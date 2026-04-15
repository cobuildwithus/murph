import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import type {
  InboundCapture,
  PersistedCapture,
} from "../src/index.ts";

import {
  buildV2026LinqWebhookEvent,
  signLinqWebhook,
} from "./linq-test-helpers.ts";

const mockedModuleIds = ["node:http"] as const;

afterEach(() => {
  vi.restoreAllMocks();
  for (const moduleId of mockedModuleIds) {
    vi.doUnmock(moduleId);
  }
  vi.resetModules();
});

test("createLinqWebhookConnector fails closed before starting when the webhook secret is missing", async () => {
  const { createLinqWebhookConnector } = await loadLinqWebhookConnector();

  assert.throws(
    () =>
      createLinqWebhookConnector({
        accountId: "default",
        host: "127.0.0.1",
        path: "/hooks/linq",
        port: 9911,
        webhookSecret: null as unknown as string,
      }),
    /Linq webhook secret is required/u,
  );
});

test("createLinqWebhookConnector serves GET, rejects duplicate watch calls, and normalizes the webhook path", async () => {
  const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
  const controller = new AbortController();
  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "hooks/linq",
    port: 8789,
    webhookSecret: "secret-123",
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => createPersistedCapture(capture),
    controller.signal,
  );
  runtime.triggerListening();

  await assert.rejects(
    () =>
      connector.watch(
        null,
        async (capture) => createPersistedCapture(capture),
        controller.signal,
      ),
    /already watching/u,
  );

  const response = await runtime.dispatch({
    method: "GET",
    path: "/hooks/linq",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    path: "/hooks/linq",
    source: "linq",
    accountId: "default",
  });
  assert.deepEqual(runtime.listenCalls, [{ host: "127.0.0.1", port: 8789 }]);

  controller.abort();
  await watchPromise;
});

test("createLinqWebhookConnector accepts signed webhook requests and emits hydrated captures", async () => {
  const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
  const controller = new AbortController();
  const emitted: Array<{
    capture: InboundCapture;
    checkpoint: Record<string, unknown> | null | undefined;
  }> = [];
  const fetchImplementation = vi.fn(async (url) => {
    assert.equal(url, "https://cdn.example.test/att_2.pdf");
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([9, 8, 7, 6]).buffer,
    } as Response;
  });
  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port: 8789,
    webhookSecret: "secret-123",
    fetchImplementation,
  });

  const watchPromise = connector.watch(
    null,
    async (capture, checkpoint) => {
      emitted.push({ capture, checkpoint });
      return createPersistedCapture(capture);
    },
    controller.signal,
  );
  runtime.triggerListening();

  const payload = JSON.stringify(buildV2026LinqWebhookEvent({
    createdAt: "2026-03-24T11:00:05.000Z",
    data: {
      chat: {
        id: "chat_456",
        owner_handle: {
          handle: "+15559990000",
          id: "handle_owner_456",
          is_me: true,
          service: "iMessage",
        },
      },
      id: "msg_456",
      parts: [
        {
          type: "text",
          value: "Webhook payload",
        },
        {
          type: "media",
          url: "https://cdn.example.test/att_2.pdf",
          id: "att_2",
          filename: "summary.pdf",
          mime_type: "application/pdf",
        },
      ],
      sender_handle: {
        handle: "+15550001111",
        id: "handle_sender_456",
        service: "iMessage",
      },
      sent_at: "2026-03-24T11:00:00.000Z",
      service: "iMessage",
    },
    eventId: "evt_456",
  }));
  const timestamp = "1711278000";

  const response = await runtime.dispatch({
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
    path: "/hooks/linq",
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), {
    ok: true,
    accepted: true,
    externalId: "linq:msg_456",
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.capture.externalId, "linq:msg_456");
  assert.equal(emitted[0]?.capture.accountId, "+15559990000");
  assert.equal(emitted[0]?.capture.thread.id, "chat_456");
  assert.equal(emitted[0]?.capture.thread.isDirect, true);
  assert.equal(emitted[0]?.capture.text, "Webhook payload");
  assert.equal(emitted[0]?.capture.attachments[0]?.kind, "document");
  assert.deepEqual(Array.from(emitted[0]?.capture.attachments[0]?.data ?? []), [9, 8, 7, 6]);
  assert.equal(fetchImplementation.mock.calls.length, 1);

  controller.abort();
  await watchPromise;
});

test("createLinqWebhookConnector still accepts a webhook when attachment download fails", async () => {
  const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
  const controller = new AbortController();
  const emitted: InboundCapture[] = [];
  const fetchImplementation = vi.fn(async () => ({
    ok: false,
    status: 503,
    arrayBuffer: async () => new ArrayBuffer(0),
  }) as Response);
  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port: 8789,
    webhookSecret: "secret-123",
    fetchImplementation,
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );
  runtime.triggerListening();

  const payload = JSON.stringify(buildV2026LinqWebhookEvent({
    createdAt: "2026-03-24T11:00:05.000Z",
    data: {
      chat: {
        id: "chat_456",
        owner_handle: {
          handle: "+15559990000",
          id: "handle_owner_456",
          is_me: true,
          service: "iMessage",
        },
      },
      id: "msg_456",
      parts: [
        {
          type: "media",
          url: "https://cdn.example.test/att_2.pdf",
          id: "att_2",
          filename: "summary.pdf",
          mime_type: "application/pdf",
        },
      ],
      sender_handle: {
        handle: "+15550001111",
        id: "handle_sender_456",
        service: "iMessage",
      },
      sent_at: "2026-03-24T11:00:00.000Z",
      service: "iMessage",
    },
    eventId: "evt_download_failure",
  }));
  const timestamp = "1711278000";

  const response = await runtime.dispatch({
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
    path: "/hooks/linq",
  });

  assert.equal(response.statusCode, 202);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.externalId, "linq:msg_456");
  assert.equal(emitted[0]?.attachments[0]?.externalId, "att_2");
  assert.equal(emitted[0]?.attachments[0]?.data ?? null, null);
  assert.equal(fetchImplementation.mock.calls.length, 1);

  controller.abort();
  await watchPromise;
});

test("createLinqWebhookConnector waits for successful attachment downloads that resolve within the timeout", async () => {
  const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
  const controller = new AbortController();
  const emitted: InboundCapture[] = [];
  let resolveDownload: ((response: Response) => void) | null = null;
  let downloadStarted = false;
  let emitCalled = false;
  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port: 8789,
    webhookSecret: "secret-123",
    attachmentDownloadTimeoutMs: 100,
    fetchImplementation: vi.fn(async () => {
      downloadStarted = true;
      return await new Promise<Response>((resolve) => {
        resolveDownload = resolve;
      });
    }),
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => {
      emitCalled = true;
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );
  runtime.triggerListening();

  const payload = JSON.stringify(buildV2026LinqWebhookEvent({
    createdAt: "2026-03-24T11:00:05.000Z",
    data: {
      chat: {
        id: "chat_delayed_download",
        owner_handle: {
          handle: "+15559990000",
          id: "handle_owner_delayed_download",
          is_me: true,
          service: "iMessage",
        },
      },
      id: "msg_delayed_download",
      parts: [
        {
          type: "media",
          url: "https://cdn.example.test/att_2.pdf",
          id: "att_2",
          filename: "summary.pdf",
          mime_type: "application/pdf",
        },
      ],
      sender_handle: {
        handle: "+15550001111",
        id: "handle_sender_delayed_download",
        service: "iMessage",
      },
      sent_at: "2026-03-24T11:00:00.000Z",
      service: "iMessage",
    },
    eventId: "evt_delayed_download",
  }));
  const timestamp = "1711278000";
  const responsePromise = runtime.dispatch({
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
    path: "/hooks/linq",
  });

  await vi.waitFor(() => {
    assert.equal(downloadStarted, true);
  });
  assert.equal(emitCalled, false);

  const completeDownload = (response: Response) => {
    if (!resolveDownload) {
      throw new Error("expected delayed Linq download resolver");
    }

    resolveDownload(response);
  };
  completeDownload({
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from([4, 3, 2, 1]).buffer,
  } as Response);

  const response = await responsePromise;
  assert.equal(response.statusCode, 202);
  assert.equal(emitted.length, 1);
  assert.deepEqual(Array.from(emitted[0]?.attachments[0]?.data ?? []), [4, 3, 2, 1]);

  controller.abort();
  await watchPromise;
});

test("createLinqWebhookConnector acknowledges webhooks promptly even when attachment downloads hang", async () => {
  const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
  const controller = new AbortController();
  const emitted: InboundCapture[] = [];
  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port: 8789,
    webhookSecret: "secret-123",
    attachmentDownloadTimeoutMs: 25,
    fetchImplementation: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );
  runtime.triggerListening();

  const payload = JSON.stringify(buildV2026LinqWebhookEvent({
    createdAt: "2026-03-24T11:00:05.000Z",
    data: {
      chat: {
        id: "chat_456",
        owner_handle: {
          handle: "+15559990000",
          id: "handle_owner_456",
          is_me: true,
          service: "iMessage",
        },
      },
      id: "msg_abort_download",
      parts: [
        {
          type: "media",
          url: "https://cdn.example.test/att_2.pdf",
          id: "att_2",
          filename: "summary.pdf",
          mime_type: "application/pdf",
        },
      ],
      sender_handle: {
        handle: "+15550001111",
        id: "handle_sender_456",
        service: "iMessage",
      },
      sent_at: "2026-03-24T11:00:00.000Z",
      service: "iMessage",
    },
    eventId: "evt_abort_download",
  }));
  const timestamp = "1711278000";

  const response = await runtime.dispatch({
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signLinqWebhook("secret-123", payload, timestamp),
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
    path: "/hooks/linq",
  });

  assert.equal(response.statusCode, 202);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.externalId, "linq:msg_abort_download");
  assert.equal(emitted[0]?.attachments[0]?.data ?? null, null);

  controller.abort();
  await watchPromise;
});

test("createLinqWebhookConnector maps verification, validation, routing, and emit failures to stable responses", async () => {
  const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
  const controller = new AbortController();
  const emitFailure = new Error("emit failed");
  let emitAttempts = 0;
  const connector = createLinqWebhookConnector({
    accountId: "default",
    host: "127.0.0.1",
    path: "/hooks/linq",
    port: 8789,
    webhookSecret: "secret-123",
    downloadAttachments: false,
  });

  const watchPromise = connector.watch(
    null,
    async (capture) => {
      emitAttempts += 1;
      if (emitAttempts === 1) {
        throw emitFailure;
      }
      return createPersistedCapture(capture);
    },
    controller.signal,
  );
  runtime.triggerListening();

  const acceptedPayload = JSON.stringify(buildV2026LinqWebhookEvent({
    data: {
      chat_id: "chat_emit_failure",
      from: "+15550002222",
      is_from_me: false,
      message: {
        id: "msg_emit_failure",
        parts: [],
      },
      recipient_phone: "+15559990000",
      sender_handle: {
        handle: "+15550002222",
        id: "handle_emit_failure",
        service: "SMS",
      },
      service: "SMS",
    },
    eventId: "evt_emit_failure",
  }));
  const acceptedTimestamp = "1711278000";
  const acceptedHeaders = {
    "content-type": "application/json",
    "x-webhook-signature": signLinqWebhook("secret-123", acceptedPayload, acceptedTimestamp),
    "x-webhook-timestamp": acceptedTimestamp,
  };

  const missingPathResponse = await runtime.dispatch({
    method: "GET",
    path: "/wrong",
  });
  assert.equal(missingPathResponse.statusCode, 404);
  assert.deepEqual(missingPathResponse.json(), {
    ok: false,
    error: "Not found.",
  });

  const wrongMethodResponse = await runtime.dispatch({
    method: "PATCH",
    path: "/hooks/linq",
  });
  assert.equal(wrongMethodResponse.statusCode, 405);
  assert.deepEqual(wrongMethodResponse.json(), {
    ok: false,
    error: "Method not allowed.",
  });

  const badSignatureResponse = await runtime.dispatch({
    body: acceptedPayload,
    headers: {
      ...acceptedHeaders,
      "x-webhook-signature": "sha256=invalid",
    },
    method: "POST",
    path: "/hooks/linq",
  });
  assert.equal(badSignatureResponse.statusCode, 401);
  assert.match(badSignatureResponse.body, /signature/i);

  const malformedPayload = "{";
  const malformedTimestamp = "1711278001";
  const badPayloadResponse = await runtime.dispatch({
    body: malformedPayload,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signLinqWebhook("secret-123", malformedPayload, malformedTimestamp),
      "x-webhook-timestamp": malformedTimestamp,
    },
    method: "POST",
    path: "/hooks/linq",
  });
  assert.equal(badPayloadResponse.statusCode, 400);

  const ignoredPayload = JSON.stringify(buildV2026LinqWebhookEvent({
    eventId: "evt_ignored",
    eventType: "message.sent",
  }));
  const ignoredTimestamp = "1711278002";
  const ignoredResponse = await runtime.dispatch({
    body: ignoredPayload,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signLinqWebhook("secret-123", ignoredPayload, ignoredTimestamp),
      "x-webhook-timestamp": ignoredTimestamp,
    },
    method: "POST",
    path: "/hooks/linq",
  });
  assert.equal(ignoredResponse.statusCode, 202);
  assert.deepEqual(ignoredResponse.json(), {
    ok: true,
    ignored: true,
    eventType: "message.sent",
  });

  const invalidMessagePayload = JSON.stringify(buildV2026LinqWebhookEvent({
    data: {
      chat_id: "chat_bad_parts",
      message: {
        id: "msg_bad_parts",
        parts: "not-an-array",
      },
    },
    eventId: "evt_bad_parts",
  }));
  const invalidMessageTimestamp = "1711278003";
  const invalidMessageResponse = await runtime.dispatch({
    body: invalidMessagePayload,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signLinqWebhook(
        "secret-123",
        invalidMessagePayload,
        invalidMessageTimestamp,
      ),
      "x-webhook-timestamp": invalidMessageTimestamp,
    },
    method: "POST",
    path: "/hooks/linq",
  });
  assert.equal(invalidMessageResponse.statusCode, 400);
  assert.match(invalidMessageResponse.body, /message\.parts must be an array/u);

  const emitFailureResponse = await runtime.dispatch({
    body: acceptedPayload,
    headers: acceptedHeaders,
    method: "POST",
    path: "/hooks/linq",
  });
  assert.equal(emitFailureResponse.statusCode, 500);
  assert.deepEqual(emitFailureResponse.json(), {
    ok: false,
    error: "emit failed",
  });

  controller.abort();
  await watchPromise;
});

test("createLinqWebhookConnector handles pre-aborted startup, server errors, and close failures", async () => {
  {
    const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector({
      autoListen: false,
    });
    const controller = new AbortController();
    const connector = createLinqWebhookConnector({
      host: "127.0.0.1",
      path: "/hooks/linq",
      port: 8789,
      webhookSecret: "secret-123",
    });
    const watchPromise = connector.watch(
      null,
      async (capture) => createPersistedCapture(capture),
      controller.signal,
    );

    controller.abort();
    runtime.triggerListening();

    await watchPromise;
  }

  {
    const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
    const controller = new AbortController();
    const connector = createLinqWebhookConnector({
      host: "127.0.0.1",
      path: "/hooks/linq",
      port: 8789,
      webhookSecret: "secret-123",
    });
    const watchPromise = connector.watch(
      null,
      async (capture) => createPersistedCapture(capture),
      controller.signal,
    );

    runtime.emitError(new Error("listen failed"));

    await assert.rejects(() => watchPromise, /listen failed/u);
  }

  {
    const { runtime, createLinqWebhookConnector } = await loadLinqWebhookConnector();
    const controller = new AbortController();
    const connector = createLinqWebhookConnector({
      host: "127.0.0.1",
      path: "/hooks/linq",
      port: 8789,
      webhookSecret: "secret-123",
    });
    const watchPromise = connector.watch(
      null,
      async (capture) => createPersistedCapture(capture),
      controller.signal,
    );
    runtime.triggerListening();
    runtime.closeError = new Error("close failed");

    controller.abort();

    await assert.rejects(() => watchPromise, /close failed/u);
    await connector.close?.();
  }
});

async function importConnectorWithMockedHttp(runtime: HttpMockRuntime) {
  vi.resetModules();
  vi.doMock("node:http", () => ({
    createServer: runtime.createServer,
  }));
  return await import("../src/connectors/linq/connector.ts");
}

async function loadLinqWebhookConnector(
  input: { autoListen?: boolean } = {},
): Promise<{ createLinqWebhookConnector: typeof import("../src/connectors/linq/connector.ts").createLinqWebhookConnector; runtime: HttpMockRuntime }> {
  const runtime = createHttpMockRuntime(input);
  const { createLinqWebhookConnector } = await importConnectorWithMockedHttp(runtime);
  return { createLinqWebhookConnector, runtime };
}

function createPersistedCapture(capture: InboundCapture): PersistedCapture {
  return {
    captureId: `cap-${capture.externalId}`,
    eventId: `evt-${capture.externalId}`,
    auditId: `aud-${capture.externalId}`,
    envelopePath: `raw/inbox/${capture.source}/${capture.externalId}.json`,
    createdAt: capture.occurredAt,
    deduped: false,
  };
}

interface DispatchInput {
  body?: string;
  headers?: Record<string, string>;
  host?: string;
  method?: string;
  path?: string;
}

interface MockResponse {
  body: string;
  headers: Record<string, string>;
  json(): Record<string, unknown>;
  setHeader(name: string, value: string): void;
  statusCode: number;
  end(chunk?: string): void;
}

interface HttpMockRuntime {
  closeError: Error | null;
  createServer(
    handler: (request: AsyncIterable<Uint8Array> & Record<string, unknown>, response: MockResponse) => unknown,
  ): {
    close(callback: (error?: Error | undefined) => void): void;
    listen(port: number, host: string, callback: () => void): void;
    on(event: "error", callback: (error: Error) => void): void;
  };
  dispatch(input?: DispatchInput): Promise<MockResponse>;
  emitError(error: Error): void;
  listenCalls: Array<{ host: string; port: number }>;
  triggerListening(): void;
}

function createHttpMockRuntime(
  input: { autoListen?: boolean } = {},
): HttpMockRuntime {
  const { autoListen = true } = input;
  let errorListener: ((error: Error) => void) | null = null;
  let requestHandler:
    | ((request: AsyncIterable<Uint8Array> & Record<string, unknown>, response: MockResponse) => unknown)
    | null = null;
  let listenCallback: (() => void) | null = null;

  const runtime: HttpMockRuntime = {
    closeError: null,
    createServer(handler) {
      requestHandler = handler;
      return {
        close(callback) {
          const error = runtime.closeError;
          runtime.closeError = null;
          callback(error ?? undefined);
        },
        listen(port, host, callback) {
          runtime.listenCalls.push({ host, port });
          listenCallback = callback;
          if (autoListen) {
            callback();
          }
        },
        on(_event, callback) {
          errorListener = callback;
        },
      };
    },
    async dispatch(dispatchInput = {}) {
      assert.ok(requestHandler, "Expected createServer to register a request handler.");

      const body = dispatchInput.body ?? "";
      const request = {
        headers: {
          host: dispatchInput.host ?? "127.0.0.1",
          ...(dispatchInput.headers ?? {}),
        },
        method: dispatchInput.method ?? "GET",
        url: dispatchInput.path ?? "/hooks/linq",
        async *[Symbol.asyncIterator]() {
          if (body.length > 0) {
            yield Buffer.from(body);
          }
        },
      } as AsyncIterable<Uint8Array> & Record<string, unknown>;
      const response = createMockResponse();

      await requestHandler(request, response);
      return response;
    },
    emitError(error) {
      errorListener?.(error);
    },
    listenCalls: [],
    triggerListening() {
      listenCallback?.();
    },
  };

  return runtime;
}

function createMockResponse(): MockResponse {
  return {
    body: "",
    headers: {},
    json() {
      return JSON.parse(this.body);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    statusCode: 200,
    end(chunk = "") {
      this.body += chunk;
    },
  };
}
