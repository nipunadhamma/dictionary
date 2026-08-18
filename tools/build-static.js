#!/usr/bin/env node
"use strict";
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ROOT = path.resolve(__dirname, "..");
var SRC = path.join(ROOT, "data", "pali-sinhala-web.json");
var OUT = path.join(ROOT, "data", "dictionary");
var BATCH = 500;

function stripDiacritics(t) {
    return String(t||"").replace(/[\u200c\u200d]/g,"")
        .replace(/\u0101/g,"a").replace(/\u012B/g,"i").replace(/\u016B/g,"u")
        .replace(/\u1E43/g,"m").replace(/\u1E41/g,"m").replace(/\u1B7B/g,"n")
        .replace(/\u00F1/g,"n").replace(/\u1E47/g,"n").replace(/\u1E6D/g,"t")
        .replace(/\u1E0D/g,"d").replace(/\u1E37/g,"l");
}
function normPali(t) { return String(t||"").toLowerCase().replace(/[\s]+/g," ").trim(); }
function normSinhala(t) { return String(t||"").normalize("NFC").replace(/[\u200c\u200d]/g,"").trim(); }
function normSearch(t) { return stripDiacritics(normPali(t)); }

var SM = {"\u0D9A":"ka","\u0D9B":"kha","\u0D9C":"ga","\u0D9D":"gha","\u0D9E":"nga",
    "\u0D9F":"cha","\u0DA0":"cha","\u0DA1":"chha","\u0DA2":"ja","\u0DA3":"jha",
    "\u0DA4":"nya","\u0DA5":"tta","\u0DA6":"ttha","\u0DA7":"ta","\u0DA8":"tha",
    "\u0DA9":"da","\u0DAA":"dha","\u0DAB":"na","\u0DAC":"tha","\u0DAD":"tha",
    "\u0DAE":"tha","\u0DAF":"da","\u0DB0":"dha","\u0DB1":"na",
    "\u0DB4":"pa","\u0DB5":"bha","\u0DB6":"ba","\u0DB8":"ma",
    "\u0DBA":"ya","\u0DBB":"ra","\u0DBD":"la","\u0DC0":"va",
    "\u0DC1":"sha","\u0DC2":"sha","\u0DC3":"sa","\u0DC4":"ha","\u0DC5":"la","\u0DCA":""};
var VM = {"\u0D85":"a","\u0D86":"aa","\u0D89":"i","\u0D8A":"ii",
    "\u0D8B":"u","\u0D8C":"uu","\u0D8F":"e","\u0D91":"o","\u0D92":"oo"};
var DVM = {"\u0DCF":"aa","\u0DD0":"a","\u0DD1":"aa","\u0DD2":"i","\u0DD3":"ii",
    "\u0DD4":"u","\u0DD6":"uu","\u0DDA":"e","\u0DDB":"ei","\u0DDC":"o","\u0DDD":"o","\u0DDE":"o","\u0DDF":"l"};

function singlish(text) {
    var s = String(text||"").normalize("NFC"), tokens = [], cur = "";
    for (var i = 0; i < s.length; i++) {
        var ch = s[i], code = ch.charCodeAt(0);
        if (VM[ch]) { if(cur){tokens.push(cur);cur="";} tokens.push(VM[ch]); continue; }
        if (code>=0x0D85&&code<=0x0D96) { if(cur){tokens.push(cur);cur="";} tokens.push(VM[ch]||""); continue; }
        if (code>=0x0D9A&&code<=0x0DDF) {
            if (ch==="\u0DCA") { if(cur&&cur.endsWith("a"))cur=cur.slice(0,-1); continue; }
            var dv = DVM[ch]; if(dv){if(cur)cur=cur.replace(/a$/,"")+dv;continue;}
            if(cur)tokens.push(cur); cur=SM[ch]||""; continue;
        }
        if (code===0x200C||code===0x200D) continue;
        if(cur){tokens.push(cur);cur="";}
    }
    if(cur)tokens.push(cur);
    return tokens.filter(Boolean).join("");
}

function genId(r) {
    var raw = String(r||"").normalize("NFC").trim();
    var h = crypto.createHash("sha256").update(raw).digest("hex");
    return "w_" + h.slice(0,16);
}

function safeKey(t, len) {
    return (String(t||"").replace(/[^a-z0-9\u0d80-\u0dff]/gi,"").toLowerCase().slice(0,len)||"xx").padEnd(len,"x");
}

function truncate(s, max) {
    var str = String(s || "");
    return str.length > max ? str.slice(0, max) : str;
}

function build() {
    console.log("Reading " + SRC + "...");
    var raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
    var entries = raw.entries, keys = Object.keys(entries);
    console.log("Source entries: " + keys.length);

    if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
    ["entries","index/pali","index/si","index/sl","index/mi"].forEach(function(d){
        fs.mkdirSync(path.join(OUT, d), { recursive: true });
    });

    var items = [], idSet = new Set(), dups = 0, aiOnlyCount = 0;
    keys.forEach(function(k) {
        var e = entries[k], w = e.w||k, r = e.r||"";
        var id = genId(r);
        if (idSet.has(id)) dups++;
        idSet.add(id);
        var meanSi = "";
        if (e.ms && e.ms[0]) meanSi = e.ms[0].si||"";
        else if (e.m && e.m.si) meanSi = e.m.si||"";

        var allMeanings = (e.ms||[]).concat(e.m&&e.m.si ? [e.m] : []);
        var aiOnly = allMeanings.length > 0 && allMeanings.every(function(m){ return m.src === "ai"; });
        if (aiOnly) aiOnlyCount++;

        items.push({ id:id, w:w, r:r, si:normSinhala(w), pali:normSearch(r),
            sl:singlish(w), mi:normSinhala(meanSi), c:e.c||null,
            ai: aiOnly ? 1 : 0,
            meanings: (e.ms||[]).map(function(m){return {si:m.si||"",src:m.src||""};})
                .concat(e.m&&e.m.si ? [{si:e.m.si||"",src:e.m.src||""}] : [])
        });
    });
    console.log("Processed: " + items.length + " | Unique IDs: " + idSet.size + " | Dups: " + dups + " | AI-only: " + aiOnlyCount);

    // Entry batches — full data for display/detail
    var batches = Math.ceil(items.length / BATCH);
    var lookup = {};
    var totalEntryBytes = 0;
    for (var b = 0; b < batches; b++) {
        var batch = {};
        var slice = items.slice(b * BATCH, (b+1) * BATCH);
        slice.forEach(function(item) {
            batch[item.id] = { id:item.id, w:item.w, r:item.r, si:item.si,
                meanings:item.meanings, c:item.c, ai:item.ai };
            lookup[item.id] = b;
        });
        var data = JSON.stringify(batch);
        fs.writeFileSync(path.join(OUT, "entries", "batch-" + String(b).padStart(4,"0") + ".json"), data);
        totalEntryBytes += Buffer.byteLength(data);
    }
    console.log("Entry batches: " + batches + " (" + (totalEntryBytes/1024/1024).toFixed(1) + " MB)");

    // Search indexes — {key: [{id,w,r}]} per chunk
    // Only store id + w + r (headword display data), NO redundant si
    function writeIndex(dir, getKey) {
        var chunks = {};
        items.forEach(function(item) {
            var key = getKey(item);
            if (!key) return;
            var ck = safeKey(key, 2);
            if (!chunks[ck]) chunks[ck] = {};
            if (!chunks[ck][key]) chunks[ck][key] = [];
            chunks[ck][key].push({ id:item.id, w:item.w, r:item.r, ai:item.ai });
        });
        var count = 0, bytes = 0;
        Object.keys(chunks).sort().forEach(function(ck) {
            var data = JSON.stringify(chunks[ck]);
            fs.writeFileSync(path.join(OUT, "index", dir, ck+".json"), data);
            count++;
            bytes += Buffer.byteLength(data);
        });
        return { count: count, bytes: bytes };
    }

    var pali = writeIndex("pali", function(i){ return i.pali||""; });
    console.log("Pali index: " + pali.count + " chunks (" + (pali.bytes/1024).toFixed(0) + " KB)");
    var si = writeIndex("si", function(i){ return i.si||""; });
    console.log("Si index:   " + si.count + " chunks (" + (si.bytes/1024).toFixed(0) + " KB)");
    var sl = writeIndex("sl", function(i){ return i.sl||""; });
    console.log("SL index:   " + sl.count + " chunks (" + (sl.bytes/1024).toFixed(0) + " KB)");
    var mi = writeIndex("mi", function(i){ return (i.mi||"").slice(0,60); });
    console.log("Mi index:   " + mi.count + " chunks (" + (mi.bytes/1024).toFixed(0) + " KB)");
    var totalIndexBytes = pali.bytes + si.bytes + sl.bytes + mi.bytes;

    // Lookup: wordId → batch number (compact, ~4 MB)
    var lookupData = JSON.stringify(lookup);
    fs.writeFileSync(path.join(OUT, "lookup.json"), lookupData);
    var lookupBytes = Buffer.byteLength(lookupData);
    console.log("Lookup:     " + (lookupBytes/1024).toFixed(0) + " KB");

    // Manifest
    var totalSize = totalEntryBytes + totalIndexBytes + lookupBytes;
    var mf = JSON.stringify({
        built: new Date().toISOString(),
        sourceEntries: keys.length,
        processed: items.length,
        uniqueWordIds: idSet.size,
        duplicates: dups,
        batchSize: BATCH,
        batches: batches,
        totalOutputBytes: totalSize
    });
    fs.writeFileSync(path.join(OUT, "manifest.json"), mf);

    console.log("\n=== BUILD REPORT ===");
    console.log("Entries:        " + items.length);
    console.log("Unique IDs:     " + idSet.size);
    console.log("Duplicates:     " + dups);
    console.log("Batches:        " + batches);
    console.log("Entry data:     " + (totalEntryBytes/1024/1024).toFixed(2) + " MB");
    console.log("Index data:     " + (totalIndexBytes/1024/1024).toFixed(2) + " MB");
    console.log("  pali:         " + (pali.bytes/1024).toFixed(0) + " KB (" + pali.count + " chunks)");
    console.log("  si:           " + (si.bytes/1024).toFixed(0) + " KB (" + si.count + " chunks)");
    console.log("  sl:           " + (sl.bytes/1024).toFixed(0) + " KB (" + sl.count + " chunks)");
    console.log("  mi:           " + (mi.bytes/1024).toFixed(0) + " KB (" + mi.count + " chunks)");
    console.log("Lookup:         " + (lookupBytes/1024).toFixed(0) + " KB");
    console.log("TOTAL OUTPUT:   " + (totalSize/1024/1024).toFixed(2) + " MB");
}

build();
