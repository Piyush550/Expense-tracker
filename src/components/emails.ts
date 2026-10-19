const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (s: string) => EMAIL_RE.test(s);

/** "a@x.com, b@y.com\nc@z.com" → lower-cased list, or the first entry that is not an email. */
export function parseEmails(text: string): { emails: string[]; bad?: string } {
  const emails = text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = emails.find((x) => !isEmail(x));
  return bad ? { emails: [], bad } : { emails: [...new Set(emails)] };
}
