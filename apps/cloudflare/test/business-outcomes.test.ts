import { generateKeyPairSync } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  buildHostedExecutionLinqMessageReceivedDispatch,
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import {
  applyHostedBusinessOutcomeIfNeeded,
  applyHostedWebBusinessOutcomeIfNeeded,
  releaseHostedWebShareClaim,
} from "../src/runner-outbound/business-outcomes.ts";

const TEST_CALLBACK_PRIVATE_JWK_JSON = JSON.stringify(
  generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
);

describe("applyHostedWebBusinessOutcomeIfNeeded", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("skips non-share events without calling hosted web", async () => {
    const fetchMock = vi.fn();

    await applyHostedWebBusinessOutcomeIfNeeded({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_tick",
        occurredAt: "2026-04-07T00:00:00.000Z",
      },
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the signed share-import completion callback to hosted web", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T00:00:00.000Z"));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("{}", { status: 200 }));

    await applyHostedWebBusinessOutcomeIfNeeded({
      dispatch: createShareDispatch(),
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toBe("https://web.example.test/api/internal/hosted-execution/share-import/complete");
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.body).toBe(JSON.stringify({
      eventId: "evt_share",
      shareId: "share_123",
    }));

    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_123");
    expect(headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("test-callback-key");
    expect(headers.get(HOSTED_EXECUTION_NONCE_HEADER)).toBeTruthy();
    expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
    expect(headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toBe("2026-04-07T00:00:00.000Z");
  });

  it("fails closed when the hosted web callback host is missing", async () => {
    await expect(applyHostedWebBusinessOutcomeIfNeeded({
      dispatch: createShareDispatch(),
      env: {},
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
    })).rejects.toThrow(/HOSTED_WEB_BASE_URL must be configured/u);
  });

  it("surfaces callback HTTP failures for the committed finalize retry lane", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("not ready", { status: 503 }));

    const promise = applyHostedWebBusinessOutcomeIfNeeded({
      dispatch: createShareDispatch(),
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(promise).rejects.toThrow(/HTTP 503/u);
    await expect(promise).rejects.not.toThrow(/not ready/u);
  });

  it("posts the signed share-claim release callback to hosted web", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T00:00:00.000Z"));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("{}", { status: 200 }));

    await releaseHostedWebShareClaim({
      dispatch: createShareDispatch(),
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: fetchMock as typeof fetch,
      reason: "share pack missing",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toBe("https://web.example.test/api/internal/hosted-execution/share-import/release");
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.body).toBe(JSON.stringify({
      eventId: "evt_share",
      reason: "share pack missing",
      shareId: "share_123",
    }));
  });
});

describe("applyHostedBusinessOutcomeIfNeeded", () => {
  it("round-trips the raw Linq message id through dispatch parsing", () => {
    const dispatch = createLinqDispatch();

    expect(parseHostedExecutionDispatchRequest(dispatch)).toEqual(dispatch);
  });

  it("deletes the Linq source message after the hosted commit succeeds", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 204 }));

    await applyHostedBusinessOutcomeIfNeeded({
      dispatch: createLinqDispatch(),
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    expect(String(call?.[0])).toBe("https://api.linqapp.com/api/partner/v3/messages/msg_123");
    expect(call?.[1]?.method).toBe("DELETE");
    expect(call?.[1]?.headers).toEqual({
      authorization: "Bearer linq-token",
    });
  });

  it("treats missing Linq records as already deleted", async () => {
    await expect(applyHostedBusinessOutcomeIfNeeded({
      dispatch: createLinqDispatch(),
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch,
    })).resolves.toBeUndefined();
  });

  it("does not echo hosted-web release response bodies in thrown errors", async () => {
    const promise = releaseHostedWebShareClaim({
      dispatch: createShareDispatch(),
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: vi.fn(async () => new Response("share pack missing", { status: 500 })) as typeof fetch,
    });

    await expect(promise).rejects.toThrow(/HTTP 500/u);
    await expect(promise).rejects.not.toThrow(/share pack missing/u);
  });

  it("does not echo Linq delete response bodies in thrown errors", async () => {
    const promise = applyHostedBusinessOutcomeIfNeeded({
      dispatch: createLinqDispatch(),
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: vi.fn(async () => new Response("provider token leaked", { status: 500 })) as typeof fetch,
    });

    await expect(promise).rejects.toThrow(/HTTP 500/u);
    await expect(promise).rejects.not.toThrow(/provider token leaked/u);
  });
});

function createShareDispatch() {
  return {
    event: {
      kind: "vault.share.accepted" as const,
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
      userId: "member_123",
    },
    eventId: "evt_share",
    occurredAt: "2026-04-07T00:00:00.000Z",
  };
}

function createLinqDispatch() {
  return buildHostedExecutionLinqMessageReceivedDispatch({
    eventId: "evt_linq",
    linqEvent: {
      api_version: "v3",
      created_at: "2026-04-07T00:00:00.000Z",
      data: {
        chat_id: "chat_123",
        message: {
          id: "opaque-message-id",
        },
      },
      event_id: "evt_linq",
      event_type: "message.received",
    },
    linqMessageId: "msg_123",
    occurredAt: "2026-04-07T00:00:00.000Z",
    phoneLookupKey: "phone_lookup_123",
    userId: "user_123",
  });
}
