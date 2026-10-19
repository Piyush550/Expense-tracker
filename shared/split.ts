// How one expense is divided between people. Every result is whole paise and the shares
// always add up to exactly the expense amount.
import { formatMoney } from "./money";

export type SplitType = "equal" | "exact" | "percent" | "shares";

/** What the user entered per person. `value` is unused for "equal", paise for "exact",
 *  basis points (100% = 10000) for "percent" and whole units for "shares". */
export interface SplitInput {
  userId: string;
  value?: number | null;
}

export interface Share {
  userId: string;
  sharePaise: number;
  /** What was typed for this person (null for equal splits), stored so the form can be reopened. */
  splitValue: number | null;
}

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

export const PERCENT_TOTAL = 10_000;

// FNV-1a: a small deterministic hash so the leftover paise of an uneven split rotate
// between people from one expense to the next, instead of always landing on the same person.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Largest-remainder (Hamilton) apportionment of `amount` in proportion to `weights`.
 * Each person gets the floor of their exact share, and the leftover units go to the
 * largest remainders. Ties are broken by a rotation seeded from `seed`.
 */
export function apportion(amount: number, weights: number[], seed: string): number[] {
  const n = weights.length;
  const total = weights.reduce((a, w) => a + w, 0);
  if (n === 0 || total <= 0) throw new SplitError("Nothing to split between.");
  // amount ≤ 1e10 and weights ≤ 1e10 would overflow 2^53, so compute in BigInt.
  const big = BigInt(amount);
  const bigTotal = BigInt(total);
  const out: number[] = [];
  const rems: { i: number; r: bigint }[] = [];
  let given = 0;
  weights.forEach((w, i) => {
    const exact = big * BigInt(w);
    const base = exact / bigTotal;
    out.push(Number(base));
    given += Number(base);
    rems.push({ i, r: exact - base * bigTotal });
  });
  const offset = hash(seed) % n;
  const rot = (i: number) => (i - offset + n) % n;
  rems.sort((a, b) => (a.r === b.r ? rot(a.i) - rot(b.i) : a.r > b.r ? -1 : 1));
  for (let k = 0; k < amount - given; k++) out[rems[k]!.i]! += 1;
  return out;
}

/**
 * Turns the form input into stored shares. `seed` should be the expense id so the
 * result is a pure function of the expense. Throws SplitError with a user-facing message.
 */
export function computeShares(amountPaise: number, type: SplitType, inputs: SplitInput[], seed: string): Share[] {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new SplitError("The amount must be above zero.");
  const ids = inputs.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) throw new SplitError("A person is listed twice.");

  // Sort by id so the result does not depend on the order people were ticked in.
  const people = [...inputs].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const values = people.map((p) => p.value ?? 0);
  if (type !== "equal" && values.some((v) => !Number.isSafeInteger(v) || v < 0)) {
    throw new SplitError("Each person's part must be a whole, non-negative number.");
  }

  let shares: number[];
  switch (type) {
    case "equal":
      if (!people.length) throw new SplitError("Pick at least one person to split between.");
      shares = apportion(amountPaise, people.map(() => 1), seed);
      break;
    case "exact": {
      const sum = values.reduce((a, v) => a + v, 0);
      if (sum !== amountPaise) throw new SplitError(`The amounts add up to ${formatMoney(sum)}, not ${formatMoney(amountPaise)}.`);
      shares = values;
      break;
    }
    case "percent": {
      const sum = values.reduce((a, v) => a + v, 0);
      if (sum !== PERCENT_TOTAL) throw new SplitError(`The percentages add up to ${sum / 100}%, not 100%.`);
      shares = apportion(amountPaise, values, seed);
      break;
    }
    case "shares":
      if (values.reduce((a, v) => a + v, 0) <= 0) throw new SplitError("Give at least one person a share.");
      shares = apportion(amountPaise, values, seed);
      break;
  }

  const result = people
    .map((p, i) => ({ userId: p.userId, sharePaise: shares[i]!, splitValue: type === "equal" ? null : values[i]! }))
    // A person with nothing to pay and nothing typed is not part of the expense.
    .filter((s) => s.sharePaise > 0 || (s.splitValue ?? 0) > 0);
  if (!result.length) throw new SplitError("Pick at least one person to split between.");
  return result;
}
