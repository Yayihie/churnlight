import { describe, expect, it } from "vitest";
import {
  hubspotAccountsCsv, hubspotTicketsCsv,
  salesforceAccountsCsv, salesforceTicketsCsv, pullHubSpot,
} from "../src/crm.js";

const TODAY = "2026-11-19";

describe("hubspotAccountsCsv", () => {
  it("maps companies to accounts.csv with revenue/12 as mrr", () => {
    const csv = hubspotAccountsCsv(
      [{ id: "1", name: "Acme", annualRevenue: 12000 }, { id: "2", name: "Beta", annualRevenue: 0 }],
      [],
    );
    expect(csv).toContain("id,name,mrr,renewal_on,last_contact_on");
    expect(csv).toContain("1,Acme,1000,9999-12-31,1970-01-01");
    expect(csv).toContain("2,Beta,0,9999-12-31,1970-01-01");
  });
  it("uses the earliest future deal close date as the renewal proxy", () => {
    const csv = hubspotAccountsCsv(
      [{ id: "1", name: "Acme", annualRevenue: 0 }],
      [
        { companyId: "1", amount: 500, closeDate: "2027-03-01" },
        { companyId: "1", amount: 900, closeDate: "2026-12-15" },
        { companyId: "1", amount: 100, closeDate: "2020-01-01" }, // past — ignored
      ],
    );
    expect(csv).toContain("1,Acme,0,2026-12-15");
  });
  it("quotes names with commas", () => {
    const csv = hubspotAccountsCsv([{ id: "1", name: "Acme, Inc.", annualRevenue: 0 }], []);
    expect(csv).toContain('1,"Acme, Inc.",0');
  });
});

describe("hubspotTicketsCsv", () => {
  it("computes age_days from createdDate and marks open/closed", () => {
    const csv = hubspotTicketsCsv([
      { companyId: "1", subject: "Login broken", createdDate: "2026-11-01T10:00:00Z", state: "OPEN" },
      { companyId: "1", subject: "Billing Q", createdDate: "2026-10-01T10:00:00Z", state: "CLOSED" },
      { companyId: "", subject: "orphan", createdDate: "2026-11-01", state: "OPEN" }, // dropped
    ], TODAY);
    expect(csv).toContain("1,2026-11-01,Login broken,open,18");
    expect(csv).toContain("1,2026-10-01,Billing Q,resolved,49");
    expect(csv).not.toContain("orphan");
  });
  it("never produces negative ages for future dates", () => {
    const csv = hubspotTicketsCsv(
      [{ companyId: "1", subject: "Sched", createdDate: "2026-12-01", state: "NEW" }], TODAY,
    );
    expect(csv).toContain("1,2026-12-01,Sched,open,0");
  });
});

describe("salesforce mappers", () => {
  it("accounts.csv from SF records", () => {
    const csv = salesforceAccountsCsv([
      { id: "001x", name: "Globex", annualRevenue: 24000 },
      { id: "002y", name: "NoRev", annualRevenue: 0 },
    ]);
    expect(csv).toContain("001x,Globex,2000,9999-12-31,1970-01-01");
    expect(csv).toContain("002y,NoRev,0");
  });
  it("tickets.csv respects IsClosed and skips rows without account", () => {
    const csv = salesforceTicketsCsv([
      { accountId: "001x", subject: "Bug", createdDate: "2026-11-05", isClosed: false },
      { accountId: "001x", subject: "Done", createdDate: "2026-11-10", isClosed: true },
      { accountId: "", subject: "ghost", createdDate: "2026-11-10", isClosed: false },
    ], TODAY);
    expect(csv).toContain("001x,2026-11-05,Bug,open,14");
    expect(csv).toContain("001x,2026-11-10,Done,resolved,9");
    expect(csv).not.toContain("ghost");
  });
});

describe("pullHubSpot (network, fake fetcher)", () => {
  const fakeFetcher = async (url: string) => {
    if (url.includes("/objects/companies")) return {
      ok: true, status: 200, text: async () => "",
      json: async () => ({ results: [{ id: "1", properties: { name: "Acme", annual_revenue: "12000" } }] }),
    };
    if (url.includes("/objects/deals")) return {
      ok: true, status: 200, text: async () => "",
      json: async () => ({ results: [{ id: "d1", properties: { amount: "500", closedate: "2026-12-15T00:00:00Z" }, associations: { results: [{ toObjectType: "company", toObjectId: 1 }] } }] }),
    };
    if (url.includes("/objects/tickets")) return {
      ok: true, status: 200, text: async () => "",
      json: async () => ({ results: [{ id: "t1", properties: { subject: "Help", createdate: "2026-11-01T09:00:00Z", state: "OPEN" }, associations: { results: [{ toObjectType: "company", toObjectId: 1 }] } }] }),
    };
    throw new Error("unexpected " + url);
  };
  it("end-to-end: token in, Churnlight CSVs out", async () => {
    const files = await pullHubSpot("pat-test", fakeFetcher as any);
    expect(files["accounts.csv"]).toContain("1,Acme,1000,2026-12-15");
    expect(files["tickets.csv"]).toContain("1,2026-11-01,Help,open,18");
  });
  it("surfaces CRM errors loudly, not as empty CSVs", async () => {
    const bad = async () => ({ ok: false, status: 401, text: async () => "unauthorized", json: async () => ({}) });
    await expect(pullHubSpot("bad", bad as any)).rejects.toThrow("HubSpot error 401");
  });
});
