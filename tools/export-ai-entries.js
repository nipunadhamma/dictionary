#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ROOT = path.resolve(__dirname, "..");
var SRC = path.join(ROOT, "data", "pali-sinhala-web.json");
var OUT = path.join(ROOT, "data", "ai-entries.json");

// ── SHA-256 of source before ───────────────────────────────

var srcRaw = fs.readFileSync(SRC);
var shaBefore = crypto.createHash("sha256").update(srcRaw).digest("hex");
console.log("Source SHA-256 (before): " + shaBefore);

// ── Parse and scan ─────────────────────────────────────────

var src = JSON.parse(srcRaw.toString("utf8"));
var srcKeys = Object.keys(src.entries);
console.log("Source entry count: " + srcKeys.length);

var aiEntries = {};
var totalAiMeanings = 0;

srcKeys.forEach(function(k) {
    var e = src.entries[k];
    var hasAi = false;

    if (e.m && e.m.src === "ai") {
        hasAi = true;
        totalAiMeanings++;
    }
    if (e.ms && Array.isArray(e.ms)) {
        e.ms.forEach(function(m) {
            if (m.src === "ai") {
                hasAi = true;
                totalAiMeanings++;
            }
        });
    }

    if (hasAi) {
        aiEntries[k] = e;
    }
});

var exportedCount = Object.keys(aiEntries).length;
console.log("Exported entry count: " + exportedCount);
console.log("AI meaning count: " + totalAiMeanings);

// ── Write output ───────────────────────────────────────────

var output = {
    _meta: {
        source: "pali-sinhala-web.json",
        filter: "at least one meaning with src === ai",
        entryCount: exportedCount,
        aiMeaningCount: totalAiMeanings,
    },
    entries: aiEntries,
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2), "utf8");
console.log("Written to: " + OUT);

// ── Verify source unchanged ────────────────────────────────

var srcRawAfter = fs.readFileSync(SRC);
var shaAfter = crypto.createHash("sha256").update(srcRawAfter).digest("hex");
console.log("Source SHA-256 (after):  " + shaAfter);
console.log("Source unchanged: " + (shaBefore === shaAfter ? "YES" : "NO — MODIFIED!"));

if (shaBefore !== shaAfter) {
    console.error("ERROR: Source file was modified!");
    process.exit(1);
}
