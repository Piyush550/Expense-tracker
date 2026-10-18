// Sign in, create account, reset password and verify-email screens.
import { esc, validEmail } from "../core/format.js";
import { S } from "../state.js";
import * as auth from "../api/auth.js";
import { $, val } from "./dom.js";
import { onUser } from "../session.js";

function authField(id, label, type, auto, extra) {
  return '<div class="field"><label for="' + id + '">' + label + '</label><input type="' + type + '" id="' + id + '" autocomplete="' + auto + '"' + (extra || "") + "></div>";
}

// Re-renders only when the screen changes, so typing is never wiped by a data update.
export function renderAuth() {
  var key = S.setup || (S.err && S.phase === "loading") ? "none" : S.phase + ":" + S.authMode + ":" + (S.user ? S.user.uid : "");
  if (S.authKey === key) return;
  S.authKey = key;
  var el = $("auth"), h = "";
  var msgs = '<div class="err" id="a-err" style="margin-top:4px"></div><p class="authmsg" id="a-msg"></p>';
  if (key === "none" || S.phase === "ready") h = "";
  else if (S.phase === "loading") h = '<div class="card authcard muted">Checking your sign-in…</div>';
  else if (S.phase === "unverified") {
    h = '<div class="card authcard"><h3 style="font-size:20px">Verify your email</h3><p class="muted" style="margin:6px 0 0">We sent a verification link to <strong>' + esc(S.user.email) +
      "</strong>. Open it, then come back here. Check your spam folder if it is not in your inbox.</p>" +
      '<div class="formfoot"><button type="button" class="btn primary" id="a-submit" data-act="verify-check">I have verified my email</button><button type="button" class="btn" data-act="verify-resend">Resend email</button></div>' + msgs +
      '<p class="note">Wrong email? <button type="button" class="linkbtn" data-act="signout">Sign out</button> and sign up again.</p></div>';
  } else if (S.authMode === "signup") {
    h = '<div class="card authcard"><h3 style="font-size:20px">Create your account</h3><p class="muted" style="margin:6px 0 0">Everyone with an account can be added to expenses.</p>' +
      '<form class="authform" id="authForm" data-mode="signup" novalidate>' +
      authField("a-name", "Your name", "text", "name", ' maxlength="24" placeholder="What the group calls you"') +
      authField("a-email", "Email", "email", "email") +
      authField("a-pw", "Password", "password", "new-password", ' placeholder="At least 6 characters"') +
      authField("a-pw2", "Confirm password", "password", "new-password") +
      '<div class="formfoot"><button type="submit" class="btn primary" id="a-submit">Create account</button></div>' + msgs + "</form>" +
      '<p class="note">Already have an account? <button type="button" class="linkbtn" data-act="auth-mode" data-mode="signin">Sign in</button></p></div>';
  } else if (S.authMode === "reset") {
    h = '<div class="card authcard"><h3 style="font-size:20px">Reset your password</h3><p class="muted" style="margin:6px 0 0">We will email you a link to choose a new password.</p>' +
      '<form class="authform" id="authForm" data-mode="reset" novalidate>' + authField("a-email", "Email", "email", "email") +
      '<div class="formfoot"><button type="submit" class="btn primary" id="a-submit">Send reset link</button></div>' + msgs + "</form>" +
      '<p class="note"><button type="button" class="linkbtn" data-act="auth-mode" data-mode="signin">Back to sign in</button></p></div>';
  } else {
    h = '<div class="card authcard"><h3 style="font-size:20px">Sign in</h3><p class="muted" style="margin:6px 0 0">Use the email you signed up with.</p>' +
      '<form class="authform" id="authForm" data-mode="signin" novalidate>' + authField("a-email", "Email", "email", "email") + authField("a-pw", "Password", "password", "current-password") +
      '<div class="formfoot"><button type="submit" class="btn primary" id="a-submit">Sign in</button><button type="button" class="linkbtn" data-act="auth-mode" data-mode="reset">Forgot password?</button></div>' + msgs + "</form>" +
      '<p class="note">New here? <button type="button" class="linkbtn" data-act="auth-mode" data-mode="signup">Create an account</button></p></div>';
  }
  el.innerHTML = h;
}

function setAuthMsg(text, isErr) {
  var e = $("a-err"), m = $("a-msg");
  if (e) e.textContent = isErr ? text : "";
  if (m) m.textContent = isErr ? "" : text;
}
function setBusy(on) { S.busy = on; var b = $("a-submit"); if (b) b.disabled = on; }
function fail(e) { setBusy(false); setAuthMsg(auth.authErrorMessage(e), true); }

function signIn() {
  var email = val("a-email").trim(), pw = val("a-pw");
  if (!validEmail(email)) return setAuthMsg("Enter your email address.", true);
  if (!pw) return setAuthMsg("Enter your password.", true);
  setBusy(true); setAuthMsg("", false);
  auth.signIn(email, pw).catch(fail);
}
function signUp() {
  var name = val("a-name").trim().slice(0, 24), email = val("a-email").trim(), pw = val("a-pw"), pw2 = val("a-pw2");
  if (!name) return setAuthMsg("Enter your name. It is what everyone sees on expenses.", true);
  if (!validEmail(email)) return setAuthMsg("Enter a valid email address.", true);
  if (pw.length < 6) return setAuthMsg("Use a password of at least 6 characters.", true);
  if (pw !== pw2) return setAuthMsg("The two passwords do not match.", true);
  setBusy(true); setAuthMsg("", false);
  auth.signUp(name, email, pw).then(function () { setAuthMsg("Verification email sent.", false); }, fail);
}
function resetPassword() {
  var email = val("a-email").trim();
  if (!validEmail(email)) return setAuthMsg("Enter your email address.", true);
  setBusy(true);
  auth.sendPasswordReset(email).then(function () {
    setBusy(false); setAuthMsg("If an account exists for " + email + ", a reset link is on its way.", false);
  }, fail);
}

// silent: a background check (page load, tab focus) that shows nothing unless it succeeds.
export function checkVerified(silent) {
  if (!auth.currentUser() || S.busy) return;
  if (!silent) setBusy(true);
  auth.refreshVerification().then(function (u) {
    if (u) return onUser(u);
    if (!silent) { setBusy(false); setAuthMsg("Not verified yet. Open the link in the email first, then try again.", true); }
  }).catch(function (e) { if (!silent) fail(e); });
}

export var actions = {
  "auth-mode": function (b) {
    var email = val("a-email");
    S.authMode = b.getAttribute("data-mode"); renderAuth();
    if ($("a-email")) $("a-email").value = email;
    var first = document.querySelector("#authForm input"); if (first) first.focus();
  },
  "verify-check": function () { checkVerified(false); },
  "verify-resend": function () {
    auth.resendVerification().then(function () { setAuthMsg("Sent a new link to " + auth.currentUser().email + ".", false); }, function (e) { setAuthMsg(auth.authErrorMessage(e), true); });
  },
  signout: function () { auth.signOut(); }
};

export var forms = {
  authForm: function (f) {
    if (S.busy) return;
    var mode = f.getAttribute("data-mode");
    if (mode === "signup") signUp(); else if (mode === "reset") resetPassword(); else signIn();
  }
};
