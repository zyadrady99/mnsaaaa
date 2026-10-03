import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";
function secret() {
  const value = process.env.APP_SECRET;
  if (!value || !/^[0-9a-f]{64}$/.test(value))
    throw new Error("Application key unavailable.");
  return Buffer.from(value, "hex");
}
export function keyedHash(scope: string, value: string) {
  return createHmac("sha256", secret()).update(`${scope}:${value}`).digest();
}
export function seal(value: string, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secret(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
export function unseal(value: Buffer, context: string) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret(),
    value.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([
    decipher.update(value.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newCode() {
  const chars = Array.from(
    { length: 24 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
  return `DRS-${chars.slice(0, 8)}-${chars.slice(8, 16)}-${chars.slice(16)}`;
}
export function normalizedCode(value: unknown) {
  if (typeof value !== "string" || value.length > 100) return null;
  const code = value.normalize("NFKC").replace(/[\s-]/g, "").toUpperCase();
  return /^DRS[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{24}$/.test(code) ? code : null;
}
