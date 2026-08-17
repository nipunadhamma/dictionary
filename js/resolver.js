"use strict";

window.Dict = window.Dict || {};
Dict.resolver = Dict.resolver || {};

// ── Resolve a single entry by wordId ───────────────────────
// Priority: Firestore approved override > static base > Firestore new entry
// Returns: { source: "static"|"override"|"new", entry: {...} }

async function resolveEntry(wordId) {
    // 1. Try Firestore first (covers overrides + editor-created new entries)
    if (Dict.db.init() && Dict.db.isAvailable()) {
        try {
            var C = Dict.db.COLLECTIONS;
            var wordSnap = await Dict.db.docRef(C.words, wordId).get();
            if (wordSnap.exists) {
                var word = { id: wordSnap.id, ...wordSnap.data() };

                // Load sub-collections
                var col = Dict.db.col;
                var queries = [
                    col(C.wordMeanings).where("wordId", "==", wordId).orderBy("order").get(),
                    col(C.wordForms).where("wordId", "==", wordId).orderBy("order").get(),
                    col(C.examples).where("wordId", "==", wordId).orderBy("order").get(),
                ];
                var snaps = await Promise.all(queries);

                word.meanings = [];
                snaps[0].forEach(function(d) {
                    word.meanings.push({ id: d.id, ...d.data() });
                });
                word.forms = [];
                snaps[1].forEach(function(d) {
                    word.forms.push({ id: d.id, ...d.data() });
                });
                word.examples = [];
                snaps[2].forEach(function(d) {
                    word.examples.push({ id: d.id, ...d.data() });
                });

                // Check if this word has an approved override source
                var hasOverride = word.overridden || (word.status === "published" && word.source === "override");
                return {
                    source: hasOverride ? "override" : "new",
                    entry: word,
                };
            }
        } catch (error) {
            console.warn("[resolver] Firestore lookup failed:", error);
        }
    }

    // 2. Try static base
    try {
        var staticEntry = await Dict.static.getEntryByWordId(wordId);
        if (staticEntry) {
            return { source: "static", entry: staticEntry };
        }
    } catch (error) {
        console.warn("[resolver] Static lookup failed:", error);
    }

    return { source: null, entry: null };
}

// ── Resolve multiple entries (for search results) ──────────
// Returns: { byId: { wordId: { source, entry } }, wordIds: [...] }

async function resolveEntries(wordIds) {
    var result = { byId: {}, wordIds: wordIds };

    // Try static base first (fast, local)
    try {
        var staticEntries = await Dict.static.getEntriesByWordIds(wordIds);
        staticEntries.forEach(function(e) {
            result.byId[e.id] = { source: "static", entry: e };
        });
    } catch (error) {
        console.warn("[resolver] static batch load failed:", error);
    }

    // Then check Firestore for any overrides or newer versions
    if (Dict.db.init() && Dict.db.isAvailable()) {
        try {
            var C = Dict.db.COLLECTIONS;
            // Firestore IN query max is 10 items — batch
            for (var i = 0; i < wordIds.length; i += 10) {
                var batch = wordIds.slice(i, i + 10);
                var snap = await Dict.db.col(C.words)
                    .where(firebase.firestore.FieldPath.documentId(), "in", batch)
                    .get();
                snap.forEach(function(d) {
                    var word = { id: d.id, ...d.data() };
                    var hasOverride = word.overridden || (word.status === "published" && word.source === "override");
                    result.byId[d.id] = {
                        source: hasOverride ? "override" : "new",
                        entry: word,
                    };
                });
            }
        } catch (error) {
            console.warn("[resolver] Firestore batch lookup failed:", error);
        }
    }

    return result;
}

// ── Get entry for display (combines static + Firestore) ────
// Used by entry.html to render the full word page.
// Returns a unified entry object suitable for renderEntryPage.

async function getDisplayEntry(wordId) {
    var resolved = await resolveEntry(wordId);
    if (!resolved.entry) return null;

    var entry = resolved.entry;

    // For static entries, format to match Firestore word schema
    if (resolved.source === "static") {
        return {
            id: entry.id,
            headword: entry.r || "",
            headwordSi: entry.w || "",
            meanings: (entry.meanings || []).map(function(m, i) {
                return {
                    order: i,
                    si: m.si || "",
                    sourceId: m.src || "",
                    grammar: null,
                };
            }),
            forms: [],
            examples: [],
            status: "published",
            source: "static",
            overridden: false,
            _static: true,
        };
    }

    // For Firestore entries (override or new), return as-is
    entry._static = false;
    return entry;
}

Dict.resolver.resolveEntry = resolveEntry;
Dict.resolver.resolveEntries = resolveEntries;
Dict.resolver.getDisplayEntry = getDisplayEntry;
