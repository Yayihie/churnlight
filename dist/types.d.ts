export interface ChampionExit {
    accountId: string;
    date: string;
    note: string;
}
export interface Account {
    id: string;
    name: string;
    mrr: number;
    renewalOn: string;
    lastContactOn: string;
}
export interface UsageEvent {
    accountId: string;
    date: string;
    metric: string;
    value: number;
}
export interface Ticket {
    accountId: string;
    date: string;
    subject: string;
    status: "open" | "resolved";
    ageDays: number;
}
export interface Payment {
    accountId: string;
    date: string;
    status: "succeeded" | "failed";
    amountCents: number;
}
export interface Meeting {
    accountId: string;
    date: string;
    status: "held" | "cancelled" | "no_show";
}
export interface Signal {
    accountId: string;
    rule: string;
    severity: "high" | "medium" | "low";
    reason: string;
    action: string;
    weight: number;
}
export interface RiskItem {
    account: Account;
    signals: Signal[];
    riskScore: number;
    tier: "critical" | "watch" | "ok";
}
export interface RuleConfig {
    usageDropPct: number;
    usageWindowDays: number;
    renewalSoonDays: number;
    renewalNoContactDays: number;
    ticketStaleDays: number;
    paymentFailures: number;
    cancelledMeetings: number;
    weights: Record<string, number>;
}
export declare const DEFAULT_CONFIG: RuleConfig;
