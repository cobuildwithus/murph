import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test as baseTest, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const processCapture = vi.fn(async () => undefined);
  return {
    processCapture,
    withHostedInboxPipeline: vi.fn(async (
      _vaultRoot: string,
      callback: (pipeline: { processCapture: (capture: unknown) => Promise<void> }) => Promise<void>,
    ) =>
      callback({
        processCapture,
      })),
  };
});

vi.mock("../src/hosted-runtime/events/inbox-pipeline.ts", () => ({
  withHostedInboxPipeline: mocks.withHostedInboxPipeline,
}));

import {
  createHostedExecutionProxyDeviceSyncRuntimeClient,
} from "@murphai/hosted-execution";
import { parseHostedEmailThreadTarget } from "@murphai/runtime-state";
import { syncHostedDeviceSyncControlPlaneState } from "../src/hosted-device-sync-runtime.ts";
import { sendHostedEmailOverWorker } from "../src/hosted-email.ts";
import { createHostedInternalWorkerFetch } from "../src/hosted-runtime/internal-http.ts";
import { ingestHostedEmailMessage } from "../src/hosted-runtime/events/email.ts";
import { handleHostedShareAcceptedDispatch } from "../src/hosted-runtime/events/share.ts";

const test = baseTest.sequential;

const originalFetch = global.fetch;
const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  mocks.processCapture.mockClear();
  mocks.withHostedInboxPipeline.mockClear();

  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }

  return Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

test("hosted internal worker fetch adds the per-run header only for targeted internal worker hosts", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ connections: [] }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }));
  const hostedFetch = createHostedInternalWorkerFetch("runner-proxy-token", fetchMock as typeof fetch);

  await hostedFetch("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  await hostedFetch("https://external.example.test/health");

  assert.equal(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-hosted-execution-runner-proxy-token"),
    "runner-proxy-token",
  );
  assert.equal(
    new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("x-hosted-execution-runner-proxy-token"),
    null,
  );
});

test("hosted share dispatch now requires an inline pack", async () => {
  const fetchMock = vi.fn(async () => new Response("unused", { status: 200 }));
  const hostedFetch = createHostedInternalWorkerFetch("runner-proxy-token", fetchMock as typeof fetch);

  await assert.rejects(
    () =>
      handleHostedShareAcceptedDispatch({
        dispatch: {
          event: {
            kind: "vault.share.accepted",
            share: {
              shareId: "share_123",
            },
            userId: "member_123",
          },
        },
        vaultRoot: "/tmp/share-vault",
      }),
    /missing an inline share pack/u,
  );

  await hostedFetch("https://external.example.test/health");
  assert.equal(fetchMock.mock.calls.length, 1);
});

test("hosted device-sync sync uses the explicit wrapped fetch for worker proxy snapshot reads", async () => {
  const fetchMock = vi.fn(async (_input, init) =>
    new Response(JSON.stringify({
      connections: [],
      generatedAt: "2026-03-27T08:05:00.000Z",
      userId: "member_123",
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }));
  const hostedFetch = createHostedInternalWorkerFetch("runner-proxy-token", fetchMock as typeof fetch);

  const state = await syncHostedDeviceSyncControlPlaneState({
    dispatch: {
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_proxy_snapshot",
      occurredAt: "2026-03-27T08:05:00.000Z",
    },
    fetchImpl: hostedFetch,
    secret: "secret-for-tests",
    service: {
      store: {
        getAccountByExternalAccount: vi.fn(),
        hydrateHostedAccount: vi.fn(),
        markPendingJobsDeadForAccount: vi.fn(),
      },
    } as never,
    timeoutMs: 5_000,
    webControlPlane: {
      deviceSyncRuntimeBaseUrl: "http://device-sync.worker",
      internalToken: null,
      schedulerToken: null,
      usageBaseUrl: null,
    },
  });

  assert.deepEqual(state.snapshot, {
    connections: [],
    generatedAt: "2026-03-27T08:05:00.000Z",
    userId: "member_123",
  });
  assert.equal(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-hosted-execution-runner-proxy-token"),
    "runner-proxy-token",
  );
  assert.equal(
    typeof fetchMock.mock.calls[0]?.[1]?.body,
    "string",
  );
  assert.match(String(fetchMock.mock.calls[0]?.[1]?.body), /"userId":"member_123"/u);
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
  const client = createHostedExecutionProxyDeviceSyncRuntimeClient({
    baseUrl: "http://device-sync.worker",
    boundUserId: "member_123",
    timeoutMs: 9_000,
  });

  await assert.rejects(
    () => client.fetchSnapshot(),
    /Hosted device-sync runtime snapshot failed with HTTP 502: <html>bad gateway<\/html>/,
  );

  assert.equal(timeoutSpy.mock.calls[0]?.[0], 9_000);
  assert.equal(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    null,
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
            identityId: "assistant@mail.example.test",
            kind: "email.message.received",
            rawMessageKey: "raw_123",
            userId: "member_123",
          },
          eventId: "evt_email",
          occurredAt: "2026-03-28T09:00:00.000Z",
        },
        "https://email.example.test",
        undefined,
        18_000,
        {},
      ),
    /Hosted email message fetch failed/,
  );

  assert.equal(timeoutSpy.mock.calls[0]?.[0], 18_000);
});

test("hosted email message ingestion no longer relies on stored envelope metadata", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-email-http-"));
  tempDirs.push(vaultRoot);
  global.fetch = vi.fn(async () =>
    new Response([
      "From: intruder@example.test",
      "To: assistant@mail.example.test",
      "Subject: Sneaky",
      "",
      "hello",
      "",
    ].join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "message/rfc822",
      },
    }));

  await assert.doesNotReject(
    () =>
      ingestHostedEmailMessage(
        vaultRoot,
        {
          event: {
            identityId: "assistant@mail.example.test",
            kind: "email.message.received",
            rawMessageKey: "raw_no_envelope_metadata",
            userId: "member_123",
          },
          eventId: "evt_email_no_envelope_metadata",
          occurredAt: "2026-03-28T09:00:00.000Z",
        },
        "https://email.example.test",
        undefined,
        5_000,
        {
          HOSTED_USER_VERIFIED_EMAIL: "owner@example.test",
        },
      ),
  );
  assert.equal(mocks.withHostedInboxPipeline.mock.calls.length, 1);
});

test("hosted email message ingestion preserves the routed alias as a self address", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-email-self-address-"));
  tempDirs.push(vaultRoot);
  global.fetch = vi.fn(async () =>
    new Response([
      "From: Friend <friend@example.test>",
      "To: assistant+u-member_123@mail.example.test",
      "Reply-To: Owner <owner@example.test>",
      "Subject: Routed alias",
      "Message-ID: <routed_alias@example.test>",
      "",
      "hello",
      "",
    ].join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "message/rfc822",
      },
    }));

  await assert.doesNotReject(
    () =>
      ingestHostedEmailMessage(
        vaultRoot,
        {
          event: {
            identityId: "assistant@mail.example.test",
            kind: "email.message.received",
            rawMessageKey: "raw_self_address",
            selfAddress: "assistant+u-member_123@mail.example.test",
            userId: "member_123",
          },
          eventId: "evt_email_self_address",
          occurredAt: "2026-03-28T09:00:00.000Z",
        },
        "https://email.example.test",
        undefined,
        5_000,
        {},
      ),
  );

  assert.equal(mocks.processCapture.mock.calls.length, 1);
  const capture = mocks.processCapture.mock.calls[0]?.[0] as {
    thread: { id: string };
  };
  const threadTarget = parseHostedEmailThreadTarget(capture.thread.id);
  assert.ok(threadTarget);
  assert.deepEqual(threadTarget.to, ["owner@example.test"]);
  assert.deepEqual(threadTarget.cc, []);
});
