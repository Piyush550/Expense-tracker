// Fills the local stack (`npm run dev:local` must be running) with verified emulator
// accounts, a group, a recurring space, a one-time trip and some expenses. Emulator-only: these accounts never exist in Firebase.
//   npm run seed:local
import { randomUUID } from "node:crypto";
import { currentMonth, shiftMonth } from "../shared/dates";

const EMULATOR = "http://127.0.0.1:9099";
const API = "http://127.0.0.1:8788/api";
const PROJECT = process.env.FIREBASE_PROJECT_ID ?? "demo-expense-tracker";
const PASSWORD = "local-dev-password";

export const DEV_ACCOUNTS = [
  { name: "Asha", email: "asha@example.test" },
  { name: "Bala", email: "bala@example.test" },
  { name: "Chen", email: "chen@example.test" },
  { name: "Dev", email: "dev@example.test" },
];

async function post<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const idp = (path: string) => `${EMULATOR}/identitytoolkit.googleapis.com/v1/${path}?key=local`;

async function account(name: string, email: string): Promise<string> {
  let localId: string;
  try {
    ({ localId } = await post<{ localId: string }>(idp("accounts:signUp"), { email, password: PASSWORD, displayName: name, returnSecureToken: true }));
  } catch {
    ({ localId } = await post<{ localId: string }>(idp("accounts:signInWithPassword"), { email, password: PASSWORD, returnSecureToken: true }));
  }
  await post(`${EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { localId, emailVerified: true, displayName: name }, { authorization: "Bearer owner" });
  const { idToken } = await post<{ idToken: string }>(idp("accounts:signInWithPassword"), { email, password: PASSWORD, returnSecureToken: true });
  return idToken;
}

async function main() {
  const tokens = await Promise.all(DEV_ACCOUNTS.map((a) => account(a.name, a.email)));
  const as = (i: number) => ({ authorization: `Bearer ${tokens[i]}` });
  const ids: string[] = [];
  for (let i = 0; i < tokens.length; i++) ids.push((await (await fetch(`${API}/me`, { headers: as(i) })).json()).id);

  const [asha, bala, chen, dev] = ids as [string, string, string, string];
  const flat = await post<{ id: string }>(`${API}/spaces`, { name: "Flat 4B", kind: "recurring", directoryIds: [bala, chen] }, as(0));
  await post(`${API}/spaces/${flat.id}/groups`, { name: "Boys Flat", memberIds: [asha, bala, chen] }, as(0));
  const trip = await post<{ id: string }>(`${API}/spaces`, { name: "Goa trip", kind: "one_time", memberEmails: [DEV_ACCOUNTS[1]!.email, DEV_ACCOUNTS[3]!.email] }, as(0));

  const now = currentMonth();
  const last = shiftMonth(now, -1);
  const all = [{ userId: asha }, { userId: bala }, { userId: chen }];
  const flatExpenses = [
    { description: "Groceries", amountPaise: 245050, payerId: asha, splitType: "equal", spentOn: `${now}-02`, splits: all },
    { description: "Electricity bill", amountPaise: 318000, payerId: bala, splitType: "shares", spentOn: `${now}-05`, splits: [{ userId: asha, value: 1 }, { userId: bala, value: 2 }, { userId: chen, value: 1 }], remarks: "Bala has the AC room" },
    { description: "Pizza night", amountPaise: 129900, payerId: chen, splitType: "exact", spentOn: `${now}-08`, splits: [{ userId: asha, value: 49900 }, { userId: chen, value: 80000 }] },
    { description: "Groceries", amountPaise: 198000, payerId: asha, splitType: "equal", spentOn: `${last}-03`, splits: all },
    { description: "Rent", amountPaise: 4500000, payerId: asha, splitType: "percent", spentOn: `${last}-01`, splits: [{ userId: asha, value: 4000 }, { userId: bala, value: 3000 }, { userId: chen, value: 3000 }] },
  ];
  for (const e of flatExpenses) await post(`${API}/spaces/${flat.id}/expenses`, { id: randomUUID(), ...e }, as(0));
  // Last month: Bala has settled up, Chen has not.
  await post(`${API}/spaces/${flat.id}/settlements`, { id: randomUUID(), fromUserId: bala, toUserId: asha, amountPaise: 1416000, paidOn: `${now}-01`, period: last, note: "UPI" }, as(1));

  const tripPeople = [{ userId: asha }, { userId: bala }, { userId: dev }];
  const tripExpenses = [
    { description: "Flights", amountPaise: 2700000, payerId: dev, splitType: "equal", spentOn: `${last}-20`, splits: tripPeople },
    { description: "Villa", amountPaise: 1800000, payerId: asha, splitType: "equal", spentOn: `${last}-21`, splits: tripPeople },
    { description: "Scooter rental", amountPaise: 240000, payerId: bala, splitType: "exact", spentOn: `${last}-22`, splits: [{ userId: bala, value: 120000 }, { userId: dev, value: 120000 }] },
  ];
  for (const e of tripExpenses) await post(`${API}/spaces/${trip.id}/expenses`, { id: randomUUID(), ...e }, as(0));
  console.log(`Seeded group "Boys Flat", spaces "Flat 4B" (monthly) and "Goa trip" (one-time). Sign in as any of: ${DEV_ACCOUNTS.map((a) => a.email).join(", ")} (password in scripts/seed-local.ts).`);
}

await main();
