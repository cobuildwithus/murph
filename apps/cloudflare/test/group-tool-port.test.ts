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
import {
  HostedWebControlPlaneResponseError,
} from "../src/runtime-platform/web-control-transport.ts";

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

  it("exact-replays one retryable Ask under the original total timeout budget", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetchHostedWebControlPlaneJson
      .mockImplementationOnce(async () => {
        now = 2_500;
        throw new Error("Hosted group tool request failed.");
      })
      .mockResolvedValueOnce({
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
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(2);
    expect(mocks.fetchHostedWebControlPlaneJson.mock.calls.map(
      ([input]) => input.timeoutMs,
    )).toEqual([5_000, 3_500]);
    expect(mocks.fetchHostedWebControlPlaneJson.mock.calls.map(
      ([input]) => input.body,
    )).toEqual([askRequest, askRequest]);
  });

  it("exact-replays one retryable member Ask", async () => {
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
    mocks.fetchHostedWebControlPlaneJson
      .mockRejectedValueOnce(new HostedWebControlPlaneResponseError({
        description: "Hosted group tool",
        status: 503,
      }))
      .mockResolvedValueOnce({
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
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(2);
    expect(mocks.fetchHostedWebControlPlaneJson.mock.calls.map(
      ([input]) => input.body,
    )).toEqual([request, request]);
  });

  it("returns the second retryable Ask failure after exactly one replay", async () => {
    const firstFailure = new Error("Hosted group tool request failed.");
    const secondFailure = new HostedWebControlPlaneResponseError({
      description: "Hosted group tool",
      status: 502,
    });
    mocks.fetchHostedWebControlPlaneJson
      .mockRejectedValueOnce(firstFailure)
      .mockRejectedValueOnce(secondFailure);
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl: vi.fn<typeof fetch>(),
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(askRequest)).rejects.toBe(secondFailure);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(2);
    expect(mocks.fetchHostedWebControlPlaneJson.mock.calls.map(
      ([input]) => input.body,
    )).toEqual([askRequest, askRequest]);
  });

  it("does not replay authority failures or unrelated group mutations", async () => {
    const authorityFailure = new HostedWebControlPlaneResponseError({
      description: "Hosted group tool",
      status: 401,
    });
    mocks.fetchHostedWebControlPlaneJson.mockRejectedValue(authorityFailure);
    const port = createHostedRuntimeGroupToolPort({
      boundUserId: "member-bound",
      fetchImpl: vi.fn<typeof fetch>(),
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request(askRequest)).rejects.toBe(authorityFailure);
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(1);

    mocks.fetchHostedWebControlPlaneJson.mockClear();
    mocks.fetchHostedWebControlPlaneJson.mockRejectedValue(
      new Error("Hosted group tool request failed."),
    );
    await expect(port.request({ action: "read_current" })).rejects.toThrow(
      "Hosted group tool request failed.",
    );
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledTimes(1);
  });
});
