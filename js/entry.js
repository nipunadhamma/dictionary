"use strict";

window.Dict = window.Dict || {};
Dict.entry = Dict.entry || {};

async function loadWord(wordId) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { word: null, note: "not_configured" };
    }

    try {
        const C = Dict.db.COLLECTIONS;
        const wordSnap = await Dict.db.docRef(C.words, wordId).get();
        if (!wordSnap.exists) return { word: null, note: "missing" };

        const word = { id: wordSnap.id, ...wordSnap.data() };

        // Load related sub-collections in parallel
        const [meaningsSnap, formsSnap, examplesSnap] = await Promise.all([
            Dict.db.col(C.wordMeanings).where("wordId", "==", wordId).orderBy("order").get(),
            Dict.db.col(C.wordForms).where("wordId", "==", wordId).orderBy("order").get(),
            Dict.db.col(C.examples).where("wordId", "==", wordId).orderBy("order").get(),
        ]);

        word.meanings = [];
        meaningsSnap.forEach(function(d) {
            word.meanings.push({ id: d.id, ...d.data() });
        });

        word.forms = [];
        formsSnap.forEach(function(d) {
            word.forms.push({ id: d.id, ...d.data() });
        });

        word.examples = [];
        examplesSnap.forEach(function(d) {
            word.examples.push({ id: d.id, ...d.data() });
        });

        return { word: word, note: "ok" };
    } catch (error) {
        console.warn("[entry] load failed:", error);
        return { word: null, note: "error" };
    }
}

async function loadVersions(wordId) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { versions: [], note: "not_configured" };
    }

    try {
        const snap = await Dict.db
            .col(Dict.db.COLLECTIONS.versions)
            .where("wordId", "==", wordId)
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();

        const versions = [];
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

function renderEntryPage(word) {
    var el = document.getElementById("entryContent");
    if (!el) return;

    if (!word) {
        el.innerHTML = '<div class="empty">වචනය හමු නොවීය.</div>';
        return;
    }

    var html = "";

    // Headword
    html += '<div class="entry-head">';
    html += '<h2 class="entry-word">' + esc(word.headword || word.headwordSi || word.id) + '</h2>';
    if (word.headwordSi) {
        html += '<div class="entry-word-si">' + esc(word.headwordSi) + '</div>';
    }
    html += '<span class="entry-status status-' + esc(word.status || 'published') + '">' + esc(word.status || "published") + '</span>';
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
            if (m.sourceId) {
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
