import { describe, expect, it } from "vitest";
import { apportion, computeShares, SplitError } from "../shared/split";
import { formatMoney, parseMoney } from "../shared/money";

const total = (xs: { sharePaise: number }[]) => xs.reduce((a, s) => a + s.sharePaise, 0);

describe("computeShares", () => {
  it("splits equally and hands leftover paise to exactly one person each", () => {
    const shares = computeShares(10001, "equal", [{ userId: "a" }, { userId: "b" }, { userId: "c" }], "seed");
    expect(total(shares)).toBe(10001);
    expect(shares.map((s) => s.sharePaise).sort()).toEqual([3333, 3334, 3334]);
    expect(shares.every((s) => s.splitValue === null)).toBe(true);
  });

  it("does not depend on the order people were picked in", () => {
    const a = computeShares(100, "equal", [{ userId: "x" }, { userId: "y" }, { userId: "z" }], "e1");
    const b = computeShares(100, "equal", [{ userId: "z" }, { userId: "x" }, { userId: "y" }], "e1");
    expect(a).toEqual(b);
  });

  it("rotates who absorbs the extra paisa between expenses", () => {
    const people = [{ userId: "a" }, { userId: "b" }, { userId: "c" }];
    const lucky = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const shares = computeShares(101, "equal", people, `expense-${i}`);
      shares.filter((s) => s.sharePaise === 34).forEach((s) => lucky.add(s.userId));
    }
    expect(lucky.size).toBe(3);
  });

  it("takes exact amounts only when they add up", () => {
    const ok = computeShares(1000, "exact", [{ userId: "a", value: 700 }, { userId: "b", value: 300 }], "s");
    expect(ok).toEqual([
      { userId: "a", sharePaise: 700, splitValue: 700 },
      { userId: "b", sharePaise: 300, splitValue: 300 },
    ]);
    expect(() => computeShares(1000, "exact", [{ userId: "a", value: 700 }, { userId: "b", value: 200 }], "s")).toThrow(SplitError);
  });

  it("drops people with a zero exact amount", () => {
    const shares = computeShares(1000, "exact", [{ userId: "a", value: 1000 }, { userId: "b", value: 0 }], "s");
    expect(shares.map((s) => s.userId)).toEqual(["a"]);
  });

  it("splits by percentage (basis points) and keeps the total exact", () => {
    const shares = computeShares(999, "percent", [{ userId: "a", value: 3333 }, { userId: "b", value: 3333 }, { userId: "c", value: 3334 }], "s");
    expect(total(shares)).toBe(999);
    expect(() => computeShares(999, "percent", [{ userId: "a", value: 5000 }, { userId: "b", value: 4000 }], "s")).toThrow(/90%/);
  });

  it("splits by shares", () => {
    const shares = computeShares(1000, "shares", [{ userId: "a", value: 1 }, { userId: "b", value: 3 }], "s");
    expect(shares.map((s) => s.sharePaise)).toEqual([250, 750]);
  });

  it("rejects duplicates, nobody, and bad numbers", () => {
    expect(() => computeShares(100, "equal", [], "s")).toThrow(SplitError);
    expect(() => computeShares(100, "equal", [{ userId: "a" }, { userId: "a" }], "s")).toThrow(/twice/);
    expect(() => computeShares(100, "shares", [{ userId: "a", value: 0 }], "s")).toThrow(SplitError);
    expect(() => computeShares(100, "shares", [{ userId: "a", value: -1 }], "s")).toThrow(SplitError);
    expect(() => computeShares(0, "equal", [{ userId: "a" }], "s")).toThrow(SplitError);
  });

  it("always sums to the amount (random inputs)", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let t = 0; t < 2000; t++) {
      const amount = 1 + rand(5_000_000);
      const weights: number[] = Array.from({ length: 1 + rand(12) }, () => rand(50));
      if (weights.every((w) => w <= 0)) weights[0] = 1;
      const out = apportion(amount, weights, `t${t}`);
      expect(out.reduce((a, b) => a + b, 0)).toBe(amount);
      const sumW = weights.reduce((a, b) => a + b, 0);
      out.forEach((v, i) => expect(Math.abs(v - (amount * weights[i]!) / sumW)).toBeLessThan(1));
    }
  });

  it("handles the largest allowed amount without losing precision", () => {
    const out = apportion(10_000_000_000, [3333, 3333, 3334], "big");
    expect(out.reduce((a, b) => a + b, 0)).toBe(10_000_000_000);
  });
});

describe("money", () => {
  it("parses and formats paise", () => {
    expect(parseMoney("1,250.5")).toBe(125050);
    expect(parseMoney("₹ 99")).toBe(9900);
    expect(parseMoney("0")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("0.07")).toBe(7);
    expect(formatMoney(125050)).toBe("₹1,250.50");
    expect(formatMoney(-500)).toBe("−₹5");
    expect(formatMoney(12345678900)).toBe("₹12,34,56,789");
  });
});
