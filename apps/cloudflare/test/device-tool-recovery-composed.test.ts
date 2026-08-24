import type {
  AssistantHostedDeviceToolRequest,
} from "@murphai/assistant-engine";
import {
  executeDeviceDynamicTool,
  type DeviceDynamicToolRequest,
} from "@murphai/assistant-engine/device-dynamic-tool";
import {
  createHostedAssistantDeviceTool,
} from "@murphai/assistant-runtime/hosted-device-tool";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedWebDeviceSyncPort,
} from "../src/runtime-platform/device-sync-port.ts";

const PRIVATE_SENTINEL = "private-device-control-plane-detail";

describe("hosted device tool recovery through the composed production path", () => {
  for (const testCase of [
    {
      failure: "timeout",
      fetchImpl: async () => {
        throw new DOMException(PRIVATE_SENTINEL, "TimeoutError");
      },
    },
    {
      failure: "network failure",
      fetchImpl: async () => {
        throw new TypeError(`fetch failed: ${PRIVATE_SENTINEL}`);
      },
    },
    {
      failure: "invalid successful response",
      fetchImpl: async () => Response.json({ private: PRIVATE_SENTINEL }),
    },
  ]) {
    it(`makes a list_accounts ${testCase.failure} safely recoverable`, async () => {
      const fetchMock = vi.fn(testCase.fetchImpl);
      const result = await executeThroughHostedDevicePath({
        action: "list_accounts",
        fetchImpl: fetchMock as typeof fetch,
      });

      expect(readToolError(result)).toEqual({
        code: "device_operation_unavailable",
        hint:
          "Retry list_accounts. If it repeats, treat device management as temporarily unavailable.",
        message: "The device operation could not be completed.",
        retryable: true,
        stage: "device-list-accounts",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
    });
  }

  it("preserves a known terminal reconcile 409", async () => {
    const result = await executeThroughHostedDevicePath({
      action: "reconcile",
      fetchImpl: async () => hostedErrorResponse({
        code: "ACCOUNT_DISCONNECTED",
        retryable: false,
        status: 409,
      }),
    });

    expect(readToolError(result)).toEqual({
      code: "ACCOUNT_DISCONNECTED",
      hint:
        "Run list_accounts again, then connect its provider before retrying reconcile.",
      message: "This device account must be reconnected before reconciliation.",
      retryable: false,
      stage: "device-reconcile",
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
  });

  it("preserves a known transient reconcile 503", async () => {
    const result = await executeThroughHostedDevicePath({
      action: "reconcile",
      fetchImpl: async () => hostedErrorResponse({
        code: "RECONCILE_WAKE_NOT_ACCEPTED",
        retryable: true,
        status: 503,
      }),
    });

    expect(readToolError(result)).toEqual({
      code: "RECONCILE_WAKE_NOT_ACCEPTED",
      hint: "Retry reconcile later for the same account.",
      message: "Device reconciliation could not be queued right now.",
      retryable: true,
      stage: "device-reconcile",
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
  });

  it("does not apply a known reconcile code to connect", async () => {
    const result = await executeThroughHostedDevicePath({
      action: "connect",
      fetchImpl: async () => hostedErrorResponse({
        code: "RECONCILE_WAKE_NOT_ACCEPTED",
        retryable: true,
        status: 503,
      }),
    });

    expect(readToolError(result)).toEqual({
      code: "device_operation_outcome_unknown",
      hint:
        "Run list_accounts and inspect the current account state before deciding whether to retry connect.",
      message: "The device operation completion could not be confirmed.",
      retryable: false,
      stage: "device-connect",
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
  });

  for (const action of ["connect", "reconcile"] as const) {
    it(`requires state inspection instead of blindly repeating an ambiguous ${action}`, async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError(`connection closed after request: ${PRIVATE_SENTINEL}`);
      });
      const result = await executeThroughHostedDevicePath({
        action,
        fetchImpl: fetchMock as typeof fetch,
      });

      expect(readToolError(result)).toEqual({
        code: "device_operation_outcome_unknown",
        hint:
          `Run list_accounts and inspect the current account state before deciding whether to retry ${action}.`,
        message: "The device operation completion could not be confirmed.",
        retryable: false,
        stage: `device-${action}`,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
    });
  }

  it("keeps caller cancellation distinct from transport recovery", async () => {
    const abortController = new AbortController();
    let markRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      const request = requestInput instanceof Request
        ? requestInput
        : new Request(requestInput, init);
      markRequestStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        const rejectForAbort = () => reject(request.signal.reason);
        if (request.signal.aborted) {
          rejectForAbort();
          return;
        }
        request.signal.addEventListener("abort", rejectForAbort, { once: true });
      });
    });

    const execution = executeThroughHostedDevicePath({
      abortSignal: abortController.signal,
      action: "list_accounts",
      fetchImpl: fetchMock as typeof fetch,
    });
    await requestStarted;
    abortController.abort(new DOMException(PRIVATE_SENTINEL, "AbortError"));
    const result = await execution;

    expect(readToolError(result)).toEqual({
      code: "device_operation_cancelled",
      hint: "Do not retry unless the member asks to continue.",
      message: "The device operation was cancelled.",
      retryable: false,
      stage: "device-list-accounts",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
  });
});

async function executeThroughHostedDevicePath(input: {
  abortSignal?: AbortSignal;
  action: AssistantHostedDeviceToolRequest["action"];
  fetchImpl: typeof fetch;
}) {
  const port = createHostedWebDeviceSyncPort({
    boundUserId: "member_device_tool_recovery",
    fetchImpl: input.fetchImpl,
    timeoutMs: 5_000,
    transport: { mode: "proxy" },
  });
  const deviceTool = createHostedAssistantDeviceTool({
    deviceConnectProviders: [{ label: "Synthetic", provider: "synthetic" }],
    deviceSyncPort: port,
  });
  const request = createDeviceRequest(input.action);
  return await executeDeviceDynamicTool({
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    deviceTool,
    request,
  });
}

function createDeviceRequest(
  action: AssistantHostedDeviceToolRequest["action"],
): Extract<DeviceDynamicToolRequest, { kind: "device" }> {
  if (action === "connect") {
    return {
      kind: "device",
      request: { action, provider: "synthetic" },
    };
  }
  if (action === "reconcile") {
    return {
      kind: "device",
      request: { accountId: "synthetic-account", action },
    };
  }
  return { kind: "device", request: { action } };
}

function hostedErrorResponse(input: {
  code: string;
  retryable: boolean;
  status: number;
}): Response {
  return Response.json({
    error: {
      code: input.code,
      message: PRIVATE_SENTINEL,
      retryable: input.retryable,
    },
  }, { status: input.status });
}

function readToolError(
  result: Awaited<ReturnType<typeof executeDeviceDynamicTool>>,
): {
  code: string;
  hint: string;
  message: string;
  retryable: boolean;
  stage: string;
} {
  const text = result.rpcResult.contentItems[0]?.text ?? "";
  const parsed = JSON.parse(text) as {
    error: {
      code: string;
      hint: string;
      message: string;
      retryable: boolean;
      stage: string;
    };
  };
  return parsed.error;
}
