import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_PATH,
} from "@murphai/hosted-execution/routes";

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

import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  createHostedRuntimeManagedGroupActivityDecisionPort,
} from "../src/runtime-platform/managed-group-activity-decision-port.ts";

describe("hosted managed group activity decision port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allowlists only the exact POST control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_PATH,
    })).toEqual({
      allowed: true,
      operation: "managed_group_activity_decision",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("forwards only the closed policy request with caller cancellation", async () => {
    const signal = new AbortController().signal;
    const request = {
      occurrenceAt: "2026-07-26T22:00:00.000Z",
      policy: "group-sunday-superlatives-v1" as const,
      route: {
        channel: "telegram" as const,
        target: "-100222333444",
      },
      timeZone: "America/New_York",
    };
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      status: "eligible",
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const port = createHostedRuntimeManagedGroupActivityDecisionPort({
      boundUserId: "member_group_runtime",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.read(request, { signal })).resolves.toEqual({
      status: "eligible",
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: request,
      boundUserId: "member_group_runtime",
      description: "Hosted managed group activity decision",
      fetchImpl,
      path: HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_PATH,
      signal,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });
  });

  it("rejects any response that widens the status-only boundary", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      count: 100,
      status: "eligible",
    });
    const port = createHostedRuntimeManagedGroupActivityDecisionPort({
      boundUserId: "member_group_runtime",
      fetchImpl: vi.fn<typeof fetch>(),
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.read({
      occurrenceAt: "2026-07-26T22:00:00.000Z",
      policy: "group-sunday-superlatives-v1",
      route: {
        channel: "linq",
        target: "chat_group_one",
      },
      timeZone: "America/New_York",
    })).rejects.toThrow(
      "Hosted managed group activity decision returned invalid JSON.",
    );
  });
});
