"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/api/analyze.ts
var analyze_exports = {};
__export(analyze_exports, {
  default: () => handler
});
module.exports = __toCommonJS(analyze_exports);

// src/csv.ts
function parseCsv(text) {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c !== "")).map((cells) => {
    const obj = {};
    header.forEach((h, i) => obj[h] = (cells[i] ?? "").trim());
    return obj;
  });
}
function parseRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// src/types.ts
var DEFAULT_CONFIG = {
  usageDropPct: 40,
  usageWindowDays: 14,
  renewalSoonDays: 30,
  renewalNoContactDays: 21,
  ticketStaleDays: 14,
  paymentFailures: 2,
  cancelledMeetings: 2,
  inactiveUserDays: 30,
  weights: {
    champion_gone: 8,
    usage_drop: 6,
    renewal_no_contact: 7,
    stale_ticket: 5,
    failed_payments: 7,
    meeting_no_show: 6,
    users_inactive: 6
  }
};

// src/rules.ts
var MS_DAY = 864e5;
var daysAgo = (iso, today) => Math.floor((today.getTime() - (/* @__PURE__ */ new Date(iso + "T00:00:00Z")).getTime()) / MS_DAY);
var daysUntil = (iso, today) => Math.floor(((/* @__PURE__ */ new Date(iso + "T00:00:00Z")).getTime() - today.getTime()) / MS_DAY);
function evaluate(input, today, cfg = DEFAULT_CONFIG) {
  const signals = [];
  const W = cfg.weights;
  for (const c of input.champions) {
    signals.push({
      accountId: c.accountId,
      rule: "champion_gone",
      severity: "high",
      reason: `Champion left (${c.note}) \u2014 decisions stall without an internal advocate`,
      action: "Find and build a relationship with the new decision-maker this week",
      weight: W.champion_gone,
      math: `champion_gone fired \xB7 weight ${W.champion_gone}`
    });
  }
  for (const acct of input.accounts) {
    const evts = input.usage.filter((u) => u.accountId === acct.id);
    const metrics = new Set(evts.map((e) => e.metric));
    for (const metric of metrics) {
      const series = evts.filter((e) => e.metric === metric).sort((a, b) => a.date.localeCompare(b.date));
      const recent = [], prior = [];
      for (const e of series) {
        const d = daysAgo(e.date, today);
        if (d >= 0 && d < cfg.usageWindowDays) recent.push(e.value);
        else if (d >= cfg.usageWindowDays && d < cfg.usageWindowDays * 2) prior.push(e.value);
      }
      const sum = (xs) => xs.reduce((a, b) => a + b, 0);
      const p = sum(prior), r = sum(recent);
      if (p > 0 && r < p) {
        const drop = Math.round((p - r) / p * 100);
        if (drop >= cfg.usageDropPct) {
          signals.push({
            accountId: acct.id,
            rule: "usage_drop",
            severity: drop >= 70 ? "high" : "medium",
            reason: `${metric} usage down ${drop}% vs the prior ${cfg.usageWindowDays} days`,
            action: "Check whether the core value event is still happening; call if not",
            weight: W.usage_drop,
            math: `down ${drop}% \u2265 threshold ${cfg.usageDropPct}% \xB7 weight ${W.usage_drop}`
          });
          break;
        }
      }
    }
  }
  for (const acct of input.accounts) {
    const until = daysUntil(acct.renewalOn, today);
    const since = daysAgo(acct.lastContactOn, today);
    if (until >= 0 && until <= cfg.renewalSoonDays && since >= cfg.renewalNoContactDays) {
      signals.push({
        accountId: acct.id,
        rule: "renewal_no_contact",
        severity: until <= 14 ? "high" : "medium",
        reason: `Renewal in ${until} days and no CSM contact for ${since} days`,
        action: "Book a value-review call before the renewal hits procurement",
        weight: W.renewal_no_contact,
        math: `renewal in ${until}d \u2264 ${cfg.renewalSoonDays}d and no contact ${since}d \u2265 ${cfg.renewalNoContactDays}d \xB7 weight ${W.renewal_no_contact}`
      });
    }
  }
  for (const t of input.tickets) {
    if (t.status === "open" && t.ageDays >= cfg.ticketStaleDays) {
      signals.push({
        accountId: t.accountId,
        rule: "stale_ticket",
        severity: t.ageDays >= 30 ? "high" : "medium",
        reason: `Ticket "${t.subject}" unresolved for ${t.ageDays} days`,
        action: "Get the ticket to done or give the customer a dated fix commitment",
        weight: W.stale_ticket,
        math: `open ${t.ageDays}d \u2265 ${cfg.ticketStaleDays}d \xB7 weight ${W.stale_ticket}`
      });
    }
  }
  for (const acct of input.accounts) {
    const fails = input.payments.filter((p) => p.accountId === acct.id && p.status === "failed");
    if (fails.length >= cfg.paymentFailures) {
      const amt = fails[fails.length - 1].amountCents / 100;
      signals.push({
        accountId: acct.id,
        rule: "failed_payments",
        severity: "high",
        reason: `${fails.length} failed payments (last $${amt.toFixed(2)})`,
        action: "Fix the card on file today \u2014 this churn is fully recoverable",
        weight: W.failed_payments,
        math: `${fails.length} failures \u2265 ${cfg.paymentFailures} \xB7 weight ${W.failed_payments}`
      });
    }
  }
  for (const acct of input.accounts) {
    const cancels = input.meetings.filter(
      (m) => m.accountId === acct.id && m.status !== "held" && daysAgo(m.date, today) >= 0 && daysAgo(m.date, today) < 60
    );
    if (cancels.length >= cfg.cancelledMeetings) {
      signals.push({
        accountId: acct.id,
        rule: "meeting_no_show",
        severity: "medium",
        reason: `${cancels.length} cancelled/no-show meetings in the last 60 days`,
        action: "Reschedule directly; if they cancel again, ask the champion's manager for a 15-min check-in",
        weight: W.meeting_no_show,
        math: `${cancels.length} cancels \u2265 ${cfg.cancelledMeetings} in 60d \xB7 weight ${W.meeting_no_show}`
      });
    }
  }
  for (const acct of input.accounts) {
    const seats = (input.users || []).filter((u) => u.accountId === acct.id);
    if (seats.length === 0) continue;
    const idle = seats.filter((u) => daysAgo(u.lastActiveOn, today) >= cfg.inactiveUserDays).length;
    if (idle >= Math.max(1, Math.ceil(seats.length / 2))) {
      signals.push({
        accountId: acct.id,
        rule: "users_inactive",
        severity: idle === seats.length ? "high" : "medium",
        reason: `${idle} of ${seats.length} user${seats.length === 1 ? "" : "s"} haven't been active in ${cfg.inactiveUserDays}+ days`,
        action: "Check who actually owns the rollout; re-onboard the idle users or right-size the seats",
        weight: W.users_inactive,
        math: `${idle} of ${seats.length} idle \u2265 half, idle \u2265 ${cfg.inactiveUserDays}d \xB7 weight ${W.users_inactive}`
      });
    }
  }
  return signals;
}
function buildRiskList(input, today, cfg = DEFAULT_CONFIG) {
  const signals = evaluate(input, today, cfg);
  const byAccount = /* @__PURE__ */ new Map();
  for (const s of signals) {
    const arr = byAccount.get(s.accountId) ?? [];
    arr.push(s);
    byAccount.set(s.accountId, arr);
  }
  const items = input.accounts.map((acct) => {
    const sigs = (byAccount.get(acct.id) ?? []).sort((a, b) => b.weight - a.weight);
    const score = sigs.reduce((a, s) => a + s.weight, 0);
    const tier = score >= 12 ? "critical" : score >= 5 ? "watch" : "ok";
    return { account: acct, signals: sigs, riskScore: score, tier };
  }).filter((r) => r.tier !== "ok").sort((a, b) => b.riskScore - a.riskScore || b.account.mrr - a.account.mrr);
  return items;
}

// src/digest.ts
var TIER_LABEL = { critical: "\u{1F534} CRITICAL", watch: "\u{1F7E1} WATCH", ok: "OK" };
var TIER_LABEL_HTML = { critical: "CRITICAL", watch: "WATCH", ok: "OK" };
function renderMarkdown(items) {
  if (items.length === 0) return "# Churnlight \u2014 Weekly Risk List\n\nNothing flagged this week. \u{1F389}\n";
  let out = `# Churnlight \u2014 Weekly Risk List

${items.length} account(s) need attention.

---
`;
  for (const it of items) {
    out += `
## ${TIER_LABEL[it.tier]} ${it.account.name} \u2014 $${it.account.mrr.toLocaleString()}/mo MRR
`;
    for (const s of it.signals) {
      out += `- **Why:** ${s.reason}${s.math ? ` _(${s.math})_` : ""}
  **Do:** ${s.action}
`;
    }
    out += `  _risk score: ${it.riskScore}_
`;
  }
  return out;
}
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function renderEmailHtml(items, title = "Churnlight \u2014 Weekly Risk List") {
  const rows = items.map(
    (it) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px;vertical-align:top">
        <div style="font-weight:700">${esc(it.account.name)}
          <span style="background:${it.tier === "critical" ? "#fee2e2" : "#fef9c3"};color:${it.tier === "critical" ? "#b91c1c" : "#854d0e"};
          padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px">${TIER_LABEL_HTML[it.tier]}</span>
        </div>
        <div style="color:#666;font-size:13px">$${it.account.mrr.toLocaleString()}/mo \xB7 renewal ${esc(it.account.renewalOn)}</div>
        ${it.signals.map((s) => `<div style="margin-top:6px;font-size:14px"><strong>Why:</strong> ${esc(s.reason)}${s.math ? ` <span style="color:#999;font-size:12px">(${esc(s.math)})</span>` : ""}<br/><strong>Do:</strong> ${esc(s.action)}</div>`).join("")}
      </td>
    </tr>`
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111">
  <h2 style="margin:0 0 4px">${esc(title)}</h2>
  <p style="color:#666;font-size:14px;margin-top:0">${items.length} account(s) flagged. Every reason comes with a next action \u2014 that is the whole point.</p>
  <table style="border-collapse:collapse;width:100%">${rows || '<tr><td style="padding:20px;color:#666">Nothing flagged this week. \u{1F389}</td></tr>'}</table>
  <p style="color:#999;font-size:12px;margin-top:24px">Generated by Churnlight \u2014 rules you can read and edit. No black-box scores.</p>
</body></html>`;
}

// src/dates.ts
var SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
function sniffDates(rows, fields) {
  let us = 0, eu = 0, amb = 0, example = "";
  for (const r of rows) {
    for (const f of fields) {
      const t = (r[f] || "").trim();
      const m = SLASH.exec(t);
      if (!m) continue;
      if (!example) example = t;
      const a = Number(m[1]), b = Number(m[2]);
      if (a > 12) eu++;
      else if (b > 12) us++;
      else amb++;
    }
  }
  if (us + eu + amb === 0) return { format: null, ambiguous: 0, mixed: false, example: "" };
  return { format: eu > 0 && us === 0 ? "eu" : "us", ambiguous: amb, mixed: eu > 0 && us > 0, example };
}
function toIso(s, eu) {
  const m = SLASH.exec(s.trim());
  if (!m) return s;
  const month = eu ? Number(m[2]) : Number(m[1]);
  const day = eu ? Number(m[1]) : Number(m[2]);
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function normalizeDateFields(rows, fields, label, warn) {
  if (rows.length === 0) return rows;
  const s = sniffDates(rows, fields);
  if (!s.format) return rows;
  if (s.mixed) {
    warn(`${label}: mixed date formats detected (e.g. ${s.example}) \u2014 day/month order can't be told apart; check these rows`);
    return rows;
  }
  const eu = s.format === "eu";
  if (eu) warn(`${label}: dates are DD/MM/YYYY (e.g. ${s.example}) \u2014 converted so rules fire on the right day`);
  else if (s.ambiguous > 0)
    warn(`${label}: ${s.ambiguous} date${s.ambiguous === 1 ? "" : "s"} like ${s.example} \u2014 assumed MM/DD/YYYY`);
  return rows.map((r) => {
    const c = { ...r };
    for (const f of fields) c[f] = toIso(r[f] || "", eu);
    return c;
  });
}

// src/analyze.ts
var num = (v, d = 0) => {
  if (v === void 0) return d;
  const cleaned = v.replace(/[$,\s]/g, "");
  if (cleaned === "" || isNaN(Number(cleaned))) return d;
  return Number(cleaned);
};
function loadAccounts(rows, warn) {
  const byId = /* @__PURE__ */ new Map();
  let dupes = 0, noId = 0, badDates = 0;
  for (const r of rows) {
    const a = {
      id: r.id || r.account_id || r.account || "",
      name: r.name || r.id || r.account_id || "(unnamed)",
      mrr: num(r.mrr),
      renewalOn: r.renewal_on || r.renewal_date || "9999-12-31",
      lastContactOn: r.last_contact_on || r.last_contact || "1970-01-01"
    };
    if (!a.id) {
      noId++;
      continue;
    }
    if (byId.has(a.id)) {
      dupes++;
      byId.set(a.id, a);
      continue;
    }
    if (!isUsableDate(a.renewalOn) || !isUsableDate(a.lastContactOn)) badDates++;
    byId.set(a.id, a);
  }
  if (noId) warn(`${noId} account row${noId === 1 ? "" : "s"} missing an id column \u2014 skipped`);
  if (dupes) warn(`${dupes} duplicate account id${dupes === 1 ? "" : "s"} \u2014 kept the last row for each`);
  if (badDates) warn(`${badDates} account${badDates === 1 ? " has" : "s have"} unparseable renewal/last-contact dates \u2014 renewal rules can't fire for those`);
  return [...byId.values()];
}
function makeWarnings() {
  const w = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (msg) => {
    if (!seen.has(msg)) {
      seen.add(msg);
      w.push(msg);
    }
  };
  return { w, add };
}
var SENTINEL_DATES = /* @__PURE__ */ new Set(["9999-12-31", "1970-01-01"]);
var isUsableDate = (s) => !!s && (SENTINEL_DATES.has(s) || !isNaN(Date.parse(s)));
function analyzeWeb(payload) {
  const files = payload.files || {};
  const { w: warnings, add: warn } = makeWarnings();
  const cfg = { ...DEFAULT_CONFIG, ...payload.config || {} };
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (k === "weights") continue;
    const n = Number(cfg[k]);
    if (!Number.isFinite(n)) cfg[k] = DEFAULT_CONFIG[k];
    else cfg[k] = n;
  }
  for (const k of Object.keys(DEFAULT_CONFIG.weights)) {
    const n = Number(cfg.weights?.[k]);
    cfg.weights[k] = Number.isFinite(n) ? n : DEFAULT_CONFIG.weights[k];
  }
  const today = payload.today ? /* @__PURE__ */ new Date(payload.today + "T00:00:00Z") : /* @__PURE__ */ new Date();
  const find = (...names) => {
    for (const n of names) {
      const key = Object.keys(files).find((f) => f.toLowerCase().replace(/^.*\//, "") === n);
      if (key) return parseCsv(files[key]);
    }
    return [];
  };
  const accounts = loadAccounts(
    normalizeDateFields(
      find("accounts.csv"),
      ["renewal_on", "renewal_date", "last_contact_on", "last_contact"],
      "accounts.csv",
      warn
    ),
    warn
  );
  const ids = new Set(accounts.map((a) => a.id));
  if (!files || Object.keys(files).length === 0)
    warn("No files were analyzed \u2014 drop your CSV exports to get a risk list.");
  else if (accounts.length === 0)
    warn("No usable accounts were loaded from accounts.csv \u2014 check the id column name.");
  function scrub(rows, label, build, dateOf = (r) => r.date) {
    const out = [];
    let noId = 0, badDate = 0, orphan = 0;
    for (const r of rows) {
      const id = r.account_id || r.account || "";
      if (!id) {
        noId++;
        continue;
      }
      if (!isUsableDate(dateOf(r))) {
        badDate++;
        continue;
      }
      if (!ids.has(id)) {
        orphan++;
        continue;
      }
      out.push(build(r));
    }
    if (noId) warn(`${noId} ${label} row${noId === 1 ? "" : "s"} missing account_id \u2014 skipped`);
    if (badDate) warn(`${badDate} ${label} row${badDate === 1 ? "" : "s"} ${badDate === 1 ? "has" : "have"} unparseable dates \u2014 skipped`);
    if (orphan) warn(`${orphan} ${label} row${orphan === 1 ? "" : "s"} reference an account not in accounts.csv \u2014 skipped`);
    return out;
  }
  const usage = scrub(normalizeDateFields(find("usage.csv", "product_usage.csv"), ["date"], "usage.csv", warn), "usage", (r) => ({
    accountId: r.account_id || r.account,
    date: r.date,
    metric: r.metric || r.event || "logins",
    value: num(r.value ?? r.count)
  }));
  const tickets = scrub(normalizeDateFields(find("tickets.csv", "support_tickets.csv"), ["date"], "tickets.csv", warn), "tickets", (r) => ({
    accountId: r.account_id || r.account,
    date: r.date,
    subject: r.subject || "(untitled)",
    status: r.status === "resolved" || r.status === "closed" ? "resolved" : "open",
    ageDays: num(r.age_days ?? r.days_open)
  }));
  const payments = scrub(normalizeDateFields(find("payments.csv", "stripe_payments.csv"), ["date"], "payments.csv", warn), "payments", (r) => ({
    accountId: r.account_id || r.account,
    date: r.date,
    status: r.status === "failed" ? "failed" : "succeeded",
    amountCents: num(r.amount_cents ?? Math.round(Number(r.amount || 0) * 100))
  }));
  const meetings = scrub(normalizeDateFields(find("meetings.csv", "calls.csv"), ["date"], "meetings.csv", warn), "meetings", (r) => ({
    accountId: r.account_id || r.account,
    date: r.date,
    status: ["held", "cancelled", "no_show"].includes(r.status) ? r.status : "held"
  }));
  const champions = scrub(normalizeDateFields(find("champions.csv", "champion_changes.csv"), ["date"], "champion changes", warn), "champion changes", (r) => ({
    accountId: r.account_id || r.account,
    date: r.date,
    note: r.note || "champion left"
  }));
  const users = scrub(
    normalizeDateFields(find("users.csv", "seats.csv"), ["date", "last_active_on", "last_active", "last_seen_on", "last_seen"], "users.csv", warn),
    "users",
    (r) => ({
      accountId: r.account_id || r.account,
      name: r.name || r.email || r.user_id || "(user)",
      lastActiveOn: r.last_active_on || r.last_active || r.last_seen_on || r.last_seen || r.date || "1970-01-01"
    }),
    (r) => r.last_active_on || r.last_active || r.last_seen_on || r.last_seen || r.date
  );
  const items = buildRiskList(
    { accounts, usage, tickets, payments, meetings, champions, users },
    today,
    cfg
  );
  return { items, warnings, md: renderMarkdown(items), html: renderEmailHtml(items), config: cfg, today: today.toISOString().slice(0, 10) };
}

// src/api/analyze.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function handler(req, res) {
  if (req.method === "OPTIONS") {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    res.status(204).end();
    return;
  }
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method !== "POST") {
    res.status(405).json({ error: 'POST only \u2014 send { files: { "accounts.csv": "..." } }' });
    return;
  }
  let body = "";
  await new Promise((resolve) => {
    req.on("data", (c) => {
      body += c;
      if (body.length > 25e6) req.destroy();
    });
    req.on("end", () => resolve());
  });
  try {
    const payload = JSON.parse(body || "{}");
    const result = analyzeWeb(payload);
    res.status(200).json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e).replace(/^Error: /, "") });
  }
}
