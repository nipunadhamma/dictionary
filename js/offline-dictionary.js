"use strict";

/* ============================================================
   OFFLINE PĀLI–SINHALA DICTIONARY
   Loads data/pali-sinhala-web.json once and searches in memory.
   No server API required.
   ============================================================ */

const DATA_URL = "data/pali-sinhala-web.json";

const STATE = {
  byRoman: [],
  byWord: [],
  entries: {},
  meta: null,
  ready: false,
  loading: false,
  results: [],
  maxResults: 250,
};

const SINHALA_RE = /[\u0d80-\u0dff]/;

let searchInput, searchBtn, clearBtn, modeMeaning;
let resultsEl, resultCountEl, detailEl, statusEl, statsEl;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  searchInput = document.getElementById("searchInput");
  searchBtn = document.getElementById("searchBtn");
  clearBtn = document.getElementById("clearBtn");
  modeMeaning = document.getElementById("modeMeaning");

  resultsEl = document.getElementById("results");
  resultCountEl = document.getElementById("resultCount");
  detailEl = document.getElementById("detail");
  statusEl = document.getElementById("status");
  statsEl = document.getElementById("stats");

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

  document.querySelectorAll(".quick-searches button").forEach((btn) => {
    btn.addEventListener("click", () => {
      searchInput.value = btn.dataset.word || "";
      run();
    });
  });
}

async function loadData() {
  if (STATE.loading || STATE.ready) return;
  STATE.loading = true;
  setStatus("දත්ත පූරණය වෙමින්... (81 MB)", "loading");

  try {
    const data = await getJSON(DATA_URL);
    STATE.meta = data._meta || {};
    STATE.entries = data.entries || {};
    await applyCorrections();

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
    setStatus("✓ දත්ත සූදානම්", "success");

    const total = byRoman.length;
    const withAi = STATE.meta.ai_gloss_entries || 0;
    const corrections = STATE.correctionCount || 0;
    const corrNote = corrections
      ? ` · නිවැරදි කිරීම් ${corrections.toLocaleString()}`
      : "";
    statsEl.innerHTML =
      `වචන ${total.toLocaleString()} · AI අර්ථ ${withAi.toLocaleString()} · ` +
      `ගොඩනැගූ ${STATE.meta.built || ""}${corrNote}`;

    renderEmptyDetail();
    search("nibbāna");
  } catch (error) {
    console.error("[DICT] load error:", error);
    setStatus("✗ දත්ත පූරණය අසාර්ථකයි", "error");
    renderLoadError(error);
  } finally {
    STATE.loading = false;
  }
}

async function getJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function applyCorrections() {
  STATE.correctionCount = 0;
  try {
    const response = await fetch("data/corrections.json", { cache: "no-store" });
    if (!response.ok) return;
    const corr = await response.json();
    const entries = corr.entries || {};
    const keys = Object.keys(entries);
    for (const key of keys) {
      STATE.entries[key] = entries[key];
    }
    STATE.correctionCount = keys.length;
    if (keys.length) {
      console.info(`[DICT] ${keys.length} නිවැරදි කිරීම් පූරණය විය`);
    }
  } catch (error) {
    console.warn("[DICT] corrections load skipped:", error.message);
  }
}

/* ---------------- search ---------------- */

function search(rawQuery) {
  if (!STATE.ready) {
    showHint("දත්ත පූරණය වෙමින්... කරුණාකර රැඳී සිටින්න.");
    return;
  }

  const query = String(rawQuery || "").trim();
  if (!query) {
    clearSearch();
    return;
  }

  const byMeaning = modeMeaning.checked;

  let results = [];
  if (byMeaning) {
    results = searchMeanings(query);
  } else if (SINHALA_RE.test(query)) {
    results = searchPrefix(query, STATE.byWord, "w");
  } else {
    results = searchPrefix(norm(query), STATE.byRoman, "s");
    if (results.length < 5) {
      const contains = searchContains(norm(query), STATE.byRoman, "s");
      results = mergeUnique(results, contains);
    }
  }

  STATE.results = results.slice(0, STATE.maxResults);
  renderResults(STATE.results, query);

  if (results.length) {
    selectResult(results[0].key);
  } else {
    detailEl.innerHTML = `<div class="empty">"${escapeHTML(query)}" සඳහා ප්‍රතිඵල නොමැත.</div>`;
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

function searchMeanings(query) {
  const q = query.toLowerCase();
  const out = [];
  const byRoman = STATE.byRoman;
  for (let i = 0; i < byRoman.length && out.length < STATE.maxResults; i++) {
    const e = STATE.entries[byRoman[i].key];
    const meanings = e.ms || (e.m ? [e.m] : []);
    for (const m of meanings) {
      if ((m.si || "").toLowerCase().includes(q)) {
        out.push(byRoman[i]);
        break;
      }
    }
  }
  return out;
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
  resultCountEl.textContent = results.length
    ? `${results.length.toLocaleString()} ප්‍රතිඵල`
    : "";

  if (!results.length) {
    resultsEl.innerHTML = `<div class="empty">"${escapeHTML(query)}" සඳහා ප්‍රතිඵල නොමැත.</div>`;
    return;
  }

  resultsEl.innerHTML = results
    .map((item, index) => {
      const e = STATE.entries[item.key];
      const snippet = firstMeaning(e);
      const srcBadge = snippet ? ` · ${escapeHTML(snippet.src)}` : "";
      return `
        <div class="result-item" data-index="${index}">
          <div class="result-pali">${escapeHTML(e.w)}</div>
          <div class="result-roman">${escapeHTML(item.r)}${srcBadge}</div>
          ${
            snippet
              ? `<div class="result-sinhala">${escapeHTML(snippet.si)}</div>`
              : ""
          }
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
  const item = STATE.entries[key];
  if (!item) return;

  resultsEl.querySelectorAll(".result-item").forEach((el) => {
    el.classList.remove("active");
  });

  const idx = STATE.results.findIndex((r) => r.key === key);
  if (idx >= 0) {
    const el = resultsEl.querySelector(`.result-item[data-index="${idx}"]`);
    if (el) el.classList.add("active");
  }

  renderDetail(item);
}

function renderDetail(e) {
  const meanings = e.ms || (e.m ? [e.m] : []);

  detailEl.innerHTML = `
    <div class="detail-pali">${escapeHTML(e.w)}</div>
    <div class="detail-roman">${escapeHTML(e.r)}</div>

    <div class="detail-grammar">
      ${e.l ? `<span class="badge">${escapeHTML(e.l)}</span>` : ""}
      ${e.p ? `<span class="badge">${escapeHTML(e.p)}</span>` : ""}
      <span class="badge count">සිදුවීම් ${Number(e.c || 0).toLocaleString()}</span>
    </div>

    ${meanings
      .map(
        (m) => `
      <div class="meaning-block">
        <div class="meaning-text">${escapeHTML(m.si)}</div>
        <div class="meaning-src">මූලාශ්‍රය: ${escapeHTML(m.src || "—")}</div>
      </div>`
      )
      .join("")}
  `;
}

function firstMeaning(e) {
  if (e.m) return e.m;
  if (e.ms && e.ms.length) return e.ms[0];
  return null;
}

function renderEmptyDetail() {
  detailEl.innerHTML = `<div class="empty">වචනයක් සොයන්න.</div>`;
}

function showHint(text) {
  resultsEl.innerHTML = `<div class="empty">${escapeHTML(text)}</div>`;
  resultCountEl.textContent = "";
}

function clearSearch() {
  searchInput.value = "";
  modeMeaning.checked = false;
  STATE.results = [];
  resultCountEl.textContent = "";
  resultsEl.innerHTML = `<div class="empty">වචනයක් සොයන්න.</div>`;
  renderEmptyDetail();
  searchInput.focus();
}

function renderLoadError(error) {
  resultsEl.innerHTML = `
    <div class="error-box">
      <strong>දත්ත පූරණය අසාර්ථක විය.</strong><br><br>
      <code>${escapeHTML(error.message)}</code><br><br>
      <small>මෙය offline පිටුවකි — දත්ත සමඟ local server එකකින් විවෘත කරන්න:
      <code>python -m http.server</code> , ඉන්පසු
      <code>http://127.0.0.1:8000/dictionary.html</code> විවෘත කරන්න.</small>
    </div>`;
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.classList.remove("status-success", "status-error", "status-loading");
  statusEl.classList.add(type === "success" ? "status-success" : type === "error" ? "status-error" : "status-loading");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
