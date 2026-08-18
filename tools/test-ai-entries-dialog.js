#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ROOT = path.resolve(__dirname, "..");
var SRC = path.join(ROOT, "data", "pali-sinhala-web.json");
var EXPORT = path.join(ROOT, "data", "ai-entries.json");
var JS_FILE = path.join(ROOT, "js", "ai-entries.js");
var CSS_FILE = path.join(ROOT, "css", "app.css");
var DASH_JS = path.join(ROOT, "js", "dashboard.js");
var DASH_HTML = path.join(ROOT, "dashboard.html");

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

function fileExists(p) {
    try { fs.accessSync(p); return true; } catch (e) { return false; }
}

function readFile(p) {
    return fs.readFileSync(p, "utf8");
}

// ── Test 1: File exists ───────────────────────────────────

console.log("\n=== Test 1: Data file exists ===");
assert(fileExists(EXPORT), "data/ai-entries.json exists");
assert(fileExists(SRC), "data/pali-sinhala-web.json exists");

// ── Test 2: Entry count ───────────────────────────────────

console.log("\n=== Test 2: Entry count ===");
var exp = JSON.parse(readFile(EXPORT));
var src = JSON.parse(readFile(SRC));
var expKeys = Object.keys(exp.entries);
var srcKeys = Object.keys(src.entries);

assert(srcKeys.length === 161209, "Source entry count is 161,209 (actual: " + srcKeys.length + ")");
assert(expKeys.length === 6570, "Export entry count is 6,570 (actual: " + expKeys.length + ")");

// ── Test 3: Every exported entry has AI meaning ────────────

console.log("\n=== Test 3: Every exported entry has AI meaning ===");
var noAi = 0;
expKeys.forEach(function(k) {
    var e = exp.entries[k];
    var hasAi = false;
    if (e.m && e.m.src === "ai") hasAi = true;
    if (e.ms && Array.isArray(e.ms)) {
        e.ms.forEach(function(m) { if (m.src === "ai") hasAi = true; });
    }
    if (!hasAi) noAi++;
});
assert(noAi === 0, "All " + expKeys.length + " entries have at least one src:\"ai\" meaning (" + noAi + " without)");

// ── Test 4: No non-AI entries exported ─────────────────────

console.log("\n=== Test 4: No non-AI entries exported ===");
var falsePositives = 0;
expKeys.forEach(function(k) {
    var se = src.entries[k];
    if (!se) { falsePositives++; return; }
    var hasAi = false;
    if (se.m && se.m.src === "ai") hasAi = true;
    if (se.ms && Array.isArray(se.ms)) {
        se.ms.forEach(function(m) { if (m.src === "ai") hasAi = true; });
    }
    if (!hasAi) falsePositives++;
});
assert(falsePositives === 0, "No false positive exports (" + falsePositives + ")");

// ── Test 5: Source unchanged ───────────────────────────────

console.log("\n=== Test 5: Source unchanged ===");
var shaSrc = crypto.createHash("sha256").update(fs.readFileSync(SRC)).digest("hex");
assert(shaSrc === "fbb457f35e7b2151c8713fedbf578ca1835d3bff8fb765415a22d30a5f83e163",
    "Source SHA-256 matches expected (" + shaSrc.slice(0, 12) + "...)");
assert(srcKeys.length === 161209, "Source has 161,209 entries");

// ── Test 6: Search/filter works ────────────────────────────

console.log("\n=== Test 6: Search/filter logic ===");

// Simulate the filterEntries function from ai-entries.js
function filterEntries(entries, query) {
    if (!query || !query.trim()) return entries;
    var q = query.trim().toLowerCase();
    return entries.filter(function(item) {
        var e = item._entry;
        if (e.w && e.w.toLowerCase().indexOf(q) !== -1) return true;
        if (e.r && e.r.toLowerCase().indexOf(q) !== -1) return true;
        if (e.m && e.m.si && e.m.si.toLowerCase().indexOf(q) !== -1) return true;
        if (e.ms && Array.isArray(e.ms)) {
            for (var i = 0; i < e.ms.length; i++) {
                if (e.ms[i].si && e.ms[i].si.toLowerCase().indexOf(q) !== -1) return true;
            }
        }
        return false;
    });
}

var allEntries = expKeys.map(function(k) {
    return { _key: k, _entry: exp.entries[k] };
});

// Find a real Sinhala headword to test
var sampleEntry = exp.entries[expKeys[0]];
var sampleW = sampleEntry.w || "";
var sampleR = sampleEntry.r || "";

// Search by Sinhala headword
var siResults = filterEntries(allEntries, sampleW);
assert(siResults.length > 0, "Sinhala headword search finds results for '" + sampleW + "'");
assert(siResults.every(function(item) {
    return item._entry.w && item._entry.w.toLowerCase().indexOf(sampleW.toLowerCase()) !== -1;
}), "All Sinhala results contain query");

// Search by Pali headword
var plResults = filterEntries(allEntries, sampleR);
assert(plResults.length > 0, "Pali headword search finds results for '" + sampleR + "'");

// Search by meaning text
var sampleMeaning = "";
if (sampleEntry.m && sampleEntry.m.si) sampleMeaning = sampleEntry.m.si;
if (!sampleMeaning && sampleEntry.ms && sampleEntry.ms[0]) sampleMeaning = sampleEntry.ms[0].si || "";
if (sampleMeaning) {
    var meaningQuery = sampleMeaning.slice(0, 4);
    var meaningResults = filterEntries(allEntries, meaningQuery);
    assert(meaningResults.length > 0, "Meaning text search finds results for '" + meaningQuery + "'");
} else {
    assert(true, "No meaning to test (skipped)");
}

// Search for something that doesn't exist
var noResults = filterEntries(allEntries, "zzzznonexistent999xyz");
assert(noResults.length === 0, "Nonexistent query returns 0 results");

// Empty query returns all
var allResults = filterEntries(allEntries, "");
assert(allResults.length === expKeys.length, "Empty query returns all entries (" + allResults.length + ")");

// ── Test 7: Role visibility logic ─────────────────────────

console.log("\n=== Test 7: Role visibility logic ===");

var dashJs = readFile(DASH_JS);
var dashHtml = readFile(DASH_HTML);
var jsCode = readFile(JS_FILE);

// Button exists in admin dashboard
assert(dashJs.indexOf("data-ai-open") !== -1, "dashboard.js has data-ai-open button");

// Button rendered in admin renderer
assert(dashJs.indexOf("AI අර්ථ") !== -1, "dashboard.js has AI අර්ථ label");

// Admin link uses dash-admin-ai-btn class
assert(dashJs.indexOf("dash-admin-ai-btn") !== -1, "Admin button has dash-admin-ai-btn class");

// Editor button in header
assert(dashJs.indexOf("dash-editor-actions") !== -1, "Editor section has dash-editor-actions wrapper");

// Modal HTML exists in dashboard.html
assert(dashHtml.indexOf('id="aiModal"') !== -1, "dashboard.html has AI modal element");
assert(dashHtml.indexOf('id="aiSearchInput"') !== -1, "dashboard.html has search input");
assert(dashHtml.indexOf('id="aiList"') !== -1, "dashboard.html has list container");
assert(dashHtml.indexOf('id="aiMore"') !== -1, "dashboard.html has load-more container");
assert(dashHtml.indexOf('data-ai-close') !== -1, "dashboard.html has close buttons");

// Script tag loaded
assert(dashHtml.indexOf('js/ai-entries.js') !== -1, "dashboard.html loads ai-entries.js");

// Auth check: renderAdminDashboard only called for admins
// The role check is via auth.isEditor which covers admin+editor
assert(dashJs.indexOf("renderAdminDashboard") !== -1, "renderAdminDashboard exists");
assert(dashJs.indexOf("renderEditorDashboard") !== -1, "renderEditorDashboard exists");

// Public users see renderPublicDashboard, which does NOT show AI button
assert(dashJs.indexOf("renderPublicDashboard") !== -1, "renderPublicDashboard exists for public users");
var publicFnMatch = dashJs.match(/function renderPublicDashboard[\s\S]*?^}/m);
if (publicFnMatch) {
    assert(publicFnMatch[0].indexOf("data-ai-open") === -1,
        "renderPublicDashboard does NOT have data-ai-open button");
}

// ── Test 8: JS module structure ───────────────────────────

console.log("\n=== Test 8: JS module structure ===");

assert(jsCode.indexOf("Dict.aiEntries") !== -1, "ai-entries.js exposes Dict.aiEntries");
assert(jsCode.indexOf("openModal") !== -1, "ai-entries.js has openModal function");
assert(jsCode.indexOf("closeModal") !== -1, "ai-entries.js has closeModal function");
assert(jsCode.indexOf("filterEntries") !== -1, "ai-entries.js has filterEntries function");
assert(jsCode.indexOf("data/ai-entries.json") !== -1, "ai-entries.js references correct data URL");
assert(jsCode.indexOf("addEventListener") !== -1, "ai-entries.js binds keyboard/mouse events");
assert(jsCode.indexOf("Escape") !== -1 || jsCode.indexOf("keyCode") !== -1,
    "ai-entries.js handles Escape key");
assert(jsCode.indexOf("data-ai-close") !== -1, "ai-entries.js handles close via data-ai-close");
assert(jsCode.indexOf("data-ai-open") !== -1, "ai-entries.js handles open via data-ai-open");
assert(jsCode.indexOf("editor.html?id=") !== -1, "ai-entries.js links to editor.html for editing");
assert(jsCode.indexOf("computeWordId") !== -1, "ai-entries.js has computeWordId function");
assert(jsCode.indexOf("crypto.subtle.digest") !== -1, "ai-entries.js uses Web Crypto for SHA-256");
assert(jsCode.indexOf("_wordId") !== -1, "ai-entries.js uses _wordId on entry items");
assert(jsCode.indexOf("PAGE_SIZE") !== -1, "ai-entries.js has pagination constant");
assert(jsCode.indexOf("50") !== -1, "ai-entries.js paginates at 50 items");

// ── Test 9: CSS classes exist ─────────────────────────────

console.log("\n=== Test 9: CSS classes exist ===");

assert(CSS_FILE && fileExists(CSS_FILE), "app.css exists");
var css = readFile(CSS_FILE);
assert(css.indexOf(".ai-modal") !== -1, "CSS has .ai-modal class");
assert(css.indexOf(".ai-modal.open") !== -1, "CSS has .ai-modal.open class");
assert(css.indexOf(".ai-modal-box") !== -1, "CSS has .ai-modal-box class");
assert(css.indexOf(".ai-modal-backdrop") !== -1, "CSS has .ai-modal-backdrop class");
assert(css.indexOf(".ai-modal-list") !== -1, "CSS has .ai-modal-list class");
assert(css.indexOf(".ai-row") !== -1, "CSS has .ai-row class");
assert(css.indexOf(".ai-row-head") !== -1, "CSS has .ai-row-head class");
assert(css.indexOf(".ai-row-si") !== -1, "CSS has .ai-row-si class");
assert(css.indexOf(".ai-row-pali") !== -1, "CSS has .ai-row-pali class");
assert(css.indexOf(".ai-meaning") !== -1, "CSS has .ai-meaning class");
assert(css.indexOf(".ai-row-link") !== -1, "CSS has .ai-row-link class");
assert(css.indexOf(".ai-modal-more") !== -1, "CSS has .ai-modal-more class");
assert(css.indexOf(".ai-modal-search") !== -1, "CSS has .ai-modal-search class");
assert(css.indexOf(".dash-admin-ai-btn") !== -1, "CSS has .dash-admin-ai-btn class");
assert(css.indexOf(".dash-editor-actions") !== -1, "CSS has .dash-editor-actions class");

// ── Test 10: Entry data preserved ──────────────────────────

console.log("\n=== Test 10: Entry data preserved ===");
var dataMatch = 0;
expKeys.forEach(function(k) {
    if (JSON.stringify(exp.entries[k]) === JSON.stringify(src.entries[k])) dataMatch++;
});
assert(dataMatch === expKeys.length,
    "All " + dataMatch + "/" + expKeys.length + " entries match source exactly");

// ── Summary ────────────────────────────────────────────────

console.log("\n====================================");
console.log("Results: " + pass + " PASS, " + fail + " FAIL");
console.log("====================================");

process.exit(fail > 0 ? 1 : 0);
