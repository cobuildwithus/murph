import { describe, expect, it, vi } from "vitest";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

import {
  commitHostedWakeCursorToWeb,
  fetchHostedWakeBatchFromWeb,
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

    await expect(
      commitHostedWakeCursorToWeb({
        baseUrl: "https://runner.example.test/root/",
        body: {
          committedSeq: "24",
          expectedVersion: "3",
          snapshotRef: {
            checkpoint: "wake_24",
          },
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
                snapshotRef: {
                  checkpoint: "wake_24",
                },
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
        snapshotRef: {
          checkpoint: "wake_24",
        },
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
      snapshotRef: {
        checkpoint: "wake_24",
      },
    });
  });
});

function requireObservedRequest(request: ObservedRequest | null): ObservedRequest {
  if (!request) {
    throw new Error("Expected the fetch mock to capture a request.");
  }

  return request;
}
