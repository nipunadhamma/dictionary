"use strict";

window.Dict = window.Dict || {};
Dict.db = Dict.db || {};

const COLLECTIONS = {
    users: "users",
    words: "words",
    wordMeanings: "wordMeanings",
    wordForms: "wordForms",
    examples: "examples",
    sources: "sources",
    submissions: "submissions",
    reviews: "reviews",
    versions: "versions",
    searchIndex: "searchIndex",
};

Dict.db.COLLECTIONS = COLLECTIONS;

let app = null;
let db = null;
let available = false;
let ready = false;

function isConfigured() {
    const cfg = (window.Dict && Dict.firebaseConfig) || null;
    return !!(cfg && cfg.apiKey && cfg.projectId);
}

function init() {
    if (ready) return true;
    ready = true;

    if (!isConfigured()) {
        available = false;
        return false;
    }
    if (typeof firebase === "undefined") {
        available = false;
        return false;
    }

    try {
        app = firebase.initializeApp(Dict.firebaseConfig);
        db = firebase.firestore(app);
        available = true;
        return true;
    } catch (error) {
        console.warn("[db] init failed:", error);
        available = false;
        return false;
    }
}

function col(name) {
    return db.collection(name);
}

function docRef(name, id) {
    return db.collection(name).doc(id);
}

Dict.db.isConfigured = isConfigured;
Dict.db.init = init;
Dict.db.col = col;
Dict.db.docRef = docRef;
Dict.db.get = function () {
    return db;
};
Dict.db.isAvailable = function () {
    return available;
};
