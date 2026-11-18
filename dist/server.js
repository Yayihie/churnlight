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
import { DEFAULT_CONFIG } from "./types.js";
import { getLicense } from "./license.js";
import { pullStripe, paymentsToCsv, sendEmail } from "./pro.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const num = (v, d = 0) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
// Shared JSON-body reader for the pro endpoints.
function readJson(req, res, handler) {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2_000_000)
        req.destroy(); });
    req.on("end", async () => {
        try {
            await handler(JSON.parse(body || "{}"));
        }
        catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
        }
    });
}
// CSV rows are keyed by snake_case headers; map to typed objects.
function loadAccounts(rows) {
    return rows.map((r) => ({
        id: r.id || r.account_id || r.account || "", name: r.name || r.id || r.account_id || "(unnamed)",
        mrr: num(r.mrr), renewalOn: r.renewal_on || r.renewal_date || "9999-12-31",
        lastContactOn: r.last_contact_on || r.last_contact || "1970-01-01",
    }));
}
function analyze(payload) {
    const files = payload.files || {};
    const cfg = { ...DEFAULT_CONFIG, ...(payload.config || {}) };
    const today = payload.today ? new Date(payload.today + "T00:00:00Z") : new Date();
    const find = (...names) => {
        for (const n of names) {
            const key = Object.keys(files).find((f) => f.toLowerCase().replace(/^.*\//, "") === n);
            if (key)
                return parseCsv(files[key]);
        }
        return [];
    };
    const accounts = loadAccounts(find("accounts.csv"));
    const usage = find("usage.csv", "product_usage.csv").map((r) => ({
        accountId: r.account_id || r.account, date: r.date, metric: r.metric || r.event || "logins", value: num(r.value ?? r.count),
    }));
    const tickets = find("tickets.csv", "support_tickets.csv").map((r) => ({
        accountId: r.account_id || r.account, date: r.date, subject: r.subject || "(untitled)",
        status: r.status === "resolved" || r.status === "closed" ? "resolved" : "open", ageDays: num(r.age_days ?? r.days_open),
    }));
    const payments = find("payments.csv", "stripe_payments.csv").map((r) => ({
        accountId: r.account_id || r.account, date: r.date, status: r.status === "failed" ? "failed" : "succeeded",
        amountCents: num(r.amount_cents ?? Math.round(Number(r.amount || 0) * 100)),
    }));
    const meetings = find("meetings.csv", "calls.csv").map((r) => ({
        accountId: r.account_id || r.account, date: r.date,
        status: (["held", "cancelled", "no_show"].includes(r.status) ? r.status : "held"),
    }));
    const champions = find("champions.csv", "champion_changes.csv").map((r) => ({
        accountId: r.account_id || r.account, date: r.date, note: r.note || "champion left",
    }));
    const validAccounts = accounts.filter((a) => a.id);
    const items = buildRiskList({ accounts: validAccounts, usage, tickets, payments, meetings, champions }, today, cfg);
    return { items, md: renderMarkdown(items), html: renderEmailHtml(items), config: cfg, today: today.toISOString().slice(0, 10) };
}
const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (req.method === "POST" && url.pathname === "/analyze") {
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 25_000_000)
            req.destroy(); });
        req.on("end", () => {
            try {
                const payload = JSON.parse(body);
                const result = analyze(payload);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(result));
            }
            catch (e) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
        return;
    }
    // ---- Pro / license endpoints ----
    if (req.method === "GET" && url.pathname === "/api/license") {
        const lic = getLicense();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ pro: lic.valid, customer: lic.customer, expires: lic.expires, error: lic.error }));
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/pro/stripe") {
        readJson(req, res, async (body) => {
            const payments = await pullStripe(body.secretKey);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ filename: "payments.csv", csv: paymentsToCsv(payments), count: payments.length }));
        });
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/pro/email") {
        readJson(req, res, async (body) => {
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
server.listen(PORT, () => {
    console.log(`\n  Churnlight is running. Open this in your browser:\n\n     http://localhost:${PORT}\n\n  Keep this window open while you use it. Close it (Ctrl+C) when done.\n`);
});
