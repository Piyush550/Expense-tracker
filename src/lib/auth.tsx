// Firebase sign-in state. "ready" means signed in with a verified email, which is what the
// API requires; email/password accounts sit in "unverified" until the link is opened.
import {
  createUserWithEmailAndPassword, GoogleAuthProvider, onIdTokenChanged, reload, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth } from "./firebase";
import { clearPersistedCache, queryClient, startPersistedCache } from "./queries";

export type AuthStatus = "loading" | "signedOut" | "unverified" | "ready";

interface AuthValue {
  user: User | null;
  status: AuthStatus;
  signInWithGoogle(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  resendVerification(): Promise<void>;
  /** Reloads the user; resolves true once the email is verified. */
  checkVerified(): Promise<boolean>;
  setDisplayName(name: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  // The signed-in user's saved cache is restored before any screen asks for data.
  const [cacheFor, setCacheFor] = useState<string | null>(null);
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid) return;
    const { ready: restored, stop } = startPersistedCache(uid);
    let live = true;
    void restored.then(() => live && setCacheFor(uid));
    return () => {
      live = false;
      stop();
    };
  }, [uid]);
  // Firebase mutates the User object in place on reload(), so bump a counter to re-render.
  const [, setTick] = useState(0);

  useEffect(
    () =>
      onIdTokenChanged(auth, (u) => {
        setUser((prev) => {
          if (prev?.uid !== u?.uid) queryClient.clear();
          return u;
        });
        setReady(true);
        setTick((t) => t + 1);
      }),
    [],
  );

  const checkVerified = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return false;
    await reload(u);
    if (!u.emailVerified) return false;
    await u.getIdToken(true); // the API reads email_verified from the token
    setTick((t) => t + 1);
    return true;
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status: !ready ? "loading" : !user ? "signedOut" : !user.emailVerified ? "unverified" : cacheFor === user.uid ? "ready" : "loading",
      async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(auth, provider);
      },
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email, password);
      },
      async signUp(name, email, password) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        await sendEmailVerification(cred.user);
      },
      async resetPassword(email) {
        try {
          await sendPasswordResetEmail(auth, email);
        } catch (err) {
          // Same answer whether or not the account exists.
          if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
        }
      },
      async resendVerification() {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      },
      checkVerified,
      async setDisplayName(name) {
        if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name });
      },
      async signOut() {
        const leaving = auth.currentUser?.uid;
        await signOut(auth);
        queryClient.clear();
        if (leaving) clearPersistedCache(leaving);
      },
    }),
    [user, ready, cacheFor, checkVerified],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

const MESSAGES: Record<string, string> = {
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
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/popup-closed-by-user": "",
  "auth/cancelled-popup-request": "",
  "auth/unauthorized-domain": "This site is not allowed to use Google sign-in yet. Add its domain in Firebase → Authentication → Settings → Authorized domains.",
  "auth/operation-not-allowed": "This sign-in method is switched off in the Firebase console.",
  "auth/account-exists-with-different-credential": "You already have an account with this email. Sign in with your password first.",
};

/** User-facing text for a Firebase error; "" means "say nothing" (e.g. the user closed the popup). */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}
