// Pro features — open-core. The code is public; the features unlock with a
// paid license key. Free users see exactly what they're missing, not a
// crippled experience.
import { getLicense } from "./license.js";
export function requirePro() {
    const lic = getLicense();
    if (!lic.valid)
        throw new Error(`Pro feature — this requires a Churnlight Pro license (${lic.error || "free tier"}). Get one at https://churnlight.dev`);
    return lic;
}
export async function pullStripe(secretKey, limit = 200) {
    requirePro();
    const res = await fetch(`https://api.stripe.com/v1/charges?limit=${limit}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Stripe API error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.data.map((c) => ({
        accountId: c.customer || "unknown-customer",
        date: new Date(c.created * 1000).toISOString().slice(0, 10),
        status: c.status === "failed" ? "failed" : "succeeded",
        amountCents: c.amount,
    }));
}
export function paymentsToCsv(payments) {
    const rows = ["account_id,date,status,amount_cents"];
    for (const p of payments)
        rows.push(`${p.accountId},${p.date},${p.status},${p.amountCents}`);
    return rows.join("\n");
}
// ---- Scheduled Monday email ----
// Sends the digest via Resend (no SMTP server to configure). Returns the
// provider id so callers can verify delivery.
export async function sendEmail(to, subject, html) {
    requirePro();
    const key = process.env.RESEND_API_KEY;
    if (!key)
        throw new Error("RESEND_API_KEY not set — get one at https://resend.com (free tier works)");
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Churnlight <digest@churnlight.dev>", to, subject, html }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend error ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
}
// ---- Weekly scheduler ----
// In-process: when the hosted server runs, it checks every 5 minutes and
// sends the digest Monday 8:00 AM local time, once per week.
export function startScheduler(opts) {
    requirePro();
    let lastSentWeek = "";
    const timer = setInterval(async () => {
        const now = new Date();
        if (now.getDay() !== 1 || now.getHours() !== 8 || now.getMinutes() >= 5)
            return;
        const week = now.toISOString().slice(0, 10);
        if (lastSentWeek === week)
            return;
        lastSentWeek = week;
        try {
            const digest = opts.analyze();
            await sendEmail(opts.to, `Churnlight — ${digest.count} account(s) at risk this week`, digest.html);
            console.log(`[scheduler] Monday digest sent to ${opts.to} (${digest.count} flagged)`);
        }
        catch (e) {
            console.error("[scheduler] send failed:", e);
        }
    }, 5 * 60 * 1000);
    return { stop: () => clearInterval(timer) };
}
