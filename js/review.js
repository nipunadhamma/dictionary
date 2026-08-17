"use strict";

window.Dict = window.Dict || {};
Dict.review = Dict.review || {};

// ── Utilities ──────────────────────────────────────────────

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function reviewSetMessage(text, type) {
    var el = document.getElementById("reviewMessage");
    if (!el) return;
    el.innerHTML = text;
    el.className = type ? "editor-message " + type : "editor-message";
}

function formatTimestamp(ts) {
    if (!ts) return "";
    try {
        var d = new Date(ts);
        return d.toLocaleDateString("si-LK", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ts; }
}

// ── Load pending submissions ───────────────────────────────

async function pendingSubmissions() {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { results: [], note: "not_configured" };
    }
    try {
        var snap = await Dict.db.col(Dict.db.COLLECTIONS.submissions)
            .where("status", "==", "pending")
            .get();
        var results = [];
        snap.forEach(function (d) {
            results.push({ id: d.id, ...d.data() });
        });
        results.sort(function (a, b) {
            return (b.submittedAt || "").localeCompare(a.submittedAt || "");
        });
        return { results: results, note: "ok" };
    } catch (error) {
        console.error("[review] pendingSubmissions failed:", error);
        return { results: [], note: "error", detail: error.message || String(error) };
    }
}

// ── Load submission detail ─────────────────────────────────

async function loadSubmission(id) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { submission: null, note: "not_configured" };
    }
    try {
        var snap = await Dict.db.docRef(Dict.db.COLLECTIONS.submissions, id).get();
        if (!snap.exists) return { submission: null, note: "missing" };
        return { submission: { id: snap.id, ...snap.data() }, note: "ok" };
    } catch (error) {
        console.warn("[review] loadSubmission failed:", error);
        return { submission: null, note: "error" };
    }
}

// ── Load editor info for a submission ──────────────────────

async function loadSubmitterInfo(uid) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return null;
    }
    try {
        var snap = await Dict.db.docRef(Dict.db.COLLECTIONS.users, uid).get();
        if (snap.exists) return snap.data();
        return null;
    } catch (error) {
        return null;
    }
}

// ── Build searchIndex doc from word data ───────────────────

function buildSearchIndex(wordId, after) {
    var pali = Dict.normalize.normSearch(after.headword || "");
    var siFirst = "";
    var siAll = [];
    var allTokens = [];

    if (after.meanings && after.meanings.length) {
        after.meanings.forEach(function (m) {
            var normSi = Dict.normalize.normSinhala(m.si || "");
            if (normSi) {
                siAll.push(normSi);
                Dict.normalize.tokenize(normSi).forEach(function (t) {
                    allTokens.push(t);
                });
            }
            if (!siFirst && normSi) siFirst = normSi;
        });
    }

    var headwordSi = Dict.normalize.normSearch(after.headwordSi || "");

    var slAll = [];
    if (after.headwordSi) {
        slAll = Dict.normalize.singlishTokens(after.headwordSi);
    }

    Dict.normalize.tokenize(pali).forEach(function (t) {
        allTokens.push(t);
    });

    var uniqueAll = Array.from(new Set(allTokens));

    return {
        wordId: wordId,
        pali: pali,
        paliPrefix: pali,
        si: siFirst,
        siAll: siAll,
        slAll: slAll,
        all: uniqueAll,
        headwordSi: headwordSi,
        sources: [],
    };
}

// ── Approve submission ─────────────────────────────────────

async function approve(submissionId, note) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { ok: false, note: "not_configured" };
    }

    var auth = Dict.auth.lastState();
    if (!auth.uid || !auth.isReviewer) {
        return { ok: false, note: "not_authorized" };
    }

    try {
        var C = Dict.db.COLLECTIONS;
        var subSnap = await Dict.db.docRef(C.submissions, submissionId).get();
        if (!subSnap.exists) return { ok: false, note: "missing" };
        var sub = subSnap.data();

        if (sub.submittedBy === auth.uid) {
            return { ok: false, note: "self_review" };
        }

        if (sub.status !== "pending") {
            return { ok: false, note: "wrong_status" };
        }

        var after = sub.after || {};
        var wordId = sub.wordId;
        var now = new Date().toISOString();

        // 1. Update word doc
        var wordSnap = await Dict.db.docRef(C.words, wordId).get();
        var newVersion = 1;
        if (wordSnap.exists) {
            var current = wordSnap.data();
            newVersion = (current.version || 0) + 1;
            await Dict.db.docRef(C.words, wordId).update({
                headword: after.headword || current.headword,
                headwordSi: after.headwordSi || current.headwordSi,
                headwordNorm: after.headwordNorm || current.headwordNorm,
                status: "published",
                version: newVersion,
                isPublished: true,
                updatedBy: auth.uid,
                updatedAt: now,
            });
        } else {
            await Dict.db.docRef(C.words, wordId).set({
                headword: after.headword,
                headwordSi: after.headwordSi,
                headwordNorm: after.headwordNorm,
                status: "published",
                version: 1,
                isPublished: true,
                createdBy: auth.uid,
                createdAt: now,
                updatedBy: auth.uid,
                updatedAt: now,
            });
            newVersion = 1;
        }

        // 2. Write wordMeanings (replace all)
        var oldMeaningsSnap = await Dict.db.col(C.wordMeanings).where("wordId", "==", wordId).get();
        var batch1 = Dict.db.get().batch();
        oldMeaningsSnap.forEach(function (d) { batch1.delete(d.ref); });
        await batch1.commit();

        if (after.meanings && after.meanings.length) {
            var batch2 = Dict.db.get().batch();
            after.meanings.forEach(function (m, i) {
                var ref = Dict.db.col(C.wordMeanings).doc();
                batch2.set(ref, {
                    wordId: wordId,
                    si: m.si || "",
                    grammar: m.grammar || null,
                    sourceId: m.sourceId || null,
                    order: i,
                    status: "published",
                    createdBy: auth.uid,
                    createdAt: now,
                });
            });
            await batch2.commit();
        }

        // 3. Write wordForms (replace all)
        var oldFormsSnap = await Dict.db.col(C.wordForms).where("wordId", "==", wordId).get();
        var batch3 = Dict.db.get().batch();
        oldFormsSnap.forEach(function (d) { batch3.delete(d.ref); });
        await batch3.commit();

        if (after.forms && after.forms.length) {
            var batch4 = Dict.db.get().batch();
            after.forms.forEach(function (f, i) {
                var ref = Dict.db.col(C.wordForms).doc();
                batch4.set(ref, {
                    wordId: wordId,
                    form: f.form || "",
                    formNorm: f.formNorm || Dict.normalize.normSearch(f.form || ""),
                    type: f.type || "alternative",
                    order: i,
                });
            });
            await batch4.commit();
        }

        // 4. Write examples (replace all)
        var oldExamplesSnap = await Dict.db.col(C.examples).where("wordId", "==", wordId).get();
        var batch5 = Dict.db.get().batch();
        oldExamplesSnap.forEach(function (d) { batch5.delete(d.ref); });
        await batch5.commit();

        if (after.examples && after.examples.length) {
            var batch6 = Dict.db.get().batch();
            after.examples.forEach(function (e, i) {
                var ref = Dict.db.col(C.examples).doc();
                batch6.set(ref, {
                    wordId: wordId,
                    pali: e.pali || "",
                    si: e.si || "",
                    sourceId: e.sourceId || null,
                    order: i,
                });
            });
            await batch6.commit();
        }

        // 5. Write searchIndex
        var siDoc = buildSearchIndex(wordId, after);
        await Dict.db.docRef(C.searchIndex, wordId).set(siDoc);

        // 6. Create versions doc
        await Dict.db.col(C.versions).add({
            wordId: wordId,
            version: newVersion,
            action: sub.type === "create" ? "create" : "approve",
            snapshot: after,
            authorId: auth.uid,
            authorRole: auth.role,
            submissionId: submissionId,
            createdAt: now,
        });

        // 7. Create reviews doc
        await Dict.db.col(C.reviews).add({
            submissionId: submissionId,
            wordId: wordId,
            reviewerId: auth.uid,
            action: "approve",
            note: note || "",
            createdAt: now,
        });

        // 8. Update submission
        await Dict.db.docRef(C.submissions, submissionId).update({
            status: "approved",
            reviewedBy: auth.uid,
            reviewedAt: now,
            reviewNote: note || "",
            updatedAt: now,
        });

        return { ok: true, note: "ok" };
    } catch (error) {
        console.error("[review] approve failed:", error);
        return { ok: false, note: error.message || "error" };
    }
}

// ── Reject submission ──────────────────────────────────────

async function reject(submissionId, reason) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { ok: false, note: "not_configured" };
    }

    var auth = Dict.auth.lastState();
    if (!auth.uid || !auth.isReviewer) {
        return { ok: false, note: "not_authorized" };
    }

    if (!reason || !reason.trim()) {
        return { ok: false, note: "reason_required" };
    }

    try {
        var C = Dict.db.COLLECTIONS;
        var subSnap = await Dict.db.docRef(C.submissions, submissionId).get();
        if (!subSnap.exists) return { ok: false, note: "missing" };
        var sub = subSnap.data();

        if (sub.submittedBy === auth.uid) {
            return { ok: false, note: "self_review" };
        }

        if (sub.status !== "pending") {
            return { ok: false, note: "wrong_status" };
        }

        var now = new Date().toISOString();
        var wordId = sub.wordId;

        // 1. Update submission
        await Dict.db.docRef(C.submissions, submissionId).update({
            status: "rejected",
            reviewedBy: auth.uid,
            reviewedAt: now,
            reviewNote: reason,
            updatedAt: now,
        });

        // 2. Update word status
        await Dict.db.docRef(C.words, wordId).update({
            status: "rejected",
            updatedAt: now,
            updatedBy: auth.uid,
        }).catch(function () { });

        // 3. Create reviews doc
        await Dict.db.col(C.reviews).add({
            submissionId: submissionId,
            wordId: wordId,
            reviewerId: auth.uid,
            action: "reject",
            note: reason,
            createdAt: now,
        });

        return { ok: true, note: "ok" };
    } catch (error) {
        console.error("[review] reject failed:", error);
        return { ok: false, note: error.message || "error" };
    }
}

// ── Request changes ────────────────────────────────────────

async function requestChanges(submissionId, reason) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return { ok: false, note: "not_configured" };
    }

    var auth = Dict.auth.lastState();
    if (!auth.uid || !auth.isReviewer) {
        return { ok: false, note: "not_authorized" };
    }

    if (!reason || !reason.trim()) {
        return { ok: false, note: "reason_required" };
    }

    try {
        var C = Dict.db.COLLECTIONS;
        var subSnap = await Dict.db.docRef(C.submissions, submissionId).get();
        if (!subSnap.exists) return { ok: false, note: "missing" };
        var sub = subSnap.data();

        if (sub.submittedBy === auth.uid) {
            return { ok: false, note: "self_review" };
        }

        if (sub.status !== "pending") {
            return { ok: false, note: "wrong_status" };
        }

        var now = new Date().toISOString();
        var wordId = sub.wordId;

        // 1. Update submission
        await Dict.db.docRef(C.submissions, submissionId).update({
            status: "changes_requested",
            reviewedBy: auth.uid,
            reviewedAt: now,
            reviewNote: reason,
            updatedAt: now,
        });

        // 2. Update word status
        await Dict.db.docRef(C.words, wordId).update({
            status: "changes_requested",
            updatedAt: now,
            updatedBy: auth.uid,
        }).catch(function () { });

        // 3. Create reviews doc
        await Dict.db.col(C.reviews).add({
            submissionId: submissionId,
            wordId: wordId,
            reviewerId: auth.uid,
            action: "request_changes",
            note: reason,
            createdAt: now,
        });

        return { ok: true, note: "ok" };
    } catch (error) {
        console.error("[review] requestChanges failed:", error);
        return { ok: false, note: error.message || "error" };
    }
}

// ── Load reviews for a submission ──────────────────────────

async function loadReviews(submissionId) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) return [];
    try {
        var snap = await Dict.db.col(Dict.db.COLLECTIONS.reviews)
            .where("submissionId", "==", submissionId)
            .get();
        var results = [];
        snap.forEach(function (d) { results.push({ id: d.id, ...d.data() }); });
        results.sort(function (a, b) {
            return (b.createdAt || "").localeCompare(a.createdAt || "");
        });
        return results;
    } catch (error) {
        console.warn("[review] loadReviews failed:", error);
        return [];
    }
}

// ══════════════════════════════════════════════════════════════
// UI Controller
// ══════════════════════════════════════════════════════════════

let reviewReady = false;

// ── Auth bar ───────────────────────────────────────────────

function updateReviewAuthBar(a) {
    var bar = document.getElementById("authBar");
    if (!bar) return;
    if (a.user && !a.isPublic) {
        bar.innerHTML =
            '<a href="index.html" class="btn small secondary">ශබ්දකෝෂය</a>' +
            '<a href="dashboard.html" class="btn small secondary">කාර්ය පුවරුව</a>' +
            '<span class="auth-email">' + esc(a.email) + "</span>" +
            '<span class="auth-role-badge">' + esc(a.roleLabel) + "</span>" +
            '<button type="button" class="btn small secondary" id="reviewSignOutBtn">පිටවීම</button>';
        var outBtn = document.getElementById("reviewSignOutBtn");
        if (outBtn) outBtn.addEventListener("click", function () { Dict.auth.signOut(); });
    } else {
        bar.innerHTML =
            '<a href="index.html" class="btn small secondary">ශබ්දකෝෂය</a>' +
            '<a href="login.html" class="btn small primary">පිවිසුම</a>';
    }
}

// ── Render submission list ─────────────────────────────────

function renderSubmissionList(submissions) {
    var listEl = document.getElementById("reviewList");
    if (!listEl) return;

    if (!submissions.length) {
        listEl.innerHTML = '<div class="empty">සමාලෝචනය අවශ්‍ය submissions නොමැත.</div>';
        return;
    }

    var html = '<h2>සමාලෝචනය අවශ්‍ය (' + submissions.length + ')</h2>';

    submissions.forEach(function (sub) {
        var after = sub.after || {};
        var submittedTime = formatTimestamp(sub.submittedAt);
        var statusBadge = '<span class="review-status pending">pending</span>';
        var editLink = sub.type === "create"
            ? "editor.html?submission=" + sub.id
            : "editor.html?id=" + encodeURIComponent(sub.wordId) + "&submission=" + sub.id;

        html += '<div class="review-card" data-id="' + esc(sub.id) + '">' +
            '<div class="review-card-header">' +
                '<div class="review-card-title">' +
                    '<a href="' + editLink + '" class="review-word-link">' +
                        esc(after.headword || sub.wordId) +
                    '</a>' +
                    ' ' + statusBadge +
                '</div>' +
                '<div class="review-card-meta">' +
                    (after.headwordSi ? '<span class="review-meta-si">' + esc(after.headwordSi) + '</span>' : '') +
                    '<span class="review-meta-type">' + esc(sub.type) + '</span>' +
                    '<span class="review-meta-time">' + esc(submittedTime) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="review-card-meanings">' +
                (after.meanings && after.meanings.length
                    ? after.meanings.slice(0, 3).map(function (m) { return '<span class="review-meaning-chip">' + esc(m.si || "") + '</span>'; }).join("")
                    : '<span class="review-meaning-chip empty">අර්ථ නැත</span>'
                ) +
                (after.meanings && after.meanings.length > 3
                    ? '<span class="review-meaning-chip more">+' + (after.meanings.length - 3) + '</span>'
                    : '') +
            '</div>' +
            '<button type="button" class="btn primary review-open-btn" data-id="' + esc(sub.id) + '">සමාලෝචනය</button>' +
        '</div>';
    });

    listEl.innerHTML = html;

    listEl.querySelectorAll(".review-open-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            openSubmissionDetail(btn.dataset.id);
        });
    });
}

// ── Open submission detail ─────────────────────────────────

async function openSubmissionDetail(subId) {
    var listEl = document.getElementById("reviewList");
    var detailEl = document.getElementById("reviewDetail");
    if (!detailEl) return;

    listEl.style.display = "none";
    detailEl.style.display = "block";

    detailEl.innerHTML = '<div class="empty">පූරණය වෙමින්...</div>';

    var result = await loadSubmission(subId);
    if (result.note !== "ok" || !result.submission) {
        detailEl.innerHTML = '<div class="empty">Submission හමු නොවීය.</div>';
        return;
    }

    var sub = result.submission;
    var after = sub.after || {};
    var before = sub.before || null;

    // For static entry edits, load the static base as "before" if missing
    if (!before && sub.type === "edit" && sub.wordId) {
        try {
            var staticEntry = await Dict.static.getEntryByWordId(sub.wordId);
            if (staticEntry) {
                var meanings = (staticEntry.meanings || []).map(function(m, i) {
                    return { si: m.si || "", sourceId: m.src || "", grammar: null, order: i };
                });
                before = {
                    headword: staticEntry.r || "",
                    headwordSi: staticEntry.w || "",
                    headwordNorm: Dict.normalize.normSearch(staticEntry.r || ""),
                    meanings: meanings,
                    forms: [],
                    examples: [],
                    notes: "",
                    _source: "static",
                };
            }
        } catch (e) {
            console.warn("[review] static base load failed:", e);
        }
    }

    var reviews = await loadReviews(subId);

    var html = '';

    // Back button
    html += '<button type="button" class="btn small secondary review-back-btn" id="reviewBackBtn">← ලැයිස්තුවට</button>';

    // Header
    html += '<div class="review-detail-header">';
    html += '<h2>' + esc(after.headword || sub.wordId) + '</h2>';
    if (after.headwordSi) html += '<div class="review-detail-si">' + esc(after.headwordSi) + '</div>';
    html += '<div class="review-detail-meta">';
    html += '<span class="review-detail-type">වර්ගය: ' + esc(sub.type) + '</span>';
    html += '<span class="review-detail-time">ඉදිරිපත් කළේ: ' + formatTimestamp(sub.submittedAt) + '</span>';
    html += '</div>';
    html += '</div>';

    // Before snapshot (if edit)
    if (before && sub.type === "edit") {
        html += '<div class="review-section">';
        html += '<h3>පෙර තත්ත්වය (Before)</h3>';
        html += renderSnapshot(before);
        html += '</div>';
    }

    // After snapshot
    html += '<div class="review-section">';
    html += '<h3>නව තත්ත්වය (After)</h3>';
    html += renderSnapshot(after);
    html += '</div>';

    // Previous reviews
    if (reviews.length) {
        html += '<div class="review-section">';
        html += '<h3>සමාලෝචන ඉතිහාසය</h3>';
        reviews.forEach(function (r) {
            var actionLabel = r.action === "approve" ? "අනුමත කළේය"
                : r.action === "reject" ? "ප්‍රතික්ෂේප කළේය"
                : "වෙනස්කම් ඉල්ලා සිටියේය";
            html += '<div class="review-history-item">';
            html += '<span class="review-history-action">' + esc(actionLabel) + '</span>';
            html += '<span class="review-history-time">' + formatTimestamp(r.createdAt) + '</span>';
            if (r.note) html += '<div class="review-history-note">' + esc(r.note) + '</div>';
            html += '</div>';
        });
        html += '</div>';
    }

    // Action buttons
    html += '<div class="review-actions">';
    html += '<div class="review-comment">';
    html += '<label for="reviewComment">සටහන්</label>';
    html += '<textarea id="reviewComment" rows="3" placeholder="සමාලෝචක සටහන්..."></textarea>';
    html += '</div>';
    html += '<div class="review-buttons">';
    html += '<button type="button" class="btn primary" id="reviewApproveBtn">අනුමත කරන්න</button>';
    html += '<button type="button" class="btn" id="reviewChangesBtn" style="background:#e67e22;color:#fff">වෙනස්කම් ඉල්ලන්න</button>';
    html += '<button type="button" class="btn danger" id="reviewRejectBtn">ප්‍රතික්ෂේප කරන්න</button>';
    html += '</div>';
    html += '<div id="reviewActionStatus" class="editor-save-status"></div>';
    html += '</div>';

    detailEl.innerHTML = html;

    // Bind events
    document.getElementById("reviewBackBtn").addEventListener("click", function () {
        detailEl.style.display = "none";
        detailEl.innerHTML = "";
        listEl.style.display = "block";
    });

    document.getElementById("reviewApproveBtn").addEventListener("click", async function () {
        var comment = document.getElementById("reviewComment").value.trim();
        var statusEl = document.getElementById("reviewActionStatus");
        statusEl.textContent = "අනුමත කරමින්...";
        statusEl.className = "editor-save-status";
        this.disabled = true;

        var res = await Dict.review.approve(subId, comment);
        if (res.ok) {
            statusEl.textContent = "අනුමත කළා!";
            statusEl.className = "editor-save-status success";
            setTimeout(function () { window.location.reload(); }, 1500);
        } else {
            statusEl.textContent = "දෝෂයක්: " + res.note;
            statusEl.className = "editor-save-status error";
            document.getElementById("reviewApproveBtn").disabled = false;
        }
    });

    document.getElementById("reviewChangesBtn").addEventListener("click", async function () {
        var comment = document.getElementById("reviewComment").value.trim();
        if (!comment) {
            document.getElementById("reviewActionStatus").textContent = "කරුණාකර සටහනක් ඇතුළත් කරන්න.";
            document.getElementById("reviewActionStatus").className = "editor-save-status error";
            return;
        }
        var statusEl = document.getElementById("reviewActionStatus");
        statusEl.textContent = "වෙනස්කම් ඉල්ලමින්...";
        statusEl.className = "editor-save-status";
        this.disabled = true;

        var res = await Dict.review.requestChanges(subId, comment);
        if (res.ok) {
            statusEl.textContent = "වෙනස්කම් ඉල්ලීය!";
            statusEl.className = "editor-save-status success";
            setTimeout(function () { window.location.reload(); }, 1500);
        } else {
            statusEl.textContent = "දෝෂයක්: " + res.note;
            statusEl.className = "editor-save-status error";
            document.getElementById("reviewChangesBtn").disabled = false;
        }
    });

    document.getElementById("reviewRejectBtn").addEventListener("click", async function () {
        var comment = document.getElementById("reviewComment").value.trim();
        if (!comment) {
            document.getElementById("reviewActionStatus").textContent = "ප්‍රතික්ෂේපය සඳහා හේතුව අවශ්‍යයි.";
            document.getElementById("reviewActionStatus").className = "editor-save-status error";
            return;
        }
        if (!confirm("මෙම submission එක ප්‍රතික්ෂේප කරන්නද?")) return;
        var statusEl = document.getElementById("reviewActionStatus");
        statusEl.textContent = "ප්‍රතික්ෂේප කරමින්...";
        statusEl.className = "editor-save-status";
        this.disabled = true;

        var res = await Dict.review.reject(subId, comment);
        if (res.ok) {
            statusEl.textContent = "ප්‍රතික්ෂේප කළා!";
            statusEl.className = "editor-save-status success";
            setTimeout(function () { window.location.reload(); }, 1500);
        } else {
            statusEl.textContent = "දෝෂයක්: " + res.note;
            statusEl.className = "editor-save-status error";
            document.getElementById("reviewRejectBtn").disabled = false;
        }
    });
}

// ── Render snapshot (before/after) ─────────────────────────

function renderSnapshot(snap) {
    var html = '<div class="review-snapshot">';

    if (snap._source === "static") {
        html += '<div class="review-snapshot-source">මූලික ශබ්දකෝෂයෙන්</div>';
    }

    html += '<div class="review-snapshot-field">';
    html += '<span class="review-snapshot-label">පාලි:</span> ' + esc(snap.headword || "—");
    html += '</div>';

    if (snap.headwordSi) {
        html += '<div class="review-snapshot-field">';
        html += '<span class="review-snapshot-label">සිංහල:</span> ' + esc(snap.headwordSi);
        html += '</div>';
    }

    if (snap.meanings && snap.meanings.length) {
        html += '<div class="review-snapshot-field">';
        html += '<span class="review-snapshot-label">අර්ථ:</span>';
        html += '<ul class="review-snapshot-list">';
        snap.meanings.forEach(function (m) {
            var grammar = m.grammar ? ' <span class="review-snapshot-grammar">(' + esc(m.grammar) + ')</span>' : '';
            html += '<li>' + esc(m.si || "") + grammar + '</li>';
        });
        html += '</ul></div>';
    }

    if (snap.forms && snap.forms.length) {
        html += '<div class="review-snapshot-field">';
        html += '<span class="review-snapshot-label">පද විභාග:</span> ';
        html += snap.forms.map(function (f) { return esc(f.form); }).join(", ");
        html += '</div>';
    }

    if (snap.examples && snap.examples.length) {
        html += '<div class="review-snapshot-field">';
        html += '<span class="review-snapshot-label">උදාහරණ:</span>';
        html += '<ul class="review-snapshot-list">';
        snap.examples.forEach(function (e) {
            html += '<li><em>' + esc(e.pali || "") + '</em> — ' + esc(e.si || "") + '</li>';
        });
        html += '</ul></div>';
    }

    if (snap.notes) {
        html += '<div class="review-snapshot-field">';
        html += '<span class="review-snapshot-label">සටහන්:</span> ' + esc(snap.notes);
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// ── Init ───────────────────────────────────────────────────

async function setupReview(auth) {
    if (reviewReady) return;

    if (!auth.user || auth.isPublic) {
        reviewSetMessage("සමාලෝචන ප්‍රවේශය සඳහා පිවිසෙන්න. <a href=\"login.html\">පිවිසුම</a>", "error");
        return;
    }

    if (!auth.isReviewer) {
        reviewSetMessage("සමාලෝචන ප්‍රවේශය නොමැත.", "error");
        return;
    }

    reviewReady = true;

    var result = await pendingSubmissions();
    if (result.note === "not_configured") {
        reviewSetMessage("Firebase සැකසුම නොමැත.", "error");
        return;
    }
    if (result.note !== "ok") {
        var detail = result.detail ? " (" + result.detail + ")" : "";
        reviewSetMessage("දෝෂයක්: submissions පූරණය කළ නොහැක." + detail, "error");
        return;
    }

    renderSubmissionList(result.results);
}

function reviewInit() {
    if (!Dict.db.init()) {
        reviewSetMessage("Firebase සැකසුම නොමැත.", "error");
        return;
    }

    Dict.auth.init();
    Dict.auth.onAuthChange(function (a) {
        updateReviewAuthBar(a);
        setupReview(a);
    });
}

// ── Public API ─────────────────────────────────────────────

Dict.review.pendingSubmissions = pendingSubmissions;
Dict.review.loadSubmission = loadSubmission;
Dict.review.loadSubmitterInfo = loadSubmitterInfo;
Dict.review.approve = approve;
Dict.review.reject = reject;
Dict.review.requestChanges = requestChanges;
Dict.review.loadReviews = loadReviews;
Dict.review.renderSubmissionList = renderSubmissionList;
Dict.review.openSubmissionDetail = openSubmissionDetail;

document.addEventListener("DOMContentLoaded", reviewInit);
