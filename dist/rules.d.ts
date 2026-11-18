import { Account, ChampionExit, Meeting, Payment, RuleConfig, Signal, Ticket, UsageEvent } from "./types.js";
export declare const daysAgo: (iso: string, today: Date) => number;
export interface Inputs {
    accounts: Account[];
    usage: UsageEvent[];
    tickets: Ticket[];
    payments: Payment[];
    meetings: Meeting[];
    champions: ChampionExit[];
}
export declare function evaluate(input: Inputs, today: Date, cfg?: RuleConfig): Signal[];
export declare function buildRiskList(input: Inputs, today: Date, cfg?: RuleConfig): import("./types.js").RiskItem[];
