import { describe, expect, it } from "vitest";
import { balancesFromDebts, pairwiseDebts, simplifyDebts, type Transfer } from "../shared/settlement";

function settle(balances: Record<string, number>, transfers: Transfer[]) {
  const after = { ...balances };
  for (const t of transfers) {
    expect(t.amountPaise).toBeGreaterThan(0);
    expect(t.from).not.toBe(t.to);
    after[t.from] = (after[t.from] ?? 0) + t.amountPaise;
    after[t.to] = (after[t.to] ?? 0) - t.amountPaise;
  }
  return after;
}

// Minimum payments = (people with a non-zero balance) − (most zero-sum groups they split into).
function bruteForceMin(vals: number[]): number {
  const n = vals.length;
  let best = 0;
  const assign = (i: number, groups: number[]) => {
    if (i === n) {
      if (groups.every((g) => g === 0)) best = Math.max(best, groups.length);
      return;
    }
    for (let g = 0; g < groups.length; g++) {
      groups[g]! += vals[i]!;
      assign(i + 1, groups);
      groups[g]! -= vals[i]!;
    }
    groups.push(vals[i]!);
    assign(i + 1, groups);
    groups.pop();
  };
  assign(0, []);
  return n - best;
}

function randomBalances(rand: (n: number) => number, people: number, coarse: boolean) {
  const b: Record<string, number> = {};
  let sum = 0;
  for (let i = 0; i < people - 1; i++) {
    const v = (rand(21) - 10) * (coarse ? 100 : 1 + rand(997));
    b[`p${i}`] = v;
    sum += v;
  }
  b[`p${people - 1}`] = -sum;
  return b;
}

describe("simplifyDebts", () => {
  it("settles a simple case", () => {
    const t = simplifyDebts({ a: 300, b: -100, c: -200 });
    expect(t).toEqual([
      { from: "c", to: "a", amountPaise: 200 },
      { from: "b", to: "a", amountPaise: 100 },
    ]);
  });

  it("returns nothing when everyone is square", () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
    expect(simplifyDebts({})).toEqual([]);
  });

  it("refuses balances that do not sum to zero", () => {
    expect(() => simplifyDebts({ a: 1, b: 0 })).toThrow(/sum to zero/);
  });

  it("finds independent sub-groups that greedy matching would miss", () => {
    // Greedy (largest first) needs 4 payments here; the optimum is 3: {a,d} and {b,c,e}.
    const balances = { a: 6, b: 5, c: 4, d: -6, e: -9 };
    const t = simplifyDebts(balances);
    expect(t).toHaveLength(bruteForceMin(Object.values(balances)));
    expect(t).toHaveLength(3);
    expect(Object.values(settle(balances, t)).every((v) => v === 0)).toBe(true);
  });

  it("is optimal and correct on random groups (brute-force check)", () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let t = 0; t < 400; t++) {
      const balances = randomBalances(rand, 2 + rand(7), t % 2 === 0);
      const transfers = simplifyDebts(balances);
      expect(Object.values(settle(balances, transfers)).every((v) => v === 0)).toBe(true);
      const nonZero = Object.values(balances).filter((v) => v !== 0);
      expect(transfers.length).toBe(bruteForceMin(nonZero));
    }
  });

  it("still settles everyone correctly above the exact-search limit", () => {
    let seed = 9;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const balances = randomBalances(rand, 30, false);
    const transfers = simplifyDebts(balances);
    expect(Object.values(settle(balances, transfers)).every((v) => v === 0)).toBe(true);
    expect(transfers.length).toBeLessThanOrEqual(29);
  });
});

describe("pairwiseDebts", () => {
  it("nets each pair and never routes money through a third person", () => {
    const debts = [
      { from: "b", to: "a", amountPaise: 500 },
      { from: "a", to: "b", amountPaise: 200 },
      { from: "c", to: "b", amountPaise: 100 },
    ];
    expect(pairwiseDebts(debts)).toEqual([
      { from: "b", to: "a", amountPaise: 300 },
      { from: "c", to: "b", amountPaise: 100 },
    ]);
    // The transfers clear exactly the balances the debts imply.
    const net = balancesFromDebts(debts);
    expect(Object.values(settle(net, pairwiseDebts(debts))).every((v) => v === 0)).toBe(true);
  });
});
