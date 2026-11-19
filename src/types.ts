// Core types — Churnlight
export interface ChampionExit { accountId: string; date: string; note: string }

export interface Account {
  id: string;
  name: string;
  mrr: number;            // monthly recurring revenue, USD
  renewalOn: string;      // ISO date
  lastContactOn: string;  // ISO date (meeting/email/call by CSM)
}

export interface UsageEvent {
  accountId: string;
  date: string;           // ISO date
  metric: string;         // e.g. "logins", "reports_run"
  value: number;
}

export interface Ticket {
  accountId: string;
  date: string;
  subject: string;
  status: "open" | "resolved";
  ageDays: number;        // how long it has been open
}

export interface Payment {
  accountId: string;
  date: string;
  status: "succeeded" | "failed";
  amountCents: number;
}

export interface Meeting {
  accountId: string;
  date: string;           // ISO date
  status: "held" | "cancelled" | "no_show";
}

export interface UserSeat {
  accountId: string;
  name: string;           // user email or name from the export
  lastActiveOn: string;   // ISO date — last time this person used the product
}

export interface Signal {
  accountId: string;
  rule: string;           // stable rule id
  severity: "high" | "medium" | "low";
  reason: string;         // plain words a CSM would say
  action: string;         // concrete next step
  weight: number;         // 0-10, contributes to risk sum
  math?: string;          // exact comparison that fired — no black box
}

export interface RiskItem {
  account: Account;
  signals: Signal[];
  riskScore: number;      // sum of weights, severity-weighted
  tier: "critical" | "watch" | "ok";
}

export interface RuleConfig {
  usageDropPct: number;          // default 40
  usageWindowDays: number;       // compare last N days vs previous N
  renewalSoonDays: number;       // renewal inside N days
  renewalNoContactDays: number;  // ... and no contact in M days
  ticketStaleDays: number;       // open ticket older than N days
  paymentFailures: number;       // >= N failures
  cancelledMeetings: number;     // >= N cancelled/no-show in window
  inactiveUserDays: number;      // a seat idle for N days counts as inactive
  weights: Record<string, number>;
}

export const DEFAULT_CONFIG: RuleConfig = {
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
    users_inactive: 6,
  },
};
