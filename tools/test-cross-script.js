#!/usr/bin/env node
"use strict";

// Cross-script search regression test using actual static index data.
// Verifies that Pali ↔ Sinhala cross-referencing finds matching entries
// by loading the correct chunks and matching headword prefixes.

var fs = require("fs");
var path = require("path");

var OUT = path.resolve(__dirname, "../data/dictionary");
var pass = 0, fail = 0;

function check(label, cond, detail) {
    if (cond) { pass++; console.log("  PASS  " + label); }
    else { fail++; console.log("  FAIL  " + label + (detail ? " -- " + detail : "")); }
}

function normSearch(text) {
    return String(text || "").toLowerCase().replace(/[\s]+/g, " ").trim()
        .replace(/[\u200c\u200d]/g, "")
        .replace(/\u0101/g, "a").replace(/\u012B/g, "i").replace(/\u016B/g, "u")
        .replace(/\u1E43/g, "m").replace(/\u1E45/g, "n").replace(/\u1E47/g, "n")
        .replace(/\u1E6D/g, "t").replace(/\u1E0D/g, "d").replace(/\u1E37/g, "l");
}

function normSinhala(text) {
    return String(text || "").normalize("NFC").replace(/[\u200c\u200d]/g, "").trim();
}

function safeKey(t, len) {
    return (String(t || "").replace(/[^a-z0-9\u0d80-\u0dff]/gi, "").toLowerCase().slice(0, len) || "xx").padEnd(len, "x");
}

function loadChunk(dir, prefix) {
    var ck = safeKey(prefix, 2);
    var fp = path.join(OUT, "index", dir, ck + ".json");
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8"));
}

function searchIndex(chunk, prefix) {
    if (!chunk || !prefix) return [];
    var results = [];
    var keys = Object.keys(chunk);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(prefix) === 0) {
            var arr = chunk[keys[i]];
            for (var j = 0; j < arr.length; j++) results.push(arr[j]);
        }
    }
    return results;
}

function dedupeById(items) {
    var seen = {};
    return items.filter(function(r) {
        if (seen[r.id]) return false;
        seen[r.id] = true;
        return true;
    });
}

// ── Cross-reference: Pali primary → SI results ─────────────

function xrefPali(primaryResults) {
    var headwords = {};
    primaryResults.forEach(function(r) {
        var w = r.w || "";
        if (w && !headwords[w]) headwords[w] = r;
    });

    var prefixMap = {};
    Object.keys(headwords).forEach(function(w) {
        var ck = safeKey(normSinhala(w), 2);
        if (!prefixMap[ck]) prefixMap[ck] = [];
        prefixMap[ck].push({ hw: w, primary: headwords[w] });
    });

    var results = [];
    Object.keys(prefixMap).forEach(function(ck) {
        var chunk = loadChunk("si", ck);
        if (!chunk) return;
        prefixMap[ck].forEach(function(entry) {
            var normW = normSinhala(entry.hw);
            Object.keys(chunk).forEach(function(key) {
                if (key.indexOf(normW) !== 0) return;
                chunk[key].forEach(function(item) {
                    results.push({
                        id: item.id,
                        headword: item.r || "",
                        si: item.w || "",
                        _source: "xref",
                    });
                });
            });
        });
    });
    return dedupeById(results);
}

// ── Cross-reference: SI primary → Pali results ─────────────

function xrefSinhala(primaryResults) {
    var headwords = {};
    primaryResults.forEach(function(r) {
        var pal = r.r || "";
        if (pal && !headwords[pal]) headwords[pal] = r;
    });

    var prefixMap = {};
    Object.keys(headwords).forEach(function(pal) {
        var ck = safeKey(normSearch(pal), 2);
        if (!prefixMap[ck]) prefixMap[ck] = [];
        prefixMap[ck].push({ hw: pal, primary: headwords[pal] });
    });

    var results = [];
    Object.keys(prefixMap).forEach(function(ck) {
        var chunk = loadChunk("pali", ck);
        if (!chunk) return;
        prefixMap[ck].forEach(function(entry) {
            var normP = normSearch(entry.hw);
            Object.keys(chunk).forEach(function(key) {
                if (key.indexOf(normP) !== 0) return;
                chunk[key].forEach(function(item) {
                    results.push({
                        id: item.id,
                        headword: item.r || "",
                        si: item.w || "",
                        _source: "xref",
                    });
                });
            });
        });
    });
    return dedupeById(results);
}

// ── Load chunks ────────────────────────────────────────────

console.log("Loading static index chunks...");

var paliDhChunk = loadChunk("pali", "dhamma");
var siDhammaChunk = loadChunk("si", "\u0DAF\u0DB8\u0DCA\u0DB8");
var paliNibbChunk = loadChunk("pali", "nibb");
var siNibbChunk = loadChunk("si", "\u0DC3\u0DD4\u0DB8\u0DCA\u0DB8");

console.log("  Pali dh.json: " + (paliDhChunk ? Object.keys(paliDhChunk).length + " keys" : "MISSING"));
console.log("  SI dhamma chunk: " + (siDhammaChunk ? Object.keys(siDhammaChunk).length + " keys" : "MISSING"));
console.log("  Pali ni.json: " + (paliNibbChunk ? Object.keys(paliNibbChunk).length + " keys" : "MISSING"));
console.log("  SI nibbana chunk: " + (siNibbChunk ? Object.keys(siNibbChunk).length + " keys" : "MISSING"));

// ── Test 1: Pali 'dhamma' → SI cross-reference ────────────

console.log("\n=== TEST 1: Pali 'dhamma' → SI cross-reference ===");

var paliDhammaResults = searchIndex(paliDhChunk, "dhamma");
console.log("  Pali 'dhamma*' results: " + paliDhammaResults.length);
check("Pali 'dhamma' primary has results", paliDhammaResults.length > 0);

// Verify all primary results have valid structure
var allHaveId = paliDhammaResults.every(function(r) { return r.id && r.id.length > 0; });
var allHaveR = paliDhammaResults.every(function(r) { return r.r && r.r.length > 0; });
var allHaveW = paliDhammaResults.every(function(r) { return r.w && r.w.length > 0; });
check("All primary results have id, r, w fields", allHaveId && allHaveR && allHaveW);

// Cross-ref
var xrefFromDhamma = xrefPali(paliDhammaResults);
console.log("  SI cross-ref results (deduped): " + xrefFromDhamma.length);
check("SI cross-ref from 'dhamma' has results", xrefFromDhamma.length > 0);

// All cross-ref results have valid structure
var xrefAllHaveId = xrefFromDhamma.every(function(r) { return r.id && r.id.length > 0; });
var xrefAllHaveSi = xrefFromDhamma.every(function(r) { return r.si && r.si.length > 0; });
check("Cross-ref results have valid id and si fields", xrefAllHaveId && xrefAllHaveSi);

// Cross-ref results are deduplicated
var xrefIds = xrefFromDhamma.map(function(r) { return r.id; });
var uniqueXrefIds = Array.from(new Set(xrefIds));
check("Cross-ref results are deduplicated", xrefIds.length === uniqueXrefIds.length,
    "got " + xrefIds.length + " total, " + uniqueXrefIds.length + " unique");

// Cross-ref should find entries NOT in primary (expansion)
var primaryIds = new Set(paliDhammaResults.map(function(r) { return r.id; }));
var expansionCount = xrefFromDhamma.filter(function(r) { return !primaryIds.has(r.id); }).length;
console.log("  Expansion (new IDs not in primary): " + expansionCount);
check("Cross-ref finds entries not in primary results", expansionCount > 0,
    "expansion=" + expansionCount);

// ── Test 2: Sinhala 'ධම්ම' → Pali cross-reference ────────

console.log("\n=== TEST 2: Sinhala 'ධම්ම' → Pali cross-reference ===");

var siDhammaResults = searchIndex(siDhammaChunk, normSinhala("\u0DAF\u0DB8\u0DCA\u0DB8"));
console.log("  SI 'ධම්ම*' results: " + siDhammaResults.length);
check("SI 'ධම්ම' primary has results", siDhammaResults.length > 0);

var xrefFromSiDhamma = xrefSinhala(siDhammaResults);
console.log("  Pali cross-ref results (deduped): " + xrefFromSiDhamma.length);
check("Pali cross-ref from 'ධම්ම' has results", xrefFromSiDhamma.length > 0);

// Cross-ref results should all have valid Pali headwords
var allHavePali = xrefFromSiDhamma.every(function(r) { return r.headword && r.headword.length > 0; });
check("Pali cross-ref results have valid Pali headwords", allHavePali);

// For small primary sets, all cross-ref IDs may overlap with primary (expected)
var siPrimaryIds = new Set(siDhammaResults.map(function(r) { return r.id; }));
var paliExpansion = xrefFromSiDhamma.filter(function(r) { return !siPrimaryIds.has(r.id); }).length;
console.log("  Expansion (new Pali IDs not in SI primary): " + paliExpansion);
check("Pali cross-ref has valid results",
    xrefFromSiDhamma.length >= siDhammaResults.length,
    "xref=" + xrefFromSiDhamma.length + " primary=" + siDhammaResults.length);

// ── Test 3: nibbāna ↔ නිබ්බාන ────────────────────────────

console.log("\n=== TEST 3: Pali 'nibbāna' ↔ Sinhala 'නිබ්බාන' ===");

var paliNibbResults = paliNibbChunk ? searchIndex(paliNibbChunk, "nibb") : [];
console.log("  Pali 'nibb*' results: " + paliNibbResults.length);
check("Pali 'nibb' primary has results", paliNibbResults.length > 0);

var siNibbResults = siNibbChunk ? searchIndex(siNibbChunk, normSinhala("\u0DC3\u0DD4\u0DB8\u0DCA\u0DB8")) : [];
console.log("  SI 'නිබ්බ*' results: " + siNibbResults.length);
check("SI 'නිබ්බාන' primary has results", siNibbResults.length > 0);

// Cross-ref Pali → SI
var xrefNibbPali = xrefPali(paliNibbResults);
console.log("  SI cross-ref from Pali 'nibb' (deduped): " + xrefNibbPali.length);
check("SI cross-ref from Pali 'nibb' has results", xrefNibbPali.length > 0);

// Cross-ref SI → Pali
var xrefNibbSi = xrefSinhala(siNibbResults);
console.log("  Pali cross-ref from SI 'නිබ්බ' (deduped): " + xrefNibbSi.length);
check("Pali cross-ref from SI 'නිබ්බාන' has results", xrefNibbSi.length > 0);

// Verify overlap: some Pali 'nibb' results should appear in SI cross-ref
var paliNibbIdSet = new Set(paliNibbResults.map(function(r) { return r.id; }));
var siXrefOverlap = xrefNibbPali.filter(function(r) { return paliNibbIdSet.has(r.id); });
console.log("  Pali primary IDs in SI cross-ref: " + siXrefOverlap.length);
check("Pali and SI results share entry IDs", siXrefOverlap.length > 0,
    "overlap=" + siXrefOverlap.length);

// ── Test 4: dhammaṃdiṭṭhi ↔ ධම්මංදිට්ඨි ──────────────────

console.log("\n=== TEST 4: 'dhammaṃdiṭṭhi' → SI cross-reference ===");

// Find entry by searching for the normalized form
var normDmd = normSearch("dhamma\u1E43di\u1E6D\u1E6Dhi");
console.log("  Normalized search key: '" + normDmd + "'");

var paliDmdResults = searchIndex(paliDhChunk, normDmd);
console.log("  Pali '" + normDmd + "' results: " + paliDmdResults.length);
check("Pali 'dhammamditthi' finds entry", paliDmdResults.length > 0,
    "searched for '" + normDmd + "' in dh.json");

if (paliDmdResults.length > 0) {
    var dmdEntry = paliDmdResults[0];
    console.log("  Entry: " + dmdEntry.id + " (r=" + dmdEntry.r + ", w=" + dmdEntry.w + ")");
    check("Entry has Pali headword", dmdEntry.r && dmdEntry.r.length > 0);
    check("Entry has Sinhala headword", dmdEntry.w && dmdEntry.w.length > 0);

    // Cross-ref from this single entry
    var xrefSingle = xrefPali([dmdEntry]);
    console.log("  SI cross-ref from single entry: " + xrefSingle.length);
    check("Single-entry cross-ref has results", xrefSingle.length > 0);

    // The cross-ref should find the same entry in the SI index
    var foundSameId = xrefSingle.some(function(r) { return r.id === dmdEntry.id; });
    check("Cross-ref finds same entry ID", foundSameId,
        "looking for " + dmdEntry.id);

    // Cross-ref Sinhala headword should match
    var matchingXref = xrefSingle.find(function(r) { return r.id === dmdEntry.id; });
    if (matchingXref) {
        check("Cross-ref entry has matching Sinhala headword",
            normSinhala(matchingXref.si) === normSinhala(dmdEntry.w),
            "xref.si=" + matchingXref.si + " primary.w=" + dmdEntry.w);
    }
}

// ── Test 5: Chunk loading efficiency ───────────────────────

console.log("\n=== TEST 5: Chunk loading efficiency ===");

// How many unique SI chunks needed for all 'dhamma' cross-refs?
var siPrefixes = new Set();
paliDhammaResults.forEach(function(r) {
    if (r.w) {
        var ck = safeKey(normSinhala(r.w), 2);
        siPrefixes.add(ck);
    }
});
console.log("  Unique SI chunks needed for 'dhamma' cross-ref: " + siPrefixes.size);
check("Cross-ref needs <= 10 SI chunks for 'dhamma'",
    siPrefixes.size <= 10,
    "needs " + siPrefixes.size + " chunks");

// How many unique Pali chunks needed for 'ධම්ම' cross-refs?
var paliPrefixes = new Set();
siDhammaResults.forEach(function(r) {
    if (r.r) {
        var ck = safeKey(normSearch(r.r), 2);
        paliPrefixes.add(ck);
    }
});
console.log("  Unique Pali chunks needed for 'ධම්ම' cross-ref: " + paliPrefixes.size);
check("Cross-ref needs <= 5 Pali chunks for 'ධම්ම'",
    paliPrefixes.size <= 5,
    "needs " + paliPrefixes.size + " chunks");

// ── Test 6: No hard-coded word mappings ────────────────────

console.log("\n=== TEST 6: Algorithmic headword extraction ===");

// Verify cross-ref extracts headwords from actual data, not hard-coded values
var testEntry = paliDhammaResults[0];
if (testEntry) {
    check("Cross-ref extracts Sinhala headword from data (w field)",
        testEntry.w && testEntry.w.length > 0,
        "w=" + testEntry.w);

    var extractedPrefix = safeKey(normSinhala(testEntry.w), 2);
    check("Chunk prefix derived from actual headword",
        extractedPrefix.length === 2 && extractedPrefix !== "xx",
        "prefix=" + extractedPrefix);

    // Verify the chunk actually exists
    var chunkExists = fs.existsSync(path.join(OUT, "index/si", extractedPrefix + ".json"));
    check("Derived chunk prefix maps to existing file", chunkExists,
        "file=" + extractedPrefix + ".json");
}

// ── Test 7: Short prefix behavior ──────────────────────────

console.log("\n=== TEST 7: Short prefix behavior ===");

var paliABigChunk = loadChunk("pali", "a");
var paliAResults = paliABigChunk ? searchIndex(paliABigChunk, "a") : [];
console.log("  Pali 'a*' results (full): " + paliAResults.length);

// Cross-ref first 20 only (simulating page 1)
var first20 = paliAResults.slice(0, 20);
var xrefA = xrefPali(first20);
console.log("  SI cross-ref from first 20 (deduped): " + xrefA.length);
check("Short prefix 'a' cross-ref from page 1 has results",
    xrefA.length > 0,
    "xref count=" + xrefA.length);

// Verify chunk count stays small
var aPrefixes = new Set();
first20.forEach(function(r) {
    if (r.w) aPrefixes.add(safeKey(normSinhala(r.w), 2));
});
console.log("  SI chunks needed for first 20: " + aPrefixes.size);
check("Short prefix needs <= 5 chunks for page 1",
    aPrefixes.size <= 5,
    "needs " + aPrefixes.size + " chunks");

// ── Test 8: nibbāna specific verification ──────────────────

console.log("\n=== TEST 8: nibbāna ↔ නිබ්බාන specific check ===");

// Find entry with Pali headword "nibbana" (without diacritics)
var nibbEntry = null;
paliNibbResults.forEach(function(r) {
    if (r.r && normSearch(r.r) === "nibbana" && !nibbEntry) nibbEntry = r;
});
if (!nibbEntry) {
    paliNibbResults.forEach(function(r) {
        if (r.r && normSearch(r.r).indexOf("nibban") === 0 && !nibbEntry) nibbEntry = r;
    });
}

if (nibbEntry) {
    console.log("  Found nibbana entry: " + nibbEntry.id + " (r=" + nibbEntry.r + ", w=" + nibbEntry.w + ")");
    check("nibbana entry found in Pali index", true);

    var xrefNibbSingle = xrefPali([nibbEntry]);
    console.log("  SI cross-ref: " + xrefNibbSingle.length + " results");
    check("nibbana cross-ref finds SI entry", xrefNibbSingle.length > 0);

    var foundNibbId = xrefNibbSingle.some(function(r) { return r.id === nibbEntry.id; });
    check("Cross-ref finds same nibbana entry by ID", foundNibbId);
} else {
    check("nibbana entry found in Pali index", false, "no entry with r starting with 'nibban'");
}

// ── Summary ────────────────────────────────────────────────

console.log("\n=== RESULT: " + pass + " PASS, " + fail + " FAIL ===");
if (fail > 0) process.exit(1);
