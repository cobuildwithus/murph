import { describe, expect, it, vi } from "vitest";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

import {
  commitHostedWakeCursorToWeb,
  fetchHostedWakeBatchFromWeb,
  quarantineHostedWakeInWeb,
  readHostedWakeStatusFromWeb,
  recordHostedWakeTerminalInWeb,
} from "../src/web-control-plane.ts";

type ObservedRequest = { init?: RequestInit; url: string };

describe("cloudflare web control plane wake helpers", () => {
  it("fetches hosted wake batches from the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      fetchHostedWakeBatchFromWeb({
        afterSeq: "12",
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
      afterSeq: "12",
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
      committedSeq: "24",
      expectedVersion: "3",
      snapshotRef,
    });
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

  it("reads canonical hosted wake status from the web control plane", async () => {
    let observedRequest: ObservedRequest | null = null;

    await expect(
      readHostedWakeStatusFromWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          eventId: "evt_tick",
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
