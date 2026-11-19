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
import { pullStripe, paymentsToCsv, sendEmail, startScheduler } from "./pro.js";

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
function loadAccounts(rows: Record<string, string>[]): Account[] {
  const byId = new Map<string, Account>();
  for (const r of rows) {
    const a: Account = {
      id: r.id || r.account_id || r.account || "", name: r.name || r.id || r.account_id || "(unnamed)",
      mrr: num(r.mrr), renewalOn: r.renewal_on || r.renewal_date || "9999-12-31",
      lastContactOn: r.last_contact_on || r.last_contact || "1970-01-01",
    };
    if (a.id) byId.set(a.id, a);
  }
  return [...byId.values()];
}

function analyze(payload: WebPayload) {
  const files = payload.files || {};
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
  const accounts = loadAccounts(find("accounts.csv"));
  const usage: UsageEvent[] = find("usage.csv", "product_usage.csv").map((r) => ({
    accountId: r.account_id || r.account, date: r.date, metric: r.metric || r.event || "logins", value: num(r.value ?? r.count),
  }));
  const tickets: Ticket[] = find("tickets.csv", "support_tickets.csv").map((r) => ({
    accountId: r.account_id || r.account, date: r.date, subject: r.subject || "(untitled)",
    status: r.status === "resolved" || r.status === "closed" ? "resolved" : "open", ageDays: num(r.age_days ?? r.days_open),
  }));
  const payments: Payment[] = find("payments.csv", "stripe_payments.csv").map((r) => ({
    accountId: r.account_id || r.account, date: r.date, status: r.status === "failed" ? "failed" : "succeeded",
    amountCents: num(r.amount_cents ?? Math.round(Number(r.amount || 0) * 100)),
  }));
  const meetings: Meeting[] = find("meetings.csv", "calls.csv").map((r) => ({
    accountId: r.account_id || r.account, date: r.date,
    status: (["held", "cancelled", "no_show"].includes(r.status) ? r.status : "held") as Meeting["status"],
  }));
  const champions = find("champions.csv", "champion_changes.csv").map((r) => ({
    accountId: r.account_id || r.account, date: r.date, note: r.note || "champion left",
  }));
  const validAccounts = accounts.filter((a) => a.id);
  const items = buildRiskList(
    { accounts: validAccounts, usage, tickets, payments, meetings, champions }, today, cfg,
  );
  return { items, md: renderMarkdown(items), html: renderEmailHtml(items), config: cfg, today: today.toISOString().slice(0, 10) };
}

// Weekly Monday digest — opt-in via env, free for everyone:
//   RESEND_API_KEY=<key> CHURNLIGHT_EMAIL_TO=team@you.com npm start
// Uses the most recent analysis from this server session; skips the send
// until at least one analysis has run.
let lastDigest: { html: string; md: string; count: number } | null = null;
if (process.env.RESEND_API_KEY && process.env.CHURNLIGHT_EMAIL_TO) {
  startScheduler({
    to: process.env.CHURNLIGHT_EMAIL_TO,
    analyze: () => lastDigest || { html: "", md: "", count: 0 },
  });
  console.log(`[scheduler] weekly digest armed → ${process.env.CHURNLIGHT_EMAIL_TO} (Mondays 8:00 AM)`);
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
