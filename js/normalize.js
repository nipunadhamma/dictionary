"use strict";

window.Dict = window.Dict || {};
Dict.normalize = Dict.normalize || {};

const SINHALA_RE = /[\u0d80-\u0dff]/;

function stripDiacritics(text) {
    return String(text || "")
        .replace(/[\u200c\u200d]/g, "")
        .replace(/ā|ā/g, "a")
        .replace(/ī|ī/g, "i")
        .replace(/ū|ū/g, "u")
        .replace(/ṃ|ṁ/g, "m")
        .replace(/ṅ|ñ|ṇ|ń/g, "n")
        .replace(/ṭ/g, "t")
        .replace(/ḍ/g, "d")
        .replace(/ḷ/g, "l");
}

function normPali(text) {
    return String(text || "").toLowerCase().replace(/[\s]+/g, " ").trim();
}

function normSinhala(text) {
    let value = String(text || "").normalize("NFC");
    return value.replace(/[\u200c\u200d]/g, "").trim();
}

function normSearch(text) {
    return stripDiacritics(normPali(text));
}

function isSinhala(text) {
    return SINHALA_RE.test(String(text || ""));
}

function tokenize(text) {
    return String(text || "")
        .split(/[^A-Za-z\u0d80-\u0dff]+/)
        .filter(Boolean);
}

// ── Singlish alias generation ───────────────────────────────
// Maps Sinhala consonant/vowel clusters to roman equivalents.
// Used during import to generate slAll tokens from Sinhala headwords.

const SINGLISH_MAP = {
    "\u0D9A": "ka",  "\u0D9B": "kha", "\u0D9C": "ga",  "\u0D9D": "gha",  "\u0D9E": "nga",
    "\u0D9F": "cha", "\u0DA0": "cha",  "\u0DA1": "chha","\u0DA2": "ja",   "\u0DA3": "jha",
    "\u0DA4": "nya", "\u0DA5": "tta",  "\u0DA6": "ttha","\u0DA7": "ta",   "\u0DA8": "tha",
    "\u0DA9": "da",  "\u0DAA": "dha",  "\u0DAB": "na",  "\u0DAC": "tha",  "\u0DAD": "tha",
    "\u0DAE": "tha", "\u0DAF": "da",   "\u0DB0": "dha", "\u0DB1": "na",
    "\u0DB4": "pa",  "\u0DB5": "bha",  "\u0DB6": "ba",  "\u0DB8": "ma",
    "\u0DBA": "ya",  "\u0DBB": "ra",   "\u0DBD": "la",  "\u0DC0": "va",
    "\u0DC1": "sha", "\u0DC2": "sha",  "\u0DC3": "sa",  "\u0DC4": "ha",   "\u0DC5": "la",
    "\u0DCA": "",    // virama (hal kirima) — no vowel
};

const VOWEL_MAP = {
    "\u0D85": "a",   "\u0D86": "aa",  "\u0D87": "ae",
    "\u0D88": "aae", "\u0D89": "i",   "\u0D8A": "ii",
    "\u0D8B": "u",   "\u0D8C": "uu",  "\u0D8D": "ru",
    "\u0D8E": "ruu", "\u0D8F": "e",   "\u0D90": "ei",
    "\u0D91": "o",   "\u0D92": "oo",  "\u0D93": "au",
};

// Dependent vowel signs — replace inherent 'a' of preceding consonant
const DEP_VOWEL_MAP = {
    "\u0DCF": "aa",  "\u0DD0": "a",   "\u0DD1": "aa",
    "\u0DD2": "i",   "\u0DD3": "ii",  "\u0DD4": "u",
    "\u0DD6": "uu",  "\u0DDA": "e",   "\u0DDB": "ei",
    "\u0DDC": "o",   "\u0DDD": "o",   "\u0DDE": "o",
    "\u0DDF": "l",
};

function singlishFromSinhala(text) {
    const s = String(text || "").normalize("NFC");
    const tokens = [];
    let current = "";

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const code = ch.charCodeAt(0);

        // Vowels at start or after virama
        if (VOWEL_MAP[ch]) {
            if (current) { tokens.push(current); current = ""; }
            tokens.push(VOWEL_MAP[ch]);
            continue;
        }

        // Independent vowels (U+0D85–U+0D96)
        if (code >= 0x0D85 && code <= 0x0D96) {
            if (current) { tokens.push(current); current = ""; }
            tokens.push(VOWEL_MAP[ch] || "");
            continue;
        }

        // Consonants + virama + dependent vowels (U+0D9A–U+0DDF)
        if (code >= 0x0D9A && code <= 0x0DDF) {
            const mapped = SINGLISH_MAP[ch] || "";

            // Virama — remove inherent vowel from previous consonant
            if (ch === "\u0DCA") {
                if (current && current.endsWith("a")) {
                    current = current.slice(0, -1);
                }
                continue;
            }

            // Dependent vowel sign — replace inherent 'a' of preceding consonant
            const depVowel = DEP_VOWEL_MAP[ch];
            if (depVowel) {
                if (current) {
                    current = current.replace(/a$/, "") + depVowel;
                }
                continue;
            }

            // Consonant
            if (current) { tokens.push(current); }
            current = mapped;
            continue;
        }

        //ZWJ, ZWNJ, other — skip
        if (code === 0x200C || code === 0x200D) continue;

        // Space or other — flush
        if (current) { tokens.push(current); current = ""; }
    }
    if (current) tokens.push(current);

    return tokens.filter(Boolean).join("");
}

function singlishTokens(text) {
    const combined = singlishFromSinhala(text);
    if (!combined) return [];
    const tokens = new Set();
    tokens.add(combined);
    // Also add without trailing vowels for prefix matching
    if (combined.length > 3) {
        tokens.add(combined.slice(0, -1));
    }
    return Array.from(tokens);
}

Dict.normalize.SINHALA_RE = SINHALA_RE;
Dict.normalize.stripDiacritics = stripDiacritics;
Dict.normalize.normPali = normPali;
Dict.normalize.normSinhala = normSinhala;
Dict.normalize.normSearch = normSearch;
Dict.normalize.isSinhala = isSinhala;
Dict.normalize.tokenize = tokenize;
Dict.normalize.singlishFromSinhala = singlishFromSinhala;
Dict.normalize.singlishTokens = singlishTokens;
