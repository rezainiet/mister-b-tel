import { describe, expect, it } from "vitest";

describe("dashboard secret over HTTP", () => {
  const password = process.env.TEST_DASHBOARD_PASSWORD_OVERRIDE;
  const baseUrl = process.env.TEST_DASHBOARD_BASE_URL || "http://127.0.0.1:3000";

  it.skipIf(!password)("authentifie le dashboard avec le secret explicitement testé", async () => {
    const response = await fetch(`${baseUrl}/api/trpc/dashboard.login?batch=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        0: {
          json: {
            password,
          },
        },
      }),
    });

    expect(response.ok).toBe(true);

    const payload = (await response.json()) as Array<{
      result?: {
        data?: {
          json?: {
            success?: boolean;
            token?: string | null;
            error?: string;
          };
        };
      };
    }>;

    const result = payload[0]?.result?.data?.json;

    expect(result?.success).toBe(true);
    expect(result?.token).toMatch(/^misterb-dash-/);
  });
});
