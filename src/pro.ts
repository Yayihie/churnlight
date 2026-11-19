// Integrations — Stripe auto-connect and email delivery. Free for everyone;
// the code is public and nothing is gated.
export interface StripePayment {
  accountId: string; date: string; status: string; amountCents: number;
}

export async function pullStripe(secretKey: string, limit = 200): Promise<StripePayment[]> {
  const res = await fetch(`https://api.stripe.com/v1/charges?limit=${limit}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stripe API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { data: any[] };
  return data.data.map((c) => ({
    accountId: c.customer || "unknown-customer",
    date: new Date(c.created * 1000).toISOString().slice(0, 10),
    status: c.status === "failed" ? "failed" : "succeeded",
    amountCents: c.amount,
  }));
}

export function paymentsToCsv(payments: StripePayment[]): string {
  const rows = ["account_id,date,status,amount_cents"];
  for (const p of payments) rows.push(`${p.accountId},${p.date},${p.status},${p.amountCents}`);
  return rows.join("\n");
}

// Basic email sanity check for the subscribe endpoint — keeps typos out of
// the scheduler; the real deliverability check is Resend accepting the send.
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

// ---- Scheduled Monday email ----
// Sends the digest via Resend (no SMTP server to configure). Returns the
// provider id so callers can verify delivery.
export async function sendEmail(to: string, subject: string, html: string): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set — get one at https://resend.com (free tier works)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Churnlight <digest@churnlight.dev>", to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json() as { id: string };
}

// ---- Weekly scheduler ----
// In-process: checks every 5 minutes and handles the digest Monday 8:00 AM
// local time, once per week. If a RESEND_API_KEY is present the digest is
// emailed; without one it's written to ./digests/ so the Monday list still
// exists — the subscriber's email is captured either way.
export function startScheduler(opts: {
  to: string;
  analyze: () => { html: string; md: string; count: number };
}): { stop: () => void } {
  let lastSentWeek = "";
  const timer = setInterval(async () => {
    const now = new Date();
    if (now.getDay() !== 1 || now.getHours() !== 8 || now.getMinutes() >= 5) return;
    const week = now.toISOString().slice(0, 10);
    if (lastSentWeek === week) return;
    lastSentWeek = week;
    try {
      const digest = opts.analyze();
      if (process.env.RESEND_API_KEY) {
        await sendEmail(opts.to, `Churnlight — ${digest.count} account(s) at risk this week`, digest.html);
        console.log(`[scheduler] Monday digest sent to ${opts.to} (${digest.count} flagged)`);
      } else {
        const dir = "./digests";
        if (!fsExists(dir)) fsMkdir(dir);
        fsWrite(`${dir}/${week}.html`, digest.html);
        fsWrite(`${dir}/${week}.md`, digest.md);
        console.log(`[scheduler] no RESEND_API_KEY — Monday digest for ${opts.to} written to ${dir}/${week}.html`);
      }
    } catch (e) {
      console.error("[scheduler] digest failed:", e);
    }
  }, 5 * 60 * 1000);
  return { stop: () => clearInterval(timer) };
}

// node:fs shims (kept here so this module stays the only fs user)
import * as fsMod from "node:fs";
const fsExists = (p: string) => fsMod.existsSync(p);
const fsMkdir = (p: string) => fsMod.mkdirSync(p);
const fsWrite = (p: string, s: string) => fsMod.writeFileSync(p, s);
