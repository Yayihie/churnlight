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

// src/api/salesforce.ts
var salesforce_exports = {};
__export(salesforce_exports, {
  default: () => handler
});
module.exports = __toCommonJS(salesforce_exports);

// src/crm.ts
var isoDay = (d) => (d || "").slice(0, 10);
var num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
var csvRow = (vals) => vals.map((v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(",");
var daysBetween = (from, to) => Math.floor(((/* @__PURE__ */ new Date(to + "T00:00:00Z")).getTime() - (/* @__PURE__ */ new Date(from + "T00:00:00Z")).getTime()) / 864e5);
function salesforceAccountsCsv(accounts) {
  const rows = ["id,name,mrr,renewal_on,last_contact_on"];
  for (const a of accounts) {
    rows.push(csvRow([a.id, a.name, Math.round(a.annualRevenue / 12), "9999-12-31", "1970-01-01"]));
  }
  return rows.join("\n");
}
function salesforceTicketsCsv(cases, today) {
  const rows = ["account_id,date,subject,status,age_days"];
  for (const c of cases) {
    if (!c.accountId || !c.createdDate) continue;
    const age = Math.max(0, daysBetween(isoDay(c.createdDate), today));
    rows.push(csvRow([c.accountId, isoDay(c.createdDate), c.subject, c.isClosed ? "resolved" : "open", age]));
  }
  return rows.join("\n");
}
async function pullSalesforce(creds, fetcher = fetch) {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    username: creds.username,
    password: creds.password + creds.securityToken
  });
  const tokenRes = await fetcher("https://login.salesforce.com/services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!tokenRes.ok) throw new Error(`Salesforce login error ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
  const { access_token: at, instance_url: base } = await tokenRes.json();
  const soql = async (q) => {
    const res = await fetcher(
      `${base}/services/data/v59.0/query?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${at}` } }
    );
    if (!res.ok) throw new Error(`Salesforce query error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).records || [];
  };
  const accounts = (await soql("SELECT Id, Name, AnnualRevenue FROM Account")).map((r) => ({
    id: r.Id,
    name: r.Name || "(unnamed)",
    annualRevenue: num(r.AnnualRevenue)
  }));
  const cases = (await soql("SELECT Id, AccountId, Subject, IsClosed, CreatedDate FROM Case")).map((r) => ({
    accountId: r.AccountId || "",
    subject: r.Subject || "(untitled)",
    createdDate: isoDay(r.CreatedDate),
    isClosed: !!r.IsClosed
  }));
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return { "accounts.csv": salesforceAccountsCsv(accounts), "tickets.csv": salesforceTicketsCsv(cases, today) };
}

// src/api/salesforce.ts
async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  let body = "";
  await new Promise((resolve) => {
    req.on("data", (c) => {
      body += c;
      if (body.length > 5e5) req.destroy();
    });
    req.on("end", () => resolve());
  });
  try {
    const b = JSON.parse(body || "{}");
    const files = await pullSalesforce({
      username: String(b.username || ""),
      password: String(b.password || ""),
      securityToken: String(b.securityToken || ""),
      clientId: String(b.clientId || ""),
      clientSecret: String(b.clientSecret || "")
    });
    res.status(200).json({ files });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e).replace(/^Error: /, "") });
  }
}
