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

// src/api/hubspot.ts
var hubspot_exports = {};
__export(hubspot_exports, {
  default: () => handler
});
module.exports = __toCommonJS(hubspot_exports);

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
function hubspotAccountsCsv(companies, deals, today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) {
  const nextClose = /* @__PURE__ */ new Map();
  for (const d of deals) {
    if (!d.companyId || !d.closeDate || d.closeDate < today) continue;
    const existing = nextClose.get(d.companyId);
    if (!existing || d.closeDate < existing) nextClose.set(d.companyId, d.closeDate);
  }
  const rows = ["id,name,mrr,renewal_on,last_contact_on"];
  for (const c of companies) {
    rows.push(csvRow([c.id, c.name, Math.round(c.annualRevenue / 12), nextClose.get(c.id) || "9999-12-31", "1970-01-01"]));
  }
  return rows.join("\n");
}
function hubspotTicketsCsv(tickets, today) {
  const rows = ["account_id,date,subject,status,age_days"];
  for (const t of tickets) {
    if (!t.companyId || !t.createdDate) continue;
    const resolved = t.state === "CLOSED" || t.state === "resolved";
    const age = Math.max(0, daysBetween(isoDay(t.createdDate), today));
    rows.push(csvRow([t.companyId, isoDay(t.createdDate), t.subject, resolved ? "resolved" : "open", age]));
  }
  return rows.join("\n");
}
async function hsPage(fetcher, token, path) {
  const out = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const url = `https://api.hubapi.com${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&after=${after}` : ""}`;
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HubSpot error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    out.push(...data.results || []);
    after = data?.paging?.next?.after || "";
    if (!after) break;
  }
  return out;
}
async function pullHubSpot(token, fetcher = fetch) {
  const companies = (await hsPage(
    fetcher,
    token,
    "/crm/v3/objects/companies?properties=name,annual_revenue"
  )).map((r) => ({
    id: r.id,
    name: r.properties?.name || "(unnamed)",
    annualRevenue: num(r.properties?.annual_revenue)
  }));
  const dealsRaw = await hsPage(
    fetcher,
    token,
    "/crm/v3/objects/deals?properties=amount,closedate&associations=company"
  );
  const deals = dealsRaw.map((d) => ({
    companyId: d.associations?.results?.find((a) => a.toObjectType === "company")?.toObjectId ? String(d.associations.results.find((a) => a.toObjectType === "company").toObjectId) : "",
    amount: num(d.properties?.amount),
    closeDate: isoDay(d.properties?.closedate)
  })).filter((d) => d.companyId);
  const ticketsRaw = await hsPage(
    fetcher,
    token,
    "/crm/v3/objects/tickets?properties=subject,createdate,state&associations=company"
  );
  const tickets = ticketsRaw.map((t) => ({
    companyId: t.associations?.results?.find((a) => a.toObjectType === "company")?.toObjectId ? String(t.associations.results.find((a) => a.toObjectType === "company").toObjectId) : "",
    subject: t.properties?.subject || "(untitled)",
    createdDate: t.properties?.createdate || "",
    state: t.properties?.state || ""
  })).filter((t) => t.companyId);
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return { "accounts.csv": hubspotAccountsCsv(companies, deals), "tickets.csv": hubspotTicketsCsv(tickets, today) };
}

// src/api/hubspot.ts
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
    const { token } = JSON.parse(body || "{}");
    const files = await pullHubSpot(String(token || ""));
    res.status(200).json({ files });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e).replace(/^Error: /, "") });
  }
}
