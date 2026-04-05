import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  createHostedExecutionSignatureHeaders,
} from "@murphai/hosted-execution";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HostedOnboardingError } from "../../src/lib/hosted-onboarding/errors";
import {
  HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID,
  requireHostedWebInternalServiceRequest,
  requireHostedWebInternalSignedRequest,
} from "../../src/lib/hosted-execution/internal";
import type { HostedWebInternalRequestNonceStore } from "../../src/lib/hosted-execution/internal-request-nonces";

const HOSTED_WEB_INTERNAL_SIGNING_SECRET = "test-hosted-web-internal-signing-secret";
const FIXED_TIMESTAMP = "2026-04-05T00:00:00.000Z";
const FIXED_NOW_MS = Date.parse(FIXED_TIMESTAMP);

class MemoryNonceStore implements HostedWebInternalRequestNonceStore {
  readonly entries = new Set<string>();

  async consumeHostedWebInternalRequestNonce(input: {
    expiresAt: string;
    method: string;
    nonceHash: string;
    now: string;
    path: string;
    search: string;
    userId: string;
  }): Promise<boolean> {
    void input.expiresAt;
    void input.now;

    const compositeKey = [
      input.userId,
      input.method,
      input.path,
      input.search,
      input.nonceHash,
    ].join("|");

    if (this.entries.has(compositeKey)) {
      return false;
    }

    this.entries.add(compositeKey);
    return true;
  }
}

describe("requireHostedWebInternalSignedRequest", () => {
  const originalSigningSecret = process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET;

  beforeEach(() => {
    process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = HOSTED_WEB_INTERNAL_SIGNING_SECRET;
  });

  afterEach(() => {
    if (originalSigningSecret === undefined) {
      delete process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET;
      return;
    }

    process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = originalSigningSecret;
  });

  it("accepts a correctly signed bound-user request and rejects its replay", async () => {
    const nonceStore = new MemoryNonceStore();
    const request = await createSignedRequest({
      body: JSON.stringify({ action: "drain" }),
      nonce: "0123456789abcdef0123456789abcdef",
      path: "/api/internal/hosted-execution/outbox/cron",
      search: "?batch=1",
      userId: HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID,
    });

    await expect(
      requireHostedWebInternalSignedRequest(request, {
        nonceStore,
        nowMs: FIXED_NOW_MS,
      }),
    ).resolves.toBe(HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID);

    const replayedRequest = await createSignedRequest({
      body: JSON.stringify({ action: "drain" }),
      nonce: "0123456789abcdef0123456789abcdef",
      path: "/api/internal/hosted-execution/outbox/cron",
      search: "?batch=1",
      userId: HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID,
    });

    await expect(
      requireHostedWebInternalSignedRequest(replayedRequest, {
        nonceStore,
        nowMs: FIXED_NOW_MS,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_WEB_INTERNAL_REPLAYED",
      httpStatus: 401,
    } satisfies Partial<HostedOnboardingError>);
  });

  it("rejects a correctly signed request when the expected service id does not match", async () => {
    const nonceStore = new MemoryNonceStore();
    const request = await createSignedRequest({
      body: JSON.stringify({ action: "drain" }),
      nonce: "abcdef0123456789abcdef0123456789",
      path: "/api/internal/hosted-execution/usage/cron",
      userId: HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID,
    });

    await expect(
      requireHostedWebInternalServiceRequest(request, "system:wrong-scheduler", {
        nonceStore,
        nowMs: FIXED_NOW_MS,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_WEB_INTERNAL_UNAUTHORIZED",
      httpStatus: 401,
    } satisfies Partial<HostedOnboardingError>);
  });
});

async function createSignedRequest(input: {
  body: string;
  nonce: string;
  path: string;
  search?: string;
  userId: string;
}): Promise<Request> {
  const signatureHeaders = await createHostedExecutionSignatureHeaders({
    method: "POST",
    nonce: input.nonce,
    path: input.path,
    payload: input.body,
    search: input.search ?? "",
    secret: HOSTED_WEB_INTERNAL_SIGNING_SECRET,
    timestamp: FIXED_TIMESTAMP,
    userId: input.userId,
  });
  const requestUrl = new URL(`https://hosted-web.example.test${input.path}`);

  if (input.search) {
    requestUrl.search = input.search;
  }

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
  });

  for (const [key, value] of Object.entries(signatureHeaders) as Array<[string, string]>) {
    headers.set(key, value);
  }

  return new Request(requestUrl.toString(), {
    body: input.body,
    headers,
    method: "POST",
  });
}
