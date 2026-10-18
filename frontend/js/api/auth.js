// Accounts: email/password sign-in with email verification (Firebase Authentication).
import { fb } from "./firebase.js";

export function onAuthChange(cb) { fb.auth.onAuthStateChanged(cb); }
export function currentUser() { return fb.auth.currentUser; }
export function signIn(email, pw) { return fb.auth.signInWithEmailAndPassword(email, pw); }
export function signOut() { return fb.auth.signOut(); }

// onAuthStateChanged fires as soon as the account exists, before the email goes out.
export function signUp(name, email, pw) {
  return fb.auth.createUserWithEmailAndPassword(email, pw).then(function (cred) {
    return cred.user.updateProfile({ displayName: name }).then(function () { return cred.user.sendEmailVerification(); });
  });
}

// Resolves the same way whether or not the email has an account.
export function sendPasswordReset(email) {
  return fb.auth.sendPasswordResetEmail(email).catch(function (e) {
    if (!(e && e.code === "auth/user-not-found")) throw e;
  });
}

export function resendVerification() { return currentUser().sendEmailVerification(); }

// Resolves to the user once their email is verified, else null. Refreshes the ID token
// so the database rules see email_verified = true.
export function refreshVerification() {
  var u = currentUser();
  if (!u) return Promise.resolve(null);
  return u.reload().then(function () {
    var cur = currentUser();
    if (cur && cur.emailVerified) return cur.getIdToken(true).then(function () { return cur; });
    return null;
  });
}

export function updateDisplayName(name) { return currentUser().updateProfile({ displayName: name }); }

export function authErrorMessage(e) {
  var c = (e && e.code) || "";
  var m = {
    "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
    "auth/invalid-email": "That email address does not look right.",
    "auth/weak-password": "Pick a stronger password, at least 6 characters.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "Wrong email or password.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-login-credentials": "Wrong email or password.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your internet and try again.",
    "auth/operation-not-allowed": "Email sign-in is not switched on. Enable Email/Password under Authentication in the Firebase console.",
    "auth/invalid-api-key": "The API key in frontend/js/config.js is wrong. Copy it again from the Firebase console.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The API key in frontend/js/config.js is wrong. Copy it again from the Firebase console."
  };
  return m[c] || "Something went wrong. Try again.";
}
