"use strict";

window.Dict = window.Dict || {};
Dict.dashboard = Dict.dashboard || {};

// ── Constants ──────────────────────────────────────────────

var DASH_LIMIT = 50;
var REVIEW_LIMIT = 20;
var DASH_PAGE_SIZE = 20;

// ── Utilities ──────────────────────────────────────────────

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatTimestamp(ts) {
    if (!ts) return "";
    try {
        var d = new Date(ts);
        return d.toLocaleDateString("si-LK", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch (e) {
        return ts;
    }
}

function setStatusMessage(text, type) {
    var el = document.getElementById("dashMessage");
    if (!el) return;
    el.innerHTML = text;
    el.className = type ? "editor-message " + type : "editor-message";
}

// ── Editor: own submissions ────────────────────────────────

async function editorSubmissions(uid, lastDoc) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { results: [], cursor: null, note: "not_configured" };
    }
    try {
        var q = Dict.db.col(Dict.db.COLLECTIONS.submissions)
            .where("submittedBy", "==", uid)
            .orderBy("createdAt", "desc")
            .limit(DASH_LIMIT + 1);

        if (lastDoc) q = q.startAfter(lastDoc);

        var snap = await q.get();
        var results = [];
        var cursor = null;
        var i = 0;

        snap.forEach(function (d) {
            i++;
            if (i <= DASH_LIMIT) {
                results.push({ id: d.id, ...d.data() });
                cursor = d;
            }
        });

        return { results: results, cursor: cursor, note: "ok" };
    } catch (error) {
        console.warn("[dashboard] editorSubmissions failed:", error);
        return { results: [], cursor: null, note: "error" };
    }
}

// ── Reviewer: pending submissions ──────────────────────────

async function pendingCount() {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { count: 0, note: "not_configured" };
    }
    try {
        var snap = await Dict.db.col(Dict.db.COLLECTIONS.submissions)
            .where("status", "==", "pending")
            .orderBy("submittedAt", "desc")
            .limit(REVIEW_LIMIT + 1)
            .get();

        var results = [];
        snap.forEach(function (d) {
            results.push({ id: d.id, ...d.data() });
        });

        return { count: results.length, results: results, note: "ok" };
    } catch (error) {
        console.warn("[dashboard] pendingCount failed:", error);
        return { count: 0, results: [], note: "error" };
    }
}

// ── Reviewer: recently reviewed ────────────────────────────

async function recentlyReviewed(uid, limit) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { results: [], note: "not_configured" };
    }
    try {
        var snap = await Dict.db.col(Dict.db.COLLECTIONS.reviews)
            .where("reviewerId", "==", uid)
            .orderBy("createdAt", "desc")
            .limit(limit || 10)
            .get();

        var results = [];
        snap.forEach(function (d) {
            results.push({ id: d.id, ...d.data() });
        });

        return { results: results, note: "ok" };
    } catch (error) {
        console.warn("[dashboard] recentlyReviewed failed:", error);
        return { results: [], note: "error" };
    }
}

// ══════════════════════════════════════════════════════════════
// UI Rendering
// ══════════════════════════════════════════════════════════════

// ── Auth bar ───────────────────────────────────────────────

function updateDashAuthBar(a) {
    var bar = document.getElementById("authBar");
    if (!bar) return;
    if (a.user && !a.isPublic) {
        var links = '<a href="index.html" class="btn small secondary">ශබ්දකෝෂය</a>';
        if (a.isEditor) links += ' <a href="editor.html" class="btn small primary">සංස්කරණය</a>';
        if (a.isReviewer) links += ' <a href="review.html" class="btn small primary">සමාලෝචනය</a>';
        bar.innerHTML =
            links +
            '<span class="auth-email">' + esc(a.email) + "</span>" +
            '<span class="auth-role-badge">' + esc(a.roleLabel) + "</span>" +
            '<button type="button" class="btn small secondary" id="dashSignOutBtn">පිටවීම</button>';
        var outBtn = document.getElementById("dashSignOutBtn");
        if (outBtn) outBtn.addEventListener("click", function () { Dict.auth.signOut(); });
    } else {
        bar.innerHTML =
            '<a href="index.html" class="btn small secondary">ශබ්දකෝෂය</a>' +
            '<a href="login.html" class="btn small primary">පිවිසුම</a>';
    }
}

// ── Status badge ───────────────────────────────────────────

function statusBadge(status) {
    var labels = {
        draft: "කෙටුම්පත",
        pending: "සමාලෝචනය බලාපොරොත්තුවේ",
        changes_requested: "වෙනස්කම් ඉල්ලා ඇත",
        approved: "අනුමත",
        rejected: "ප්‍රතික්ෂේප",
    };
    return '<span class="review-status ' + esc(status) + '">' + esc(labels[status] || status) + '</span>';
}

// ── Group submissions by status ────────────────────────────

function groupByStatus(submissions) {
    var groups = {
        draft: [],
        pending: [],
        changes_requested: [],
        approved: [],
        rejected: [],
    };
    submissions.forEach(function (s) {
        var key = s.status || "draft";
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
    });
    return groups;
}

// ── Render submission row ──────────────────────────────────

function renderSubRow(sub, showOwner) {
    var after = sub.after || {};
    var word = after.headword || sub.wordId || "";
    var si = after.headwordSi || "";
    var time = formatTimestamp(sub.submittedAt || sub.createdAt);
    var typeLabel = sub.type === "create" ? "නව" : "සංස්කරණය";

    var editLink = "";
    if (sub.status === "changes_requested") {
        editLink = ' <a href="editor.html?submission=' + esc(sub.id) + '" class="btn primary">නැවත සංස්කරණය කරන්න</a>';
    } else if (sub.status === "draft") {
        editLink = ' <a href="editor.html?submission=' + esc(sub.id) + '" class="btn small primary">සංස්කරණය</a>';
    } else if (sub.wordId) {
        editLink = ' <a href="entry.html?id=' + encodeURIComponent(sub.wordId) + '" class="btn small secondary">බලන්න</a>';
    }

    var changesNote = "";
    if (sub.status === "changes_requested" && sub.reviewNote) {
        changesNote = '<div class="dash-review-note changes">සමාලෝචකගේ අදහස: ' + esc(sub.reviewNote) + '</div>';
    } else if (sub.status === "rejected" && sub.reviewNote) {
        changesNote = '<div class="dash-review-note rejected">ප්‍රතික්ෂේප හේතුව: ' + esc(sub.reviewNote) + '</div>';
    } else if (sub.status === "approved" && sub.reviewNote) {
        changesNote = '<div class="dash-review-note approved">සමාලෝචක සටහන: ' + esc(sub.reviewNote) + '</div>';
    }

    return '<div class="dash-sub-row">' +
        '<div class="dash-sub-main">' +
            '<div class="dash-sub-word">' +
                esc(word) +
                (si ? ' <span class="dash-sub-si">' + esc(si) + '</span>' : '') +
            '</div>' +
            '<div class="dash-sub-meta">' +
                '<span class="dash-sub-type">' + esc(typeLabel) + '</span>' +
                '<span class="dash-sub-time">' + esc(time) + '</span>' +
            '</div>' +
            changesNote +
        '</div>' +
        '<div class="dash-sub-actions">' + editLink + '</div>' +
    '</div>';
}

// ── Render editor dashboard ────────────────────────────────

function renderEditorDashboard(auth) {
    var dashContent = document.getElementById("dashContent");
    if (!dashContent) return;

    var section = document.createElement("div");
    section.className = "dash-section";

    var html = '<div class="dash-section-header">';
    html += '<h2>මගේ කාර්ය පුවරුව</h2>';
    html += '<a href="editor.html" class="btn primary">+ නව වචනයක්</a>';
    html += '</div>';
    html += '<div id="dashChangesAlert"></div>';
    html += '<div id="dashSubList" class="dash-sub-list"><div class="empty">පූරණය වෙමින්...</div></div>';
    html += '<div id="dashLoadMore" class="load-more-container" style="display:none">';
    html += '<button type="button" class="btn secondary" id="dashLoadMoreBtn">තවත් පෙන්වන්න</button>';
    html += '</div>';

    section.innerHTML = html;
    dashContent.appendChild(section);

    loadEditorSubmissions(auth.uid);
}

async function loadEditorSubmissions(uid, cursor) {
    var listEl = document.getElementById("dashSubList");
    var loadMoreEl = document.getElementById("dashLoadMore");
    if (!listEl) return;

    var result = await editorSubmissions(uid, cursor);
    if (result.note === "not_configured") {
        listEl.innerHTML = '<div class="empty">Firebase සැකසුම නොමැත.</div>';
        return;
    }
    if (result.note === "error") {
        listEl.innerHTML = '<div class="empty">දෝෂයක්: submissions පූරණය කළ නොහැක.</div>';
        return;
    }

    var groups = groupByStatus(result.results);
    var total = result.results.length;

    if (!total) {
        listEl.innerHTML = '<div class="empty">තවම submissions නොමැත. <a href="editor.html">නව වචනයක් සාදන්න.</a></div>';
        if (loadMoreEl) loadMoreEl.style.display = "none";
        return;
    }

    var alertEl = document.getElementById("dashChangesAlert");
    if (alertEl) {
        var crItems = groups.changes_requested || [];
        if (crItems.length) {
            var alertHtml = '<div class="dash-changes-alert">';
            alertHtml += '<h3 class="dash-changes-alert-title">⚠ වෙනස්කම් අවශ්‍යයි <span class="dash-group-count">(' + crItems.length + ')</span></h3>';
            crItems.forEach(function (sub) {
                alertHtml += renderSubRow(sub, false);
            });
            alertHtml += '</div>';
            alertEl.innerHTML = alertHtml;
        } else {
            alertEl.innerHTML = "";
        }
    }

    var html = '';
    var statusOrder = ["draft", "pending", "approved", "rejected"];

    statusOrder.forEach(function (status) {
        var items = groups[status];
        if (!items || !items.length) return;

        html += '<div class="dash-group">';
        html += '<h3 class="dash-group-title">' + statusBadge(status) + ' <span class="dash-group-count">(' + items.length + ')</span></h3>';

        items.forEach(function (sub) {
            html += renderSubRow(sub, false);
        });

        html += '</div>';
    });

    listEl.innerHTML = html;

    if (result.results.length >= DASH_LIMIT && loadMoreEl) {
        loadMoreEl.style.display = "block";
        var btn = document.getElementById("dashLoadMoreBtn");
        if (btn) {
            btn.onclick = function () {
                loadEditorSubmissions(uid, result.cursor);
            };
        }
    } else if (loadMoreEl) {
        loadMoreEl.style.display = "none";
    }
}

// ── Render reviewer dashboard ──────────────────────────────

function renderReviewerDashboard(auth) {
    var dashContent = document.getElementById("dashContent");
    if (!dashContent) return;

    var section = document.createElement("div");
    section.className = "dash-section";

    var html = '<div class="dash-section-header">';
    html += '<h2>සමාලෝචක කාර්ය පුවරුව</h2>';
    html += '<a href="review.html" class="btn primary">සමාලෝචනය</a>';
    html += '</div>';

    html += '<div class="dash-reviewer-stats">';
    html += '<div class="dash-stat-card" id="dashReviewerPendingCount">';
    html += '<div class="dash-stat-value">...</div>';
    html += '<div class="dash-stat-label">සමාලෝචනය අවශ්‍ය</div>';
    html += '</div>';
    html += '</div>';

    html += '<h3>මෑත සමාලෝචන</h3>';
    html += '<div id="dashRecentReviews" class="dash-sub-list"><div class="empty">පූරණය වෙමින්...</div></div>';
    html += '</div>';

    section.innerHTML = html;
    dashContent.appendChild(section);

    loadReviewerData(auth.uid);
}

async function loadReviewerData(uid) {
    var pendingResult = await pendingCount();
    var countEl = document.getElementById("dashReviewerPendingCount");
    if (countEl) {
        var val = countEl.querySelector(".dash-stat-value");
        if (val) val.textContent = pendingResult.count;
    }

    var recentResult = await recentlyReviewed(uid, 10);
    var listEl = document.getElementById("dashRecentReviews");
    if (!listEl) return;

    if (recentResult.note === "not_configured" || !recentResult.results.length) {
        listEl.innerHTML = '<div class="empty">මෑත සමාලෝචන නොමැත.</div>';
        return;
    }

    var html = '';
    var actionLabels = {
        approve: "අනුමත කළේය",
        reject: "ප්‍රතික්ෂේප කළේය",
        request_changes: "වෙනස්කම් ඉල්ලා සිටියේය",
    };

    recentResult.results.forEach(function (r) {
        html += '<div class="dash-sub-row">';
        html += '<div class="dash-sub-main">';
        html += '<div class="dash-sub-word">';
        html += '<a href="entry.html?id=' + encodeURIComponent(r.wordId || "") + '">';
        html += esc(r.wordId || "");
        html += '</a>';
        html += '</div>';
        html += '<div class="dash-sub-meta">';
        html += '<span class="dash-sub-type">' + esc(actionLabels[r.action] || r.action) + '</span>';
        html += '<span class="dash-sub-time">' + formatTimestamp(r.createdAt) + '</span>';
        html += '</div>';
        if (r.note) {
            html += '<div class="dash-review-note">' + esc(r.note) + '</div>';
        }
        html += '</div>';
        html += '</div>';
    });

    listEl.innerHTML = html;
}

// ── Render admin dashboard ─────────────────────────────────

function renderAdminDashboard(auth) {
    var dashContent = document.getElementById("dashContent");
    if (!dashContent) return;

    var section = document.createElement("div");
    section.className = "dash-section";

    var html = '<div class="dash-section-header">';
    html += '<h2>පරිපාලක කාර්ය පුවරුව</h2>';
    html += '</div>';

    html += '<div class="dash-admin-links">';
    html += '<a href="review.html" class="dash-admin-link">';
    html += '<div class="dash-admin-link-title">සමාලෝචනය</div>';
    html += '<div class="dash-admin-link-desc">Submissions සමාලෝචනය</div>';
    html += '</a>';
    html += '<a href="editor.html" class="dash-admin-link">';
    html += '<div class="dash-admin-link-title">සංස්කරණය</div>';
    html += '<div class="dash-admin-link-desc">වචන සංස්කරණය / නව එකතු කිරීම</div>';
    html += '</a>';
    html += '<a href="admin.html" class="dash-admin-link">';
    html += '<div class="dash-admin-link-title">පරිපාලනය</div>';
    html += '<div class="dash-admin-link-desc">පරිපාලක මෙවලම් (legacy)</div>';
    html += '</a>';
    html += '</div>';

    html += '<div class="dash-reviewer-stats">';
    html += '<div class="dash-stat-card" id="dashAdminPendingCount">';
    html += '<div class="dash-stat-value">...</div>';
    html += '<div class="dash-stat-label">සමාලෝචනය අවශ්‍ය</div>';
    html += '</div>';
    html += '</div>';

    section.innerHTML = html;
    dashContent.appendChild(section);

    pendingCount().then(function (result) {
        var countEl = document.getElementById("dashAdminPendingCount");
        if (countEl) {
            var val = countEl.querySelector(".dash-stat-value");
            if (val) val.textContent = result.count;
        }
    });
}

// ── Public user view ───────────────────────────────────────

function renderPublicDashboard() {
    var dashContent = document.getElementById("dashContent");
    if (!dashContent) return;

    dashContent.innerHTML =
        '<div class="empty">' +
            'කාර්ය පුවරුව භාවිතා කිරීමට <a href="login.html">පිවිසෙන්න</a>.' +
        '</div>';
}

// ══════════════════════════════════════════════════════════════
// Init
// ══════════════════════════════════════════════════════════════

var dashReady = false;

async function setupDashboard(auth) {
    if (dashReady) return;

    if (!auth.user || auth.isPublic) {
        renderPublicDashboard();
        return;
    }

    dashReady = true;

    var dashContent = document.getElementById("dashContent");
    if (!dashContent) return;
    dashContent.innerHTML = "";

    if (auth.isAdmin) {
        renderAdminDashboard(auth);
    }
    if (auth.isReviewer) {
        renderReviewerDashboard(auth);
    }
    if (auth.isEditor) {
        renderEditorDashboard(auth);
    }
    if (!auth.isAdmin && !auth.isReviewer && !auth.isEditor) {
        renderPublicDashboard();
    }
}

function dashInit() {
    if (!Dict.db.init()) {
        setStatusMessage("Firebase සැකසුම නොමැත.", "error");
        return;
    }

    Dict.auth.init();
    Dict.auth.onAuthChange(function (a) {
        updateDashAuthBar(a);
        setupDashboard(a);
    });
}

// ── Public API ─────────────────────────────────────────────

Dict.dashboard.editorSubmissions = editorSubmissions;
Dict.dashboard.pendingCount = pendingCount;
Dict.dashboard.recentlyReviewed = recentlyReviewed;

document.addEventListener("DOMContentLoaded", dashInit);
