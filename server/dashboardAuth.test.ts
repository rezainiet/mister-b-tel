import { describe, expect, it, beforeEach } from "vitest";

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret-for-vitest-1234567890";
  process.env.DASHBOARD_PASSWORD = "1234";
});

describe("dashboard auth (HMAC-signed tokens)", () => {
  it("issues a token that round-trips through validation", async () => {
    const { buildDashboardToken, isDashboardTokenValid } = await import("./_core/dashboardAuth");
    const token = buildDashboardToken();
    expect(token.startsWith("misterb-dash-")).toBe(true);
    expect(isDashboardTokenValid(token)).toBe(true);
  });

  it("rejects unsigned strings that just have the prefix (the old vulnerability)", async () => {
    const { isDashboardTokenValid } = await import("./_core/dashboardAuth");
    expect(isDashboardTokenValid("misterb-dash-anything")).toBe(false);
    expect(isDashboardTokenValid("misterb-dash-123456789")).toBe(false);
    expect(isDashboardTokenValid("misterb-dash-")).toBe(false);
  });

  it("rejects tampered signatures", async () => {
    const { buildDashboardToken, isDashboardTokenValid } = await import("./_core/dashboardAuth");
    const token = buildDashboardToken();
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(isDashboardTokenValid(tampered)).toBe(false);
  });

  it("rejects expired tokens", async () => {
    const { buildDashboardToken, isDashboardTokenValid } = await import("./_core/dashboardAuth");
    const token = buildDashboardToken(-1000);
    expect(isDashboardTokenValid(token)).toBe(false);
  });

  it("rejects wrong-secret signatures", async () => {
    const { buildDashboardToken } = await import("./_core/dashboardAuth");
    const token = buildDashboardToken();
    process.env.JWT_SECRET = "different-secret-now-99999999999";
    const { isDashboardTokenValid } = await import("./_core/dashboardAuth");
    expect(isDashboardTokenValid(token)).toBe(false);
  });

  it("verifies password using timing-safe compare", async () => {
    const { verifyDashboardPassword } = await import("./_core/dashboardAuth");
    expect(verifyDashboardPassword("1234")).toBe(true);
    expect(verifyDashboardPassword("12345")).toBe(false);
    expect(verifyDashboardPassword("")).toBe(false);
  });
});
