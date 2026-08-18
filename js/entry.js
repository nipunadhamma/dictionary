"use strict";

window.Dict = window.Dict || {};
Dict.entry = Dict.entry || {};

// ── Load word via hybrid resolver ───────────────────────────

async function loadWord(wordId) {
    try {
        var resolved = await Dict.resolver.getDisplayEntry(wordId);
        if (!resolved) return { word: null, note: "missing" };
        return { word: resolved, note: "ok" };
    } catch (error) {
        console.warn("[entry] load failed:", error);
        return { word: null, note: "error" };
    }
}

// ── Load versions from Firestore ────────────────────────────

async function loadVersions(wordId) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { versions: [], note: "not_configured" };
    }

    try {
        var snap = await Dict.db
            .col(Dict.db.COLLECTIONS.versions)
            .where("wordId", "==", wordId)
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();

        var versions = [];
        snap.forEach(function(d) {
            versions.push({ id: d.id, ...d.data() });
        });
        return { versions: versions, note: "ok" };
    } catch (error) {
        console.warn("[entry] versions load failed:", error);
        return { versions: [], note: "error" };
    }
}

function esc(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ── Render entry page ───────────────────────────────────────

function renderEntryPage(word) {
    var el = document.getElementById("entryContent");
    if (!el) return;

    if (!word) {
        el.innerHTML = '<div class="empty">වචනය හමු නොවීය.</div>';
        return;
    }

    var html = "";

    // Source indicator
    var sourceLabel = "";
    if (word._static) {
        sourceLabel = '<span class="entry-source-tag">මූලික ශබ්දකෝෂය</span>';
    } else if (word.overridden) {
        sourceLabel = '<span class="entry-source-tag override">සංස්කරණය කළ</span>';
    }

    // Headword
    html += '<div class="entry-head">';
    html += '<h2 class="entry-word">' + esc(word.headword || word.headwordSi || word.id) + '</h2>';
    if (word.headwordSi) {
        html += '<div class="entry-word-si">' + esc(word.headwordSi) + '</div>';
    }
    html += '<span class="entry-status status-' + esc(word.status || 'published') + '">' + esc(word.status || "published") + '</span>';
    if (sourceLabel) html += ' ' + sourceLabel;
    html += '</div>';

    // Meanings
    if (word.meanings && word.meanings.length) {
        html += '<h3>අර්ථ</h3>';
        html += '<div class="entry-section">';
        word.meanings.forEach(function(m) {
            html += '<div class="meaning-item">';
            html += '<div class="meaning-si">' + esc(m.si || "") + '</div>';
            if (m.grammar && m.grammar.pos) {
                html += '<span class="meaning-grammar">' + esc(m.grammar.pos) + '</span>';
            }
            if (m.sourceId === "ai") {
                html += '<span class="meaning-ai-badge">AI අර්ථය</span>';
            } else if (m.sourceId) {
                html += '<span class="meaning-source">' + esc(m.sourceId) + '</span>';
            }
            html += '</div>';
        });
        html += '</div>';
    }

    // Word forms
    if (word.forms && word.forms.length) {
        html += '<h3>පාලි රූප</h3>';
        html += '<div class="entry-section">';
        word.forms.forEach(function(f) {
            html += '<span class="form-tag">' + esc(f.form || "") + '</span> ';
        });
        html += '</div>';
    }

    // Examples
    if (word.examples && word.examples.length) {
        html += '<h3>උදාහරණ</h3>';
        html += '<div class="entry-section">';
        word.examples.forEach(function(ex) {
            html += '<div class="example-item">';
            html += '<div class="example-pali">' + esc(ex.pali || "") + '</div>';
            html += '<div class="example-si">' + esc(ex.si || "") + '</div>';
            html += '</div>';
        });
        html += '</div>';
    }

    // Status / version
    html += '<div class="entry-meta">';
    html += 'වචන ID: ' + esc(word.id);
    if (word.version) html += ' · සංස්කරණය: ' + word.version;
    html += '</div>';

    el.innerHTML = html;
}

Dict.entry.loadWord = loadWord;
Dict.entry.loadVersions = loadVersions;
Dict.entry.renderEntryPage = renderEntryPage;
