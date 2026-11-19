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

// src/api/stripe.ts
var stripe_exports = {};
__export(stripe_exports, {
  default: () => handler
});
module.exports = __toCommonJS(stripe_exports);

// src/pro.ts
async function pullStripe(secretKey, limit = 200) {
  const res = await fetch(`https://api.stripe.com/v1/charges?limit=${limit}`, {
    headers: { Authorization: `Bearer ${secretKey}` }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stripe API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data.map((c) => ({
    accountId: c.customer || "unknown-customer",
    date: new Date(c.created * 1e3).toISOString().slice(0, 10),
    status: c.status === "failed" ? "failed" : "succeeded",
    amountCents: c.amount
  }));
}
function paymentsToCsv(payments) {
  const rows = ["account_id,date,status,amount_cents"];
  for (const p of payments) rows.push(`${p.accountId},${p.date},${p.status},${p.amountCents}`);
  return rows.join("\n");
}

// src/api/stripe.ts
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
    const { secretKey } = JSON.parse(body || "{}");
    const payments = await pullStripe(String(secretKey || ""));
    res.status(200).json({ filename: "payments.csv", csv: paymentsToCsv(payments), count: payments.length });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e).replace(/^Error: /, "") });
  }
}
