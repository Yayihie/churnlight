// Pure analysis pipeline — shared by the local server AND the in-browser
// hosted app (bundled with esbuild). No node: imports allowed here.
import { parseCsv } from "./csv.js";
import { buildRiskList } from "./rules.js";
import { renderMarkdown, renderEmailHtml } from "./digest.js";
import { DEFAULT_CONFIG, Account, Meeting, Payment, Ticket, UsageEvent, UserSeat, RuleConfig } from "./types.js";
import { normalizeDateFields } from "./dates.js";

// Real exports format numbers ("$2,400", "2,400.50", " 100 ") — strip
// currency symbols, commas and whitespace before Number().
const num = (v: string | undefined, d = 0) => {
  if (v === undefined) return d;
  const cleaned = v.replace(/[$,\s]/g, "");
  if (cleaned === "" || isNaN(Number(cleaned))) return d;
  return Number(cleaned);
};

// CSV rows are keyed by snake_case headers; map to typed objects.
// Duplicate account ids (re-exported sheets, merged files) collapse to the
// LAST row — otherwise the same account shows up as multiple risk cards
// with doubled scores.
function loadAccounts(rows: Record<string, string>[], warn: (m: string) => void): Account[] {
  const byId = new Map<string, Account>();
  let dupes = 0, noId = 0, badDates = 0;
  for (const r of rows) {
    const a: Account = {
      id: r.id || r.account_id || r.account || "", name: r.name || r.id || r.account_id || "(unnamed)",
      mrr: num(r.mrr), renewalOn: r.renewal_on || r.renewal_date || "9999-12-31",
      lastContactOn: r.last_contact_on || r.last_contact || "1970-01-01",
    };
    if (!a.id) { noId++; continue; }
    if (byId.has(a.id)) { dupes++; byId.set(a.id, a); continue; }
    if (!isUsableDate(a.renewalOn) || !isUsableDate(a.lastContactOn)) badDates++;
    byId.set(a.id, a);
  }
  if (noId) warn(`${noId} account row${noId === 1 ? "" : "s"} missing an id column — skipped`);
  if (dupes) warn(`${dupes} duplicate account id${dupes === 1 ? "" : "s"} — kept the last row for each`);
  if (badDates) warn(`${badDates} account${badDates === 1 ? " has" : "s have"} unparseable renewal/last-contact dates — renewal rules can't fire for those`);
  return [...byId.values()];
}

// Parse-warning surface — bad data (unparseable dates, orphan rows, dropped
// ids) used to be handled silently, which hides real problems from the user.
// Everything questionable is collected here and shown in the UI.
function makeWarnings() {
  const w: string[] = [];
  const seen = new Set<string>();
  const add = (msg: string) => { if (!seen.has(msg)) { seen.add(msg); w.push(msg); } };
  return { w, add };
}

// A date that can't be parsed (and isn't an intentional sentinel like
// "9999-12-31") — keep the sentinel list tight and explicit.
const SENTINEL_DATES = new Set(["9999-12-31", "1970-01-01"]);
const isUsableDate = (s: string | undefined) =>
  !!s && (SENTINEL_DATES.has(s) || !isNaN(Date.parse(s)));

export interface WebPayload {
  files: Record<string, string>; // filename -> csv text
  today?: string;
  config?: Partial<RuleConfig>;
}

export function analyzeWeb(payload: WebPayload) {
  const files = payload.files || {};
  const { w: warnings, add: warn } = makeWarnings();
  const cfg: RuleConfig = { ...DEFAULT_CONFIG, ...(payload.config || {}) };
  // coerce/validate thresholds — a NaN from bad input would silently
  // disable rules, so every numeric falls back to its default
  for (const k of Object.keys(DEFAULT_CONFIG) as (keyof RuleConfig)[]) {
    if (k === "weights") continue;
    const n = Number(cfg[k]);
    if (!Number.isFinite(n)) (cfg as any)[k] = DEFAULT_CONFIG[k]; else (cfg as any)[k] = n;
  }
  for (const k of Object.keys(DEFAULT_CONFIG.weights) as (keyof RuleConfig["weights"])[]) {
    const n = Number(cfg.weights?.[k]);
    cfg.weights[k] = Number.isFinite(n) ? n : DEFAULT_CONFIG.weights[k];
  }
  const today = payload.today ? new Date(payload.today + "T00:00:00Z") : new Date();
  const find = (...names: string[]) => {
    for (const n of names) {
      const key = Object.keys(files).find((f) => f.toLowerCase().replace(/^.*\//, "") === n);
      if (key) return parseCsv(files[key]);
    }
    return [];
  };
  const accounts = loadAccounts(
    normalizeDateFields(
      find("accounts.csv"), ["renewal_on", "renewal_date", "last_contact_on", "last_contact"], "accounts.csv", warn,
    ), warn,
  );
  const ids = new Set(accounts.map((a) => a.id));
  // No accounts loaded = no risk list is possible. Saying "nothing flagged"
  // here would be a false all-clear.
  if (!files || Object.keys(files).length === 0)
    warn("No files were analyzed — drop your CSV exports to get a risk list.");
  else if (accounts.length === 0)
    warn("No usable accounts were loaded from accounts.csv — check the id column name.");

  // Generic per-file scrubber: drops rows without an account id or an
  // unparseable date, and counts orphan rows (id not present in accounts.csv).
  function scrub<T>(rows: Record<string, string>[], label: string, build: (r: Record<string, string>) => T, dateOf: (r: Record<string, string>) => string = (r) => r.date): T[] {
    const out: T[] = [];
    let noId = 0, badDate = 0, orphan = 0;
    for (const r of rows) {
      const id = r.account_id || r.account || "";
      if (!id) { noId++; continue; }
      if (!isUsableDate(dateOf(r))) { badDate++; continue; }
      if (!ids.has(id)) { orphan++; continue; }
      out.push(build(r));
    }
    if (noId) warn(`${noId} ${label} row${noId === 1 ? "" : "s"} missing account_id — skipped`);
    if (badDate) warn(`${badDate} ${label} row${badDate === 1 ? "" : "s"} ${badDate === 1 ? "has" : "have"} unparseable dates — skipped`);
    if (orphan) warn(`${orphan} ${label} row${orphan === 1 ? "" : "s"} reference an account not in accounts.csv — skipped`);
    return out;
  }

  const usage = scrub<UsageEvent>(normalizeDateFields(find("usage.csv", "product_usage.csv"), ["date"], "usage.csv", warn), "usage", (r) => ({
    accountId: r.account_id || r.account, date: r.date, metric: r.metric || r.event || "logins", value: num(r.value ?? r.count),
  }));
  const tickets = scrub<Ticket>(normalizeDateFields(find("tickets.csv", "support_tickets.csv"), ["date"], "tickets.csv", warn), "tickets", (r) => ({
    accountId: r.account_id || r.account, date: r.date, subject: r.subject || "(untitled)",
    status: r.status === "resolved" || r.status === "closed" ? "resolved" : "open", ageDays: num(r.age_days ?? r.days_open),
  }));
  const payments = scrub<Payment>(normalizeDateFields(find("payments.csv", "stripe_payments.csv"), ["date"], "payments.csv", warn), "payments", (r) => ({
    accountId: r.account_id || r.account, date: r.date, status: r.status === "failed" ? "failed" : "succeeded",
    amountCents: num(r.amount_cents ?? Math.round(Number(r.amount || 0) * 100)),
  }));
  const meetings = scrub<Meeting>(normalizeDateFields(find("meetings.csv", "calls.csv"), ["date"], "meetings.csv", warn), "meetings", (r) => ({
    accountId: r.account_id || r.account, date: r.date,
    status: (["held", "cancelled", "no_show"].includes(r.status) ? r.status : "held") as Meeting["status"],
  }));
  const champions = scrub(normalizeDateFields(find("champions.csv", "champion_changes.csv"), ["date"], "champion changes", warn), "champion changes", (r) => ({
    accountId: r.account_id || r.account, date: r.date, note: r.note || "champion left",
  }));
  const users = scrub<UserSeat>(
    normalizeDateFields(find("users.csv", "seats.csv"), ["date", "last_active_on", "last_active", "last_seen_on", "last_seen"], "users.csv", warn),
    "users", (r) => ({
      accountId: r.account_id || r.account, name: r.name || r.email || r.user_id || "(user)",
      lastActiveOn: r.last_active_on || r.last_active || r.last_seen_on || r.last_seen || r.date || "1970-01-01",
    }),
    (r) => r.last_active_on || r.last_active || r.last_seen_on || r.last_seen || r.date,
  );
  const items = buildRiskList(
    { accounts, usage, tickets, payments, meetings, champions, users }, today, cfg,
  );
  return { items, warnings, md: renderMarkdown(items), html: renderEmailHtml(items), config: cfg, today: today.toISOString().slice(0, 10) };
}
