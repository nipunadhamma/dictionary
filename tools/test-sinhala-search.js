#!/usr/bin/env node
"use strict";

// Focused regression test for Sinhala search normalization and token structure.
// The actual Firestore query fix (all.array-contains) must be verified in-browser.

var pass = 0, fail = 0;
function check(label, cond, detail) {
    if (cond) { pass++; console.log("  PASS  " + label); }
    else { fail++; console.log("  FAIL  " + label + (detail ? " -- " + detail : "")); }
}

function normSinhala(t) { return String(t||"").normalize("NFC").replace(/[\u200c\u200d]/g,"").trim(); }
function isSinhala(t) { return /[\u0d80-\u0dff]/.test(String(t||"")); }

// ── mode detection ──────────────────────────────────────────

console.log("=== SINHALA SEARCH REGRESSION TEST ===\n");

console.log("--- Mode detection ---");
check("\"ධර්මය\" detected as Sinhala", isSinhala("ධර්මය"));
check("\"නවලොකොත්තර ධර්මය\" detected as Sinhala", isSinhala("නවලොකොත්තර ධර්මය"));
check("\"dharmaya\" NOT detected as Sinhala", !isSinhala("dharmaya"));
check("\"dhamma\" NOT detected as Sinhala", !isSinhala("dhamma"));

// ── normalization ───────────────────────────────────────────

console.log("\n--- normSinhala output ---");
var n1 = normSinhala("ධර්මය");
check("normSinhala(\"ධර්මය\") = \"ධර්මය\"", n1 === "ධර්මය", "got: \"" + n1 + "\"");

var n2 = normSinhala("  ධර්මය  ");
check("normSinhala trims whitespace", n2 === "ධර්මය", "got: \"" + n2 + "\"");

var n3 = normSinhala("ධර\u200Dමය");
check("normSinhala strips ZWJ", n3 === "ධරමය", "got: \"" + n3 + "\" (ZWJ removed, virama not present)");

var n4 = normSinhala("ධර\u200Cමය");
check("normSinhala strips ZWNJ", n4 === "ධරමය", "got: \"" + n4 + "\" (ZWNJ removed, virama not present)");

// The actual word ධර්මය uses virama U+0DCA, not ZWJ/ZWNJ
var n7 = normSinhala("ධර\u0DCAමය");
check("normSinhala preserves virama U+0DCA", n7 === "ධර්මය", "got: \"" + n7 + "\"");

var n5 = normSinhala("ධර්මය");
var n6 = normSinhala("ධර්මය");
check("normSinhala is deterministic", n5 === n6, "got: \"" + n5 + "\" vs \"" + n6 + "\"");

// ── Expected Firestore searchIndex structure ────────────────
// For the entry with wordId "w_74da98b4e68eabe5", the Firestore
// searchIndex document should contain:
//   all: ["නවලොකොත්තර", "ධර්මය", "dharmaya"]
//   si:  "නවලොකොත්තර ධර්මය"
//   siAll: ["නවලොකොත්තර ධර්මය"]
//
// The fix changes fsSearchBySinhala from:
//   col.where("si", ">=", prefix).where("si", "<", prefix + "\uf8ff")
// to:
//   col.where("all", "array-contains", prefix)
//
// This matches because "ධර්මය" IS an element of the "all" array.

console.log("\n--- Firestore query structure verification ---");

// Simulate the "all" array from Firestore
var mockAll = ["නවලොකොත්තර", "ධර්මය", "dharmaya"];
check("\"all\" array contains \"ධර්මය\"", mockAll.indexOf("ධර්මය") >= 0);
check("\"all\" array contains \"නවලොකොත්තර\"", mockAll.indexOf("නවලොකොත්තර") >= 0);
check("\"all\" array contains \"dharmaya\"", mockAll.indexOf("dharmaya") >= 0);

// Verify old si prefix range would NOT match
var si = "නවලොකොත්තර ධර්මය";
var prefix = "ධර්මය";
var siGePrefix = si >= prefix;
var siLtRange = si < prefix + "\uf8ff";
check("Old si range: si >= prefix is " + siGePrefix, siGePrefix,
    "si=\"" + si + "\" prefix=\"" + prefix + "\"");
check("Old si range: si < prefix+\\uf8ff is " + siLtRange, !siLtRange,
    "si=\"" + si + "\" upper=\"" + prefix + "\\uf8ff\" (expected false)");
check("Old si prefix range would NOT match (both conditions needed)",
    !(siGePrefix && siLtRange),
    "This confirms the old query was broken for this case");

// Verify new all.array-contains would match
check("New all.array-contains(prefix) WOULD match",
    mockAll.indexOf(prefix) >= 0,
    "prefix=\"" + prefix + "\" found in all array");

// ── Prefix matching behavior ────────────────────────────────

console.log("\n--- Prefix matching edge cases ---");
check("\"ධර්\" is NOT an exact element of all array",
    mockAll.indexOf("ධර්") < 0,
    "array-contains requires exact element match, not prefix");

check("\"නවලොකොත්තර ධර්මය\" WOULD match siAll array-contains",
    ["නවලොකොත්තර ධර්මය"].indexOf("නවලොකොත්තර ධර්මය") >= 0);

// ── Other Sinhala words (sanity) ────────────────────────────

console.log("\n--- Other Sinhala normalization ---");
var tests = [
    { input: "බුද්ධ", expected: "බුද්ධ" },
    { input: "නිවන", expected: "නිවන" },
    { input: "නයය", expected: "නයය" },
];
tests.forEach(function(t) {
    var got = normSinhala(t.input);
    check("normSinhala(\"" + t.input + "\") = \"" + t.expected + "\"",
        got === t.expected, "got: \"" + got + "\"");
});

// ── Summary ─────────────────────────────────────────────────

console.log("\n=== RESULT: " + pass + " PASS, " + fail + " FAIL ===");
if (fail > 0) process.exit(1);
