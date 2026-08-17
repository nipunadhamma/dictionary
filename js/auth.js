"use strict";

window.Dict = window.Dict || {};
Dict.auth = Dict.auth || {};

const ROLES = { ADMIN: "admin", EDITOR: "editor", REVIEWER: "reviewer" };
const ROLE_LABELS = { admin: "පරිපාලක", editor: "සංස්කරක", reviewer: "සමාලෝචක", public: "ආගන්තුක" };

let currentUser = null;
let currentRole = "public";
let listeners = [];

Dict.auth.ROLES = ROLES;
Dict.auth.ROLE_LABELS = ROLE_LABELS;

function firebaseAuth() {
    if (!Dict.db.isAvailable()) return null;
    return firebase.auth();
}

function init() {
    if (!Dict.db.init()) {
        currentUser = null;
        currentRole = "public";
        return;
    }
    const auth = firebaseAuth();
    if (!auth) return;

    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        currentRole = "public";

        if (user) {
            try {
                const userRef = Dict.db.docRef(Dict.db.COLLECTIONS.users, user.uid);
                const snap = await userRef.get();

                if (snap.exists) {
                    const data = snap.data();
                    if (data.active !== false) {
                        currentRole = data.role || "public";
                    }
                    // Update lastLoginAt on every sign-in / page load
                    await userRef.update({ lastLoginAt: new Date().toISOString() });
                } else {
                    // Signed in but no user doc — treat as public
                    currentRole = "public";
                }
            } catch (error) {
                console.warn("[auth] role load failed:", error);
            }
        }
        notify();
    });
}

function notify() {
    listeners.forEach((cb) => cb(api()));
}

function onAuthChange(cb) {
    listeners.push(cb);
}

async function signIn(email, password) {
    const auth = firebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    return auth.signInWithEmailAndPassword(email, password);
}

async function signUp(email, password) {
    const auth = firebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    return auth.createUserWithEmailAndPassword(email, password);
}

async function signOut() {
    const auth = firebaseAuth();
    if (!auth) return;
    return auth.signOut();
}

function roleLabel(role) {
    return ROLE_LABELS[role] || ROLE_LABELS.public;
}

function api() {
    return {
        user: currentUser,
        uid: currentUser ? currentUser.uid : null,
        email: currentUser ? currentUser.email : null,
        role: currentRole,
        roleLabel: roleLabel(currentRole),
        isAdmin: currentRole === ROLES.ADMIN,
        isEditor: currentRole === ROLES.EDITOR || currentRole === ROLES.ADMIN,
        isReviewer: currentRole === ROLES.REVIEWER || currentRole === ROLES.ADMIN,
        isPublic: currentRole === "public",
        ROLES: ROLES,
    };
}

Dict.auth.init = init;
Dict.auth.onAuthChange = onAuthChange;
Dict.auth.signIn = signIn;
Dict.auth.signUp = signUp;
Dict.auth.signOut = signOut;
Dict.auth.current = api;
Dict.auth.lastState = api;
