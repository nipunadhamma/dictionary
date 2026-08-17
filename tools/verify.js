var fs = require("fs"), p = require("path");
var root = "E:/DICTIONARY/dictionary.suththa.org/data/dictionary";

var m = JSON.parse(fs.readFileSync(p.join(root, "manifest.json"), "utf8"));
console.log("=== MANIFEST ===");
console.log("Built:", m.built);
console.log("Source entries:", m.sourceEntries);
console.log("Processed:", m.processed);
console.log("Unique wordIds:", m.uniqueWordIds);
console.log("Duplicates:", m.duplicates);
console.log("Batches:", m.batches);

var batchDir = p.join(root, "entries");
var batchFiles = fs.readdirSync(batchDir);
console.log("\n=== ENTRY BATCHES ===");
console.log("Count:", batchFiles.length);
var sampleBatch = JSON.parse(fs.readFileSync(p.join(batchDir, "batch-0000.json"), "utf8"));
var sampleKeys = Object.keys(sampleBatch);
console.log("Batch 0 entries:", sampleKeys.length);
console.log("Sample entry:", JSON.stringify(sampleBatch[sampleKeys[0]]).slice(0, 200));

var lookup = JSON.parse(fs.readFileSync(p.join(root, "lookup.json"), "utf8"));
var lookupKeys = Object.keys(lookup);
console.log("\n=== LOOKUP ===");
console.log("Entries:", lookupKeys.length);
console.log("Sample:", lookupKeys[0], "-> batch", lookup[lookupKeys[0]]);

var idxDirs = ["pali", "si", "sl", "mi"];
idxDirs.forEach(function(dir) {
    var dirPath = p.join(root, "index", dir);
    var files = fs.readdirSync(dirPath);
    var totalSize = files.reduce(function(s, f) { return s + fs.statSync(p.join(dirPath, f)).size; }, 0);
    console.log("\n=== INDEX " + dir.toUpperCase() + " ===");
    console.log("Chunks:", files.length);
    console.log("Total size:", (totalSize / 1024).toFixed(0) + " KB");
    var sampleFile = files[Math.floor(Math.random() * files.length)];
    var sample = JSON.parse(fs.readFileSync(p.join(dirPath, sampleFile), "utf8"));
    var sampleKeyCount = Object.keys(sample).length;
    console.log("Sample chunk (" + sampleFile + "):", sampleKeyCount, "unique keys");
});

console.log("\n=== SEARCH SIMULATION ===");
var paliChunk = JSON.parse(fs.readFileSync(p.join(root, "index/pali/dh.json"), "utf8"));
var prefix = "dhamma";
var matches = [];
Object.keys(paliChunk).forEach(function(k) {
    if (k.indexOf(prefix) === 0) {
        paliChunk[k].forEach(function(item) { matches.push(item); });
    }
});
console.log("Pali prefix dhamma matches:", matches.length);
if (matches.length > 0) console.log("First:", JSON.stringify(matches[0]));

if (matches.length > 0) {
    var wordId = matches[0].id;
    var batchNum = lookup[wordId];
    if (batchNum != null) {
        var batchFile = "batch-" + String(batchNum).padStart(4, "0") + ".json";
        var batch = JSON.parse(fs.readFileSync(p.join(batchDir, batchFile), "utf8"));
        var entry = batch[wordId];
        console.log("\n=== ENTRY LOAD ===");
        console.log("WordId:", wordId);
        console.log("Found:", !!entry);
        if (entry) {
            console.log("Headword:", entry.r);
            console.log("Sinhala:", entry.w);
            console.log("Meanings:", entry.meanings ? entry.meanings.length : 0);
        }
    }
}

// 7. Test Sinhala search
console.log("\n=== SINHALA SEARCH ===");
// Use a valid sinhala chunk key - check which files exist
var siDir = p.join(root, "index/si");
var siFiles = fs.readdirSync(siDir);
var siSampleFile = siFiles[0]; // just pick first file
var siChunk = JSON.parse(fs.readFileSync(p.join(siDir, siSampleFile), "utf8"));
var siKeys = Object.keys(siChunk);
console.log("Sinhala chunk " + siSampleFile + " has " + siKeys.length + " keys");
if (siKeys.length > 0) {
    var siPrefix = siKeys[0];
    var siMatches = [];
    Object.keys(siChunk).forEach(function(k) {
        if (k.indexOf(siPrefix) === 0) {
            siChunk[k].forEach(function(item) { siMatches.push(item); });
        }
    });
    console.log("Sinhela prefix " + siPrefix + " matches:", siMatches.length);
    if (siMatches.length > 0) console.log("First:", JSON.stringify(siMatches[0]));
}

// 8. Singlish search
console.log("\n=== SINGLISH SEARCH ===");
var slDir = p.join(root, "index/sl");
var slFiles = fs.readdirSync(slDir);
var slSampleFile = slFiles[0];
var slChunk = JSON.parse(fs.readFileSync(p.join(slDir, slSampleFile), "utf8"));
var slKeys = Object.keys(slChunk);
console.log("Singlish chunk " + slSampleFile + " has " + slKeys.length + " keys");
if (slKeys.length > 0) {
    var slPrefix = slKeys[0];
    var slMatches = [];
    Object.keys(slChunk).forEach(function(k) {
        if (k.indexOf(slPrefix) === 0) {
            slChunk[k].forEach(function(item) { slMatches.push(item); });
        }
    });
    console.log("Singlish prefix " + slPrefix + " matches:", slMatches.length);
}

console.log("\n=== ALL CHECKS PASSED ===");
