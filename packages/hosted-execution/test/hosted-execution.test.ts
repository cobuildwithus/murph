import { describe, expect, it } from "vitest";

import {
  encodeHostedExecutionSignedRequestPayload,
  readHostedExecutionSignatureHeaders,
} from "../src/auth.ts";
import { buildHostedExecutionMemberActivatedDispatch } from "../src/builders.ts";
import { createHostedExecutionDispatchClient } from "../src/client.ts";
import {
  HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_EVENT_DISPATCH_STATES,
  HOSTED_EXECUTION_EVENT_KINDS,
  HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KINDS,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  resolveHostedExecutionDispatchOutcomeState,
} from "../src/contracts.ts";
import {
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "../src/env.ts";
import {
  buildHostedExecutionRunnerCommitPath,
  buildHostedExecutionRunnerEmailMessagePath,
  buildHostedExecutionRunnerSideEffectPath,
} from "../src/routes.ts";

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

describe("hosted execution coverage gaps", () => {
  it("reads signature headers and normalizes signed request payloads", () => {
    const headers = new Headers({
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: "sig_123",
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: "2026-04-07T00:00:00.000Z",
      [HOSTED_EXECUTION_NONCE_HEADER]: "nonce_123",
      [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "key_123",
    });

    expect(readHostedExecutionSignatureHeaders(headers)).toEqual({
      keyId: "key_123",
      nonce: "nonce_123",
      signature: "sig_123",
      timestamp: "2026-04-07T00:00:00.000Z",
    });

    expect(
      decodeUtf8(
        encodeHostedExecutionSignedRequestPayload({
          method: " patch ",
          nonce: "  nonce_abc  ",
          path: "internal/dispatch",
          payload: "{\"ok\":true}",
          search: "limit=10&sort=desc",
          timestamp: "2026-04-07T00:00:00.000Z",
          userId: "  user_123  ",
        }),
      ),
    ).toBe(JSON.stringify([
      "2026-04-07T00:00:00.000Z",
      "PATCH",
      "/internal/dispatch",
      "?limit=10&sort=desc",
      "user_123",
      "nonce_abc",
      "{\"ok\":true}",
    ]));

    expect(
      decodeUtf8(
        encodeHostedExecutionSignedRequestPayload({
          method: undefined,
          nonce: "   ",
          path: undefined,
          payload: "payload",
          search: "   ",
          timestamp: "2026-04-07T00:00:00.000Z",
          userId: null,
        }),
      ),
    ).toBe(JSON.stringify([
      "2026-04-07T00:00:00.000Z",
      "POST",
      "/",
      "",
      "",
      "",
      "payload",
    ]));
  });

  it("normalizes hosted execution base URLs and string inputs", () => {
    expect(normalizeHostedExecutionString(null)).toBeNull();
    expect(normalizeHostedExecutionString("  ")).toBeNull();
    expect(normalizeHostedExecutionString("  abc  ")).toBe("abc");

    expect(
      normalizeHostedExecutionBaseUrl(" https://Example.com/root/?q=1#frag "),
    ).toBe("https://example.com/root");

    expect(
      normalizeHostedExecutionBaseUrl("http://LOCALHOST:8787/api/?q=1", {
        allowHttpLocalhost: true,
      }),
    ).toBe("http://localhost:8787/api");

    expect(
      normalizeHostedExecutionBaseUrl("http://api.example.com/v1/?q=1", {
        allowHttpHosts: ["API.EXAMPLE.COM"],
      }),
    ).toBe("http://api.example.com/v1");

    expect(() => normalizeHostedExecutionBaseUrl("http://example.com")).toThrow(
      /HTTPS unless the host is explicitly allowlisted/i,
    );
    expect(() => normalizeHostedExecutionBaseUrl("https://user:pass@example.com")).toThrow(
      /embedded credentials/i,
    );
  });

  it("builds hosted execution routes with safe path encoding", () => {
    expect(buildHostedExecutionRunnerCommitPath("evt/123?x=1")).toBe(
      "/events/evt%2F123%3Fx%3D1/commit",
    );
    expect(buildHostedExecutionRunnerSideEffectPath("effect 123")).toBe(
      "/effects/effect%20123",
    );
    expect(buildHostedExecutionRunnerEmailMessagePath("raw/message#1")).toBe(
      "/messages/raw%2Fmessage%231",
    );
  });

  it("exports canonical hosted execution contracts and resolves dispatch outcomes", () => {
    expect(HOSTED_EXECUTION_EVENT_KINDS).toEqual([
      "member.activated",
      "linq.message.received",
      "telegram.message.received",
      "email.message.received",
      "assistant.cron.tick",
      "device-sync.wake",
      "vault.share.accepted",
      "gateway.message.send",
    ]);
    expect(HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS).toEqual([
      "linq.message.received",
      "telegram.message.received",
      "email.message.received",
      "device-sync.wake",
      "gateway.message.send",
    ]);
    expect(HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KINDS).toEqual([
      "member.activated",
      "assistant.cron.tick",
      "vault.share.accepted",
    ]);
    expect(HOSTED_EXECUTION_EVENT_DISPATCH_STATES).toEqual([
      "queued",
      "duplicate_pending",
      "duplicate_consumed",
      "backpressured",
      "completed",
      "poisoned",
    ]);
    expect(HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR).toBe(
      "Hosted execution dispatch is not configured.",
    );
    expect(HOSTED_EXECUTION_SIGNATURE_HEADER).toBe("x-hosted-execution-signature");
    expect(HOSTED_EXECUTION_TIMESTAMP_HEADER).toBe("x-hosted-execution-timestamp");
    expect(HOSTED_EXECUTION_NONCE_HEADER).toBe("x-hosted-execution-nonce");
    expect(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER).toBe(
      "x-hosted-execution-signing-key-id",
    );
    expect(HOSTED_EXECUTION_USER_ID_HEADER).toBe("x-hosted-execution-user-id");
    expect(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER).toBe(
      "x-hosted-execution-runner-proxy-token",
    );

    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: true,
        },
      }),
    ).toBe("poisoned");
    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: true,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("backpressured");
    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: true,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("duplicate_consumed");
    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: true,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("duplicate_pending");
    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: true,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("completed");
    expect(
      resolveHostedExecutionDispatchOutcomeState({
        initialState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
        nextState: {
          backpressured: false,
          consumed: false,
          lastError: null,
          pending: false,
          poisoned: false,
        },
      }),
    ).toBe("queued");
  });

  it("dispatches hosted execution requests through the client and handles failures", async () => {
    const successfulResponse = {
      event: {
        eventId: "evt_123",
        lastError: null,
        state: "queued",
        userId: "user_123",
      },
      status: {
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: null,
        lastRunAt: null,
        nextWakeAt: null,
        pendingEventCount: 0,
        poisonedEventIds: [],
        retryingEventId: null,
        userId: "user_123",
      },
    };

    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      observedRequest = { init, url: String(url) };
      return new Response(JSON.stringify(successfulResponse), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    };

    const client = createHostedExecutionDispatchClient({
      baseUrl: "https://dispatch.example.com/root/",
      fetchImpl,
      getBearerToken: async () => "  Bearer token-123  ",
      timeoutMs: 2500,
    });

    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_123",
      memberId: "user_123",
      occurredAt: "2026-04-07T00:00:00.000Z",
    });

    await expect(client.dispatch(dispatch)).resolves.toEqual(successfulResponse);
    expect(observedRequest).not.toBeNull();
    expect(observedRequest?.url).toBe(
      "https://dispatch.example.com/root/internal/dispatch",
    );
    expect(observedRequest?.init?.method).toBe("POST");
    expect(observedRequest?.init?.redirect).toBe("error");
    expect(observedRequest?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(observedRequest?.init?.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
    expect(new Headers(observedRequest?.init?.headers).get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(observedRequest?.init?.body).toBe(JSON.stringify(dispatch));

    const blankTokenClient = createHostedExecutionDispatchClient({
      baseUrl: "https://dispatch.example.com",
      fetchImpl,
      getBearerToken: async () => "   ",
    });

    await expect(blankTokenClient.dispatch(dispatch)).rejects.toThrow(
      /bearer token must be configured/i,
    );

    const whitespaceErrorBody = "   ";
    const failureFetchImpl: typeof fetch = async () =>
      new Response(whitespaceErrorBody, { status: 503 });
    const failureClient = createHostedExecutionDispatchClient({
      baseUrl: "https://dispatch.example.com",
      fetchImpl: failureFetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(failureClient.dispatch(dispatch)).rejects.toThrow(
      "Hosted execution dispatch failed with HTTP 503.",
    );

    const longErrorBody = `  ${"x".repeat(600)}  `;
    const longErrorFetchImpl: typeof fetch = async () =>
      new Response(longErrorBody, { status: 502 });
    const longErrorClient = createHostedExecutionDispatchClient({
      baseUrl: "https://dispatch.example.com",
      fetchImpl: longErrorFetchImpl,
      getBearerToken: async () => "token-123",
    });

    await expect(longErrorClient.dispatch(dispatch)).rejects.toThrow(
      `Hosted execution dispatch failed with HTTP 502: ${"x".repeat(500)}.`,
    );
  });

  it("rejects invalid hosted execution client configuration", () => {
    expect(() =>
      createHostedExecutionDispatchClient({
        baseUrl: "  ",
        fetchImpl: async () =>
          new Response(JSON.stringify({}), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
        getBearerToken: async () => "token-123",
      }),
    ).toThrow(/baseUrl must be configured/i);
  });
});
