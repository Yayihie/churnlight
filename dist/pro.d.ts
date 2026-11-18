import { LicenseInfo } from "./license.js";
export declare function requirePro(): LicenseInfo;
export interface StripePayment {
    accountId: string;
    date: string;
    status: string;
    amountCents: number;
}
export declare function pullStripe(secretKey: string, limit?: number): Promise<StripePayment[]>;
export declare function paymentsToCsv(payments: StripePayment[]): string;
export declare function sendEmail(to: string, subject: string, html: string): Promise<{
    id: string;
}>;
export declare function startScheduler(opts: {
    to: string;
    analyze: () => {
        html: string;
        md: string;
        count: number;
    };
}): {
    stop: () => void;
};
