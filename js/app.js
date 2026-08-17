"use strict";

window.Dict = window.Dict || {};
Dict.app = Dict.app || {};

let searchInput, searchBtn, clearBtn, modeMeaning;
let resultsEl, resultCountEl, detailEl, statusEl, statsEl;
let authBarEl, signInBtn, signOutBtn, authEmailEl, authPassEl, authModal, authErrorEl;

let currentResults = [];
let currentCursor = null;
let currentPlan = null;
let isLoadingMore = false;
let hasMore = false;
let staticOffset = 0;

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = "status" + (cls ? " " + cls : "");
}

function updateStats(dt) {
    if (!statsEl) return;
    const auth = Dict.auth.lastState();
    const label = auth && auth.user
        ? (auth.isPublic ? auth.email + " (ප්‍රවේශය නැත)" : auth.email + " · " + auth.roleLabel)
        : "ආගන්තුක";
    statsEl.textContent = `${Math.round(dt)}ms · පිවිසුම්: ${label}`;
}

function resetPagination() {
    currentResults = [];
    currentCursor = null;
    currentPlan = null;
    hasMore = false;
    isLoadingMore = false;
    staticOffset = 0;
}

function renderResults(items, query) {
    if (!items.length && !hasMore) {
        resultsEl.innerHTML = `<div class="empty">"${esc(query)}" සඳහා ප්‍රතිඵල නොමැත.</div>`;
        resultCountEl.textContent = "";
        return;
    }
    resultCountEl.textContent = `${items.length} ප්‍රතිඵල`;
    const matchLabel = {
        pali: "පාලි",
        sinhala: "සිංහල",
        singlish: "Singlish",
        meaning: "අර්ථ",
    };
    let html = items
        .map((it, i) => {
            const word = it.headword || it.pali || it.id;
            const si = (it.si || "").slice(0, 120);
            const id = it.wordId || it.id;
            return `
            <div class="result-item" data-index="${i}">
                <div class="result-pali">${esc(word)}</div>
                <div class="result-roman">${matchLabel[it.match] || ""}</div>
                ${si ? `<div class="result-sinhala">${esc(si)}</div>` : ""}
                <a href="entry.html?id=${encodeURIComponent(id)}" class="result-link" title="සම්පූර්ණ පිටුව">→</a>
            </div>`;
        })
        .join("");

    if (hasMore) {
        html += `<div class="load-more-container">
            <button type="button" class="btn secondary" id="loadMoreBtn"
                ${isLoadingMore ? "disabled" : ""}>
                ${isLoadingMore ? "ඉදිරියට..." : "තවත් ප්‍රතිඵල"}
            </button>
        </div>`;
    }

    resultsEl.innerHTML = html;

    resultsEl.querySelectorAll(".result-item").forEach((el) => {
        el.addEventListener("click", (e) => {
            if (e.target.closest(".result-link")) return;
            resultsEl.querySelectorAll(".result-item.active").forEach(function(a) { a.classList.remove("active"); });
            el.classList.add("active");
            const idx = Number(el.dataset.index);
            renderDetail(currentResults[idx]);
        });
    });

    const loadMoreBtn = document.getElementById("loadMoreBtn");
    if (loadMoreBtn) loadMoreBtn.addEventListener("click", loadMore);
}

async function renderDetail(item) {
    if (!item) {
        detailEl.innerHTML = `<div class="empty">වචනයක් තෝරන්න.</div>`;
        return;
    }
    const word = item.headword || item.pali || item.id;
    const si = item.si || "";
    const id = item.wordId || item.id;

    detailEl.innerHTML = `
        <div class="detail-pali">${esc(word)}</div>
        ${si ? `<div class="detail-sinhala">${esc(si)}</div>` : ""}
        <div class="meaning-block">
            <h3>අර්ථ</h3>
            <div class="detail-loading">ලබාගන්නවා...</div>
        </div>`;

    try {
        if (!Dict.resolver || !Dict.resolver.getDisplayEntry) {
            throw new Error("resolver not loaded");
        }
        const resolved = await Dict.resolver.getDisplayEntry(id);
        if (resolved && resolved.meanings && resolved.meanings.length) {
            let html = resolved.meanings.map(function(m) {
                let s = '<div class="meaning-item">';
                s += '<div class="meaning-text">' + esc(m.si || "—") + "</div>";
                if (m.sourceId) s += '<span class="meaning-source">' + esc(m.sourceId) + "</span>";
                s += "</div>";
                return s;
            }).join("");
            detailEl.innerHTML =
                '<div class="detail-pali">' + esc(resolved.headword || word) + "</div>" +
                (resolved.headwordSi ? '<div class="detail-sinhala">' + esc(resolved.headwordSi) + "</div>" : (si ? '<div class="detail-sinhala">' + esc(si) + "</div>" : "")) +
                '<div class="meaning-block"><h3>අර්ථ</h3>' + html + "</div>";
        } else {
            detailEl.innerHTML =
                '<div class="detail-pali">' + esc(word) + "</div>" +
                (si ? '<div class="detail-sinhala">' + esc(si) + "</div>" : "") +
                '<div class="meaning-block"><div class="meaning-text">—</div></div>';
        }
    } catch (err) {
        console.warn("[app] detail resolve:", err);
        detailEl.innerHTML =
            '<div class="detail-pali">' + esc(word) + "</div>" +
            (si ? '<div class="detail-sinhala">' + esc(si) + "</div>" : "") +
            '<div class="meaning-block"><div class="meaning-text">—</div></div>' +
            '<div class="detail-hint"><a href="entry.html?id=' + encodeURIComponent(id) + '">සම්පූර්ණ පිටුව →</a></div>';
    }
}

function showNotConfigured() {
    setStatus("Firebase සැකසුම නොමැත", "error");
    resultsEl.innerHTML = `
        <div class="empty">
            Firebase config එකක් සකසා නොමැත. <code>js/firebase-config.js</code> සකසන්න.<br><br>
            මේ අතර <a href="offline.html">offline පිටුව</a> භාවිතා කරන්න.
        </div>`;
}

// ── Auth UI ─────────────────────────────────────────────────

function updateAuthBar(a) {
    if (!authBarEl) return;

    if (a.user && !a.isPublic) {
        var editorLink = a.isEditor
            ? '<a href="editor.html" class="btn small primary">සංස්කරණය</a>'
            : "";
        var reviewLink = a.isReviewer
            ? '<a href="review.html" class="btn small primary">සමාලෝචනය</a>'
            : "";
        var dashLink = '<a href="dashboard.html" class="btn small secondary">කාර්ය පුවරුව</a>';
        authBarEl.innerHTML = `
            ${dashLink}
            ${editorLink}
            ${reviewLink}
            <span class="auth-email">${esc(a.email)}</span>
            <span class="auth-role-badge">${esc(a.roleLabel)}</span>
            <button type="button" class="btn small secondary" id="authSignOutBtn">පිටවීම</button>`;
        const outBtn = document.getElementById("authSignOutBtn");
        if (outBtn) outBtn.addEventListener("click", () => Dict.auth.signOut());
    } else if (a.user && a.isPublic) {
        authBarEl.innerHTML = `
            <span class="auth-email">${esc(a.email)}</span>
            <span class="auth-role-badge role-public">ප්‍රවේශය නැත</span>
            <button type="button" class="btn small secondary" id="authSignOutBtn">පිටවීම</button>`;
        const outBtn = document.getElementById("authSignOutBtn");
        if (outBtn) outBtn.addEventListener("click", () => Dict.auth.signOut());
    } else {
        authBarEl.innerHTML = `
            <button type="button" class="btn small primary" id="authSignInBtn">පිවිසුම</button>`;
        const inBtn = document.getElementById("authSignInBtn");
        if (inBtn) inBtn.addEventListener("click", showSignInModal);
    }
}

function showSignInModal() {
    if (!authModal) return;
    authModal.classList.add("open");
    authErrorEl.textContent = "";
    if (authEmailEl) authEmailEl.value = "";
    if (authPassEl) authPassEl.value = "";
    if (authEmailEl) authEmailEl.focus();
}

function hideSignInModal() {
    if (authModal) authModal.classList.remove("open");
}

async function handleSignIn(e) {
    e.preventDefault();
    if (!authEmailEl || !authPassEl) return;
    const email = authEmailEl.value.trim();
    const pass = authPassEl.value;
    if (!email || !pass) {
        authErrorEl.textContent = "Email සහ මුරපදය අවශ්‍යයි.";
        return;
    }
    try {
        authErrorEl.textContent = "";
        await Dict.auth.signIn(email, pass);
        hideSignInModal();
    } catch (err) {
        const msg =
            err.code === "auth/user-not-found" ? "මෙම email එක හමු නොවීය." :
            err.code === "auth/wrong-password" ? "මුරපදය වැරදියි." :
            err.code === "auth/invalid-email" ? "වලංගු email එකක් ඇතුලත් කරන්න." :
            err.code === "auth/too-many-requests" ? "නැවත උත්සාහ කරන්න. බොහෝ වාර උත්සාහ කළා." :
            "පිවිසුම් දෝෂයක්: " + (err.message || err.code);
        authErrorEl.textContent = msg;
    }
}

// ── Search ──────────────────────────────────────────────────

async function run() {
    const q = searchInput.value.trim();
    if (!q) return;
    resetPagination();
    detailEl.innerHTML = "";
    setStatus("සොයනවා...");
    resultsEl.innerHTML = "";
    const t0 = performance.now();
    try {
        const res = await Dict.search.search(q, { byMeaning: modeMeaning.checked });
        const dt = performance.now() - t0;
        updateStats(dt);
        if (res.note === "not_configured") {
            showNotConfigured();
            return;
        }
        if (res.note === "error") {
            setStatus("සෙවීමේ දෝෂයක්", "error");
            return;
        }
        if (res.plan) currentPlan = res.plan;
        currentResults = res.results;
        currentCursor = res.cursor;
        hasMore = res.results.length >= Dict.search.PAGE_SIZE;
        staticOffset = res._staticOffset || 0;
        setStatus("");
        renderResults(currentResults, q);
    } catch (err) {
        console.error("[app] search error:", err);
        setStatus("");
        resultsEl.innerHTML = `<div class="empty"><strong>දෝෂයකි.</strong> Console බලන්න.</div>`;
    }
}

async function loadMore() {
    if (isLoadingMore || !hasMore || !currentPlan) return;
    isLoadingMore = true;
    renderResults(currentResults, searchInput.value.trim());
    try {
        const res = await Dict.search.search(currentPlan.raw, {
            byMeaning: currentPlan.mode === Dict.search.MATCH.MEANING,
            lastDoc: currentCursor,
            _staticOffset: staticOffset,
        });
        if (res.note === "ok" && res.results.length > 0) {
            const seen = new Set(currentResults.map((r) => r.id));
            res.results.forEach(function(r) {
                if (!seen.has(r.id)) {
                    seen.add(r.id);
                    currentResults.push(r);
                }
            });
        }
        currentCursor = res.cursor;
        hasMore = res.results.length >= Dict.search.PAGE_SIZE;
        staticOffset = res._staticOffset || 0;
    } catch (err) {
        console.error("[app] loadMore error:", err);
    } finally {
        isLoadingMore = false;
        renderResults(currentResults, searchInput.value.trim());
    }
}

// ── Init ────────────────────────────────────────────────────

function bindEvents() {
    searchBtn.addEventListener("click", run);
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") run();
    });
    clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        resultCountEl.textContent = "";
        resultsEl.innerHTML = `<div class="empty">වචනයක් සොයන්න.</div>`;
        detailEl.innerHTML = `<div class="empty">වචනයක් තෝරන්න.</div>`;
        resetPagination();
        searchInput.focus();
    });
    document.querySelectorAll(".quick-searches button").forEach((btn) => {
        btn.addEventListener("click", () => {
            searchInput.value = btn.dataset.word || "";
            run();
        });
    });

    // Auth modal
    authModal = document.getElementById("authModal");
    authEmailEl = document.getElementById("authEmail");
    authPassEl = document.getElementById("authPass");
    authErrorEl = document.getElementById("authError");
    const authForm = document.getElementById("authForm");
    const authClose = document.getElementById("authCloseBtn");
    if (authForm) authForm.addEventListener("submit", handleSignIn);
    if (authClose) authClose.addEventListener("click", hideSignInModal);
    if (authModal) {
        authModal.addEventListener("click", (e) => {
            if (e.target === authModal) hideSignInModal();
        });
    }
}

function init() {
    searchInput = document.getElementById("searchInput");
    searchBtn = document.getElementById("searchBtn");
    clearBtn = document.getElementById("clearBtn");
    modeMeaning = document.getElementById("modeMeaning");
    resultsEl = document.getElementById("results");
    resultCountEl = document.getElementById("resultCount");
    detailEl = document.getElementById("detail");
    statusEl = document.getElementById("status");
    statsEl = document.getElementById("stats");
    authBarEl = document.getElementById("authBar");

    bindEvents();

    if (!Dict.db.init()) {
        showNotConfigured();
        if (statsEl) statsEl.textContent = "Firebase නොමැතිව පවතී — offline පිටුව භාවිතා කරන්න.";
        if (authBarEl) authBarEl.innerHTML = `<a href="offline.html" class="btn small secondary">Offline පිටුව</a>`;
        return;
    }

    Dict.auth.init();
    Dict.auth.onAuthChange((a) => {
        updateAuthBar(a);
        updateStats(0);
    });
    setStatus("✓ සූදානම්", "success");
}

document.addEventListener("DOMContentLoaded", init);
