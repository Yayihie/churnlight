#!/usr/bin/env node
// Churnlight web app — zero-dependency local server (node:http only).
// Non-technical flow: open http://localhost:8788 → drag CSVs in → read the risk list → download the email.
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./csv.js";
import { buildRiskList } from "./rules.js";
import { renderMarkdown, renderEmailHtml } from "./digest.js";
import { DEFAULT_CONFIG, Account, Meeting, Payment, Ticket, UsageEvent, RuleConfig } from "./types.js";
import { normalizeDateFields } from "./dates.js";
import { pullStripe, paymentsToCsv, sendEmail, startScheduler, isValidEmail } from "./pro.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);

// Real exports format numbers ("$2,400", "2,400.50", " 100 ") — strip
// currency symbols, commas and whitespace before Number().
const num = (v: string | undefined, d = 0) => {
  if (v === undefined) return d;
  const cleaned = v.replace(/[$,\s]/g, "");
  if (cleaned === "" || isNaN(Number(cleaned))) return d;
  return Number(cleaned);
};

// Shared JSON-body reader for the pro endpoints.
function readJson(req: http.IncomingMessage, res: http.ServerResponse, handler: (body: any) => Promise<void>) {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
  req.on("end", async () => {
    try {
      await handler(JSON.parse(body || "{}"));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
}

interface WebPayload {
  files: Record<string, string>; // filename -> csv text
  today?: string;
  config?: Partial<RuleConfig>;
}

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

function analyze(payload: WebPayload) {
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
  function scrub<T>(rows: Record<string, string>[], label: string, build: (r: Record<string, string>) => T): T[] {
    const out: T[] = [];
    let noId = 0, badDate = 0, orphan = 0;
    for (const r of rows) {
      const id = r.account_id || r.account || "";
      if (!id) { noId++; continue; }
      if (!isUsableDate(r.date)) { badDate++; continue; }
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
  const items = buildRiskList(
    { accounts, usage, tickets, payments, meetings, champions }, today, cfg,
  );
  return { items, warnings, md: renderMarkdown(items), html: renderEmailHtml(items), config: cfg, today: today.toISOString().slice(0, 10) };
}

// Weekly Monday digest. Armed two ways, both free:
//   1. env at boot:      RESEND_API_KEY=<key> CHURNLIGHT_EMAIL_TO=team@you.com npm start
//   2. at runtime:       POST /api/digest/subscribe {"to":"team@you.com"} — the UI's
//                        "Email me every Monday" button. Sends a confirmation
//                        immediately so a typo'd address fails loudly, not silently.
let lastDigest: { html: string; md: string; count: number } | null = null;
let digestSub: { stop: () => void } | null = null;
function armDigest(to: string) {
  digestSub?.stop();
  digestSub = startScheduler({
    to,
    analyze: () => lastDigest || { html: "", md: "", count: 0 },
  });
  console.log(`[scheduler] weekly digest armed → ${to} (Mondays 8:00 AM)`);
}
if (process.env.RESEND_API_KEY && process.env.CHURNLIGHT_EMAIL_TO) {
  armDigest(process.env.CHURNLIGHT_EMAIL_TO);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (req.method === "POST" && url.pathname === "/analyze") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 25_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body) as WebPayload;
        const result = analyze(payload);
        lastDigest = { html: result.html, md: result.md, count: result.items.length };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }
  // ---- integration endpoints (free for everyone) ----
  if (req.method === "POST" && url.pathname === "/api/digest/subscribe") {
    readJson(req, res, async (body: any) => {
      const to = String(body.to || "").trim();
      if (!isValidEmail(to)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "That doesn't look like an email address — check it and try again." }));
        return;
      }
      if (!process.env.RESEND_API_KEY) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Email sending needs a RESEND_API_KEY env var on the server. Get a free one at resend.com, then: RESEND_API_KEY=<key> npm start" }));
        return;
      }
      // Confirmation send first — a bad address fails HERE, not next Monday.
      await sendEmail(to, "Churnlight digest armed", renderEmailHtml([], "You're set — Churnlight will email this list every Monday at 8:00 AM"));
      armDigest(to);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ armed: true, to }));
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/stripe") {
    readJson(req, res, async (body: any) => {
      const payments = await pullStripe(body.secretKey);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ filename: "payments.csv", csv: paymentsToCsv(payments), count: payments.length }));
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/email") {
    readJson(req, res, async (body: any) => {
      const result = await sendEmail(body.to, body.subject, body.html);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sent: true, id: result.id }));
    });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// Bind to loopback only — this tool holds your Stripe key and Resend key;
// on 0.0.0.0 anyone on the same network could use them. Set HOST to
// override deliberately.
const HOST = process.env.HOST || "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`\n  Churnlight is running. Open this in your browser:\n\n     http://localhost:${PORT}\n\n  Keep this window open while you use it. Close it (Ctrl+C) when done.\n`);
});
