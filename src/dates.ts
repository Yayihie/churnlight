// Locale-aware date handling. Slash dates like 01/10/2026 are ambiguous:
// Oct 1 in the US, Jan 10 in most of Europe. Date.parse() silently reads
// them as US, which silently corrupts renewal and recency rules. We sniff
// each file: any day-component > 12 proves DD/MM; a month-component > 12
// proves MM/DD; otherwise the file is ambiguous and we assume MM/DD/YYYY
// but surface a warning so the assumption is visible instead of silent.

export type SlashFormat = "us" | "eu";

const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export interface SniffResult {
  format: SlashFormat | null; // null = no slash dates (already ISO)
  ambiguous: number; // slash dates where day/month can't be told apart
  mixed: boolean; // both US- and EU-provable dates in the same file
  example: string; // first slash date seen, for the warning
}

export function sniffDates(rows: Record<string, string>[], fields: string[]): SniffResult {
  let us = 0, eu = 0, amb = 0, example = "";
  for (const r of rows) {
    for (const f of fields) {
      const t = (r[f] || "").trim();
      const m = SLASH.exec(t);
      if (!m) continue;
      if (!example) example = t;
      const a = Number(m[1]), b = Number(m[2]);
      if (a > 12) eu++; else if (b > 12) us++; else amb++;
    }
  }
  if (us + eu + amb === 0) return { format: null, ambiguous: 0, mixed: false, example: "" };
  return { format: eu > 0 && us === 0 ? "eu" : "us", ambiguous: amb, mixed: eu > 0 && us > 0, example };
}

// Convert one provably-EU slash date to ISO YYYY-MM-DD.
function toIso(s: string): string {
  const m = SLASH.exec(s.trim());
  if (!m) return s;
  return `${m[3]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

// Normalize the date fields of a parsed CSV file before the rules see it.
// Warns at most a few times per file; never throws.
export function normalizeDateFields(
  rows: Record<string, string>[], fields: string[], label: string, warn: (m: string) => void,
): Record<string, string>[] {
  if (rows.length === 0) return rows;
  const s = sniffDates(rows, fields);
  if (!s.format) return rows;
  if (s.mixed) {
    warn(`${label}: mixed date formats detected (e.g. ${s.example}) — day/month order can't be told apart; check these rows`);
    return rows;
  }
  if (s.format === "eu") {
    warn(`${label}: dates are DD/MM/YYYY (e.g. ${s.example}) — converted so rules fire on the right day`);
    return rows.map((r) => {
      const c: Record<string, string> = { ...r };
      for (const f of fields) c[f] = toIso(r[f] || "");
      return c;
    });
  }
  if (s.ambiguous > 0)
    warn(`${label}: ${s.ambiguous} date${s.ambiguous === 1 ? "" : "s"} like ${s.example} — assumed MM/DD/YYYY`);
  return rows;
}
