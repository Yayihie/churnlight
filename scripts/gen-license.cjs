// Generates a real Ed25519 keypair, embeds the public key in license.ts,
// and writes two demo license keys (valid + expired) for tests.
// The private key is NOT written anywhere — it is discarded. Production
// keys are signed by the Churnlight maintainer's private key.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).trim();

const sign = (customer, tier, expires) => {
  const payload = JSON.stringify({ customer, tier, expires });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const sig = crypto.sign(null, Buffer.from(payloadB64), privateKey).toString("base64url");
  return payloadB64 + "." + sig;
};

const licensePath = path.join(__dirname, "..", "src", "license.ts");
const src = fs.readFileSync(licensePath, "utf8");
const next = src.replace(
  /export const LICENSE_PUBLIC_KEY = `[\s\S]*?`;/,
  "export const LICENSE_PUBLIC_KEY = `" + pub + "`;"
);
fs.writeFileSync(licensePath, next);

const root = path.join(__dirname, "..");
fs.writeFileSync(path.join(root, "demo-license.txt"), sign("demo-cs-team", "pro", "2027-11-25") + "\n");
fs.writeFileSync(path.join(root, "demo-license-expired.txt"), sign("old-customer", "pro", "2020-01-01") + "\n");

console.log("license.ts public key updated; demo-license.txt + demo-license-expired.txt written (" + pub.length + " char key)");
