#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ROOT = path.resolve(__dirname, "..");
var SRC = path.join(ROOT, "data", "pali-sinhala-web.json");
var EXPORT = path.join(ROOT, "data", "ai-entries.json");

var pass = 0;
var fail = 0;

function assert(cond, label) {
    if (cond) {
        pass++;
        console.log("  PASS  " + label);
    } else {
        fail++;
        console.log("  FAIL  " + label);
    }
}

// ── Load ───────────────────────────────────────────────────

var src = JSON.parse(fs.readFileSync(SRC, "utf8"));
var exp = JSON.parse(fs.readFileSync(EXPORT, "utf8"));
var srcKeys = Object.keys(src.entries);
var expKeys = Object.keys(exp.entries);

// ── Test 1: Source integrity ───────────────────────────────

console.log("\n=== Test 1: Source integrity ===");

var shaSrc = crypto.createHash("sha256").update(fs.readFileSync(SRC)).digest("hex");
assert(srcKeys.length === 161209, "Source entry count is 161,209 (actual: " + srcKeys.length + ")");

// Verify every source entry is intact by checking first/last 100 keys
var sampleSrcKeys = srcKeys.slice(0, 100).concat(srcKeys.slice(-100));
var srcIntact = true;
sampleSrcKeys.forEach(function(k) {
    if (!src.entries[k]) srcIntact = false;
});
assert(srcIntact, "Source entries accessible (spot-checked 200 keys)");

// ── Test 2: Export metadata ────────────────────────────────

console.log("\n=== Test 2: Export metadata ===");

assert(exp._meta && exp._meta.source === "pali-sinhala-web.json", "Export _meta.source is correct");
assert(exp._meta && exp._meta.filter === "at least one meaning with src === ai", "Export _meta.filter is correct");
assert(exp._meta && exp._meta.entryCount === expKeys.length, "Export _meta.entryCount matches actual count");

// ── Test 3: Every exported entry has at least one src:"ai" ──

console.log("\n=== Test 3: Every exported entry has at least one src:\"ai\" ===");

var falseExports = 0;
var checkedExport = 0;
expKeys.forEach(function(k) {
    var e = exp.entries[k];
    var hasAi = false;
    if (e.m && e.m.src === "ai") hasAi = true;
    if (e.ms && Array.isArray(e.ms)) {
        e.ms.forEach(function(m) { if (m.src === "ai") hasAi = true; });
    }
    checkedExport++;
    if (!hasAi) falseExports++;
});

assert(falseExports === 0, "All " + checkedExport + " exported entries contain at least one src:\"ai\" meaning");

// ── Test 4: No non-AI entries were exported ────────────────

console.log("\n=== Test 4: No non-AI entries were exported ===");

var falsePositives = 0;
expKeys.forEach(function(k) {
    if (!src.entries[k]) {
        falsePositives++;
        return;
    }
    // Entry exists in source — check it should have been exported
    var se = src.entries[k];
    var shouldExport = false;
    if (se.m && se.m.src === "ai") shouldExport = true;
    if (se.ms && Array.isArray(se.ms)) {
        se.ms.forEach(function(m) { if (m.src === "ai") shouldExport = true; });
    }
    if (!shouldExport) falsePositives++;
});

assert(falsePositives === 0, "No entry in export lacks src:\"ai\" in source (" + falsePositives + " false positives)");

// ── Test 5: No AI entries were missed ──────────────────────

console.log("\n=== Test 5: No AI entries were missed ===");

var missed = 0;
srcKeys.forEach(function(k) {
    var e = src.entries[k];
    var hasAi = false;
    if (e.m && e.m.src === "ai") hasAi = true;
    if (e.ms && Array.isArray(e.ms)) {
        e.ms.forEach(function(m) { if (m.src === "ai") hasAi = true; });
    }
    if (hasAi && !exp.entries[k]) missed++;
});

assert(missed === 0, "No AI entries missing from export (" + missed + " missed)");

// ── Test 6: Entry data preserved exactly ────────────────────

console.log("\n=== Test 6: Entry data preserved exactly ===");

var dataMatch = 0;
var dataMismatch = 0;
expKeys.forEach(function(k) {
    var orig = JSON.stringify(src.entries[k]);
    var exported = JSON.stringify(exp.entries[k]);
    if (orig === exported) dataMatch++;
    else dataMismatch++;
});

assert(dataMismatch === 0, "All " + dataMatch + " entries match source exactly (0 mismatches)");

if (dataMismatch > 0) {
    expKeys.slice(0, 5).forEach(function(k) {
        var orig = src.entries[k];
        var expE = exp.entries[k];
        if (JSON.stringify(orig) !== JSON.stringify(expE)) {
            console.log("    MISMATCH: " + k);
        }
    });
}

// ── Test 7: Count consistency ──────────────────────────────

console.log("\n=== Test 7: Count consistency ===");

assert(expKeys.length === exp._meta.entryCount, "Export array length matches _meta.entryCount (" + expKeys.length + ")");
assert(expKeys.length === 6570, "Export count is 6,570 (actual: " + expKeys.length + ")");

// Count total AI meanings in export
var totalAiMeanings = 0;
expKeys.forEach(function(k) {
    var e = exp.entries[k];
    if (e.m && e.m.src === "ai") totalAiMeanings++;
    if (e.ms && Array.isArray(e.ms)) {
        e.ms.forEach(function(m) { if (m.src === "ai") totalAiMeanings++; });
    }
});
assert(totalAiMeanings === 7775, "Total AI meanings is 7,775 (actual: " + totalAiMeanings + ")");
assert(totalAiMeanings === exp._meta.aiMeaningCount, "AI meaning count matches _meta");

// ── Test 8: Original fields preserved in export ────────────

console.log("\n=== Test 8: Original fields preserved in export ===");

var hasW = 0, hasR = 0, hasC = 0;
expKeys.forEach(function(k) {
    var e = exp.entries[k];
    if (e.w) hasW++;
    if (e.r) hasR++;
    if (e.c != null) hasC++;
});

assert(hasW === expKeys.length, "All entries have 'w' field (" + hasW + "/" + expKeys.length + ")");
assert(hasR === expKeys.length, "All entries have 'r' field (" + hasR + "/" + expKeys.length + ")");
assert(hasC === expKeys.length, "All entries have 'c' field (" + hasC + "/" + expKeys.length + ")");

// ── Summary ────────────────────────────────────────────────

console.log("\n====================================");
console.log("Results: " + pass + " PASS, " + fail + " FAIL");
console.log("====================================");

process.exit(fail > 0 ? 1 : 0);
