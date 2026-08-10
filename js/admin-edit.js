"use strict";

/* ============================================================
   ADMIN EDIT PAGE
   Search the dictionary, fix meanings, and save corrections to
   data/corrections.json. The main dictionary page merges this
   file on load, so fixes take effect immediately.
   ============================================================ */

const DATA_URL = "data/pali-sinhala-web.json";
const CORR_URL = "data/corrections.json";
const SAVE_URL = "/save-corrections";

const STATE = {
  byRoman: [],
  byWord: [],
  entries: {},
  baseEntries: {}, // original data (before corrections) for revert
  ready: false,
  loading: false,
  results: [],
  corrections: {}, // existing corrections loaded from disk
  dirty: {}, // keys edited this session (merge of corrections + edits)
  maxResults: 250,
};

const SINHALA_RE = /[\u0d80-\u0dff]/;

let searchInput, searchBtn, clearBtn, saveAllBtn;
let resultsEl, editorEl, statusEl, statsEl, corrCountEl, dirtyBadgeEl;

document.addEventListener("admin-auth-ok", init);
document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", adminLogout);
});

async function init() {
  searchInput = document.getElementById("searchInput");
  searchBtn = document.getElementById("searchBtn");
  clearBtn = document.getElementById("clearBtn");
  resultsEl = document.getElementById("results");
  editorEl = document.getElementById("editor");
  statusEl = document.getElementById("status");
  statsEl = document.getElementById("stats");
  corrCountEl = document.getElementById("corrCount");
  dirtyBadgeEl = document.getElementById("dirtyBadge");
  saveAllBtn = document.getElementById("saveAllBtn");

  bindEvents();
  await loadData();
}

function bindEvents() {
  const run = () => search(searchInput.value);

  searchBtn.addEventListener("click", run);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") run();
  });
  clearBtn.addEventListener("click", clearSearch);
  saveAllBtn.addEventListener("click", saveAll);
}

async function loadData() {
  if (STATE.loading || STATE.ready) return;
  STATE.loading = true;
  setStatus("දත්ත පූරණය වෙමින්... (81 MB)", "loading");

  try {
    const data = await getJSON(DATA_URL);
    STATE.entries = data.entries || {};
    STATE.baseEntries = data.entries || {};
    await loadCorrections();

    const byRoman = [];
    const byWord = [];
    for (const key of Object.keys(STATE.entries)) {
      const e = STATE.entries[key];
      const r = e.r || key;
      byRoman.push({ key, r, s: norm(r), w: e.w || "", c: e.c || 0 });
      byWord.push({ key, w: e.w || "", r, c: e.c || 0 });
    }
    byRoman.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
    byWord.sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
    STATE.byRoman = byRoman;
    STATE.byWord = byWord;
    STATE.ready = true;

    setStatus("✓ සූදානම්", "success");

    const total = byRoman.length;
    statsEl.innerHTML =
      `වචන ${total.toLocaleString()} · ` +
      `ගොඩනැගූ ${(data._meta && data._meta.built) || ""}`;

    renderCorrCount();
    search("nibbana");
  } catch (error) {
    console.error("[ADMIN] load error:", error);
    setStatus("✗ දත්ත පූරණය අසාර්ථකයි", "error");
  } finally {
    STATE.loading = false;
  }
}

async function loadCorrections() {
  try {
    const response = await fetch(CORR_URL, { cache: "no-store" });
    if (response.ok) {
      const corr = await response.json();
      STATE.corrections = corr.entries || {};
      for (const key of Object.keys(STATE.corrections)) {
        STATE.entries[key] = STATE.corrections[key];
        STATE.dirty[key] = true;
      }
    }
  } catch (error) {
    console.warn("[ADMIN] corrections load skipped:", error.message);
  }
}

async function getJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/* ---------------- search ---------------- */

function search(rawQuery) {
  if (!STATE.ready) {
    showHint("දත්ත පූරණය වෙමින්...");
    return;
  }

  const query = String(rawQuery || "").trim();
  if (!query) {
    clearSearch();
    return;
  }

  let results = [];
  if (SINHALA_RE.test(query)) {
    results = searchPrefix(query, STATE.byWord, "w");
  } else {
    results = searchPrefix(norm(query), STATE.byRoman, "s");
    if (results.length < 5) {
      results = mergeUnique(results, searchContains(norm(query), STATE.byRoman, "s"));
    }
  }

  STATE.results = results.slice(0, STATE.maxResults);
  renderResults(STATE.results, query);

  if (results.length) {
    selectResult(results[0].key);
  } else {
    editorEl.innerHTML =
      `<div class="empty">"${escapeHTML(query)}" සඳහා ප්‍රතිඵල නොමැත.</div>` +
      (SINHALA_RE.test(query)
        ? `<button type="button" class="btn primary" id="addNewBtn">නව entry එකක් එකතු කරන්න</button>`
        : "");
    const addNew = document.getElementById("addNewBtn");
    if (addNew) {
      addNew.addEventListener("click", () => addNewEntry(query));
    }
  }
}

function searchPrefix(query, list, field) {
  const lower = query.toLowerCase();
  const out = [];
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][field].toLowerCase() < lower) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < list.length && out.length < STATE.maxResults; i++) {
    if (!list[i][field].toLowerCase().startsWith(lower)) break;
    out.push(list[i]);
  }
  return out;
}

function searchContains(query, list, field) {
  const out = [];
  for (let i = 0; i < list.length && out.length < STATE.maxResults; i++) {
    if (list[i][field].toLowerCase().includes(query)) out.push(list[i]);
  }
  return out;
}

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u200c\u200d]/g, "")
    .replace(/ā|ā/g, "a")
    .replace(/ī|ī/g, "i")
    .replace(/ū|ū/g, "u")
    .replace(/ṃ|ṁ/g, "m")
    .replace(/ṅ|ñ|ṇ|ń/g, "n")
    .replace(/ṭ/g, "t")
    .replace(/ḍ/g, "d")
    .replace(/ḷ/g, "l");
}

function mergeUnique(a, b) {
  const seen = new Set(a.map((x) => x.key));
  for (const item of b) {
    if (!seen.has(item.key)) {
      a.push(item);
      seen.add(item.key);
    }
  }
  return a;
}

/* ---------------- render ---------------- */

function renderResults(results, query) {
  if (!results.length) {
    resultsEl.innerHTML = `<div class="empty">"${escapeHTML(query)}" සඳහා ප්‍රතිඵල නොමැත.</div>`;
    return;
  }

  resultsEl.innerHTML = results
    .map((item, index) => {
      const e = STATE.entries[item.key];
      const marked = STATE.dirty[item.key] ? ` <span class="corr-tag">නිවැරදි කළ</span>` : "";
      return `
        <div class="result-item" data-index="${index}">
          <div class="result-pali">${escapeHTML(e.w)}${marked}</div>
          <div class="result-roman">${escapeHTML(item.r)}</div>
          <div class="result-meta">සිදුවීම් ${Number(e.c || 0).toLocaleString()}</div>
        </div>`;
    })
    .join("");

  resultsEl.querySelectorAll(".result-item").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.index);
      if (STATE.results[idx]) selectResult(STATE.results[idx].key);
    });
  });
}

function selectResult(key) {
  resultsEl.querySelectorAll(".result-item").forEach((el) => el.classList.remove("active"));
  const idx = STATE.results.findIndex((r) => r.key === key);
  if (idx >= 0) {
    const el = resultsEl.querySelector(`.result-item[data-index="${idx}"]`);
    if (el) el.classList.add("active");
  }
  renderEditor(STATE.entries[key], key);
}

/* ---------------- editor ---------------- */

function renderEditor(e, key) {
  const meanings = e.ms || (e.m ? [e.m] : []);
  const isDirty = !!STATE.dirty[key];

  editorEl.innerHTML = `
    <div class="edit-key">Key: <code>${escapeHTML(key)}</code></div>
    <label class="fld">සිංහල වචනය (w)
      <input type="text" id="f-w" value="${escapeAttr(e.w)}">
    </label>
    <label class="fld">Roman (r)
      <input type="text" id="f-r" value="${escapeAttr(e.r || key)}">
    </label>
    <label class="fld">සිදුවීම් (count)
      <input type="number" id="f-c" value="${Number(e.c || 0)}" min="0">
    </label>

    <div class="fld">
      <div class="mean-head">අර්ථ (meanings)</div>
      <div id="meanList"></div>
      <button type="button" class="btn secondary" id="addMeanBtn">+ අර්ථයක් එකතු කරන්න</button>
    </div>

    <div class="edit-actions">
      <button type="button" class="btn primary" id="saveEntryBtn">${isDirty ? "වෙනස්කම් යාවත්කාලීන කරන්න" : "නිවැරදි කිරීම සුරකින්න"}</button>
      <button type="button" class="btn danger" id="discardBtn">මෙය ප්‍රතිස්ථාපනය කරන්න</button>
    </div>
    <div id="editMsg" class="edit-msg"></div>
  `;

  const meanList = editorEl.querySelector("#meanList");
  meanings.forEach((m, i) => meanList.appendChild(meaningRow(m, i)));
  if (!meanings.length) addMeaningRow();

  document.getElementById("addMeanBtn").addEventListener("click", addMeaningRow);
  document.getElementById("saveEntryBtn").addEventListener("click", () => saveEntry(key));
  document.getElementById("discardBtn").addEventListener("click", () => discardEntry(key));
}

function meaningRow(m, i) {
  const row = document.createElement("div");
  row.className = "mean-row";
  row.innerHTML = `
    <textarea class="mean-si" rows="2" placeholder="සිංහල අර්ථය">${escapeHTML(m.si || "")}</textarea>
    <div class="mean-foot">
      <input class="mean-src" placeholder="මූලාශ්‍රය (src)" value="${escapeAttr(m.src || "")}">
      <button type="button" class="btn small danger" title="මෙම අර්ථය මකන්න">මකන්න</button>
    </div>`;
  row.querySelector(".btn").addEventListener("click", () => row.remove());
  return row;
}

function addMeaningRow() {
  const meanList = document.getElementById("meanList");
  if (!meanList) return;
  meanList.appendChild(meaningRow({ si: "", src: "" }, meanList.children.length));
}

function saveEntry(key) {
  const w = document.getElementById("f-w").value.trim();
  const r = document.getElementById("f-r").value.trim() || key;
  const c = Number(document.getElementById("f-c").value) || 0;

  const rows = document.querySelectorAll("#meanList .mean-row");
  const ms = [];
  rows.forEach((row) => {
    const si = row.querySelector(".mean-si").value.trim();
    const src = row.querySelector(".mean-src").value.trim();
    if (si) ms.push({ si, src });
  });

  const entry = {};
  if (w) entry.w = w;
  if (r) entry.r = r;
  entry.c = c;
  if (ms.length === 1) {
    entry.m = ms[0];
    delete entry.ms;
  } else if (ms.length > 1) {
    entry.ms = ms;
    delete entry.m;
  }

  const nextKey = w || key;

  if (nextKey !== key && STATE.entries[nextKey]) {
    if (!confirm(`"${nextKey}" දැනටමත් ශබ්දකෝෂයේ පවතී.\nඑය නව අගයන් සමඟ ප්‍රතිස්ථාපනය කරන්නද?`)) return;
  }

  // store under new key if the word changed
  if (nextKey !== key) {
    delete STATE.entries[key];
    delete STATE.dirty[key];
    if (!STATE.entries[nextKey]) {
      STATE.entries[nextKey] = entry;
      STATE.dirty[nextKey] = true;
      console.info("[ADMIN] new entry:", nextKey);
    } else {
      // merging into existing entry
      STATE.entries[nextKey] = entry;
      STATE.dirty[nextKey] = true;
      console.info("[ADMIN] merged into existing:", nextKey);
    }
  } else {
    STATE.entries[key] = entry;
    STATE.dirty[key] = true;
  }

  updateIndex();
  renderCorrCount();

  searchInput.value = nextKey;
  search(nextKey);

  const msg = document.getElementById("editMsg");
  if (msg) {
    msg.textContent = "✓ සුරැකීමට සූදානම් — ඉහත 'වෙනස්කම් සුරකින්න' ඔබන්න.";
    msg.className = "edit-msg ok";
  }
  setStatus(`★ ${Object.keys(STATE.dirty).length} වෙනස්කම් අනුමැතිය සඳහා බලා සිටී`, "loading");
}

function discardEntry(key) {
  if (!confirm(`"${key}" සඳහා වන සියලු නිවැරදි කිරීම් ඉවත් කරන්නද?`)) return;
  delete STATE.dirty[key];
  delete STATE.corrections[key];
  if (STATE.baseEntries[key]) {
    STATE.entries[key] = STATE.baseEntries[key];
  } else {
    delete STATE.entries[key];
  }
  updateIndex();
  renderCorrCount();
  setStatus("සූදානම්", "success");
  search(searchInput.value);
}

function addNewEntry(query) {
  const key = query.trim();
  if (!key) return;
  if (STATE.entries[key]) {
    selectResult(key);
    return;
  }
  STATE.entries[key] = { w: key, r: "", c: 1 };
  STATE.dirty[key] = true;
  updateIndex();
  renderCorrCount();
  renderEditor(STATE.entries[key], key);
}

function updateIndex() {
  const byRoman = [];
  const byWord = [];
  for (const key of Object.keys(STATE.entries)) {
    const e = STATE.entries[key];
    const r = e.r || key;
    byRoman.push({ key, r, s: norm(r), w: e.w || "", c: e.c || 0 });
    byWord.push({ key, w: e.w || "", r, c: e.c || 0 });
  }
  byRoman.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  byWord.sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
  STATE.byRoman = byRoman;
  STATE.byWord = byWord;
}

/* ---------------- corrections save ---------------- */

async function saveAll() {
  const keys = Object.keys(STATE.dirty);
  if (!keys.length) {
    alert("සුරැකීමට වෙනස්කම් නොමැත.");
    return;
  }

  const payload = {
    _meta: {
      saved: new Date().toISOString(),
      count: keys.length,
      note: "Admin edits — merged by dictionary.html at load time",
    },
    entries: {},
  };
  for (const key of keys) payload.entries[key] = STATE.entries[key];

  try {
    const response = await fetch(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    console.info("[ADMIN] save response:", text);
    STATE.corrections = payload.entries;
    setStatus(`✓ ${keys.length} නිවැරදි කිරීම් data/corrections.json වෙත සුරකින ලදී`, "success");
    renderCorrCount();
    dirtyBadgeEl.textContent = "";
    return;
  } catch (error) {
    console.warn("[ADMIN] server save failed:", error.message);
    downloadCorrections(payload);
  }
}

function downloadCorrections(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "corrections.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus(
    "Server සමඟ සුරැකීමට නොහැකි විය — corrections.json බාගත විය. " +
      "එය data/ තුළට දමා පිටුව reload කරන්න.",
    "error"
  );
}

function renderCorrCount() {
  if (corrCountEl) corrCountEl.textContent = String(Object.keys(STATE.dirty).length);
  if (dirtyBadgeEl) {
    const n = Object.keys(STATE.dirty).length;
    dirtyBadgeEl.textContent = n ? `${n} ක්රියාකාරී` : "";
    dirtyBadgeEl.className = n ? "dirty-badge on" : "dirty-badge";
  }
}

/* ---------------- helpers ---------------- */

function showHint(text) {
  resultsEl.innerHTML = `<div class="empty">${escapeHTML(text)}</div>`;
}

function clearSearch() {
  searchInput.value = "";
  STATE.results = [];
  resultsEl.innerHTML = `<div class="empty">වචනයක් සොයන්න.</div>`;
  editorEl.innerHTML = `<div class="empty">වම් පසින් වචනයක් තෝරන්න.</div>`;
  searchInput.focus();
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.classList.remove("status-success", "status-error", "status-loading");
  statusEl.classList.add(
    type === "success" ? "status-success" : type === "error" ? "status-error" : "status-loading"
  );
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/`/g, "&#096;");
}
