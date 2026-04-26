import crypto from "node:crypto";

const DASHBOARD_TOKEN_PREFIX = "misterb-dash-";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function getSecret() {
  return process.env.JWT_SECRET || process.env.DASHBOARD_TOKEN_SECRET || "";
}

function timingSafeEqualString(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // length-leak avoidance: still consume time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function buildDashboardToken(ttlMs: number = DEFAULT_TTL_MS) {
  const secret = getSecret();
  if (!secret) {
    throw new Error("JWT_SECRET (or DASHBOARD_TOKEN_SECRET) must be set to issue dashboard tokens");
  }
  const expiresAt = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${expiresAt}:${nonce}`;
  const signature = sign(payload, secret);
  return `${DASHBOARD_TOKEN_PREFIX}${payload}:${signature}`;
}

export function isDashboardTokenValid(token?: string) {
  if (!token || !token.startsWith(DASHBOARD_TOKEN_PREFIX)) return false;
  const secret = getSecret();
  if (!secret) return false;

  const stripped = token.slice(DASHBOARD_TOKEN_PREFIX.length);
  const parts = stripped.split(":");
  if (parts.length !== 3) return false;

  const [expiresAtRaw, nonce, providedSig] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!nonce || !providedSig) return false;

  const expectedSig = sign(`${expiresAtRaw}:${nonce}`, secret);
  return timingSafeEqualString(expectedSig, providedSig);
}

export function verifyDashboardPassword(supplied: string) {
  const expected = process.env.DASHBOARD_PASSWORD || "";
  if (!expected) return false;
  return timingSafeEqualString(expected, supplied);
}
