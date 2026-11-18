export const DEFAULT_CONFIG = {
    usageDropPct: 40,
    usageWindowDays: 14,
    renewalSoonDays: 30,
    renewalNoContactDays: 21,
    ticketStaleDays: 14,
    paymentFailures: 2,
    cancelledMeetings: 2,
    weights: {
        champion_gone: 8,
        usage_drop: 6,
        renewal_no_contact: 7,
        stale_ticket: 5,
        failed_payments: 7,
        meeting_no_show: 6,
    },
};
