import { afterEach, describe, expect, it } from "vitest";

import { HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH } from "@murphai/hosted-execution/routes";
import { createHostedRuntimePlanUsageToolPort } from "../src/runtime-platform/plan-usage-tool-port.ts";
import {
  startHostedWebControlStub,
  type HostedWebControlStub,
} from "./helpers/hosted-web-control-support.js";

let webControl: HostedWebControlStub | null = null;

afterEach(async () => {
  await webControl?.stop();
  webControl = null;
});

describe("hosted plan usage tool port", () => {
  it.each([
    { remainingPercent: 75, status: "active", usedPercent: 25 },
    { remainingPercent: 0, status: "exhausted", usedPercent: 100 },
  ] as const)(
    "accepts a $status non-expiring Starter response over the signed adapter",
    async ({ remainingPercent, status, usedPercent }) => {
      webControl = await startHostedWebControlStub({
        respond: () => ({
          body: {
            accessKind: "starter",
            forecast: null,
            generatedAt: "2026-08-10T12:00:00.000Z",
            periodEnd: "9999-12-31T23:59:59.999Z",
            periodKind: "lifetime",
            periodStart: "2026-08-10T00:00:00.000Z",
            planCode: "launch_group_monthly",
            planName: "Starter",
            recommendedAction: null,
            remainingPercent,
            status,
            usedPercent,
          },
        }),
      });
      const port = createHostedRuntimePlanUsageToolPort({
        boundUserId: "member_bound",
        fetchImpl: fetch,
        timeoutMs: 2_000,
        transport: webControl.transport,
      });

      await expect(port.read({})).resolves.toMatchObject({
        accessKind: "starter",
        periodKind: "lifetime",
        planName: "Starter",
        remainingPercent,
        status,
        usedPercent,
      });
    },
  );

  it("signs the real HTTP request and validates the Web response", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          accessKind: "paid",
          forecast: null,
          generatedAt: "2026-07-03T12:00:00.000Z",
          periodEnd: "2026-08-01T00:00:00.000Z",
          periodKind: "monthly",
          periodStart: "2026-07-01T00:00:00.000Z",
          planCode: "launch_monthly",
          planName: "Pulse",
          recommendedAction: null,
          remainingPercent: 50,
          status: "active",
          subscriptionActionQuote: {
            action: "change_plan",
            expiresAt: "2026-07-03T12:10:00.000Z",
            label: "Upgrade to Edge ($20/month)",
            monthlyPriceUsdCents: 2_000,
            quoteId: "quote_test_edge",
            targetPlanCode: "launch_edge_monthly",
            timing: "immediate",
          },
          usedPercent: 50,
        },
      }),
    });
    const port = createHostedRuntimePlanUsageToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });

    await expect(port.read({
      includeSubscriptionActionQuote: true,
    })).resolves.toMatchObject({
      planName: "Pulse",
      usedPercent: 50,
    });

    expect(webControl.observedRequests).toHaveLength(1);
    expect(webControl.observedRequests[0]).toMatchObject({
      body: JSON.stringify({ includeSubscriptionActionQuote: true }),
      keyId: "v1",
      method: "POST",
      url: HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
      userId: "member_bound",
    });
    expect(webControl.observedRequests[0]?.nonce).toMatch(/^[0-9a-f]{32}$/u);
    expect(webControl.observedRequests[0]?.signature).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(webControl.observedRequests[0]?.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T/u,
    );
  });

  it("preserves a non-OK Web status across the real HTTP transport", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          error: {
            code: "HOSTED_PLAN_USAGE_TEMPORARILY_UNAVAILABLE",
            message: "Try again shortly.",
            retryable: true,
          },
        },
        status: 503,
      }),
    });
    const port = createHostedRuntimePlanUsageToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });

    await expect(port.read({})).rejects.toMatchObject({
      retryable: true,
      status: 503,
      statusCode: 503,
    });
  });

  it("rejects an invalid control-plane response", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          status: "active",
          usedPercent: 150,
        },
      }),
    });
    const port = createHostedRuntimePlanUsageToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });

    await expect(port.read({
      includeSubscriptionActionQuote: true,
    })).rejects.toThrow(
      "Hosted plan usage tool returned invalid JSON.",
    );
  });
});
