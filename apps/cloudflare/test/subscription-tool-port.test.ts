import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  createHostedRuntimeSubscriptionToolPort,
} from "../src/runtime-platform/subscription-tool-port.ts";
import {
  startHostedWebControlStub,
  type HostedWebControlStub,
} from "./helpers/hosted-web-control-support.js";

const ASSISTANT_INPUT_ID = `ain_${"b".repeat(32)}`;
let webControl: HostedWebControlStub | null = null;

afterEach(async () => {
  await webControl?.stop();
  webControl = null;
});

describe("hosted subscription tool port", () => {
  it("allows only the bounded POST web-control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
    })).toEqual({
      allowed: true,
      operation: "subscription_tool",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("sends one signed HTTP request and validates the Web-owned result", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          action: "continue_pulse",
          plan: {
            code: "launch_monthly",
            displayName: "Pulse",
            interval: "month",
            recurringAmountUsdCents: 800,
          },
          status: "no_action_required",
        },
      }),
    });
    const port = createHostedRuntimeSubscriptionToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });
    const request = {
      action: "continue_pulse" as const,
      assistantInputId: ASSISTANT_INPUT_ID,
    };

    await expect(port.request(request)).resolves.toEqual({
      action: "continue_pulse",
      plan: {
        code: "launch_monthly",
        displayName: "Pulse",
        interval: "month",
        recurringAmountUsdCents: 800,
      },
      status: "no_action_required",
    });

    expect(webControl.observedRequests).toHaveLength(1);
    expect(webControl.observedRequests[0]).toMatchObject({
      body: JSON.stringify(request),
      keyId: "v1",
      method: "POST",
      url: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
      userId: "member_bound",
    });
    expect(webControl.observedRequests[0]?.signature).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("rejects an invalid control-plane response", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          action: "upgrade_edge",
          paymentUrl: "https://billing.stripe.com/unneeded",
          plan: {
            code: "launch_edge_monthly",
            displayName: "Edge",
            interval: "month",
            recurringAmountUsdCents: 2_000,
          },
          status: "completed",
        },
      }),
    });
    const port = createHostedRuntimeSubscriptionToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });

    await expect(port.request({
      action: "upgrade_edge",
      assistantInputId: ASSISTANT_INPUT_ID,
    })).rejects.toThrow("Hosted subscription tool returned invalid JSON.");
  });
});
