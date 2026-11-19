// Vercel serverless wrapper: HubSpot one-click pull. The user's token rides
// in the request only; nothing is persisted.
import { pullHubSpot } from "../crm.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  let body = "";
  await new Promise<void>((resolve) => {
    req.on("data", (c: string) => { body += c; if (body.length > 500_000) req.destroy(); });
    req.on("end", () => resolve());
  });
  try {
    const { token } = JSON.parse(body || "{}");
    const files = await pullHubSpot(String(token || ""));
    res.status(200).json({ files });
  } catch (e: any) {
    res.status(400).json({ error: String(e.message || e).replace(/^Error: /, "") });
  }
}
