"use strict";

window.Dict = window.Dict || {};
Dict.aiEntries = Dict.aiEntries || {};

// ── Constants ─────────────────────────────────────────────

var PAGE_SIZE = 50;
var AI_DATA_URL = "data/ai-entries.json";

// ── State ─────────────────────────────────────────────────

var _aiCache = null;
var _aiLoadPromise = null;
var _filtered = null;
var _rendered = 0;

// ── Helpers ───────────────────────────────────────────────

function aiEsc(v) {
    return String(v == null ? "" : v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ── WordId computation (mirrors build-static.js genId) ─────

async function computeWordId(r) {
    var raw = String(r || "").normalize("NFC").trim();
    var enc = new TextEncoder().encode(raw);
    var hash = await crypto.subtle.digest("SHA-256", enc);
    var hex = Array.from(new Uint8Array(hash))
        .map(function (b) { return b.toString(16).padStart(2, "0"); })
        .join("");
    return "w_" + hex.slice(0, 16);
}

async function computeAllWordIds(entries) {
    return Promise.all(entries.map(function (item) {
        return computeWordId(item._entry.r).then(function (id) {
            item._wordId = id;
            return item;
        });
    }));
}

// ── Fetch & cache ─────────────────────────────────────────

async function loadAIData() {
    if (_aiCache) return _aiCache;
    if (_aiLoadPromise) return _aiLoadPromise;

    _aiLoadPromise = fetch(AI_DATA_URL)
        .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        })
        .then(function (data) {
            _aiCache = data;
            return data;
        })
        .catch(function (err) {
            console.warn("[aiEntries] load failed:", err);
            _aiLoadPromise = null;
            return null;
        });

    return _aiLoadPromise;
}

function getEntryList(data) {
    if (!data || !data.entries) return [];
    var keys = Object.keys(data.entries);
    return keys.map(function (k) {
        return { _key: k, _entry: data.entries[k] };
    });
}

// ── Search / filter ───────────────────────────────────────

function filterEntries(entries, query) {
    if (!query || !query.trim()) return entries;
    var q = query.trim().toLowerCase();

    return entries.filter(function (item) {
        var e = item._entry;
        // Match Sinhala headword (w)
        if (e.w && e.w.toLowerCase().indexOf(q) !== -1) return true;
        // Match Pali headword (r)
        if (e.r && e.r.toLowerCase().indexOf(q) !== -1) return true;
        // Match meaning text
        if (e.m && e.m.si && e.m.si.toLowerCase().indexOf(q) !== -1) return true;
        if (e.ms && Array.isArray(e.ms)) {
            for (var i = 0; i < e.ms.length; i++) {
                if (e.ms[i].si && e.ms[i].si.toLowerCase().indexOf(q) !== -1) return true;
            }
        }
        return false;
    });
}

// ── Render helpers ────────────────────────────────────────

function renderAIMeanings(meanings) {
    var html = "";
    if (meanings.m) {
        html += renderOneMeaning(meanings.m);
    }
    if (meanings.ms && Array.isArray(meanings.ms)) {
        meanings.ms.forEach(function (m) {
            html += renderOneMeaning(m);
        });
    }
    return html;
}

function renderOneMeaning(m) {
    if (!m || !m.si) return "";
    var html = '<div class="ai-meaning">';
    html += '<span class="ai-meaning-text">' + aiEsc(m.si) + '</span>';
    if (m.src === "ai") {
        html += '<span class="meaning-ai-badge">AI අර්ථය</span>';
    } else if (m.src) {
        html += '<span class="meaning-source">' + aiEsc(m.src) + '</span>';
    }
    html += '</div>';
    return html;
}

function renderAIEntryRow(item) {
    var e = item._entry;
    var key = item._key;
    var wordId = item._wordId || "";

    var html = '<div class="ai-row" data-word-id="' + aiEsc(wordId) + '">';

    html += '<div class="ai-row-head">';
    html += '<span class="ai-row-si">' + aiEsc(e.w || key) + '</span>';
    html += '<span class="ai-row-pali">' + aiEsc(e.r || "") + '</span>';
    html += '</div>';

    html += '<div class="ai-row-meanings">';
    html += renderAIMeanings(e);
    html += '</div>';

    if (wordId) {
        html += '<a href="editor.html?id=' + encodeURIComponent(wordId) + '" class="ai-row-link">සංස්කරණය →</a>';
    }

    html += '</div>';
    return html;
}

// ── Modal open / close ────────────────────────────────────

function openAIModal() {
    var modal = document.getElementById("aiModal");
    if (modal) modal.classList.add("open");
    document.body.style.overflow = "hidden";
    initAILoad();
}

function closeAIModal() {
    var modal = document.getElementById("aiModal");
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
}

// ── Init & load ───────────────────────────────────────────

async function initAILoad() {
    var listEl = document.getElementById("aiList");
    var statsEl = document.getElementById("aiStats");
    if (!listEl) return;

    var data = await loadAIData();
    if (!data) {
        listEl.innerHTML = '<div class="empty">AI දත්ත පූරණය කළ නොහැක.</div>';
        return;
    }

    var allEntries = getEntryList(data);

    if (statsEl) {
        statsEl.textContent = 'මුළු AI වචන: ' + allEntries.length + ' (ID ගණනය වෙමින්...)';
    }

    await computeAllWordIds(allEntries);

    if (statsEl) {
        statsEl.textContent = 'මුළු AI වචන: ' + allEntries.length;
    }

    _filtered = allEntries;
    _rendered = 0;

    listEl.innerHTML = "";
    renderNextPage();
}

function renderNextPage() {
    var listEl = document.getElementById("aiList");
    var moreEl = document.getElementById("aiMore");
    if (!listEl || !_filtered) return;

    var start = _rendered;
    var end = Math.min(start + PAGE_SIZE, _filtered.length);

    if (start === 0 && end === 0) {
        listEl.innerHTML = '<div class="empty">සෙවුම් ප්‍රතිඵල නොමැත.</div>';
        if (moreEl) moreEl.style.display = "none";
        return;
    }

    var fragment = document.createDocumentFragment();
    for (var i = start; i < end; i++) {
        var temp = document.createElement("div");
        temp.innerHTML = renderAIEntryRow(_filtered[i]);
        fragment.appendChild(temp.firstElementChild);
    }

    if (start === 0) {
        listEl.innerHTML = "";
    }
    listEl.appendChild(fragment);

    _rendered = end;

    if (moreEl) {
        moreEl.style.display = _rendered < _filtered.length ? "block" : "none";
    }
}

// ── Search handler ────────────────────────────────────────

async function handleAISearch() {
    var input = document.getElementById("aiSearchInput");
    if (!input || !_aiCache) return;

    var listEl = document.getElementById("aiList");
    if (listEl) listEl.innerHTML = '<div class="empty">සොයමින්...</div>';

    var allEntries = getEntryList(_aiCache);
    var filtered = filterEntries(allEntries, input.value);
    await computeAllWordIds(filtered);
    _filtered = filtered;
    _rendered = 0;

    if (listEl) listEl.innerHTML = "";
    renderNextPage();
}

// ── Event binding ─────────────────────────────────────────

function bindAIEvents() {
    // Open buttons
    document.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ai-open]");
        if (btn) {
            e.preventDefault();
            openAIModal();
        }
    });

    // Close buttons / backdrop
    var modal = document.getElementById("aiModal");
    if (modal) {
        modal.addEventListener("click", function (e) {
            if (e.target.hasAttribute("data-ai-close")) {
                closeAIModal();
            }
        });
    }

    // Escape key
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" || e.keyCode === 27) {
            var m = document.getElementById("aiModal");
            if (m && m.classList.contains("open")) {
                closeAIModal();
            }
        }
    });

    // Search button
    var searchBtn = document.getElementById("aiSearchBtn");
    if (searchBtn) searchBtn.addEventListener("click", handleAISearch);

    // Search on Enter
    var searchInput = document.getElementById("aiSearchInput");
    if (searchInput) {
        searchInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.keyCode === 13) {
                e.preventDefault();
                handleAISearch();
            }
        });
    }

    // Load more
    var moreBtn = document.getElementById("aiMoreBtn");
    if (moreBtn) moreBtn.addEventListener("click", renderNextPage);
}

// ── Public API ────────────────────────────────────────────

Dict.aiEntries.openModal = openAIModal;
Dict.aiEntries.closeModal = closeAIModal;
Dict.aiEntries.load = loadAIData;
Dict.aiEntries.filterEntries = filterEntries;
Dict.aiEntries.getEntryList = getEntryList;
Dict.aiEntries._test = {
    loadAIData: loadAIData,
    filterEntries: filterEntries,
    getEntryList: getEntryList,
};

document.addEventListener("DOMContentLoaded", bindAIEvents);
