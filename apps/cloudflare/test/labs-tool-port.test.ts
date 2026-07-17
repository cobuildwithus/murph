import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_LABS_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
  parseHostedRuntimeLabsToolResponse: vi.fn(),
}));

vi.mock("@murphai/hosted-execution/labs", () => ({
  parseHostedRuntimeLabsToolResponse:
    mocks.parseHostedRuntimeLabsToolResponse,
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  createHostedRuntimeLabsToolPort,
} from "../src/runtime-platform/labs-tool-port.ts";

describe("hosted labs tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows only the bounded POST web-control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_LABS_TOOL_PATH,
    })).toEqual({
      allowed: true,
      operation: "labs_tool",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_LABS_TOOL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_LABS_TOOL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("posts the exact request with caller cancellation and a sensitive body cap", async () => {
    const upstreamPayload = { action: "search", items: [] };
    const parsedResponse = { parsed: true };
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue(upstreamPayload);
    mocks.parseHostedRuntimeLabsToolResponse.mockReturnValue(parsedResponse);
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const port = createHostedRuntimeLabsToolPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });
    const request = {
      action: "search" as const,
      limit: 5,
      query: "lipid",
    };

    await expect(port.request(request, {
      signal: controller.signal,
    })).resolves.toBe(parsedResponse);

    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: request,
      boundUserId: "member_bound",
      description: "Hosted labs tool",
      fetchImpl,
      method: "POST",
      path: HOSTED_RUNTIME_LABS_TOOL_PATH,
      sensitiveResponseBody: {
        maxBytes: 128 * 1024,
      },
      signal: controller.signal,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });
    expect(mocks.parseHostedRuntimeLabsToolResponse).toHaveBeenCalledWith(
      upstreamPayload,
    );
  });

  it("forwards an already-aborted caller signal", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.fetchHostedWebControlPlaneJson.mockImplementation(async (input) => {
      input.signal?.throwIfAborted();
      return null;
    });
    const port = createHostedRuntimeLabsToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({
      action: "show",
      labId: 12,
      providerId: "provider_123",
    }, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("rejects malformed responses without retaining parser payload details", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      privateProviderPayload: "must-not-escape",
    });
    mocks.parseHostedRuntimeLabsToolResponse.mockImplementation(() => {
      throw new Error("must-not-escape");
    });
    const port = createHostedRuntimeLabsToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    let thrown: unknown;
    try {
      await port.request({
        action: "show",
        labId: 12,
        providerId: "provider_123",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error)) {
      throw new Error("Expected the Labs port to reject a malformed response.");
    }
    expect(thrown.message).toBe("Hosted labs tool returned invalid JSON.");
    expect(thrown.cause).toBeUndefined();
    expect(thrown.message).not.toContain("must-not-escape");
  });
});
