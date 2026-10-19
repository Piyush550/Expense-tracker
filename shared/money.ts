// Money is always an integer number of paise (₹1 = 100 paise). Never use floats for amounts.

export const MAX_AMOUNT_PAISE = 10_000_000_000; // ₹10 crore, matches the database CHECK

export function formatMoney(paise: number): string {
  const sign = paise < 0 ? "−" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}₹${rupees.toLocaleString("en-IN")}${rest ? "." + String(rest).padStart(2, "0") : ""}`;
}

/** "1,250.5" → 125050. Returns null for anything that is not a positive amount with at most 2 decimals. */
export function parseMoney(input: string): number | null {
  const v = input.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [whole = "0", frac = ""] = v.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return paise > 0 && paise <= MAX_AMOUNT_PAISE ? paise : null;
}

/** 125050 → "1250.50" (for form inputs and CSV). */
export function paiseToInput(paise: number): string {
  const s = (paise / 100).toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}
