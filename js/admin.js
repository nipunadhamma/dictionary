"use strict";

window.Dict = window.Dict || {};
Dict.admin = Dict.admin || {};

async function stats() {
    return { note: "phase1_skeleton", totalWords: 0, pendingReviews: 0 };
}

async function listUsers() {
    return { results: [], note: "phase1_skeleton" };
}

async function setUserRole(uid, role) {
    return { ok: false, note: "phase1_skeleton" };
}

Dict.admin.stats = stats;
Dict.admin.listUsers = listUsers;
Dict.admin.setUserRole = setUserRole;
