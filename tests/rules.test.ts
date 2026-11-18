import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/csv.js";
import { buildRiskList, evaluate } from "../src/rules.js";
import { renderMarkdown, renderEmailHtml } from "../src/digest.js";
import { ChampionExit, DEFAULT_CONFIG, Account, Meeting, Payment, Ticket, UsageEvent } from "../src/types.js";
import * as path from "node:path";

const FIX = path.join(import.meta.dirname, "..", "fixtures");
const TODAY = new Date("2026-11-25T00:00:00Z");

function loadFixture() {
  const read = (n: string) => parseCsv(readFileSync(path.join(FIX, n), "utf8"));
  const num = (v: string | undefined, d = 0) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
  const accounts: Account[] = read("accounts.csv").map((r) => ({ id: r.id, name: r.name || r.id, mrr: num(r.mrr), renewalOn: r.renewal_on, lastContactOn: r.last_contact_on }));
  const usage: UsageEvent[] = read("usage.csv").map((r) => ({ accountId: r.account_id, date: r.date, metric: r.metric, value: num(r.value) }));
  const tickets: Ticket[] = read("tickets.csv").map((r) => ({ accountId: r.account_id, date: r.date, subject: r.subject, status: r.status === "resolved" ? "resolved" : "open", ageDays: num(r.age_days) }));
  const payments: Payment[] = read("payments.csv").map((r) => ({ accountId: r.account_id, date: r.date, status: r.status === "failed" ? "failed" : "succeeded", amountCents: num(r.amount_cents) }));
  const meetings: Meeting[] = read("meetings.csv").map((r) => ({ accountId: r.account_id, date: r.date, status: ["held", "cancelled", "no_show"].includes(r.status) ? r.status : "held" }));
  const champions: ChampionExit[] = read("champions.csv").map((r) => ({ accountId: r.account_id, date: r.date, note: r.note || "champion left" }));
  return { accounts, usage, tickets, payments, meetings, champions };
}

describe("csv parser", () => {
  it("handles quoted fields with commas and doubled quotes", () => {
    const rows = parseCsv('id,note\n1,"hello, world"\n2,"say ""hi"" there"');
    expect(rows).toEqual([{ id: "1", note: "hello, world" }, { id: "2", note: 'say "hi" there' }]);
  });
  it("skips empty rows", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toHaveLength(1);
  });
});

describe("rules engine on fixtures (today=2026-11-25)", () => {
  const input = loadFixture();
  const items = buildRiskList(input, TODAY);
  const byId = Object.fromEntries(items.map((i) => [i.account.id, i]));

  it("flags Acme: champion gone + usage drop + renewal-no-contact", () => {
    const acme = byId["acme"];
    expect(acme).toBeDefined();
    expect(acme.signals.map((s) => s.rule).sort()).toEqual(["champion_gone", "renewal_no_contact", "usage_drop"]);
    expect(acme.tier).toBe("critical");
  });

  it("flags Delta: stale ticket + renewal-no-contact, highest MRR", () => {
    const delta = byId["delta"];
    expect(delta.signals.map((s) => s.rule).sort()).toEqual(["renewal_no_contact", "stale_ticket"]);
    expect(delta.tier).toBe("critical");
  });

  it("flags Bright for failed payments only (usage healthy)", () => {
    expect(byId["bright"].signals.map((s) => s.rule)).toEqual(["failed_payments"]);
  });

  it("leaves Echo as no_show only (2 cancelled/no-show meetings)", () => {
    expect(byId["echo"].signals.map((s) => s.rule)).toEqual(["meeting_no_show"]);
    expect(byId["echo"].tier).toBe("watch");
  });

  it("never flags healthy Cedar", () => {
    expect(byId["cedar"]).toBeUndefined();
  });

  it("sorts critical accounts first and by risk score", () => {
    expect(items[0].tier).toBe("critical");
    expect(items[0].riskScore).toBeGreaterThanOrEqual(items[1].riskScore);
  });

  it("respects config overrides (usage threshold raised, drops acme usage flag)", () => {
    const cfg = { ...DEFAULT_CONFIG, usageDropPct: 80 }; // acme's drop is 72%, so 80 must clear it
    const acme = buildRiskList(input, TODAY, cfg).find((i) => i.account.id === "acme");
    expect(acme?.signals.some((s) => s.rule === "usage_drop")).toBe(false);
  });
});

describe("digest rendering", () => {
  const items = buildRiskList(loadFixture(), TODAY);
  it("markdown lists reason and action for every signal", () => {
    const md = renderMarkdown(items);
    expect(md).toContain("Acme Corp");
    expect(md).toContain("**Do:**");
  });
  it("html escapes account names", () => {
    const evil = [{ account: { id: "x", name: '<script>alert(1)</script>', mrr: 1, renewalOn: "2027-01-01", lastContactOn: "2026-01-01" }, signals: [], riskScore: 0, tier: "watch" as const }];
    const html = renderEmailHtml(evil);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });
  it("empty list renders a clean no-flagged message", () => {
    expect(renderMarkdown([])).toContain("Nothing flagged");
  });
});
