import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
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

import { createHostedRuntimeAssistantAskPort } from "../src/runtime-platform/assistant-ask-port.ts";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";

describe("Hosted Assistant Ask control-plane port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allowlists only the exact POST control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
    })).toEqual({
      allowed: true,
      operation: "assistant_ask",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("forwards the opaque request id with cancellation and parses the bounded response", async () => {
    const signal = new AbortController().signal;
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "prepare",
      question: "What is today's workout?",
      status: "ready",
      targetLabel: "100 Club",
    });
    const port = createHostedRuntimeAssistantAskPort({
      boundUserId: "member-group-runtime",
      fetchImpl: vi.fn() as never,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({
      action: "prepare",
      requestId: "aask_req_one",
    }, { signal })).resolves.toEqual({
      action: "prepare",
      question: "What is today's workout?",
      status: "ready",
      targetLabel: "100 Club",
    });

    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: { action: "prepare", requestId: "aask_req_one" },
      boundUserId: "member-group-runtime",
      description: "Hosted Assistant Ask control",
      fetchImpl: expect.any(Function),
      path: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
      sensitiveResponseBody: { maxBytes: 8_192 },
      signal,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });
  });

  it("rejects an invalid Web response instead of widening the port", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "prepare",
      question: "unbounded",
      status: "unexpected",
      targetLabel: null,
    });
    const port = createHostedRuntimeAssistantAskPort({
      boundUserId: "member-group-runtime",
      fetchImpl: vi.fn() as never,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({
      action: "prepare",
      requestId: "aask_req_one",
    })).rejects.toThrow("Hosted Assistant Ask control returned invalid JSON.");
  });
});
