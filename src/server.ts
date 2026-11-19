#!/usr/bin/env node
// Churnlight web app — zero-dependency local server (node:http only).
// Non-technical flow: open http://localhost:8788 → drag CSVs in → read the risk list → download the email.
import * as http from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWeb } from "./analyze.js";
import { RuleConfig } from "./types.js";
import { renderEmailHtml } from "./digest.js";
import { pullHubSpot, pullSalesforce } from "./crm.js";
import { pullStripe, paymentsToCsv, sendEmail, startScheduler, isValidEmail } from "./pro.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);

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

// Shareable read-only links — the risk page without a login. In-memory with
// a 7-day expiry (pruned lazily on read). This is a local-server feature;
// a serverless host has no shared memory, so links die with the process.
const shares = new Map<string, { html: string; expires: number }>();
const SHARE_TTL = 7 * 86_400_000;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname.startsWith("/share/")) {
    const id = url.pathname.slice("/share/".length);
    const s = shares.get(id);
    if (!s || s.expires < Date.now()) {
      shares.delete(id);
      res.writeHead(410, { "Content-Type": "text/plain" });
      res.end("This share link has expired. Ask for a fresh one.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(s.html);
    return;
  }
  if (req.method === "POST" && url.pathname === "/analyze") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 25_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body) as WebPayload;
        const result = analyzeWeb(payload);
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
  if (req.method === "POST" && url.pathname === "/api/share") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 25_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const { html } = JSON.parse(body) as { html: string };
        if (typeof html !== "string" || html.length < 20) throw new Error("Nothing to share yet — run the analysis first.");
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        shares.set(id, { html, expires: Date.now() + SHARE_TTL });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: `http://${req.headers.host || `localhost:${PORT}`}/share/${id}`, expiresDays: 7 }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e).replace(/^Error: /, "") }));
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
      // No Resend required: capturing the email IS the feature. Subscribers
      // are stored on disk (deduped); if a RESEND_API_KEY ever exists the
      // scheduler emails them, otherwise their Monday digest is written to
      // ./digests/. Confirmation email only when a key is actually present.
      const subFile = path.join(process.cwd(), "subscribers.json");
      let subs: string[] = [];
      try { subs = JSON.parse(fs.readFileSync(subFile, "utf8")); } catch { /* first run */ }
      if (!subs.includes(to)) subs.push(to);
      fs.writeFileSync(subFile, JSON.stringify(subs, null, 2));
      if (process.env.RESEND_API_KEY) {
        try {
          await sendEmail(to, "Churnlight digest armed", renderEmailHtml([], "You're set — Churnlight will email this list every Monday at 8:00 AM"));
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Saved your email, but the confirmation send failed: ${e}` }));
          return;
        }
      }
      armDigest(to);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ armed: true, to, emailed: !!process.env.RESEND_API_KEY }));
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/hubspot") {
    readJson(req, res, async (body: any) => {
      const files = await pullHubSpot(String(body.token || ""));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files }));
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/salesforce") {
    readJson(req, res, async (body: any) => {
      const files = await pullSalesforce({
        username: String(body.username || ""), password: String(body.password || ""),
        securityToken: String(body.securityToken || ""), clientId: String(body.clientId || ""),
        clientSecret: String(body.clientSecret || ""),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files }));
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
