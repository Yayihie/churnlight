import { describe, expect, it } from "vitest";
import { buildRiskList, evaluate } from "../src/rules.js";
import { DEFAULT_CONFIG, Account, UserSeat } from "../src/types.js";

const today = new Date("2026-11-19T00:00:00Z");
const acct = (over: Partial<Account> = {}): Account => ({
  id: "a1", name: "Acme", mrr: 500, renewalOn: "2027-06-01", lastContactOn: "2026-11-01", ...over,
});
const seat = (lastActiveOn: string, id = "a1"): UserSeat => ({ accountId: id, name: `u-${lastActiveOn}`, lastActiveOn });

const base = { usage: [], tickets: [], payments: [], meetings: [], champions: [] };

describe("users_inactive rule (seat tracking)", () => {
  it("fires when at least half the seats are idle past the threshold", () => {
    const sigs = evaluate(
      { accounts: [acct()], ...base, users: [seat("2026-09-01"), seat("2026-09-10"), seat("2026-11-15")] },
      today, DEFAULT_CONFIG,
    );
    const s = sigs.find((x) => x.rule === "users_inactive")!;
    expect(s).toBeTruthy();
    expect(s.math).toBe("2 of 3 idle ≥ half, idle ≥ 30d · weight 6");
    expect(s.severity).toBe("medium");
  });

  it("is high severity when every seat is idle", () => {
    const sigs = evaluate(
      { accounts: [acct()], ...base, users: [seat("2026-08-01"), seat("2026-08-15")] },
      today, DEFAULT_CONFIG,
    );
    const s = sigs.find((x) => x.rule === "users_inactive")!;
    expect(s.severity).toBe("high");
    expect(s.math).toContain("2 of 2 idle");
  });

  it("stays silent when most users are active", () => {
    const sigs = evaluate(
      { accounts: [acct()], ...base, users: [seat("2026-09-01"), seat("2026-11-18"), seat("2026-11-17")] },
      today, DEFAULT_CONFIG,
    );
    expect(sigs.find((x) => x.rule === "users_inactive")).toBeUndefined();
  });

  it("respects a custom inactiveUserDays threshold in the math", () => {
    const cfg = { ...DEFAULT_CONFIG, inactiveUserDays: 7 };
    const sigs = evaluate(
      { accounts: [acct()], ...base, users: [seat("2026-11-01")] },
      today, cfg,
    );
    const s = sigs.find((x) => x.rule === "users_inactive")!;
    expect(s.math).toContain("idle ≥ 7d");
  });

  it("accounts with no users.csv rows never fire", () => {
    const sigs = evaluate({ accounts: [acct()], ...base }, today);
    expect(sigs.find((x) => x.rule === "users_inactive")).toBeUndefined();
  });
});

describe("buildRiskList includes seat signal", () => {
  it("scores accounts with idle seats", () => {
    const items = buildRiskList(
      { accounts: [acct()], ...base, users: [seat("2026-08-01"), seat("2026-08-15")] },
      today, DEFAULT_CONFIG,
    );
    expect(items.length).toBe(1);
    expect(items[0].signals.some((s) => s.rule === "users_inactive")).toBe(true);
    expect(items[0].riskScore).toBeGreaterThanOrEqual(6);
  });
});
