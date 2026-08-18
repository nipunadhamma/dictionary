"use strict";

window.Dict = window.Dict || {};
Dict.editor = Dict.editor || {};

// ── Constants ──────────────────────────────────────────────

const FORM_TYPES = [
    { value: "alternative", label: "විකල්ප" },
    { value: "inflection", label: "ව්‍යුත්පත්ති" },
    { value: "derived", label: "ව්‍යුත්පාද" },
];

// ── State ──────────────────────────────────────────────────

let currentSubmissionId = null;
let currentWordId = null;
let currentEditType = null;
let existingWordSnapshot = null;
let isSubmitting = false;
let editorReady = false;

// ── Utilities ──────────────────────────────────────────────

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function generateWordId(headwordNorm) {
    var raw = String(headwordNorm || "").normalize("NFC").trim();
    var encoder = new TextEncoder();
    var data = encoder.encode(raw);
    var hashBuffer = await crypto.subtle.digest("SHA-256", data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    var hashHex = hashArray.map(function (b) {
        return b.toString(16).padStart(2, "0");
    }).join("");
    return "w_" + hashHex.slice(0, 16);
}

function setSaveStatus(text, type) {
    var el = document.getElementById("editorSaveStatus");
    if (!el) return;
    el.textContent = text;
    el.className = type ? "editor-save-status " + type : "editor-save-status";
}

function setMessage(text, type) {
    var el = document.getElementById("editorMessage");
    if (!el) return;
    el.textContent = text;
    el.className = type ? "editor-message " + type : "editor-message";
}

// ── Data loading ───────────────────────────────────────────

async function loadSubmission(id) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        console.error("[editor] loadSubmission: Firebase not configured or unavailable");
        return { submission: null, note: "not_configured" };
    }
    try {
        var snap = await Dict.db.docRef(Dict.db.COLLECTIONS.submissions, id).get();
        if (!snap.exists) {
            console.error("[editor] loadSubmission: document does not exist for id=" + id);
            return { submission: null, note: "missing" };
        }
        return { submission: { id: snap.id, ...snap.data() }, note: "ok" };
    } catch (error) {
        console.error("[editor] loadSubmission failed for id=" + id + ":", error.message || error, error.code || "", error);
        return { submission: null, note: "error", detail: error.message || String(error) };
    }
}

// ── Changes-requested notification ─────────────────────────

async function loadChangesRequestedSubmissions(uid) {
    if (!Dict.db.init() || !Dict.db.isAvailable()) {
        return [];
    }
    try {
        var C = Dict.db.COLLECTIONS;
        var snap = await Dict.db.col(C.submissions)
            .where("submittedBy", "==", uid)
            .where("status", "==", "changes_requested")
            .get();
        var results = [];
        snap.forEach(function (doc) {
            results.push({ id: doc.id, ...doc.data() });
        });
        results.sort(function (a, b) {
            var ta = a.updatedAt || a.submittedAt || a.createdAt || "";
            var tb = b.updatedAt || b.submittedAt || b.createdAt || "";
            return tb.localeCompare(ta);
        });
        return results;
    } catch (error) {
        console.error("[editor] loadChangesRequestedSubmissions failed:", error.message || error, error.code || "", error);
        return null;
    }
}

function renderChangesNotification(submissions, uid) {
    var container = document.getElementById("editorChangesList");
    if (!container) return;
    container.innerHTML = "";

    if (!submissions || submissions.length === 0) return;

    var panel = document.createElement("div");
    panel.className = "editor-changes-list";

    var header = document.createElement("div");
    header.className = "editor-changes-header";
    header.textContent = "⚠ වෙනස්කම් ඉල්ලා ඇත \u2014 " + submissions.length;
    panel.appendChild(header);

    var list = document.createElement("div");
    list.className = "editor-change-items";

    submissions.forEach(function (sub, idx) {
        var item = document.createElement("div");
        item.className = "editor-change-item";

        var after = sub.after || {};
        var headwordSi = after.headwordSi || "";
        var headword = after.headword || "";
        var displayLabel = headwordSi || headword || "(නම නැත)";
        var reviewNote = sub.reviewNote || "";

        var main = document.createElement("div");
        main.className = "editor-change-main";

        var num = document.createElement("span");
        num.className = "editor-change-num";
        num.textContent = (idx + 1) + ".";
        main.appendChild(num);

        var headEl = document.createElement("span");
        headEl.className = "editor-change-headword";
        headEl.textContent = displayLabel;
        main.appendChild(headEl);

        if (headwordSi && headword) {
            var paliEl = document.createElement("span");
            paliEl.className = "editor-change-pali";
            paliEl.textContent = headword;
            main.appendChild(paliEl);
        }

        item.appendChild(main);

        if (reviewNote) {
            var noteEl = document.createElement("div");
            noteEl.className = "editor-change-note";
            noteEl.textContent = reviewNote;
            item.appendChild(noteEl);
        }

        var actionRow = document.createElement("div");
        actionRow.className = "editor-change-action";
        var btn = document.createElement("a");
        btn.href = "editor.html?submission=" + encodeURIComponent(sub.id);
        btn.className = "btn primary small";
        btn.textContent = "නැවත සංස්කරණය කරන්න";
        actionRow.appendChild(btn);
        item.appendChild(actionRow);

        list.appendChild(item);
    });

    panel.appendChild(list);
    container.appendChild(panel);
}

async function loadWordForEdit(wordId) {
    // Try Firestore first
    if (Dict.db.init() && Dict.db.isAvailable()) {
        try {
            var C = Dict.db.COLLECTIONS;
            var wordSnap = await Dict.db.docRef(C.words, wordId).get();
            if (wordSnap.exists) {
                var word = { id: wordSnap.id, ...wordSnap.data() };
                var results = await Promise.all([
                    Dict.db.col(C.wordMeanings).where("wordId", "==", wordId).orderBy("order").get(),
                    Dict.db.col(C.wordForms).where("wordId", "==", wordId).orderBy("order").get(),
                    Dict.db.col(C.examples).where("wordId", "==", wordId).orderBy("order").get(),
                ]);
                word.meanings = [];
                results[0].forEach(function (d) { word.meanings.push({ id: d.id, ...d.data() }); });
                word.forms = [];
                results[1].forEach(function (d) { word.forms.push({ id: d.id, ...d.data() }); });
                word.examples = [];
                results[2].forEach(function (d) { word.examples.push({ id: d.id, ...d.data() }); });
                return { word: word, note: "ok", source: "firestore" };
            }
        } catch (error) {
            console.warn("[editor] Firestore loadWordForEdit failed:", error);
        }
    }

    // Fall back to static entry
    try {
        var staticEntry = await Dict.static.getEntryByWordId(wordId);
        if (staticEntry) {
            var meanings = (staticEntry.meanings || []).map(function(m, i) {
                return { si: m.si || "", sourceId: m.src || "", grammar: null, order: i };
            });
            return {
                word: {
                    id: staticEntry.id,
                    headword: staticEntry.r || "",
                    headwordSi: staticEntry.w || "",
                    headwordNorm: Dict.normalize.normSearch(staticEntry.r || ""),
                    meanings: meanings,
                    forms: [],
                    examples: [],
                    status: "published",
                    source: "static",
                },
                note: "ok",
                source: "static",
            };
        }
    } catch (error) {
        console.warn("[editor] static loadWordForEdit failed:", error);
    }

    return { word: null, note: "missing" };
}

// ── Validation ─────────────────────────────────────────────

function validate(data) {
    var errors = [];
    if (!data.headword || !data.headword.trim()) {
        errors.push("පාලි හිස්වචනය අවශ්‍යයි.");
    }
    if (!data.meanings || !data.meanings.length) {
        errors.push("අවම වශයෙන් අර්ථයක් ඇතුළත් කරන්න.");
    } else {
        var hasAny = data.meanings.some(function (m) {
            return m.si && m.si.trim();
        });
        if (!hasAny) {
            errors.push("අවම වශයෙන් සිංහල අර්ථයක් ඇතුළත් කරන්න.");
        }
    }
    return errors;
}

// ── Collect form data ──────────────────────────────────────

function collectFormData() {
    var headword = (document.getElementById("headword").value || "").trim();
    var headwordSi = (document.getElementById("headwordSi").value || "").trim();
    var headwordNorm = Dict.normalize.normSearch(headword);

    var meanings = [];
    document.querySelectorAll(".meaning-row").forEach(function (row, i) {
        var si = (row.querySelector(".meaning-si").value || "").trim();
        if (!si) return;
        meanings.push({
            si: si,
            grammar: (row.querySelector(".meaning-grammar").value || "").trim() || null,
            sourceId: (row.querySelector(".meaning-source").value || "").trim() || null,
            order: i,
        });
    });

    var forms = [];
    document.querySelectorAll(".form-row").forEach(function (row, i) {
        var form = (row.querySelector(".form-text").value || "").trim();
        if (!form) return;
        forms.push({
            form: form,
            formNorm: Dict.normalize.normSearch(form),
            type: row.querySelector(".form-type").value || "alternative",
            order: i,
        });
    });

    var examples = [];
    document.querySelectorAll(".example-row").forEach(function (row, i) {
        var pali = (row.querySelector(".example-pali").value || "").trim();
        var si = (row.querySelector(".example-si").value || "").trim();
        if (!pali && !si) return;
        examples.push({
            pali: pali,
            si: si,
            sourceId: (row.querySelector(".example-source").value || "").trim() || null,
            order: i,
        });
    });

    var notes = (document.getElementById("notes").value || "").trim();

    return {
        headword: headword,
        headwordSi: headwordSi,
        headwordNorm: headwordNorm,
        meanings: meanings,
        forms: forms,
        examples: examples,
        notes: notes,
    };
}

// ── Build after snapshot ───────────────────────────────────

function buildAfterSnapshot(data) {
    return {
        headword: data.headword,
        headwordSi: data.headwordSi,
        headwordNorm: data.headwordNorm,
        meanings: data.meanings,
        forms: data.forms,
        examples: data.examples,
        notes: data.notes,
    };
}

// ── Save draft (core) ──────────────────────────────────────
// Shared logic used by both saveDraft() and submitForReview() auto-save.
// Does NOT manage isSubmitting — caller must handle that.

async function _saveDraftCore(data, auth) {
    var after = buildAfterSnapshot(data);
    var now = new Date().toISOString();
    var C = Dict.db.COLLECTIONS;

    if (currentSubmissionId) {
        await Dict.db.docRef(C.submissions, currentSubmissionId).update({
            after: after,
            updatedAt: now,
        });
    } else {
        var wordId = currentWordId || await generateWordId(data.headwordNorm);

        if (currentEditType === "create") {
            var existing = await Dict.db.docRef(C.words, wordId).get();
            if (existing.exists) {
                throw new Error("මෙම වචනය දැනටමත් පවතී. සංස්කරණය කිරීමට editor.html?id=" + wordId + " වෙත යන්න.");
            }

            await Dict.db.docRef(C.words, wordId).set({
                headword: data.headword,
                headwordSi: data.headwordSi,
                headwordNorm: data.headwordNorm,
                status: "draft",
                version: 0,
                isPublished: false,
                createdBy: auth.uid,
                createdAt: now,
                updatedBy: auth.uid,
                updatedAt: now,
            });
        }

        var before = null;
        if (currentEditType === "edit" && existingWordSnapshot) {
            before = {
                headword: existingWordSnapshot.headword,
                headwordSi: existingWordSnapshot.headwordSi,
                headwordNorm: existingWordSnapshot.headwordNorm,
                meanings: existingWordSnapshot.meanings || [],
                forms: existingWordSnapshot.forms || [],
                examples: existingWordSnapshot.examples || [],
            };
        }

        var subRef = await Dict.db.col(C.submissions).add({
            wordId: wordId,
            type: currentEditType || "create",
            status: "draft",
            before: before,
            after: after,
            submittedBy: auth.uid,
            submittedAt: null,
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            createdAt: now,
            updatedAt: now,
        });

        currentSubmissionId = subRef.id;
        currentWordId = wordId;
    }

    document.getElementById("submitBtn").disabled = false;
    return true;
}

// ── Save draft ─────────────────────────────────────────────

async function saveDraft() {
    if (isSubmitting) return;

    var data = collectFormData();
    var errors = validate(data);
    if (errors.length) {
        setSaveStatus(errors.join(" "), "error");
        return;
    }

    isSubmitting = true;
    setSaveStatus("සුරකිමින්...", "");

    try {
        var auth = Dict.auth.lastState();
        if (!auth.uid) {
            setSaveStatus("පිවිසුම් අවශ්‍යයි.", "error");
            return;
        }

        await _saveDraftCore(data, auth);
        setSaveStatus("සුරැකීය.", "success");
    } catch (error) {
        console.error("[editor] saveDraft failed:", error);
        setSaveStatus("දෝෂයක්: " + (error.message || error), "error");
    } finally {
        isSubmitting = false;
    }
}

// ── Submit for review ──────────────────────────────────────

async function submitForReview() {
    if (isSubmitting) return;

    var data = collectFormData();
    var errors = validate(data);
    if (errors.length) {
        setSaveStatus(errors.join(" "), "error");
        return;
    }

    if (!confirm(currentSubmissionId ? "වෙනස්කම් සංස්කරණය කර නැවත සමාලෝචනයට යවන්නද? යැවීමෙන් පසුව වෙනස් කළ නොහැක." : "සමාලෝචනයට යවන්නද? යැවීමෙන් පසුව වෙනස් කළ නොහැක.")) return;

    isSubmitting = true;
    setSaveStatus("යවමින්...", "");

    try {
        var auth = Dict.auth.lastState();
        if (!auth.uid) {
            setSaveStatus("පිවිසුම් අවශ්‍යයි.", "error");
            return;
        }

        if (!currentSubmissionId) {
            setSaveStatus("Draft සුරකිමින්...", "");
            try {
                await _saveDraftCore(data, auth);
            } catch (draftErr) {
                console.error("[editor] auto-draft failed:", draftErr);
                setSaveStatus("Draft සුරැකීම අසාර්ථකයි: " + (draftErr.message || draftErr), "error");
                return;
            }
            if (!currentSubmissionId) {
                setSaveStatus("Draft සුරැකීම අසාර්ථකයි.", "error");
                return;
            }
        }

        var after = buildAfterSnapshot(data);
        var now = new Date().toISOString();
        var C = Dict.db.COLLECTIONS;

        console.log("[editor] submitForReview update:", {
            submissionId: currentSubmissionId,
            authUid: auth.uid,
            currentStatus: "changes_requested→pending",
            submittedBy: "from loaded submission",
            wordId: currentWordId,
        });

        await Dict.db.docRef(C.submissions, currentSubmissionId).update({
            after: after,
            status: "pending",
            submittedAt: now,
            reviewNote: null,
            updatedAt: now,
        });

        if (currentWordId) {
            try {
                var wordSnap = await Dict.db.docRef(C.words, currentWordId).get();
                if (wordSnap.exists) {
                    await Dict.db.docRef(C.words, currentWordId).update({
                        status: "pending",
                        updatedAt: now,
                        updatedBy: auth.uid,
                    });
                }
            } catch (wordErr) {
                console.warn("[editor] word status update skipped:", wordErr);
            }
        }

        document.getElementById("submitBtn").disabled = true;
        document.getElementById("saveDraftBtn").disabled = true;
        setSaveStatus("සමාලෝචනයට යැවීය.", "success");

        var form = document.getElementById("editorForm");
        if (form) form.classList.add("submitted");
    } catch (error) {
        console.error("[editor] submitForReview failed:", error);
        var errCode = error.code || error.name || "";
        var errMsg = error.message || String(error);
        setSaveStatus("දෝෂයක්: " + errMsg + (errCode ? " [" + errCode + "]" : ""), "error");
    } finally {
        isSubmitting = false;
    }
}

// ── Repeatable row builders ────────────────────────────────

function addMeaningRow(data) {
    var container = document.getElementById("meaningsContainer");
    if (!container) return;
    var row = document.createElement("div");
    row.className = "repeatable-row meaning-row";
    row.innerHTML =
        '<input type="text" class="meaning-si" placeholder="සිංහල අර්ථය *" value="' + esc(data ? data.si : "") + '">' +
        '<input type="text" class="meaning-grammar" placeholder="ව්‍යාකරණ (POS)" value="' + esc(data ? data.grammar : "") + '">' +
        '<input type="text" class="meaning-source" placeholder="මූලාශ්‍රය ID" value="' + esc(data ? data.sourceId : "") + '">' +
        '<button type="button" class="btn small danger remove-btn" title="ඉවත් කරන්න">&times;</button>';
    row.querySelector(".remove-btn").addEventListener("click", function () {
        if (container.querySelectorAll(".meaning-row").length > 1) {
            row.remove();
        }
    });
    container.appendChild(row);
}

function addFormRow(data) {
    var container = document.getElementById("formsContainer");
    if (!container) return;
    var row = document.createElement("div");
    row.className = "repeatable-row form-row";
    var typeHtml = FORM_TYPES.map(function (ft) {
        var sel = data && data.type === ft.value ? " selected" : "";
        return '<option value="' + ft.value + '"' + sel + ">" + esc(ft.label) + "</option>";
    }).join("");
    row.innerHTML =
        '<input type="text" class="form-text" placeholder="පද විභාගය" value="' + esc(data ? data.form : "") + '">' +
        '<select class="form-type">' + typeHtml + '</select>' +
        '<button type="button" class="btn small danger remove-btn" title="ඉවත් කරන්න">&times;</button>';
    row.querySelector(".remove-btn").addEventListener("click", function () {
        row.remove();
    });
    container.appendChild(row);
}

function addExampleRow(data) {
    var container = document.getElementById("examplesContainer");
    if (!container) return;
    var row = document.createElement("div");
    row.className = "repeatable-row example-row";
    row.innerHTML =
        '<input type="text" class="example-pali" placeholder="පාලි උදාහරණය" value="' + esc(data ? data.pali : "") + '">' +
        '<input type="text" class="example-si" placeholder="සිංහල පරිවර්තනය" value="' + esc(data ? data.si : "") + '">' +
        '<input type="text" class="example-source" placeholder="මූලාශ්‍රය ID" value="' + esc(data ? data.sourceId : "") + '">' +
        '<button type="button" class="btn small danger remove-btn" title="ඉවත් කරන්න">&times;</button>';
    row.querySelector(".remove-btn").addEventListener("click", function () {
        row.remove();
    });
    container.appendChild(row);
}

// ── Prefill form ───────────────────────────────────────────

function prefillForm(data) {
    if (!data) return;
    document.getElementById("headword").value = data.headword || "";
    document.getElementById("headwordSi").value = data.headwordSi || "";

    var meaningsContainer = document.getElementById("meaningsContainer");
    meaningsContainer.innerHTML = "";
    if (data.meanings && data.meanings.length) {
        data.meanings.forEach(function (m) { addMeaningRow(m); });
    } else {
        addMeaningRow(null);
    }

    var formsContainer = document.getElementById("formsContainer");
    formsContainer.innerHTML = "";
    if (data.forms && data.forms.length) {
        data.forms.forEach(function (f) { addFormRow(f); });
    }

    var examplesContainer = document.getElementById("examplesContainer");
    examplesContainer.innerHTML = "";
    if (data.examples && data.examples.length) {
        data.examples.forEach(function (e) { addExampleRow(e); });
    }

    document.getElementById("notes").value = data.notes || "";
}

// ── Auth bar ───────────────────────────────────────────────

function updateEditorAuthBar(a) {
    var bar = document.getElementById("authBar");
    if (!bar) return;
    if (a.user && !a.isPublic) {
        var reviewLink = a.isReviewer
            ? '<a href="review.html" class="btn small secondary">සමාලෝචනය</a>'
            : "";
        var aiLink = '<button type="button" class="btn small secondary" data-ai-open>AI අර්ථ</button>';
        bar.innerHTML =
            '<a href="index.html" class="btn small secondary">ශබ්දකෝෂය</a>' +
            '<a href="dashboard.html" class="btn small secondary">කාර්ය පුවරුව</a>' +
            reviewLink +
            aiLink +
            '<span class="auth-email">' + esc(a.email) + "</span>" +
            '<span class="auth-role-badge">' + esc(a.roleLabel) + "</span>" +
            '<button type="button" class="btn small secondary" id="editorSignOutBtn">පිටවීම</button>';
        var outBtn = document.getElementById("editorSignOutBtn");
        if (outBtn) outBtn.addEventListener("click", function () { Dict.auth.signOut(); });
    } else {
        bar.innerHTML =
            '<a href="index.html" class="btn small secondary">ශබ්දකෝෂය</a>' +
            '<a href="login.html" class="btn small primary">පිවිසුම</a>';
    }
}

// ── Init ───────────────────────────────────────────────────

async function setupEditor(auth) {
    if (editorReady) return;

    if (!auth.user || auth.isPublic) {
        setMessage("සංස්කරණ ප්‍රවේශය සඳහා පිවිසෙන්න. <a href=\"login.html\">පිවිසුම</a>", "error");
        return;
    }

    if (!auth.isEditor) {
        setMessage("සංස්කරණ ප්‍රවේශය නොමැත.", "error");
        return;
    }

    if (!auth.uid) {
        console.error("[editor] setupEditor: auth.uid is null after auth check");
        return;
    }

    editorReady = true;
    document.getElementById("editorForm").style.display = "block";

    // Load changes-requested notification (background, non-blocking)
    (function () {
        var container = document.getElementById("editorChangesList");
        if (container) container.textContent = "සමාලෝචන වෙනස්කම් පරීක්ෂා කරමින්...";
        loadChangesRequestedSubmissions(auth.uid).then(function (subs) {
            renderChangesNotification(subs, auth.uid);
        }).catch(function (err) {
            console.error("[editor] changes notification failed:", err);
            if (container) container.textContent = "";
        });
    })();

    var params = new URLSearchParams(window.location.search);
    var subId = params.get("submission");
    var wId = params.get("id");

    if (subId) {
        console.log("[editor] loading submission:", subId, "for uid:", auth.uid);
        var result = await loadSubmission(subId);
        if (result.note !== "ok" || !result.submission) {
            var errDetail = result.detail ? " (" + result.detail + ")" : "";
            setMessage("Submission හමු නොවීය: " + subId + errDetail, "error");
            return;
        }
        var sub = result.submission;

        console.log("[editor] submission loaded:", {
            id: sub.id, status: sub.status, type: sub.type,
            wordId: sub.wordId, submittedBy: sub.submittedBy,
            hasAfter: !!sub.after, hasReviewNote: !!sub.reviewNote
        });

        if (sub.submittedBy !== auth.uid && !auth.isAdmin) {
            setMessage("මෙම draft එක ඔබේ නොවේ.", "error");
            return;
        }

        currentSubmissionId = subId;
        currentWordId = sub.wordId;
        currentEditType = sub.type;

        document.getElementById("editorTitle").textContent =
            sub.type === "create" ? "නව වචනයක් සංස්කරණය" : "වචනය සංස්කරණය";
        prefillForm(sub.after);

        if (sub.status === "changes_requested") {
            var msgEl = document.getElementById("editorMessage");
            msgEl.innerHTML =
                '<div class="editor-changes-box">' +
                    '<div class="editor-changes-status">⚠ වෙනස්කම් ඉල්ලා ඇත</div>' +
                    '<div class="editor-changes-detail">මෙම වචනය සඳහා සමාලෝචකයා වෙනස්කම් ඉල්ලා ඇත. පහත සඳහන් අදහස බලා සංස්කරණය කර නැවත යවන්න.</div>' +
                    '<div class="editor-changes-label">සමාලෝචකගේ අදහස:</div>' +
                    '<div class="editor-changes-note">' + esc(sub.reviewNote || "—") + '</div>' +
                '</div>';
            msgEl.className = "editor-message info";
            document.getElementById("submitBtn").disabled = false;
            document.getElementById("submitBtn").textContent = "සමාලෝචනයට නැවත යවන්න";
            document.getElementById("saveDraftBtn").disabled = false;
            console.log("[editor] changes_requested UI rendered for submission:", subId);
        } else if (sub.status !== "draft") {
            document.getElementById("saveDraftBtn").disabled = true;
            document.getElementById("submitBtn").disabled = true;
            document.getElementById("editorForm").classList.add("submitted");
            setMessage("මෙම submission එක දැනටමත් " + sub.status + " තත්ත්වයේ ඇත.", "error");
        } else {
            document.getElementById("submitBtn").disabled = false;
        }
    } else if (wId) {
        currentEditType = "edit";
        currentWordId = wId;
        document.getElementById("editorTitle").textContent = "වචනය සංස්කරණය";

        var wordResult = await loadWordForEdit(wId);
        if (wordResult.note !== "ok" || !wordResult.word) {
            setMessage("වචනය හමු නොවීය.", "error");
            return;
        }

        existingWordSnapshot = {
            headword: wordResult.word.headword,
            headwordSi: wordResult.word.headwordSi || "",
            headwordNorm: wordResult.word.headwordNorm,
            meanings: wordResult.word.meanings || [],
            forms: wordResult.word.forms || [],
            examples: wordResult.word.examples || [],
            notes: "",
        };

        prefillForm(existingWordSnapshot);
        document.getElementById("submitBtn").disabled = false;
    } else {
        currentEditType = "create";
        document.getElementById("editorTitle").textContent = "නව වචනයක්";
        addMeaningRow(null);
        document.getElementById("submitBtn").disabled = false;
    }

    document.getElementById("saveDraftBtn").addEventListener("click", saveDraft);
    document.getElementById("submitBtn").addEventListener("click", submitForReview);
    document.getElementById("addMeaningBtn").addEventListener("click", function () { addMeaningRow(null); });
    document.getElementById("addFormBtn").addEventListener("click", function () { addFormRow(null); });
    document.getElementById("addExampleBtn").addEventListener("click", function () { addExampleRow(null); });
}

function init() {
    if (!Dict.db.init()) {
        setMessage("Firebase සැකසුම නොමැත.", "error");
        return;
    }

    Dict.auth.init();
    Dict.auth.onAuthChange(function (a) {
        updateEditorAuthBar(a);
        setupEditor(a);
    });
}

Dict.editor.loadSubmission = loadSubmission;
Dict.editor.loadWordForEdit = loadWordForEdit;
Dict.editor.loadChangesRequestedSubmissions = loadChangesRequestedSubmissions;
Dict.editor.renderChangesNotification = renderChangesNotification;
Dict.editor.saveDraft = saveDraft;
Dict.editor.submitForReview = submitForReview;
Dict.editor.validate = validate;
Dict.editor.collectFormData = collectFormData;

document.addEventListener("DOMContentLoaded", init);
