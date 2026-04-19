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
  HostedWakeTerminalStaleFetchProofError,
  commitHostedWakeCursorToWeb,
  fetchHostedWakeBatchFromWeb,
  finalizeHostedWakeCursorInWeb,
  materializeHostedDueWakesInWeb,
  quarantineHostedWakeInWeb,
  readHostedWakeStatusFromWeb,
  recordHostedWakeTerminalInWeb,
} from "../src/web-control-plane.ts";
import { appendHostedEmailIngressWakeInWeb } from "../src/web-control-plane-email-ingress.ts";

type ObservedRequest = { init?: RequestInit; url: string };

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
