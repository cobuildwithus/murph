import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import {
  fetchHostedDeviceSyncRuntimeSnapshot,
} from "../src/hosted-device-sync-control-plane.ts";
import { sendHostedEmailOverWorker } from "../src/hosted-email.ts";
import { ingestHostedEmailMessage } from "../src/hosted-runtime/events/email.ts";
import { handleHostedShareAcceptedDispatch } from "../src/hosted-runtime/events/share.ts";

const originalFetch = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();

  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});

test("hosted device-sync snapshot tolerates non-JSON error bodies and applies the hosted timeout", async () => {
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  const fetchMock = vi.fn(async (_input, init) =>
    new Response("<html>bad gateway</html>", {
      status: 502,
      headers: {
        "content-type": "text/html",
      },
    }));
  global.fetch = fetchMock;

  await assert.rejects(
    () =>
      fetchHostedDeviceSyncRuntimeSnapshot({
        baseUrl: "https://hosted.example.test",
        internalToken: "internal-token",
        timeoutMs: 9_000,
        userId: "member_123",
      }),
    /Hosted device-sync runtime snapshot failed with HTTP 502: <html>bad gateway<\/html>/,
  );

  assert.equal(timeoutSpy.mock.calls[0]?.[0], 9_000);
  assert.equal(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    "Bearer internal-token",
  );
});

test("hosted share payload fetch tolerates non-JSON error bodies and applies the hosted timeout", async () => {
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  const fetchMock = vi.fn(async () =>
    new Response("<html>service unavailable</html>", {
      status: 503,
      headers: {
        "content-type": "text/html",
      },
    }));
  global.fetch = fetchMock;

  await assert.rejects(
    () =>
      handleHostedShareAcceptedDispatch({
        dispatch: {
          event: {
            kind: "vault.share.accepted",
            share: {
              shareCode: "share-code",
              shareId: "share_123",
            },
            userId: "member_123",
          },
        },
        runtime: {
          commitTimeoutMs: 12_000,
          webControlPlane: {
            deviceSyncRuntimeBaseUrl: null,
            internalToken: "share-token",
            schedulerToken: null,
            shareBaseUrl: "https://share.example.test",
            shareToken: "share-token",
          },
        },
        vaultRoot: "/tmp/share-vault",
      }),
    /Hosted share payload fetch failed with HTTP 503: <html>service unavailable<\/html>/,
  );

  assert.equal(timeoutSpy.mock.calls[0]?.[0], 12_000);
  assert.equal(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    "Bearer share-token",
  );
});

test("hosted email send worker tolerates non-JSON error bodies and applies the hosted timeout", async () => {
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  global.fetch = vi.fn(async () =>
    new Response("<html>email down</html>", {
      status: 502,
      headers: {
        "content-type": "text/html",
      },
    }));

  await assert.rejects(
    () =>
      sendHostedEmailOverWorker({
        emailBaseUrl: "https://email.example.test",
        identityId: "assistant@mail.example.test",
        message: "hello",
        target: "user@example.com",
        targetKind: "explicit",
        timeoutMs: 15_000,
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "HOSTED_EMAIL_DELIVERY_FAILED");
      assert.equal((error as Error & { retryable?: boolean }).retryable, true);
      assert.match(error.message, /<html>email down<\/html>/);
      return true;
    },
  );

  assert.equal(timeoutSpy.mock.calls[0]?.[0], 15_000);
});

test("hosted email message fetch applies the hosted timeout before failing on HTTP status", async () => {
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  global.fetch = vi.fn(async () =>
    new Response("temporarily unavailable", {
      status: 503,
    }));

  await assert.rejects(
    () =>
      ingestHostedEmailMessage(
        "/tmp/email-vault",
        {
          event: {
            envelopeTo: "assistant@mail.example.test",
            identityId: "assistant@mail.example.test",
            kind: "email.message.received",
            rawMessageKey: "raw_123",
            threadTarget: null,
            userId: "member_123",
          },
          eventId: "evt_email",
          occurredAt: "2026-03-28T09:00:00.000Z",
        },
        "https://email.example.test",
        18_000,
      ),
    /Hosted email message fetch failed/,
  );

  assert.equal(timeoutSpy.mock.calls[0]?.[0], 18_000);
});
