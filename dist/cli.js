#!/usr/bin/env node
// CLI: churnlight run --data ./data --out ./digests --format md,email
// Directory layout: data/accounts.csv, data/usage.csv, data/tickets.csv, data/payments.csv, data/meetings.csv, data/champions.csv
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCsv } from "./csv.js";
import { buildRiskList } from "./rules.js";
import { renderMarkdown, renderEmailHtml } from "./digest.js";
import { DEFAULT_CONFIG } from "./types.js";
const args = process.argv.slice(2);
const arg = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
};
const dataDir = arg("data", "./data");
const outDir = arg("out", "./digests");
const format = arg("format", "md");
const todayArg = arg("today"); // ISO date override for deterministic runs
const configArg = arg("config"); // path to config.json (RuleConfig)
const today = todayArg ? new Date(todayArg + "T00:00:00Z") : new Date();
const cfg = configArg ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configArg, "utf8")) } : DEFAULT_CONFIG;
const read = (name) => {
    const p = path.join(dataDir, name);
    return fs.existsSync(p) ? parseCsv(fs.readFileSync(p, "utf8")) : [];
};
const num = (v, d = 0) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
const accounts = read("accounts.csv").map((r) => ({
    id: r.id, name: r.name || r.id, mrr: num(r.mrr), renewalOn: r.renewal_on || "9999-12-31", lastContactOn: r.last_contact_on || "1970-01-01",
}));
const usage = read("usage.csv").map((r) => ({ accountId: r.account_id, date: r.date, metric: r.metric, value: num(r.value) }));
const tickets = read("tickets.csv").map((r) => ({
    accountId: r.account_id, date: r.date, subject: r.subject || "(untitled)",
    status: r.status === "resolved" ? "resolved" : "open", ageDays: num(r.age_days),
}));
const payments = read("payments.csv").map((r) => ({
    accountId: r.account_id, date: r.date, status: r.status === "failed" ? "failed" : "succeeded", amountCents: num(r.amount_cents),
}));
const meetings = read("meetings.csv").map((r) => ({
    accountId: r.account_id, date: r.date,
    status: (["held", "cancelled", "no_show"].includes(r.status) ? r.status : "held"),
}));
const championExits = read("champions.csv").map((r) => ({ accountId: r.account_id, date: r.date, note: r.note || "champion left" }));
const items = buildRiskList({ accounts, usage, tickets, payments, meetings, champions: championExits }, today, cfg);
fs.mkdirSync(outDir, { recursive: true });
const stamp = today.toISOString().slice(0, 10);
if (format === "md" || format === "both") {
    fs.writeFileSync(path.join(outDir, `risk-${stamp}.md`), renderMarkdown(items));
    console.log(renderMarkdown(items));
}
if (format === "email" || format === "both") {
    fs.writeFileSync(path.join(outDir, `risk-${stamp}.html`), renderEmailHtml(items));
    console.log(`email HTML written to ${path.join(outDir, `risk-${stamp}.html`)}`);
}
console.log(`\n${items.length} account(s) flagged · config: usageDropPct=${cfg.usageDropPct}, renewalSoonDays=${cfg.renewalSoonDays}`);
