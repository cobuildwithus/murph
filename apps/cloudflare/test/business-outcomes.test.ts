import { generateKeyPairSync } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution";

import {
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
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

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
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://web.example.test/api/internal/hosted-execution/share-import/complete");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({
      eventId: "evt_share",
      shareId: "share_123",
    }));

    const headers = new Headers(init.headers);
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
    const fetchMock = vi.fn(async () => new Response("not ready", { status: 503 }));

    await expect(applyHostedWebBusinessOutcomeIfNeeded({
      dispatch: createShareDispatch(),
      env: {
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      },
      callbackSigning: {
        keyId: "test-callback-key",
        privateKeyJwkJson: TEST_CALLBACK_PRIVATE_JWK_JSON,
      },
      fetchImpl: fetchMock as typeof fetch,
    })).rejects.toThrow(/HTTP 503/u);
  });

  it("posts the signed share-claim release callback to hosted web", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T00:00:00.000Z"));
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

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
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://web.example.test/api/internal/hosted-execution/share-import/release");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({
      eventId: "evt_share",
      reason: "share pack missing",
      shareId: "share_123",
    }));
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
