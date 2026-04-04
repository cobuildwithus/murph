import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareHostedDispatchContext: vi.fn(async () => null),
  sendGatewayMessageLocal: vi.fn(async () => ({
    delivery: null,
    messageId: null,
    queued: true,
    sessionKey: "gwcs_example",
  })),
}));

vi.mock("@murphai/gateway-local", () => ({
  sendGatewayMessageLocal: mocks.sendGatewayMessageLocal,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  prepareHostedDispatchContext: mocks.prepareHostedDispatchContext,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("hosted gateway dispatch forwards clientRequestId to the local gateway send path", async () => {
  const { executeHostedDispatchEvent } = await import("../src/hosted-runtime/events.ts");
  const {
    assistantGatewayLocalMessageSender,
    assistantGatewayLocalProjectionSourceReader,
  } = await import("@murphai/assistant-core/gateway-local-adapter");

  const dispatch = {
    event: {
      clientRequestId: "req-123",
      kind: "gateway.message.send",
      replyToMessageId: "5001",
      sessionKey: "gwcs_example",
      text: "Please follow up.",
      userId: "member_123",
    },
    eventId: "gateway-send:abc123",
    occurredAt: "2026-03-31T09:15:00.000Z",
  } as const;

  const metrics = await executeHostedDispatchEvent({
    dispatch,
    emailBaseUrl: "https://email.example.test",
    runtime: {
      commitTimeoutMs: null,
      userEnv: {},
      webControlPlane: {
        deviceSyncRuntimeBaseUrl: null,
        internalToken: null,
        schedulerToken: null,
        shareBaseUrl: null,
        shareToken: null,
      },
    },
    runtimeEnv: {},
    vaultRoot: "/tmp/hosted-gateway-test",
  });

  assert.deepEqual(metrics, {
    bootstrapResult: null,
    shareImportResult: null,
    shareImportTitle: null,
  });
  assert.equal(mocks.prepareHostedDispatchContext.mock.calls.length, 1);
  const sendInput = mocks.sendGatewayMessageLocal.mock.calls[0]?.[0];
  assert.notEqual(sendInput, null);
  assert.deepEqual(sendInput, {
    clientRequestId: "req-123",
    dispatchMode: "queue-only",
    messageSender: assistantGatewayLocalMessageSender,
    replyToMessageId: "5001",
    sessionKey: "gwcs_example",
    sourceReader: assistantGatewayLocalProjectionSourceReader,
    text: "Please follow up.",
    vault: "/tmp/hosted-gateway-test",
  });
});

test("hosted Linq attachment downloads only fetch allowlisted CDN URLs", async () => {
  const { createHostedLinqAttachmentDownloadDriver } = await import("../src/hosted-runtime/events/linq.ts");
  const { normalizeLinqWebhookEvent } = await import("@murphai/inboxd");
  const { parseLinqWebhookEvent } = await import("@murphai/messaging-ingress/linq-webhook");

  const fetchMock = vi.fn(async (input: string | URL | Request) =>
    new Response(new TextEncoder().encode(`bytes:${String(input)}`), {
      status: 200,
    }));
  vi.stubGlobal("fetch", fetchMock as typeof fetch);

  const downloadDriver = createHostedLinqAttachmentDownloadDriver();
  assert.notEqual(downloadDriver, null);

  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    downloadDriver,
    event: parseLinqWebhookEvent(JSON.stringify({
      api_version: "2026-04-02",
      created_at: "2026-04-02T04:00:00.000Z",
      webhook_version: "2026-02-03",
      data: {
        chat: {
          id: "chat_123",
          owner_handle: {
            handle: "hbid:linq.recipient:v1:test",
            id: "handle_owner_123",
            is_me: true,
            service: "iMessage",
          },
        },
        direction: "inbound",
        id: "hbid:linq.message:v1:test",
        parts: [
          {
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            type: "media",
            url: "https://cdn.linqapp.com/media/photo.jpg",
          },
          {
            mime_type: "audio/m4a",
            type: "media",
            url: "https://cdn.linqapp.com/media/voice.m4a",
          },
          {
            filename: "ignored.jpg",
            mime_type: "image/jpeg",
            type: "media",
            url: "https://example.com/ignored.jpg",
          },
        ],
        sender_handle: {
          handle: "hbid:linq.from:v1:test",
          id: "handle_sender_123",
          service: "iMessage",
        },
        sent_at: "2026-04-02T04:00:01.000Z",
        service: "iMessage",
      },
      event_id: "evt_123",
      event_type: "message.received",
    })),
  });

  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(capture.attachments.length, 3);
  assert.equal(capture.attachments[0]?.fileName, "photo.jpg");
  assert.equal(capture.attachments[0]?.kind, "image");
  assert.ok(capture.attachments[0]?.data instanceof Uint8Array);
  assert.equal(capture.attachments[1]?.fileName, "voice.m4a");
  assert.equal(capture.attachments[1]?.kind, "audio");
  assert.ok(capture.attachments[1]?.data instanceof Uint8Array);
  assert.equal(capture.attachments[2]?.fileName, "ignored.jpg");
  assert.equal(capture.attachments[2]?.kind, "image");
  assert.equal(capture.attachments[2]?.data, null);
});

test("hosted Linq attachment URL normalization accepts only https cdn.linqapp.com URLs", async () => {
  const { normalizeHostedLinqAttachmentUrl } = await import("../src/hosted-runtime/events/linq.ts");

  assert.equal(
    normalizeHostedLinqAttachmentUrl("https://cdn.linqapp.com/media/photo.jpg"),
    "https://cdn.linqapp.com/media/photo.jpg",
  );
  assert.equal(
    normalizeHostedLinqAttachmentUrl("http://cdn.linqapp.com/media/photo.jpg"),
    null,
  );
  assert.equal(
    normalizeHostedLinqAttachmentUrl("https://example.com/media/photo.jpg"),
    null,
  );
  assert.equal(normalizeHostedLinqAttachmentUrl("not-a-url"), null);
});
