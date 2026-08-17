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
    var q = String(query || "").trim();
    if (!q) return null;
    if (opts && opts.byMeaning) return MATCH_MEANING;
    if (Dict.normalize.isSinhala(q)) return MATCH_SINHALA;
    return MATCH_PALI;
}

// ── Query planning ──────────────────────────────────────────

function planQuery(raw, opts) {
    var q = String(raw || "").trim();
    if (!q) return null;
    var mode = detectMode(q, opts);

    if (mode === MATCH_MEANING) {
        return { raw: q, mode: mode, norm: Dict.normalize.normSinhala(q), prefix: Dict.normalize.normSinhala(q) };
    }
    if (mode === MATCH_SINHALA) {
        return { raw: q, mode: mode, norm: Dict.normalize.normSinhala(q), prefix: Dict.normalize.normSinhala(q) };
    }
    return { raw: q, mode: mode, norm: Dict.normalize.normSearch(q), prefix: Dict.normalize.normSearch(q) };
}

// ── Dedupe helper ───────────────────────────────────────────

function dedupeById(items) {
    var seen = {};
    return items.filter(function(r) {
        if (seen[r.id]) return false;
        seen[r.id] = true;
        return true;
    });
}

// ── Static search functions ─────────────────────────────────

async function staticSearchPali(prefix) {
    try {
        return await Dict.static.searchStaticIndex("pali", prefix);
    } catch (e) {
        console.warn("[search] static pali failed:", e);
        return [];
    }
}

async function staticSearchSinhala(prefix) {
    try {
        return await Dict.static.searchStaticIndex("si", prefix);
    } catch (e) {
        console.warn("[search] static si failed:", e);
        return [];
    }
}

async function staticSearchSinglish(prefix) {
    try {
        return await Dict.static.searchStaticIndex("sl", prefix);
    } catch (e) {
        console.warn("[search] static sl failed:", e);
        return [];
    }
}

async function staticSearchMeaning(prefix) {
    try {
        return await Dict.static.searchStaticIndex("mi", prefix);
    } catch (e) {
        console.warn("[search] static mi failed:", e);
        return [];
    }
}

// ── Firestore search functions ──────────────────────────────

async function fsSearchByMeaning(prefix, lastDoc) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) return { results: [], cursor: null };

    var col = Dict.db.col(Dict.db.COLLECTIONS.searchIndex);
    var q = col.where("si", ">=", prefix).where("si", "<", prefix + "\uf8ff").orderBy("si");
    if (lastDoc) q = q.startAfter(lastDoc);
    q = q.limit(PAGE_SIZE);

    var snap = await q.get();
    var cursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

    var out = [];
    snap.forEach(function(d) { out.push({ id: d.id, ...d.data(), match: MATCH_MEANING }); });
    return { results: out, cursor: cursor };
}

async function fsSearchBySinhala(prefix, lastDoc) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) return { results: [], cursor: null };

    var col = Dict.db.col(Dict.db.COLLECTIONS.searchIndex);
    var out = [];

    // Primary: exact token match on "all" field
    // The "all" array contains individual Sinhala tokens (e.g. ["නවලොකොත්තර", "ධර්මය", "dharmaya"])
    var tokenSnap = await col.where("all", "array-contains", prefix).limit(PAGE_SIZE).get();
    tokenSnap.forEach(function(d) {
        out.push({ id: d.id, ...d.data(), match: MATCH_SINHALA });
    });

    // Secondary: prefix match on "si" field (works when si starts with the search term)
    if (!lastDoc) {
        var q = col.where("si", ">=", prefix).where("si", "<", prefix + "\uf8ff").orderBy("si");
        q = q.limit(PAGE_SIZE);
        var siSnap = await q.get();
        siSnap.forEach(function(d) {
            if (!out.find(function(r) { return r.id === d.id; }))
                out.push({ id: d.id, ...d.data(), match: MATCH_SINHALA });
        });
    }

    // Cursor from combined results for pagination
    var lastResults = out.slice(-PAGE_SIZE);

    return { results: out.slice(0, PAGE_SIZE), cursor: null };
}

async function fsSearchByPali(prefix, rawLower, lastDoc) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) return { results: [], cursor: null };

    var col = Dict.db.col(Dict.db.COLLECTIONS.searchIndex);
    var out = [];

    // Pali prefix
    var q = col.where("paliPrefix", ">=", prefix).where("paliPrefix", "<", prefix + "\uf8ff").orderBy("paliPrefix");
    if (lastDoc) q = q.startAfter(lastDoc);
    q = q.limit(PAGE_SIZE);

    var paliSnap = await q.get();
    var cursor = paliSnap.docs.length > 0 ? paliSnap.docs[paliSnap.docs.length - 1] : null;

    paliSnap.forEach(function(d) { out.push({ id: d.id, ...d.data(), match: MATCH_PALI }); });

    if (!lastDoc && prefix) {
        // Singlish: normalized form
        var slSnap = await col.where("slAll", "array-contains", prefix).limit(PAGE_SIZE).get();
        slSnap.forEach(function(d) {
            if (!out.find(function(r) { return r.id === d.id; }))
                out.push({ id: d.id, ...d.data(), match: MATCH_SINGLISH });
        });
        // Singlish: raw lowercase
        if (rawLower && rawLower !== prefix) {
            var slRawSnap = await col.where("slAll", "array-contains", rawLower).limit(PAGE_SIZE).get();
            slRawSnap.forEach(function(d) {
                if (!out.find(function(r) { return r.id === d.id; }))
                    out.push({ id: d.id, ...d.data(), match: MATCH_SINGLISH });
            });
        }
        // Fallback token variants
        if (out.length < 5) {
            var tokens = Dict.normalize.tokenize(rawLower || prefix);
            for (var i = 0; i < Math.min(tokens.length, 3); i++) {
                var t = tokens[i];
                if (t && t !== prefix) {
                    var tSnap = await col.where("slAll", "array-contains", t).limit(30).get();
                    tSnap.forEach(function(d) {
                        if (!out.find(function(r) { return r.id === d.id; }))
                            out.push({ id: d.id, ...d.data(), match: MATCH_SINGLISH });
                    });
                }
            }
        }
    }

    return { results: out.slice(0, PAGE_SIZE), cursor: cursor };
}

// ── Merge static + Firestore results ───────────────────────
// Static results come first (instant), then Firestore additions.

function normalizeStaticResult(item, matchType) {
    return {
        id: item.id,
        headword: item.r || "",
        si: "",
        wordId: item.id,
        match: matchType,
        _source: "static",
        _w: item.w || "",
    };
}

function mergeAndDedupe(staticResults, fsResults, matchType) {
    var seen = {};
    var out = [];

    staticResults.forEach(function(r) {
        var item = (r._source === "static") ? r : normalizeStaticResult(r, matchType);
        if (!seen[item.id]) {
            seen[item.id] = true;
            out.push(item);
        }
    });

    fsResults.forEach(function(r) {
        if (!seen[r.id]) {
            seen[r.id] = true;
            out.push(r);
        }
    });

    return out;
}

// ── Main search ─────────────────────────────────────────────
// Returns { plan, results, cursor, note, _staticTotal }

async function search(raw, opts) {
    var plan = planQuery(raw, opts);
    if (!plan) return { plan: null, results: [], cursor: null, note: "empty" };

    var lastDoc = (opts && opts.lastDoc) || null;
    var rawLower = Dict.normalize.normPali(plan.raw);
    var staticOffset = (opts && opts._staticOffset) || 0;

    // ── Static search (first page only) ──
    var staticResults = [];
    if (!lastDoc) {
        if (plan.mode === MATCH_PALI) {
            staticResults = await staticSearchPali(plan.prefix);
            // Also try singlish on static
            var slStatic = await staticSearchSinglish(plan.prefix);
            staticResults = mergeAndDedupe(staticResults, slStatic.map(function(r) {
                return normalizeStaticResult(r, MATCH_SINGLISH);
            }), plan.mode);
        } else if (plan.mode === MATCH_SINHALA) {
            staticResults = await staticSearchSinhala(plan.prefix);
        } else if (plan.mode === MATCH_MEANING) {
            staticResults = await staticSearchMeaning(plan.prefix);
        } else if (plan.mode === MATCH_SINGLISH) {
            staticResults = await staticSearchSinglish(plan.prefix);
        }

        // Mark all as static
        staticResults = staticResults.map(function(r) {
            if (!r._source) return normalizeStaticResult(r, plan.mode);
            r.match = r.match || plan.mode;
            return r;
        });
    }

    // ── Firestore search ──
    var fsResult = { results: [], cursor: null };
    try {
        if (plan.mode === MATCH_MEANING) {
            fsResult = await fsSearchByMeaning(plan.prefix, lastDoc);
        } else if (plan.mode === MATCH_SINHALA) {
            fsResult = await fsSearchBySinhala(plan.prefix, lastDoc);
        } else {
            fsResult = await fsSearchByPali(plan.prefix, rawLower, lastDoc);
        }
    } catch (error) {
        console.warn("[search] Firestore search failed:", error);
    }

    // ── Merge ──
    var allResults = mergeAndDedupe(
        staticResults.slice(staticOffset),
        fsResult.results,
        plan.mode
    );

    return {
        plan: plan,
        results: allResults.slice(0, PAGE_SIZE),
        cursor: fsResult.cursor,
        note: "ok",
        _staticTotal: staticResults.length,
        _staticOffset: staticOffset + Math.min(allResults.length, PAGE_SIZE),
    };
}

Dict.search.detectMode = detectMode;
Dict.search.planQuery = planQuery;
Dict.search.search = search;
