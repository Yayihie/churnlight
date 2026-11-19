// The rules engine — transparent, editable, no black box.
import { Account, ChampionExit, Meeting, Payment, RuleConfig, Signal, Ticket, UsageEvent, DEFAULT_CONFIG } from "./types.js";

const MS_DAY = 86_400_000;
export const daysAgo = (iso: string, today: Date): number =>
  Math.floor((today.getTime() - new Date(iso + "T00:00:00Z").getTime()) / MS_DAY);
const daysUntil = (iso: string, today: Date): number =>
  Math.floor((new Date(iso + "T00:00:00Z").getTime() - today.getTime()) / MS_DAY);

export interface Inputs {
  accounts: Account[];
  usage: UsageEvent[];
  tickets: Ticket[];
  payments: Payment[];
  meetings: Meeting[];
  champions: ChampionExit[];
}

export function evaluate(
  input: Inputs,
  today: Date,
  cfg: RuleConfig = DEFAULT_CONFIG,
): Signal[] {
  const signals: Signal[] = [];
  const W = cfg.weights;

  // 1. Champion gone — the #1 early tell CSMs reported (before any usage drop)
  for (const c of input.champions) {
    signals.push({
      accountId: c.accountId, rule: "champion_gone", severity: "high",
      reason: `Champion left (${c.note}) — decisions stall without an internal advocate`,
      action: "Find and build a relationship with the new decision-maker this week",
      weight: W.champion_gone,
      math: `champion_gone fired · weight ${W.champion_gone}`,
    });
  }

  // 2. Usage drop — breadth-of-usage trend vs prior window
  for (const acct of input.accounts) {
    const evts = input.usage.filter((u) => u.accountId === acct.id);
    const metrics = new Set(evts.map((e) => e.metric));
    for (const metric of metrics) {
      const series = evts.filter((e) => e.metric === metric).sort((a, b) => a.date.localeCompare(b.date));
      const recent: number[] = [], prior: number[] = [];
      for (const e of series) {
        const d = daysAgo(e.date, today);
        if (d >= 0 && d < cfg.usageWindowDays) recent.push(e.value);
        else if (d >= cfg.usageWindowDays && d < cfg.usageWindowDays * 2) prior.push(e.value);
      }
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const p = sum(prior), r = sum(recent);
      if (p > 0 && r < p) {
        const drop = Math.round(((p - r) / p) * 100);
        if (drop >= cfg.usageDropPct) {
          signals.push({
            accountId: acct.id, rule: "usage_drop", severity: drop >= 70 ? "high" : "medium",
            reason: `${metric} usage down ${drop}% vs the prior ${cfg.usageWindowDays} days`,
            action: "Check whether the core value event is still happening; call if not",
            weight: W.usage_drop,
            math: `down ${drop}% ≥ threshold ${cfg.usageDropPct}% · weight ${W.usage_drop}`,
          });
          break; // one usage signal per account is enough
        }
      }
    }
  }

  // 3. Renewal soon + no meaningful contact
  for (const acct of input.accounts) {
    const until = daysUntil(acct.renewalOn, today);
    const since = daysAgo(acct.lastContactOn, today);
    if (until >= 0 && until <= cfg.renewalSoonDays && since >= cfg.renewalNoContactDays) {
      signals.push({
        accountId: acct.id, rule: "renewal_no_contact", severity: until <= 14 ? "high" : "medium",
        reason: `Renewal in ${until} days and no CSM contact for ${since} days`,
        action: "Book a value-review call before the renewal hits procurement",
        weight: W.renewal_no_contact,
        math: `renewal in ${until}d ≤ ${cfg.renewalSoonDays}d and no contact ${since}d ≥ ${cfg.renewalNoContactDays}d · weight ${W.renewal_no_contact}`,
      });
    }
  }

  // 4. Stale unresolved tickets
  for (const t of input.tickets) {
    if (t.status === "open" && t.ageDays >= cfg.ticketStaleDays) {
      signals.push({
        accountId: t.accountId, rule: "stale_ticket", severity: t.ageDays >= 30 ? "high" : "medium",
        reason: `Ticket "${t.subject}" unresolved for ${t.ageDays} days`,
        action: "Get the ticket to done or give the customer a dated fix commitment",
        weight: W.stale_ticket,
        math: `open ${t.ageDays}d ≥ ${cfg.ticketStaleDays}d · weight ${W.stale_ticket}`,
      });
    }
  }

  // 5. Failed payments (involuntary churn risk)
  for (const acct of input.accounts) {
    const fails = input.payments.filter((p) => p.accountId === acct.id && p.status === "failed");
    if (fails.length >= cfg.paymentFailures) {
      const amt = fails[fails.length - 1].amountCents / 100;
      signals.push({
        accountId: acct.id, rule: "failed_payments", severity: "high",
        reason: `${fails.length} failed payments (last $${amt.toFixed(2)})`,
        action: "Fix the card on file today — this churn is fully recoverable",
        weight: W.failed_payments,
        math: `${fails.length} failures ≥ ${cfg.paymentFailures} · weight ${W.failed_payments}`,
      });
    }
  }

  // 6. Cancelled meetings / no-shows — relationship drifting
  for (const acct of input.accounts) {
    const cancels = input.meetings.filter(
      (m) => m.accountId === acct.id && m.status !== "held" && daysAgo(m.date, today) >= 0 && daysAgo(m.date, today) < 60
    );
    if (cancels.length >= cfg.cancelledMeetings) {
      signals.push({
        accountId: acct.id, rule: "meeting_no_show", severity: "medium",
        reason: `${cancels.length} cancelled/no-show meetings in the last 60 days`,
        action: "Reschedule directly; if they cancel again, ask the champion's manager for a 15-min check-in",
        weight: W.meeting_no_show,
        math: `${cancels.length} cancels ≥ ${cfg.cancelledMeetings} in 60d · weight ${W.meeting_no_show}`,
      });
    }
  }

  return signals;
}

export function buildRiskList(input: Inputs, today: Date, cfg: RuleConfig = DEFAULT_CONFIG): import("./types.js").RiskItem[] {
  const signals = evaluate(input, today, cfg);
  const byAccount = new Map<string, Signal[]>();
  for (const s of signals) {
    const arr = byAccount.get(s.accountId) ?? [];
    arr.push(s);
    byAccount.set(s.accountId, arr);
  }
  const items = input.accounts
    .map((acct) => {
      const sigs = (byAccount.get(acct.id) ?? []).sort((a, b) => b.weight - a.weight);
      const score = sigs.reduce((a, s) => a + s.weight, 0);
      const tier: import("./types.js").RiskItem["tier"] = score >= 12 ? "critical" : score >= 5 ? "watch" : "ok";
      return { account: acct, signals: sigs, riskScore: score, tier };
    })
    .filter((r) => r.tier !== "ok")
    .sort((a, b) => b.riskScore - a.riskScore || b.account.mrr - a.account.mrr);
  return items;
}
