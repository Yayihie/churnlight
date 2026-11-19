// Vercel serverless wrapper: public analyze API for tools and bots.
// POST { files: {name: csvText}, config?: partial RuleConfig } → the risk list JSON.
// Permissive CORS so external tools/scripts can call it from anywhere.
import { analyzeWeb, WebPayload } from "../analyze.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    res.status(204).end();
    return;
  }
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method !== "POST") { res.status(405).json({ error: "POST only — send { files: { \"accounts.csv\": \"...\" } }" }); return; }
  let body = "";
  await new Promise<void>((resolve) => {
    req.on("data", (c: string) => { body += c; if (body.length > 25_000_000) req.destroy(); });
    req.on("end", () => resolve());
  });
  try {
    const payload = JSON.parse(body || "{}") as WebPayload;
    const result = analyzeWeb(payload);
    res.status(200).json(result);
  } catch (e: any) {
    res.status(400).json({ error: String(e.message || e).replace(/^Error: /, "") });
  }
}
