// Local fixture only. Every request is pinned to the loopback Auth emulator.
export const LOCAL_TEST_ACCOUNT = { name: "Test", email: "test@gmail.com", password: "test" } as const;
const EMULATOR = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-expense-tracker";
interface LocalUser { localId: string; displayName?: string; email?: string; emailVerified?: boolean; disabled?: boolean }

async function post<T>(path: string, body: unknown, admin = true): Promise<T> {
  const response = await fetch(`${EMULATOR}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(admin ? { authorization: "Bearer owner" } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `Local Auth emulator returned ${response.status}`);
  return data as T;
}

/** Idempotent: keeps the existing uid and leaves a working account's sessions alone. */
export async function ensureLocalTestAccount(): Promise<string> {
  const deadline = Date.now() + 30_000;
  let existing: LocalUser | undefined;
  // dev:local starts Auth and the API concurrently; wait for the emulator to be ready.
  for (;;) {
    try {
      const found = await post<{ users?: LocalUser[] }>(`projects/${projectId}/accounts:lookup`, { email: [LOCAL_TEST_ACCOUNT.email] });
      existing = found.users?.[0];
      break;
    } catch (error) {
      const starting = error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name));
      if (!starting) throw error;
      if (Date.now() >= deadline) throw new Error("Local Auth emulator is unavailable on port 9099. Start npm run dev:local first.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (existing?.emailVerified && !existing.disabled) {
    try {
      const login = await post<{ localId: string }>("accounts:signInWithPassword?key=local", {
        email: LOCAL_TEST_ACCOUNT.email, password: LOCAL_TEST_ACCOUNT.password, returnSecureToken: true,
      }, false);
      if (login.localId === existing.localId) return existing.localId;
    } catch (error) {
      // Only repair this explicitly requested local fixture when its password differs.
      if (!(error instanceof Error) || !/INVALID_(PASSWORD|LOGIN_CREDENTIALS)|USER_NOT_FOUND/.test(error.message)) throw error;
    }
  }
  const localId = existing?.localId ?? "local-dev-test";
  if (!existing) {
    const collision = await post<{ users?: LocalUser[] }>(`projects/${projectId}/accounts:lookup`, { localId: [localId] });
    if (collision.users?.length) throw new Error("The local fixture uid is already used by a different emulator account.");
  }
  // The emulator's fixture import supports rawPassword; ordinary signup retains its
  // six-character minimum. This never changes Firebase production password policy.
  const imported = await post<{ error?: { index: number; message: string }[] }>(`projects/${projectId}/accounts:batchCreate`, {
    allowOverwrite: true,
    users: [{ localId, email: LOCAL_TEST_ACCOUNT.email, displayName: existing?.displayName ?? LOCAL_TEST_ACCOUNT.name, emailVerified: true, rawPassword: LOCAL_TEST_ACCOUNT.password }],
  });
  if (imported.error?.length) throw new Error(`Could not seed local test account: ${imported.error[0]!.message}`);
  const login = await post<{ localId: string }>("accounts:signInWithPassword?key=local", {
    email: LOCAL_TEST_ACCOUNT.email, password: LOCAL_TEST_ACCOUNT.password, returnSecureToken: true,
  }, false);
  if (login.localId !== localId) throw new Error("The local test account could not be verified.");
  return localId;
}
