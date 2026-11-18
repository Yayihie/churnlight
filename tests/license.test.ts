import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { verifyLicense } from "../src/license.js";

const ROOT = path.join(import.meta.dirname, "..");
const validKey = readFileSync(path.join(ROOT, "demo-license.txt"), "utf8").trim();
const expiredKey = readFileSync(path.join(ROOT, "demo-license-expired.txt"), "utf8").trim();

describe("open-core license gate", () => {
  it("accepts a genuinely signed license key", () => {
    const lic = verifyLicense(validKey);
    expect(lic.valid).toBe(true);
    expect(lic.tier).toBe("pro");
    expect(lic.customer).toBe("demo-cs-team");
    expect(lic.expires).toBe("2027-11-25");
  });

  it("rejects a tampered payload (signature check)", () => {
    const [payload, sig] = validKey.split(".");
    // swap customer in the payload — the signature no longer matches
    const forged = Buffer.from(JSON.stringify({ customer: "attacker", tier: "pro", expires: "2099-01-01" })).toString("base64url");
    const lic = verifyLicense(forged + "." + sig);
    expect(lic.valid).toBe(false);
    expect(lic.error).toBe("Invalid signature");
  });

  it("rejects a malformed key", () => {
    expect(verifyLicense("not-a-key").valid).toBe(false);
    expect(verifyLicense("").valid).toBe(false);
    expect(verifyLicense("abc.def").valid).toBe(false);
  });

  it("rejects an expired key", () => {
    const lic = verifyLicense(expiredKey);
    expect(lic.valid).toBe(false);
    expect(lic.error).toContain("Expired");
  });

  it("pro features refuse to run without a license", async () => {
    delete process.env.CHURNLIGHT_LICENSE_KEY; // the dev shell may still have one exported
    const { pullStripe } = await import("../src/pro.js");
    await expect(pullStripe("sk_test_fake")).rejects.toThrow(/Pro feature/);
  });
});
