import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", async () => {
  const actual = await vi.importActual<
    typeof import("../src/runtime-platform/web-control-transport.ts")
  >("../src/runtime-platform/web-control-transport.ts");
  return {
    ...actual,
    fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
  };
});

import { createHostedRuntimeGroupToolPort } from "../src/runtime-platform/group-tool-port.ts";

const askRequest = {
  action: "ask" as const,
  groupLabel: "100 Club",
  originAssistantInputId: `ain_${"a".repeat(32)}`,
  originSessionId: "session_private",
  question: "What exercises are scheduled today?",
};

describe("hosted group tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks Ask as safe for one transport-owned exact replay", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "ask",
      result: {
        status: "accepted",
        targetLabel: "100 Club",
      },
    });
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl: vi.fn<typeof fetch>(),
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(askRequest)).resolves.toEqual({
      action: "ask",
      result: {
        status: "accepted",
        targetLabel: "100 Club",
      },
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
      expect.objectContaining({
        body: askRequest,
        replayOnceOnRetryableFailure: true,
        timeoutMs: 5_000,
      }),
    );
  });

  it("marks a member Ask as safe for one transport-owned exact replay", async () => {
    const request = {
      action: "ask_member" as const,
      grantId: "grant_sleep",
      origin: {
        assistantInputId: `ain_${"b".repeat(32)}`,
        kind: "accepted_input" as const,
        sessionId: "session_group",
      },
      question: "How has the grantor been sleeping lately?",
    };
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "ask_member",
      result: { status: "accepted" },
    });
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl: vi.fn<typeof fetch>(),
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(request)).resolves.toEqual({
      action: "ask_member",
      result: { status: "accepted" },
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
      expect.objectContaining({
        body: request,
        replayOnceOnRetryableFailure: true,
      }),
    );
  });

  it("does not mark unrelated group mutations as replay-safe", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockRejectedValue(
      new Error("Hosted group tool request failed."),
    );
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl: vi.fn<typeof fetch>(),
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({ action: "read_current" })).rejects.toThrow(
      "Hosted group tool request failed.",
    );
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { action: "read_current" },
        replayOnceOnRetryableFailure: false,
      }),
    );
  });
});
