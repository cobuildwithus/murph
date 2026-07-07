import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_CALL_CIRCLE_RESPOND_PATH,
} from "@murphai/hosted-execution/call-circle";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime-platform/web-control-transport.ts")>(
    "../src/runtime-platform/web-control-transport.ts",
  );

  return {
    ...actual,
    fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
  };
});

import { createHostedWebCallCirclePort } from "../src/runtime-platform/call-circle-port.ts";

describe("createHostedWebCallCirclePort", () => {
  beforeEach(() => {
    mocks.fetchHostedWebControlPlaneJson.mockReset();
  });

  it("posts Call Circle responses through the bounded web-control route", async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });
    const signal = AbortSignal.timeout(1_000);
    const transport = { mode: "proxy" as const };
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({ status: "ok" });

    const port = createHostedWebCallCirclePort({
      boundUserId: "member_123",
      fetchImpl,
      timeoutMs: 5_000,
      transport,
    });

    await expect(port.respond({
      groupId: "hgrp_123",
      kind: "confirm",
      matchId: "hccm_123",
      side: "A",
    }, {
      inboundMailboxItemIds: ["mailbox_reply"],
      signal,
    })).resolves.toEqual({ status: "ok" });

    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: {
        context: {
          inboundMailboxItemIds: ["mailbox_reply"],
        },
        request: {
          groupId: "hgrp_123",
          kind: "confirm",
          matchId: "hccm_123",
          side: "A",
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
