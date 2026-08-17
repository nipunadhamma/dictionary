"use strict";

window.Dict = window.Dict || {};
Dict.static = Dict.static || {};

const STATIC_BASE = "data/dictionary";
const CHUNK_PREFIX_LEN = 2;

const _indexCache = {};
const _batchCache = {};
let _manifest = null;
let _lookup = null;
let _manifestPromise = null;
let _lookupPromise = null;

// ── Safe key (mirrors build-static.js) ────────────────────

function safeKey(text, len) {
    return (String(text || "")
        .replace(/[^a-z0-9\u0d80-\u0dff]/gi, "")
        .toLowerCase()
        .slice(0, len) || "xx").padEnd(len, "x");
}

// ── Fetch helpers ──────────────────────────────────────────

async function fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status + " " + url);
    return resp.json();
}

// ── Manifest & lookup ──────────────────────────────────────

async function ensureManifest() {
    if (_manifest) return _manifest;
    if (!_manifestPromise) {
        _manifestPromise = fetchJSON(STATIC_BASE + "/manifest.json").then(function(m) {
            _manifest = m;
            return m;
        });
    }
    return _manifestPromise;
}

async function ensureLookup() {
    if (_lookup) return _lookup;
    if (!_lookupPromise) {
        _lookupPromise = fetchJSON(STATIC_BASE + "/lookup.json").then(function(l) {
            _lookup = l;
            return l;
        });
    }
    return _lookupPromise;
}

// ── Index chunk loading ────────────────────────────────────

async function getIndexChunk(dir, normalizedKey) {
    var ck = safeKey(normalizedKey, CHUNK_PREFIX_LEN);
    var cacheKey = dir + "/" + ck;
    if (_indexCache[cacheKey]) return _indexCache[cacheKey];

    var url = STATIC_BASE + "/index/" + dir + "/" + encodeURIComponent(ck) + ".json";
    var promise = fetchJSON(url).then(function(chunk) {
        _indexCache[cacheKey] = chunk;
        return chunk;
    });
    _indexCache[cacheKey] = promise;
    return promise;
}

// ── Entry batch loading ────────────────────────────────────

async function getEntryBatch(batchNum) {
    var key = "batch-" + batchNum;
    if (_batchCache[key]) return _batchCache[key];

    var num = String(batchNum).padStart(4, "0");
    var url = STATIC_BASE + "/entries/batch-" + num + ".json";
    var promise = fetchJSON(url).then(function(batch) {
        _batchCache[key] = batch;
        return batch;
    });
    _batchCache[key] = promise;
    return promise;
}

// ── Entry lookup by wordId ─────────────────────────────────

async function getEntryByWordId(wordId) {
    var lookup = await ensureLookup();
    var batchNum = lookup[wordId];
    if (batchNum == null) return null;
    var batch = await getEntryBatch(batchNum);
    return batch[wordId] || null;
}

// ── Batch lookup for multiple wordIds ──────────────────────

async function getEntriesByWordIds(wordIds) {
    var lookup = await ensureLookup();
    var batchMap = {};
    wordIds.forEach(function(id) {
        var bn = lookup[id];
        if (bn != null) {
            if (!batchMap[bn]) batchMap[bn] = [];
            batchMap[bn].push(id);
        }
    });

    var batchNums = Object.keys(batchMap);
    var batches = await Promise.all(batchNums.map(function(bn) {
        return getEntryBatch(Number(bn));
    }));

    var results = [];
    batchNums.forEach(function(bn, i) {
        var batch = batches[i];
        batchMap[bn].forEach(function(id) {
            var entry = batch[id];
            if (entry) results.push(entry);
        });
    });
    return results;
}

// ── Static search ──────────────────────────────────────────
// Searches a single index. Returns all matching {id, w, r} items.
// No cursor pagination — the full chunk is loaded, and the caller
// paginates client-side.

function searchIndex(chunk, prefix) {
    if (!chunk || !prefix) return [];
    var results = [];
    var keys = Object.keys(chunk);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(prefix) === 0) {
            var arr = chunk[keys[i]];
            for (var j = 0; j < arr.length; j++) {
                results.push(arr[j]);
            }
        }
    }
    return results;
}

async function searchStaticIndex(dir, normalizedPrefix) {
    var chunk = await getIndexChunk(dir, normalizedPrefix);
    return searchIndex(chunk, normalizedPrefix);
}

// ── Public API ─────────────────────────────────────────────

Dict.static.ensureManifest = ensureManifest;
Dict.static.ensureLookup = ensureLookup;
Dict.static.safeKey = safeKey;
Dict.static.getIndexChunk = getIndexChunk;
Dict.static.getEntryBatch = getEntryBatch;
Dict.static.getEntryByWordId = getEntryByWordId;
Dict.static.getEntriesByWordIds = getEntriesByWordIds;
Dict.static.searchIndex = searchIndex;
Dict.static.searchStaticIndex = searchStaticIndex;
