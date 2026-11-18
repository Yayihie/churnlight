// Open-core license gate — signed Ed25519 license keys.
// The code for Pro features lives in this repo (open source), but the
// features unlock with a paid license key. Standard open-core model.
//   Free:  local web app, CSV ingest, manual digests, all rules.
//   Pro:   Stripe auto-connect, scheduled Monday email delivery, hosted.
import * as crypto from "node:crypto";

// Public key of the Churnlight license signer. Private key is held by us.
// Anyone can verify a key; nobody can forge one.
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAwWkaGnN3V+2KZgRJVDWJO6pu8xjfpjuM0hCtWUUzepU=
-----END PUBLIC KEY-----`;

export interface LicenseInfo {
  valid: boolean;
  tier: "pro" | "invalid";
  customer?: string;
  expires?: string; // ISO date
  error?: string;
}

export function verifyLicense(key: string): LicenseInfo {
  if (!key) return { valid: false, tier: "invalid", error: "No license key" };
  const [payloadB64, sigB64] = key.split(".");
  if (!payloadB64 || !sigB64) return { valid: false, tier: "invalid", error: "Malformed key" };
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    const sig = Buffer.from(sigB64, "base64url");
    const ok = crypto.verify(null, Buffer.from(payloadB64), {
      key: LICENSE_PUBLIC_KEY, format: "pem", type: "spki",
    }, sig);
    if (!ok) return { valid: false, tier: "invalid", error: "Invalid signature" };
    if (payload.expires && new Date(payload.expires) < new Date())
      return { valid: false, tier: "invalid", error: `Expired ${payload.expires}` };
    return { valid: true, tier: "pro", customer: payload.customer, expires: payload.expires };
  } catch (e) {
    return { valid: false, tier: "invalid", error: String(e) };
  }
}

export function getLicense(): LicenseInfo {
  return verifyLicense(process.env.CHURNLIGHT_LICENSE_KEY || "");
}
