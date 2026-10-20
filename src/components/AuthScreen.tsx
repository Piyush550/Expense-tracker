import { useEffect, useState, type FormEvent } from "react";
import { authErrorMessage, useAuth, type AuthStatus } from "../lib/auth";
import { Brand, ThemeSwitch } from "./Header";

type Mode = "signin" | "signup" | "reset";
const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await fn();
      if (done) setInfo(done);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const em = email.trim();
    if (!validEmail(em)) return setError("Enter a valid email address.");
    if (mode === "reset") return run(() => auth.resetPassword(em), `If an account exists for ${em}, a reset link is on its way.`);
    if (!password) return setError("Enter your password.");
    if (mode === "signin") return run(() => auth.signIn(em, password));
    const nm = name.trim().slice(0, 40);
    if (!nm) return setError("Enter your name. It is what your group sees on expenses.");
    if (password.length < 6) return setError("Use a password of at least 6 characters.");
    if (password !== password2) return setError("The two passwords do not match.");
    return run(() => auth.signUp(nm, em, password));
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setError("");
    setInfo("");
  };

  const title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in";
  return (
    <div className="card authcard">
      <span className="eyebrow">{mode === "signin" ? "Welcome back" : "Shared costs, made simple"}</span>
      <h2 className="authtitle">{title}</h2>
      {mode !== "reset" && (
        <>
          <p className="authintro">
            {mode === "signup" ? "Use Google, or an email and password." : "Use Google, or the email you signed up with."}
          </p>
          <button type="button" className="btn googlebtn" disabled={busy} onClick={() => run(auth.signInWithGoogle)}>
            <GoogleIcon /> Continue with Google
          </button>
          <p className="auth-security"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M19 15a5 5 0 0 1 2 5" /></svg> Your Google name helps friends find you.</p>
          <div className="divider">or with email</div>
        </>
      )}
      {mode === "reset" && <p className="authintro">We will email you a link to choose a new password.</p>}
      <form className="authform" onSubmit={submit} noValidate>
        {mode === "signup" && (
          <div className="field">
            <label htmlFor="a-name">Your name</label>
            <input id="a-name" type="text" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="What the group calls you" />
          </div>
        )}
        <div className="field">
          <label htmlFor="a-email">Email</label>
          <input id="a-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== "reset" && (
          <div className="field">
            <div className="fieldlabel">
              <label htmlFor="a-pw">Password</label>
              {mode === "signin" && <button type="button" className="linkbtn" disabled={busy} onClick={() => switchTo("reset")}>Forgot password?</button>}
            </div>
            <input id="a-pw" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "At least 6 characters" : undefined} />
          </div>
        )}
        {mode === "signup" && (
          <div className="field">
            <label htmlFor="a-pw2">Confirm password</label>
            <input id="a-pw2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </div>
        )}
        <div className="err" role="alert">{error}</div>
        <button type="submit" className="btn primary authsubmit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
        </button>
        <p className="authmsg" role="status">{info}</p>
      </form>
      <p className="note authswitch">
        {mode === "signin" ? (
          <>New here? <button type="button" className="linkbtn" onClick={() => switchTo("signup")}>Create an account</button></>
        ) : mode === "signup" ? (
          <>Already have an account? <button type="button" className="linkbtn" onClick={() => switchTo("signin")}>Sign in</button></>
        ) : (
          <button type="button" className="linkbtn" onClick={() => switchTo("signin")}>Back to sign in</button>
        )}
      </p>
    </div>
  );
}

export function VerifyEmailScreen() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Coming back from the verification email in another tab: pick it up without a click.
  useEffect(() => {
    const onFocus = () => void auth.checkVerified().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [auth]);

  const check = async () => {
    setBusy(true);
    setError("");
    try {
      if (!(await auth.checkVerified())) setError("Not verified yet. Open the link in the email first, then try again.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card authcard">
      <h2 className="authtitle">Verify your email</h2>
      <p className="muted" style={{ margin: "6px 0 0" }}>
        We sent a verification link to <strong>{auth.user?.email}</strong>. Open it, then come back here. Check your spam folder if it is not in your inbox.
      </p>
      <div className="formfoot">
        <button type="button" className="btn primary" disabled={busy} onClick={check}>I have verified my email</button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            auth.resendVerification().then(
              () => setInfo(`Sent a new link to ${auth.user?.email}.`),
              (err) => setError(authErrorMessage(err)),
            )
          }
        >
          Resend email
        </button>
      </div>
      <div className="err" role="alert" style={{ marginTop: 8 }}>{error}</div>
      <p className="authmsg">{info}</p>
      <p className="note">
        Wrong email? <button type="button" className="linkbtn" onClick={() => auth.signOut()}>Sign out</button> and sign up again.
      </p>
    </div>
  );
}

const POINTS = [
  { title: "A space for each situation", text: "Monthly for the flat's groceries and bills, one-time for a trip.", icon: "M3 7h18v13H3zM8 7V4h8v3" },
  { title: "Split it any way", text: "Equally, by exact amounts, by percentage or by shares.", icon: "M12 3v18M3 12h18" },
  { title: "Fewest payments to settle", text: "It works out who pays whom so everyone is square.", icon: "M5 12h14M13 6l6 6-6 6" },
];

/** Everything before the app proper: sign in / sign up / reset, verify email, or a loading state. */
export function AuthShell({ status }: { status: AuthStatus }) {
  return (
    <div className="authshell">
      <header className="authheader">
        <Brand />
        <ThemeSwitch />
      </header>
      <div className="authlayout">
        <aside className="authside">
          <div className="authpitch">
            <span className="eyebrow">A little less owing. A lot more living.</span>
            <h1>Split shared costs.<br />Settle up simply.</h1>
            <p>Log who paid and who shared it. Expense Tracker keeps the balance sheet and tells everyone exactly what to pay.</p>
          </div>
          <ul className="authpoints">
            {POINTS.map((p) => (
              <li key={p.title}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p.icon} /></svg>
                <span><strong>{p.title}</strong><span>{p.text}</span></span>
              </li>
            ))}
          </ul>
          <div className="authsample" aria-label="Example settle-up">
            <div><span>Example · settle up</span><span>2 payments</span></div>
            <div><span>Chen pays Bala</span><span className="amt">₹773.17</span></div>
            <div><span>Chen pays Asha</span><span className="amt">₹339.66</span></div>
          </div>
        </aside>
        <main className="authmain">
          {status === "loading" ? (
            <div className="card authcard muted">Checking your sign-in…</div>
          ) : status === "unverified" ? (
            <VerifyEmailScreen />
          ) : (
            <AuthScreen />
          )}
        </main>
      </div>
    </div>
  );
}
