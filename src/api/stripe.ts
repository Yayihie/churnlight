// Vercel serverless wrapper: Stripe payments pull.
import { pullStripe, paymentsToCsv } from "../pro.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  let body = "";
  await new Promise<void>((resolve) => {
    req.on("data", (c: string) => { body += c; if (body.length > 500_000) req.destroy(); });
    req.on("end", () => resolve());
  });
  try {
    const { secretKey } = JSON.parse(body || "{}");
    const payments = await pullStripe(String(secretKey || ""));
    res.status(200).json({ filename: "payments.csv", csv: paymentsToCsv(payments), count: payments.length });
  } catch (e: any) {
    res.status(400).json({ error: String(e.message || e).replace(/^Error: /, "") });
  }
}
