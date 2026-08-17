"use strict";

window.Dict = window.Dict || {};
Dict.search = Dict.search || {};

const PAGE_SIZE = 20;

const MATCH_PALI = "pali";
const MATCH_SINHALA = "sinhala";
const MATCH_SINGLISH = "singlish";
const MATCH_MEANING = "meaning";

Dict.search.MATCH = {
    PALI: MATCH_PALI,
    SINHALA: MATCH_SINHALA,
    SINGLISH: MATCH_SINGLISH,
    MEANING: MATCH_MEANING,
};

Dict.search.PAGE_SIZE = PAGE_SIZE;

// ── Mode detection ──────────────────────────────────────────

function detectMode(query, opts) {
    const q = String(query || "").trim();
    if (!q) return null;
    if (opts && opts.byMeaning) return MATCH_MEANING;
    if (Dict.normalize.isSinhala(q)) return MATCH_SINHALA;
    return MATCH_PALI;
}

// ── Query planning ──────────────────────────────────────────

function planQuery(raw, opts) {
    const q = String(raw || "").trim();
    if (!q) return null;
    const mode = detectMode(q, opts);

    if (mode === MATCH_MEANING) {
        return {
            raw: q,
            mode: mode,
            norm: Dict.normalize.normSinhala(q),
            prefix: Dict.normalize.normSinhala(q),
        };
    }
    if (mode === MATCH_SINHALA) {
        return {
            raw: q,
            mode: mode,
            norm: Dict.normalize.normSinhala(q),
            prefix: Dict.normalize.normSinhala(q),
        };
    }
    // Pali or potential Singlish
    return {
        raw: q,
        mode: mode,
        norm: Dict.normalize.normSearch(q),
        prefix: Dict.normalize.normSearch(q),
    };
}

// ── Dedupe helper ───────────────────────────────────────────

function mergeResults(base, extra, matchType) {
    const ids = new Set(base.map(function(r) { return r.id; }));
    extra.forEach(function(d) {
        if (!ids.has(d.id)) {
            ids.add(d.id);
            base.push({ id: d.id, ...d.data(), match: matchType });
        }
    });
}

// ── Search: meaning mode ────────────────────────────────────
// Primary: Sinhala prefix on si (cursor-paginated).
// First page only: exact token match in siAll.

async function searchByMeaning(prefix, lastDoc) {
    const col = Dict.db.col(Dict.db.COLLECTIONS.searchIndex);

    // Primary: Sinhala prefix range on si
    let q = col
        .where("si", ">=", prefix)
        .where("si", "<", prefix + "\uf8ff")
        .orderBy("si");
    if (lastDoc) q = q.startAfter(lastDoc);
    q = q.limit(PAGE_SIZE);

    const prefixSnap = await q.get();
    const cursor = prefixSnap.docs.length > 0
        ? prefixSnap.docs[prefixSnap.docs.length - 1]
        : null;

    // Paginating: only return primary results
    if (lastDoc) {
        const out = [];
        prefixSnap.forEach(function(d) {
            out.push({ id: d.id, ...d.data(), match: MATCH_MEANING });
        });
        return { results: out, cursor: cursor };
    }

    // First page: also try exact token match in siAll
    const out = [];
    const tokenSnap = await col
        .where("siAll", "array-contains", prefix)
        .limit(PAGE_SIZE)
        .get();
    tokenSnap.forEach(function(d) {
        out.push({ id: d.id, ...d.data(), match: MATCH_MEANING });
    });

    mergeResults(out, prefixSnap, MATCH_MEANING);

    return { results: out.slice(0, PAGE_SIZE), cursor: cursor };
}

// ── Search: Sinhala mode ────────────────────────────────────
// Single cursor-paginated prefix query on si.

async function searchBySinhala(prefix, lastDoc) {
    const col = Dict.db.col(Dict.db.COLLECTIONS.searchIndex);

    let q = col
        .where("si", ">=", prefix)
        .where("si", "<", prefix + "\uf8ff")
        .orderBy("si");
    if (lastDoc) q = q.startAfter(lastDoc);
    q = q.limit(PAGE_SIZE);

    const snap = await q.get();
    const cursor = snap.docs.length > 0
        ? snap.docs[snap.docs.length - 1]
        : null;

    const out = [];
    snap.forEach(function(d) {
        out.push({ id: d.id, ...d.data(), match: MATCH_SINHALA });
    });
    return { results: out, cursor: cursor };
}

// ── Search: Pali/Singlish mode ──────────────────────────────
// Primary: Pali prefix on paliPrefix (cursor-paginated).
// First page only: Singlish array-contains on slAll.

async function searchByPali(prefix, rawLower, lastDoc) {
    const col = Dict.db.col(Dict.db.COLLECTIONS.searchIndex);
    const out = [];

    // 1. Primary: Pali prefix range on paliPrefix
    let q = col
        .where("paliPrefix", ">=", prefix)
        .where("paliPrefix", "<", prefix + "\uf8ff")
        .orderBy("paliPrefix");
    if (lastDoc) q = q.startAfter(lastDoc);
    q = q.limit(PAGE_SIZE);

    const paliSnap = await q.get();
    const cursor = paliSnap.docs.length > 0
        ? paliSnap.docs[paliSnap.docs.length - 1]
        : null;

    paliSnap.forEach(function(d) {
        out.push({ id: d.id, ...d.data(), match: MATCH_PALI });
    });

    // Paginating: only return primary results
    if (lastDoc) {
        return { results: out, cursor: cursor };
    }

    // 2. First page: Singlish — try normalized form
    if (prefix) {
        const slSnap = await col
            .where("slAll", "array-contains", prefix)
            .limit(PAGE_SIZE)
            .get();
        mergeResults(out, slSnap, MATCH_SINGLISH);
    }

    // 3. Singlish: try raw lowercase
    if (rawLower && rawLower !== prefix) {
        const slRawSnap = await col
            .where("slAll", "array-contains", rawLower)
            .limit(PAGE_SIZE)
            .get();
        mergeResults(out, slRawSnap, MATCH_SINGLISH);
    }

    // 4. Fallback: token variants
    if (out.length < 5) {
        const tokens = Dict.normalize.tokenize(rawLower || prefix);
        for (let i = 0; i < Math.min(tokens.length, 3); i++) {
            const t = tokens[i];
            if (t && t !== prefix) {
                const tSnap = await col
                    .where("slAll", "array-contains", t)
                    .limit(30)
                    .get();
                mergeResults(out, tSnap, MATCH_SINGLISH);
            }
        }
    }

    return { results: out.slice(0, PAGE_SIZE), cursor: cursor };
}

// ── Main search ─────────────────────────────────────────────
// opts.lastDoc — Firestore DocumentSnapshot for cursor pagination.
// Returns { plan, results, cursor, note }.

async function search(raw, opts) {
    const plan = planQuery(raw, opts);
    if (!plan) return { plan: null, results: [], cursor: null, note: "empty" };

    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { plan: plan, results: [], cursor: null, note: "not_configured" };
    }

    try {
        const lastDoc = (opts && opts.lastDoc) || null;
        const rawLower = Dict.normalize.normPali(plan.raw);
        let result;

        if (plan.mode === MATCH_MEANING) {
            result = await searchByMeaning(plan.prefix, lastDoc);
        } else if (plan.mode === MATCH_SINHALA) {
            result = await searchBySinhala(plan.prefix, lastDoc);
        } else {
            result = await searchByPali(plan.prefix, rawLower, lastDoc);
        }

        return {
            plan: plan,
            results: result.results,
            cursor: result.cursor,
            note: "ok",
        };
    } catch (error) {
        console.warn("[search] query failed:", error);
        return { plan: plan, results: [], cursor: null, note: "error" };
    }
}

Dict.search.detectMode = detectMode;
Dict.search.planQuery = planQuery;
Dict.search.search = search;
