import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog:
      mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  HOSTED_CONTAINER_RUNTIME_COMPLETION_TIMEOUT_MS,
  recordHostedContainerRuntimeCompletionBestEffort,
} from "../src/container-runtime-completion.ts";
import {
  CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT,
} from "../src/internal-hosts.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
} from "../src/runner-outbound/headers.ts";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("recordHostedContainerRuntimeCompletionBestEffort", () => {
  it("posts the terminal result with only the exact container authority", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => Response.json({ completed: true }),
    );
    const input = createCompletionInput();

    await expect(recordHostedContainerRuntimeCompletionBestEffort({
      ...input,
      fetchImpl,
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0];
    if (!call) {
      throw new Error("Expected the completion request.");
    }
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe(CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT);
    expect(request.method).toBe("POST");
    expect(Object.fromEntries(request.headers.entries())).toEqual({
      "content-type": "application/json; charset=utf-8",
      [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: input.job.request.userId,
      [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: input.job.request.attemptId,
      [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]:
        input.job.request.leaseGeneration,
    });
    await expect(request.json()).resolves.toEqual({ result: input.result });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "recorded",
        }),
        level: "info",
      }),
    );
  });

  it("reports a declined CAS as not recorded", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => Response.json({ completed: false }),
    );

    await expect(recordHostedContainerRuntimeCompletionBestEffort({
      ...createCompletionInput(),
      fetchImpl,
    })).resolves.toBeUndefined();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "not_recorded",
        }),
        level: "warn",
      }),
    );
  });

  it.each([
    {
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 404 }),
      ),
      name: "an unavailable route",
    },
    {
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 503 }),
      ),
      name: "a non-success response",
    },
    {
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error("completion transport unavailable");
      }),
      name: "a transport failure",
    },
  ])("preserves the completed result after $name", async ({ fetchImpl }) => {
    await expect(recordHostedContainerRuntimeCompletionBestEffort({
      ...createCompletionInput(),
      fetchImpl,
    })).resolves.toBeUndefined();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "not_recorded",
        }),
        level: "warn",
      }),
    );
  });

  it("hard-bounds a completion request that ignores its abort signal", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      async () => await new Promise<Response>(() => undefined),
    );
    const completion = recordHostedContainerRuntimeCompletionBestEffort({
      ...createCompletionInput(),
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(
      HOSTED_CONTAINER_RUNTIME_COMPLETION_TIMEOUT_MS,
    );

    await expect(completion).resolves.toBeUndefined();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "not_recorded",
        }),
      }),
    );
  });
});

function createCompletionInput() {
  return {
    job: {
      kind: "workspace-invocation" as const,
      request: {
        attemptId: "attempt_runtime_completion",
        leaseGeneration: "7",
        userId: "member_runtime_completion",
        workspaceVersion: "12",
      },
    },
    result: {
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 1,
      },
      status: "idle" as const,
    },
  };
}
