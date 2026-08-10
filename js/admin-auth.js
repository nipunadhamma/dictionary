"use strict";

/* ============================================================
   ADMIN AUTH
   Basic client-side password gate for admin.html.
   Password hash (SHA-256) lives in data/admin-pass.json
   (written via server.py POST /set-admin-password). If no server
   is available, the hash falls back to localStorage.
   NOTE: this is casual protection for a fully-local app, not
   real security — the password check happens in the browser.
   ============================================================ */

const AUTH = {
  hash: null, // sha256 hex of the password ('' = none configured)
  ready: false,
};

(async function authInit() {
  const overlay = document.getElementById("authOverlay");
  if (!overlay) return;

  // Already authenticated this tab session?
  if (sessionStorage.getItem("admin_auth_ok") === "1") {
    unlock();
    return;
  }

  AUTH.hash = await loadStoredHash();
  if (!AUTH.hash) {
    showSetup(overlay);
  } else {
    showLogin(overlay);
  }
})();

async function loadStoredHash() {
  // Prefer the server-side file; fall back to localStorage.
  try {
    const response = await fetch("data/admin-pass.json", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data && data.hash) return data.hash;
    }
  } catch (error) {
    console.warn("[AUTH] could not read server hash:", error.message);
  }
  return localStorage.getItem("admin_pass_hash") || null;
}

function showSetup(overlay) {
  overlay.innerHTML = authCard(true);
  bindCard(overlay, true);
}

function showLogin(overlay) {
  overlay.innerHTML = authCard(false);
  bindCard(overlay, false);
}

function authCard(isSetup) {
  const title = isSetup
    ? "මුල් මුරපදය සකසන්න"
    : "පරිපාලක පිවිසුම";
  const hint = isSetup
    ? "අලුත් මුරපදයක් දමා 'සුරකින්න' ඔබන්න."
    : "මුරපදය ලියා 'ඇතුළු වන්න' ඔබන්න.";
  return `
    <div class="auth-card">
      <div class="auth-title">${title}</div>
      <div class="auth-hint">${hint}</div>
      <input type="password" id="authPass" class="auth-pass" autocomplete="new-password"
        placeholder="මුරපදය" autofocus>
      <div id="authMsg" class="auth-msg"></div>
      <div class="auth-actions">
        <button type="button" id="authSubmit" class="btn primary">${isSetup ? "සුරකින්න" : "ඇතුළු වන්න"}</button>
      </div>
    </div>`;
}

function bindCard(overlay, isSetup) {
  const pass = document.getElementById("authPass");
  const submit = document.getElementById("authSubmit");
  const msg = document.getElementById("authMsg");

  const go = async () => {
    const value = (pass.value || "").trim();
    if (!value) {
      msg.textContent = "මුරපදය හිස් විය නොහැක.";
      msg.className = "auth-msg err";
      return;
    }
    if (isSetup) {
      const hash = await sha256(value);
      const ok = await saveHash(hash);
      AUTH.hash = hash;
      localStorage.setItem("admin_pass_hash", hash);
      msg.textContent = ok
        ? "✓ මුරපදය සුරකින ලදී."
        : "⚠ Server නොමැති නිසා මුරපදය මෙම browser එකේ පමණක් සුරැකුණි.";
      msg.className = "auth-msg ok";
      setTimeout(unlock, 600);
    } else {
      const hash = await sha256(value);
      if (hash === AUTH.hash) {
        unlock();
      } else {
        msg.textContent = "✗ වැරදි මුරපදයකි.";
        msg.className = "auth-msg err";
        pass.value = "";
        pass.focus();
      }
    }
  };

  submit.addEventListener("click", go);
  pass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}

async function saveHash(hash) {
  try {
    const response = await fetch("/set-admin-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash }),
    });
    return response.ok;
  } catch (error) {
    console.warn("[AUTH] server save failed:", error.message);
    return false;
  }
}

function unlock() {
  sessionStorage.setItem("admin_auth_ok", "1");
  const overlay = document.getElementById("authOverlay");
  if (overlay) overlay.classList.add("hidden");
  document.dispatchEvent(new CustomEvent("admin-auth-ok"));
  document.body.classList.remove("auth-locked");
}

function adminLogout() {
  sessionStorage.removeItem("admin_auth_ok");
  location.reload();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
