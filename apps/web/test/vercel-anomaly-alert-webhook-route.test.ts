import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedVercelAnomalyWebhook: vi.fn(),
}));

vi.mock("@/src/lib/hosted-operational-alert/vercel-anomaly-webhook", () => ({
  handleHostedVercelAnomalyWebhook:
    mocks.handleHostedVercelAnomalyWebhook,
}));

type VercelAlertWebhookRoute =
  typeof import("../app/api/internal/vercel-alerts/webhook/route");

let route: VercelAlertWebhookRoute;

describe("hosted Vercel anomaly alert webhook route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/vercel-alerts/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleHostedVercelAnomalyWebhook.mockResolvedValue({
      alertCount: 1,
      ok: true,
      outcome: "sent",
    });
  });

  it("passes the exact raw body and Vercel signature into the handler", async () => {
    const rawBody = JSON.stringify({
      id: "evt_alert_123",
      type: "alerts.triggered",
    });
    const request = new Request(
      "https://www.example.test/api/internal/vercel-alerts/webhook",
      {
        body: rawBody,
        headers: {
          "x-vercel-signature": "signature_123",
        },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handleHostedVercelAnomalyWebhook).toHaveBeenCalledWith({
      rawBody,
      signal: request.signal,
      signature: "signature_123",
    });
    await expect(response.json()).resolves.toEqual({
      alertCount: 1,
      ok: true,
      outcome: "sent",
    });
  });

  it("rejects oversized bodies before calling the handler", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const request = new Request(
        "https://www.example.test/api/internal/vercel-alerts/webhook",
        {
          body: "{}",
          headers: {
            "content-length": String(64 * 1024 + 1),
            "x-vercel-signature": "signature_123",
          },
          method: "POST",
        },
      );

      const response = await route.POST(request);

      expect(response.status).toBe(413);
      expect(mocks.handleHostedVercelAnomalyWebhook).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "HOSTED_VERCEL_ALERT_WEBHOOK_BODY_TOO_LARGE",
          message: "Vercel alert webhook body is too large.",
          retryable: false,
        },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("{}");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("waits for Resend admission before acknowledging the webhook", async () => {
    let resolveHandler!: (value: {
      alertCount: number;
      ok: true;
      outcome: "sent";
    }) => void;
    mocks.handleHostedVercelAnomalyWebhook.mockReturnValueOnce(new Promise(
      (resolve) => {
        resolveHandler = resolve;
      },
    ));
    const request = new Request(
      "https://www.example.test/api/internal/vercel-alerts/webhook",
      {
        body: "{}",
        method: "POST",
      },
    );

    let settled = false;
    const responsePromise = route.POST(request).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveHandler({
      alertCount: 1,
      ok: true,
      outcome: "sent",
    });
    await expect(responsePromise).resolves.toMatchObject({
      status: 200,
    });
  });

  it("is event-driven rather than registered as another Vercel cron", async () => {
    const vercelConfig = JSON.parse(await readFile(
      new URL("../vercel.json", import.meta.url),
      "utf8",
    )) as { crons?: Array<{ path?: string }> };

    expect(vercelConfig.crons?.map(({ path }) => path)).not.toContain(
      "/api/internal/vercel-alerts/webhook",
    );
  });
});
