import { describe, expect, it } from "vitest";
import { buildRiskList, evaluate } from "../src/rules.js";
import { isValidEmail } from "../src/pro.js";
import { DEFAULT_CONFIG, Account, UsageEvent } from "../src/types.js";

const today = new Date("2026-11-18T00:00:00Z");
const acct = (over: Partial<Account> = {}): Account => ({
  id: "a1", name: "Acme", mrr: 500, renewalOn: "2027-06-01", lastContactOn: "2026-11-01", ...over,
});

describe("signal math (visible rule logic)", () => {
  it("usage_drop shows the exact comparison", () => {
    const usage: UsageEvent[] = [
      { accountId: "a1", date: "2026-10-25", metric: "logins", value: 100 },
      { accountId: "a1", date: "2026-11-10", metric: "logins", value: 30 },
    ];
    const sigs = evaluate({ accounts: [acct()], usage, tickets: [], payments: [], meetings: [], champions: [] }, today);
    const s = sigs.find((x) => x.rule === "usage_drop")!;
    expect(s.math).toBe("down 70% ≥ threshold 40% · weight 6");
  });

  it("renewal_no_contact shows both sides of the AND", () => {
    const sigs = evaluate(
      { accounts: [acct({ renewalOn: "2026-12-15", lastContactOn: "2026-09-01" })], usage: [], tickets: [], payments: [], meetings: [], champions: [] }, today,
    );
    const s = sigs.find((x) => x.rule === "renewal_no_contact")!;
    expect(s.math).toContain("renewal in 27d ≤ 30d");
    expect(s.math).toContain("no contact 78d ≥ 21d");
  });

  it("stale_ticket and failed_payments show threshold math", () => {
    const sigs = evaluate({
      accounts: [acct()], usage: [],
      tickets: [{ accountId: "a1", date: "2026-10-01", subject: "Bug", status: "open", ageDays: 22 }],
      payments: [
        { accountId: "a1", date: "2026-11-01", status: "failed", amountCents: 4900 },
        { accountId: "a1", date: "2026-11-05", status: "failed", amountCents: 4900 },
      ],
      meetings: [], champions: [],
    }, today);
    expect(sigs.find((x) => x.rule === "stale_ticket")!.math).toBe("open 22d ≥ 14d · weight 5");
    expect(sigs.find((x) => x.rule === "failed_payments")!.math).toBe("2 failures ≥ 2 · weight 7");
  });

  it("meeting_no_show shows count vs config", () => {
    const sigs = evaluate({
      accounts: [acct()], usage: [], tickets: [], payments: [],
      meetings: [
        { accountId: "a1", date: "2026-11-01", status: "cancelled" },
        { accountId: "a1", date: "2026-11-05", status: "no_show" },
      ],
      champions: [],
    }, today);
    expect(sigs.find((x) => x.rule === "x")?.math).toBeUndefined();
    expect(sigs.find((x) => x.rule === "meeting_no_show")!.math).toBe("2 cancels ≥ 2 in 60d · weight 6");
  });

  it("custom config thresholds appear in the math, not just the weight", () => {
    const usage: UsageEvent[] = [
      { accountId: "a1", date: "2026-10-25", metric: "logins", value: 100 },
      { accountId: "a1", date: "2026-11-10", metric: "logins", value: 70 },
    ];
    const cfg = { ...DEFAULT_CONFIG, usageDropPct: 25 };
    const sigs = evaluate({ accounts: [acct()], usage, tickets: [], payments: [], meetings: [], champions: [] }, today, cfg);
    expect(sigs.find((x) => x.rule === "usage_drop")!.math).toContain("≥ threshold 25%");
  });
});

describe("isValidEmail", () => {
  it("accepts normal addresses", () => {
    expect(isValidEmail("team@acme.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.acme.io")).toBe(true);
  });
  it("rejects junk that would silently never receive a digest", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("two@at@signs.com")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
  });
});

describe("buildRiskList carries math through to items", () => {
  it("each flagged item's signals include math", () => {
    const usage: UsageEvent[] = [
      { accountId: "a1", date: "2026-10-25", metric: "logins", value: 100 },
      { accountId: "a1", date: "2026-11-10", metric: "logins", value: 10 },
    ];
    const items = buildRiskList(
      { accounts: [acct()], usage, tickets: [], payments: [], meetings: [], champions: [] }, today, DEFAULT_CONFIG,
    );
    expect(items.length).toBe(1);
    for (const s of items[0].signals) expect(s.math).toBeTruthy();
  });
});
