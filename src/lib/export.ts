// Copy-to-clipboard summary and CSV downloads.
import type { Expense, Settlement } from "../../shared/api";
import type { Transfer } from "../../shared/settlement";
import { formatMoney, paiseToInput } from "../../shared/money";

function csvCell(v: string): string {
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(filename: string, expenses: Expense[], payments: Settlement[], name: (id: string) => string) {
  const rows: string[][] = [["Date", "Type", "Description", "Amount (INR)", "Paid by", "Split", "Shares", "Remarks"]];
  const items = [
    ...expenses.map((e) => ({ date: e.spentOn, at: e.createdAt, row: [
      e.spentOn, "Expense", e.description, paiseToInput(e.amountPaise), name(e.payerId), e.splitType,
      e.shares.map((s) => `${name(s.userId)}: ${paiseToInput(s.sharePaise)}`).join("; "), e.remarks,
    ] })),
    ...payments.map((p) => ({ date: p.paidOn, at: p.createdAt, row: [
      p.paidOn, "Payment", `${name(p.fromUserId)} paid ${name(p.toUserId)}`, paiseToInput(p.amountPaise), name(p.fromUserId), "", "", p.note,
    ] })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  items.forEach((i) => rows.push(i.row));
  const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function summaryText(spaceName: string, periodName: string, transfers: Transfer[], name: (id: string) => string) {
  const lines = [`${spaceName} – ${periodName}`, ""];
  if (!transfers.length) lines.push("Everyone is settled up.");
  else {
    lines.push("To settle up:");
    transfers.forEach((t) => lines.push(`${name(t.from)} pays ${name(t.to)} ${formatMoney(t.amountPaise)}`));
  }
  return lines.join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
