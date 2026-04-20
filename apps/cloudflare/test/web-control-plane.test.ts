import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

import {
  acquireHostedRunFromWeb,
  commitHostedRunToWeb,
  HostedWakeTerminalStaleFetchProofError,
  commitHostedWakeCursorToWeb,
  fetchHostedWakeBatchFromWeb,
  finalizeHostedRunInWeb,
  finalizeHostedWakeCursorInWeb,
  materializeHostedDueWakesInWeb,
  quarantineHostedWakeInWeb,
  readHostedRunStatusFromWeb,
  readHostedWakeStatusFromWeb,
  recordHostedRunLogInWeb,
  recordHostedWakeTerminalInWeb,
} from "../src/web-control-plane.ts";
import { appendHostedEmailIngressWakeInWeb } from "../src/web-control-plane-email-ingress.ts";

type ObservedRequest = { init?: RequestInit; url: string };
type HostedRunRecordFixture = {
  acquiredAt: string;
  attempt: number;
  committedAt: string | null;
  createdAt: string;
  errorClass: string | null;
  errorCode: string | null;
  eventCount: number;
  eventKinds: string[];
  eventSeqs: string[];
  executorKind: "cloudflare-container";
  failedAt: string | null;
  finalSnapshotRef: ReturnType<typeof createBundleRef> | null;
  finalizedAt: string | null;
  id: string;
  inputCommittedSeq: string;
  inputCursorVersion: string;
  inputSnapshotRef: ReturnType<typeof createBundleRef> | null;
  nextRuntimeWakeAt: string | null;
  nextRuntimeWakeReason: string | null;
  outputCommittedSeq: string | null;
  outputCursorVersion: string | null;
  preparedAt: string | null;
  preparedSnapshotRef: ReturnType<typeof createBundleRef> | null;
  redactedSummary: Record<string, unknown> | null;
  startedAt: string | null;
  status: string;
  triggerKind: "runtime_timer";
  updatedAt: string;
  userId: string;
  wakeIds: string[];
};

describe("cloudflare web control plane wake helpers", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockReset();
  });

  it("logs non-OK wake fetch responses with safe response details", async () => {
    const fetchMock = vi.fn(async () => new Response("control-plane down", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 503,
    }));

    await expect(fetchHostedWakeBatchFromWeb({
      baseUrl: "https://runner.example.test/root/",
      boundUserId: "user_123",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 2_500,
    })).rejects.toThrow(/Hosted wake batch fetch failed with HTTP 503/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted wake batch fetch",
          path: "/api/internal/hosted-wake/unseen",
          responseDetail: "control-plane down",
          responseStatus: 503,
          userId: "user_123",
        },
        level: "warn",
        message: "Hosted web control-plane response returned non-OK.",
        phase: "side-effects.draining",
        userId: "user_123",
      }),
    );
  });

  it("logs email ingress append failures before surfacing them", async () => {
    const fetchMock = vi.fn(async () => new Response("append rejected", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 502,
    }));

    await expect(appendHostedEmailIngressWakeInWeb({
      baseUrl: "https://runner.example.test/root/",
      body: {
        eventId: "evt_123",
        identityId: null,
        occurredAt: "2026-04-17T00:00:00.000Z",
        rawMessageKey: "raw_123",
      },
      boundUserId: "user_123",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 2_500,
    })).rejects.toThrow(/Hosted email ingress wake append failed with HTTP 502/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          description: "Hosted email ingress wake append",
          path: "/api/internal/hosted-wake/email-ingress",
          responseStatus: 502,
          userId: "user_123",
        },
        level: "warn",
        message: "Hosted email ingress control-plane response returned non-OK.",
        phase: "side-effects.draining",
        userId: "user_123",
      }),
    );
  });

  it("fetches hosted wake batches from the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      fetchHostedWakeBatchFromWeb({
        baseUrl: "https://runner.example.test/root/",
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              cursor: {
                committedSeq: "24",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextSeq: "25",
                snapshotRef: null,
                updatedAt: "2026-04-17T00:00:00.000Z",
                userId: "user_123",
                version: "4",
              },
              wakes: [],
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        limit: 128,
        timeoutMs: 2_500,
      }),
    ).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "user_123",
        version: "4",
      },
      wakes: [],
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-wake/unseen",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request.init?.body))).toEqual({
      limit: 128,
    });
  });

  it("commits the hosted wake cursor through the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;
    const snapshotRef = createBundleRef("wake_24");

    await expect(
      commitHostedWakeCursorToWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          assistantNextWakeAt: "2026-04-17T02:00:00.000Z",
          committedSeq: "24",
          expectedVersion: "3",
          snapshotRef,
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              committed: true,
              cursor: {
                committedSeq: "24",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextSeq: "25",
                snapshotRef,
                updatedAt: "2026-04-17T00:00:00.000Z",
                userId: "user_123",
                version: "4",
              },
              finalizeToken: "finalize_token_24",
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toEqual({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "user_123",
        version: "4",
      },
      finalizeToken: "finalize_token_24",
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-wake/commit",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request.init?.body))).toEqual({
      assistantNextWakeAt: "2026-04-17T02:00:00.000Z",
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef,
    });
  });

  it("finalizes the hosted wake cursor through the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;
    const snapshotRef = createBundleRef("wake_24_final");

    await expect(
      finalizeHostedWakeCursorInWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          assistantNextWakeAt: "2026-04-17T03:00:00.000Z",
          finalizeToken: "finalize_token_24",
          snapshotRef,
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              cursor: {
                committedSeq: "24",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextSeq: "25",
                snapshotRef,
                updatedAt: "2026-04-17T00:00:01.000Z",
                userId: "user_123",
                version: "5",
              },
              finalized: true,
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "user_123",
        version: "5",
      },
      finalized: true,
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-wake/finalize",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request.init?.body))).toEqual({
      assistantNextWakeAt: "2026-04-17T03:00:00.000Z",
      finalizeToken: "finalize_token_24",
      snapshotRef,
    });
  });

  it("materializes hosted due wakes without sending DO-local hints", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      materializeHostedDueWakesInWeb({
        baseUrl: "https://runner.example.test/root/",
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              targetSeqHint: "24",
              wakeMaterializationHints: {
                assistantWakeAt: "2026-04-17T02:00:00.000Z",
              },
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toEqual({
      targetSeqHint: "24",
      wakeMaterializationHints: {
        assistantWakeAt: "2026-04-17T02:00:00.000Z",
      },
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-wake/materialize",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBeNull();
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expect(request.init?.body).toBeUndefined();
  });

  it("records hosted wake quarantine requests with the fetched wake proof", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      quarantineHostedWakeInWeb({
        baseUrl: "https://runner.example.test/root/",
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              quarantined: true,
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        fetchProof: "proof_24",
        quarantineCode: "invalid-wake-payload",
        timeoutMs: 2_500,
        wakeId: "wake_24",
        wakeSeq: "24",
      }),
    ).resolves.toEqual({
      quarantined: true,
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-wake/quarantine",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request.init?.body))).toEqual({
      fetchProof: "proof_24",
      quarantineCode: "invalid-wake-payload",
      wakeId: "wake_24",
      wakeSeq: "24",
    });
  });

  it("records hosted wake terminal receipts through the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      recordHostedWakeTerminalInWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          fetchProof: "proof_24",
          state: "completed",
          wakeId: "wake_24",
          wakeSeq: "24",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              recorded: true,
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toEqual({
      recorded: true,
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-wake/terminal",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request.init?.body))).toEqual({
      fetchProof: "proof_24",
      state: "completed",
      wakeId: "wake_24",
      wakeSeq: "24",
    });
  });

  it("surfaces stale hosted wake terminal receipts as a dedicated error", async () => {
    await expect(
      recordHostedWakeTerminalInWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          fetchProof: "proof_24",
          state: "completed",
          wakeId: "wake_24",
          wakeSeq: "24",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async () => new Response(
          JSON.stringify({
            error: {
              code: "HOSTED_WAKE_FETCH_PROOF_STALE",
              message: "Hosted wake fetch proof is stale.",
            },
          }),
          {
            headers: { "content-type": "application/json; charset=utf-8" },
            status: 409,
          },
        )) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).rejects.toBeInstanceOf(HostedWakeTerminalStaleFetchProofError);
  });

  it("reads canonical hosted wake status from the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      readHostedWakeStatusFromWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          eventId: "evt_tick",
          fetchProof: "proof_24",
          wakeEventId: "evt_tick",
          wakeId: "wake_24",
          wakeSeq: "24",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              cursor: {
                committedSeq: "24",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextSeq: "26",
                snapshotRef: null,
                updatedAt: "2026-04-17T00:00:00.000Z",
                userId: "user_123",
                version: "4",
              },
              fetchProofCurrent: false,
              replacedByEventId: "evt_tick_new",
              wakeState: "queued",
              pendingWakeCount: 1,
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "26",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "user_123",
        version: "4",
      },
      fetchProofCurrent: false,
      replacedByEventId: "evt_tick_new",
      wakeState: "queued",
      pendingWakeCount: 1,
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-wake/status",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      eventId: "evt_tick",
      fetchProof: "proof_24",
      wakeEventId: "evt_tick",
      wakeId: "wake_24",
      wakeSeq: "24",
    });
  });

  it("acquires hosted runs through the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      acquireHostedRunFromWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          executorKind: "cloudflare-container",
          limit: 5,
          triggerKind: "runtime_timer",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              acquired: true,
              cursor: {
                committedSeq: "24",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
                nextRuntimeWakeReason: "assistant.run",
                nextSeq: "25",
                snapshotRef: null,
                updatedAt: "2026-04-17T00:00:00.000Z",
                userId: "user_123",
                version: "4",
              },
              events: [],
              pendingWakeCount: 0,
              resumeFinalize: false,
              run: createHostedRunRecord(),
              runToken: "run_token_123",
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toEqual({
      acquired: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
        nextRuntimeWakeReason: "assistant.run",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:00.000Z",
        userId: "user_123",
        version: "4",
      },
      events: [],
      pendingWakeCount: 0,
      resumeFinalize: false,
      run: createHostedRunRecord(),
      runToken: "run_token_123",
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/api/internal/hosted-run/acquire",
    );
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      executorKind: "cloudflare-container",
      limit: 5,
      triggerKind: "runtime_timer",
    });
  });

  it("commits and finalizes hosted runs through the web control plane", async () => {
    let observedCommitRequest: ObservedRequest | null = null;
    let observedFinalizeRequest: ObservedRequest | null = null;
    const snapshotRef = createBundleRef("run_25");

    await expect(
      commitHostedRunToWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          eventResults: [
            {
              quarantineCode: null,
              state: "completed",
              wakeId: "wake_25",
            },
          ],
          expectedCursorVersion: "4",
          finalizeRequired: true,
          nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
          nextRuntimeWakeReason: "assistant.run",
          outputCommittedSeq: "25",
          preparedSnapshotRef: snapshotRef,
          redactedSummary: { stage: "prepared" },
          runId: "run-1",
          runToken: "run_token_123",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedCommitRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              committed: true,
              cursor: {
                committedSeq: "25",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextSeq: "26",
                snapshotRef,
                updatedAt: "2026-04-17T00:00:01.000Z",
                userId: "user_123",
                version: "5",
              },
              needsFinalize: true,
              run: createHostedRunRecord({
                outputCommittedSeq: "25",
                outputCursorVersion: "5",
                preparedSnapshotRef: snapshotRef,
              }),
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toMatchObject({
      committed: true,
      needsFinalize: true,
    });

    await expect(
      finalizeHostedRunInWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          finalSnapshotRef: snapshotRef,
          nextRuntimeWakeAt: "2026-04-17T03:00:00.000Z",
          nextRuntimeWakeReason: "assistant.run",
          redactedSummary: { stage: "finalized" },
          runId: "run-1",
          runToken: "run_token_123",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedFinalizeRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              cursor: {
                committedSeq: "25",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextSeq: "26",
                snapshotRef,
                updatedAt: "2026-04-17T00:00:02.000Z",
                userId: "user_123",
                version: "6",
              },
              finalized: true,
              run: createHostedRunRecord({
                finalSnapshotRef: snapshotRef,
                finalizedAt: "2026-04-17T00:00:02.000Z",
                outputCommittedSeq: "25",
                outputCursorVersion: "6",
                preparedSnapshotRef: snapshotRef,
                status: "finalized",
              }),
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toMatchObject({
      finalized: true,
    });

    const commitRequest = requireObservedRequest(observedCommitRequest);
    expect(commitRequest.url).toBe(
      "https://runner.example.test/api/internal/hosted-run/commit",
    );
    expect(JSON.parse(String(commitRequest.init?.body))).toEqual({
      eventResults: [
        {
          quarantineCode: null,
          state: "completed",
          wakeId: "wake_25",
        },
      ],
      expectedCursorVersion: "4",
      finalizeRequired: true,
      nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      outputCommittedSeq: "25",
      preparedSnapshotRef: snapshotRef,
      redactedSummary: { stage: "prepared" },
      runId: "run-1",
      runToken: "run_token_123",
    });

    const finalizeRequest = requireObservedRequest(observedFinalizeRequest);
    expect(finalizeRequest.url).toBe(
      "https://runner.example.test/api/internal/hosted-run/finalize",
    );
    expect(JSON.parse(String(finalizeRequest.init?.body))).toEqual({
      finalSnapshotRef: snapshotRef,
      nextRuntimeWakeAt: "2026-04-17T03:00:00.000Z",
      nextRuntimeWakeReason: "assistant.run",
      redactedSummary: { stage: "finalized" },
      runId: "run-1",
      runToken: "run_token_123",
    });
  });

  it("records hosted run logs and reads hosted run status through the web control plane", async () => {
    let observedLogRequest: ObservedRequest | null = null;
    let observedStatusRequest: ObservedRequest | null = null;

    await expect(
      recordHostedRunLogInWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          at: "2026-04-17T00:00:00.000Z",
          component: "runtime",
          level: "info",
          message: "prepared snapshot",
          phase: "prepare",
          redacted: { stage: "prepared" },
          runId: "run-1",
          runToken: "run_token_123",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedLogRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              logged: true,
              log: {
                at: "2026-04-17T00:00:00.000Z",
                component: "runtime",
                createdAt: "2026-04-17T00:00:00.000Z",
                id: "log-1",
                level: "info",
                message: "prepared snapshot",
                phase: "prepare",
                redacted: { stage: "prepared" },
                runId: "run-1",
                userId: "user_123",
              },
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toMatchObject({
      logged: true,
    });

    await expect(
      readHostedRunStatusFromWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          includeLogs: true,
          limit: 3,
          runId: "run-1",
        },
        boundUserId: "user_123",
        fetchImpl: vi.fn(async (url, init) => {
          observedStatusRequest = { init, url: String(url) };
          return new Response(
            JSON.stringify({
              cursor: {
                committedSeq: "25",
                createdAt: "2026-04-17T00:00:00.000Z",
                nextSeq: "26",
                snapshotRef: null,
                updatedAt: "2026-04-17T00:00:02.000Z",
                userId: "user_123",
                version: "6",
              },
              logs: [
                {
                  at: "2026-04-17T00:00:00.000Z",
                  component: "runtime",
                  createdAt: "2026-04-17T00:00:00.000Z",
                  id: "log-1",
                  level: "info",
                  message: "prepared snapshot",
                  phase: "prepare",
                  redacted: { stage: "prepared" },
                  runId: "run-1",
                  userId: "user_123",
                },
              ],
              pendingWakeCount: 0,
              run: createHostedRunRecord({
                outputCommittedSeq: "25",
                outputCursorVersion: "6",
              }),
              runs: [createHostedRunRecord()],
            }),
            {
              headers: { "content-type": "application/json; charset=utf-8" },
              status: 200,
            },
          );
        }) as typeof fetch,
        timeoutMs: 2_500,
      }),
    ).resolves.toMatchObject({
      pendingWakeCount: 0,
    });

    const logRequest = requireObservedRequest(observedLogRequest);
    expect(logRequest.url).toBe(
      "https://runner.example.test/api/internal/hosted-run/log",
    );
    expect(JSON.parse(String(logRequest.init?.body))).toEqual({
      at: "2026-04-17T00:00:00.000Z",
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      redacted: { stage: "prepared" },
      runId: "run-1",
      runToken: "run_token_123",
    });

    const statusRequest = requireObservedRequest(observedStatusRequest);
    expect(statusRequest.url).toBe(
      "https://runner.example.test/api/internal/hosted-run/status",
    );
    expect(JSON.parse(String(statusRequest.init?.body))).toEqual({
      includeLogs: true,
      limit: 3,
      runId: "run-1",
    });
  });
});

function requireObservedRequest(request: ObservedRequest | null): ObservedRequest {
  if (!request) {
    throw new Error("Expected the fetch mock to capture a request.");
  }

  return request;
}

function createBundleRef(id: string) {
  return {
    hash: `hash-${id}`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: "2026-04-17T00:00:00.000Z",
  };
}

function createHostedRunRecord(
  overrides: Partial<HostedRunRecordFixture> = {},
) {
  return {
    ...createHostedRunRecordBase(),
    ...overrides,
  };
}

function createHostedRunRecordBase(): HostedRunRecordFixture {
  return {
    acquiredAt: "2026-04-17T00:00:00.000Z",
    attempt: 1,
    committedAt: "2026-04-17T00:00:02.000Z",
    createdAt: "2026-04-17T00:00:00.000Z",
    errorClass: null,
    errorCode: null,
    eventCount: 1,
    eventKinds: ["assistant.cron.tick"],
    eventSeqs: ["24"],
    executorKind: "cloudflare-container",
    failedAt: null,
    finalSnapshotRef: null,
    finalizedAt: null,
    id: "run-1",
    inputCommittedSeq: "24",
    inputCursorVersion: "4",
    inputSnapshotRef: null,
    nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
    nextRuntimeWakeReason: "assistant.run",
    outputCommittedSeq: null,
    outputCursorVersion: null,
    preparedAt: "2026-04-17T00:00:01.000Z",
    preparedSnapshotRef: null,
    redactedSummary: { stage: "prepared" },
    startedAt: "2026-04-17T00:00:00.500Z",
    status: "acquired",
    triggerKind: "runtime_timer",
    updatedAt: "2026-04-17T00:00:02.000Z",
    userId: "user_123",
    wakeIds: ["wake_25"],
  };
}
