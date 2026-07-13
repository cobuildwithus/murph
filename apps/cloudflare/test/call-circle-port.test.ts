import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_CALL_CIRCLE_RESPOND_PATH,
} from "@murphai/hosted-execution/call-circle";

const mocks = vi.hoisted(() => ({
  fetchReplaySafeHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime-platform/web-control-transport.ts")>(
    "../src/runtime-platform/web-control-transport.ts",
  );

  return {
    ...actual,
    fetchReplaySafeHostedWebControlPlaneJson: mocks.fetchReplaySafeHostedWebControlPlaneJson,
  };
});

import { createHostedWebCallCirclePort } from "../src/runtime-platform/call-circle-port.ts";

describe("createHostedWebCallCirclePort", () => {
  beforeEach(() => {
    mocks.fetchReplaySafeHostedWebControlPlaneJson.mockReset();
  });

  it("posts Call Circle responses through the bounded web-control route", async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });
    const signal = AbortSignal.timeout(1_000);
    const transport = { mode: "proxy" as const };
    mocks.fetchReplaySafeHostedWebControlPlaneJson.mockResolvedValue({ status: "ok" });

    const port = createHostedWebCallCirclePort({
      boundUserId: "member_123",
      fetchImpl,
      timeoutMs: 5_000,
      transport,
    });

    await expect(port.respond({
      kind: "confirm",
    }, {
      inboundMailboxItemIds: ["mailbox_reply"],
      selfMemberName: "Sam",
      signal,
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.fetchReplaySafeHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: {
        context: {
          inboundMailboxItemIds: ["mailbox_reply"],
          selfMemberName: "Sam",
        },
        request: {
          kind: "confirm",
        },
      },
      boundUserId: "member_123",
      description: "Hosted Call Circle response",
      fetchImpl,
      method: "POST",
      path: HOSTED_CALL_CIRCLE_RESPOND_PATH,
      signal,
      timeoutMs: 5_000,
      transport,
    });
  });
});
