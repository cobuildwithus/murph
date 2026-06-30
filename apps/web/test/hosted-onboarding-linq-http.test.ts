import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

import {
  createHostedLinqChat,
  createHostedLinqWebhookSubscription,
  sendHostedLinqChatMessage,
  sendHostedLinqReadReceipt,
  sendHostedLinqVoiceMemo,
  startHostedLinqTypingIndicator,
  uploadHostedLinqAttachment,
} from "@/src/lib/hosted-onboarding/linq";

const originalFetch = globalThis.fetch;
const describe = baseDescribe.sequential;

function createJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

function expectRequestInit(init: RequestInit | undefined): RequestInit {
  if (!init) {
    throw new Error("Expected fetch init");
  }

  return init;
}

function readRequestSignal(init: RequestInit | undefined): AbortSignal | undefined {
  const signal = init?.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

function readJsonRequestBody(init: RequestInit | undefined): unknown {
  const body = expectRequestInit(init).body;
  if (typeof body !== "string") {
    throw new Error("Expected string request body");
  }

  return JSON.parse(body);
}

describe("sendHostedLinqChatMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("fails with the hosted retryable error when the Linq API request hangs past the timeout", async () => {
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = readRequestSignal(init);
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("aborted")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    });
    const expectation = expect(result).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply timed out.",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await expectation;
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/messages", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("marks 5xx Linq API failures as retryable", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({}, 503);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply failed with HTTP 503.",
      retryable: true,
    });
  });

  it("treats Linq 429 responses as retryable", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({}, 429);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply failed with HTTP 429.",
      retryable: true,
    });
  });

  it("sends Linq idempotency keys on existing-chat replies", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        chat_id: "chat_123",
        message: {
          id: "msg_123",
        },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedLinqChatMessage({
      chatId: "chat_123",
      idempotencyKey: "linq-message:evt_123",
      message: "hello",
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected fetch to be called");
    }
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(url).toEqual(new URL("chats/chat_123/messages", "https://linq.example.test/api/partner/v3/"));
    expect(readJsonRequestBody(init)).toEqual({
      message: {
        idempotency_key: "linq-message:evt_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
    });
  });

  it("treats an empty success body as a successful send", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendHostedLinqReadReceipt", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts read acknowledgements to the v3 chat read endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqReadReceipt({
      chatId: "chat_123",
      timeoutMs: 750,
    })).resolves.toEqual({
      ok: true,
      status: 204,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/read", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

describe("startHostedLinqTypingIndicator", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts typing indicators to the v3 chat typing endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startHostedLinqTypingIndicator({
      chatId: "chat_123",
      timeoutMs: 750,
    })).resolves.toEqual({
      ok: true,
      status: 204,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/typing", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

describe("createHostedLinqChat", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts first-contact chat creation payloads to the v3 chats endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        chat: {
          id: "chat_123",
          message: {
            id: "msg_123",
          },
        },
      }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createHostedLinqChat({
      from: "+15550000000",
      idempotencyKey: "chat-create:evt_123",
      message: "hello",
      to: ["+15551234567"],
    });

    expect(result).toEqual({
      chatId: "chat_123",
      messageId: "msg_123",
    });
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected fetch to be called");
    }
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(url).toEqual(new URL("chats", "https://linq.example.test/api/partner/v3/"));
    expect(expectRequestInit(init).method).toBe("POST");
    expect(readJsonRequestBody(init)).toEqual({
      from: "+15550000000",
      message: {
        idempotency_key: "chat-create:evt_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      to: ["+15551234567"],
    });
  });
});

describe("hosted Linq attachment voice memo transport", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("creates an attachment and uploads raw bytes to the presigned URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = input.toString();

      if (url === "https://linq.example.test/api/partner/v3/attachments") {
        return createJsonResponse({
          attachment_id: "attachment_123",
          download_url: "https://cdn.linq.example.test/attachment_123",
          expires_at: "2026-06-29T12:00:00.000Z",
          http_method: "PUT",
          required_headers: {
            "content-type": "audio/x-m4a",
            "x-upload-token": "upload-token",
          },
          upload_url: "https://uploads.linq.example.test/attachment_123",
        }, 201);
      }

      if (url === "https://uploads.linq.example.test/attachment_123") {
        return new Response(null, { status: 200 });
      }

      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadHostedLinqAttachment({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a",
      filename: "murph-ops-voice-memo.m4a",
      sizeBytes: 3,
    })).resolves.toEqual({
      attachmentId: "attachment_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("attachments", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        body: JSON.stringify({
          content_type: "audio/x-m4a",
          filename: "murph-ops-voice-memo.m4a",
          size_bytes: 3,
        }),
        method: "POST",
      }),
    );
    const uploadInit = expectRequestInit(fetchMock.mock.calls[1]?.[1]);
    const uploadBody = uploadInit.body;
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://uploads.linq.example.test/attachment_123");
    expect(uploadInit.method).toBe("PUT");
    expect(uploadInit.redirect).toBe("error");
    expect(uploadBody).toBeInstanceOf(ArrayBuffer);
    if (!(uploadBody instanceof ArrayBuffer)) {
      throw new Error("Expected attachment upload body to be an ArrayBuffer.");
    }
    expect(Array.from(new Uint8Array(uploadBody))).toEqual([1, 2, 3]);
    expect(new Headers(uploadInit.headers).get("content-type")).toBe("audio/x-m4a");
    expect(new Headers(uploadInit.headers).get("x-upload-token")).toBe("upload-token");
    expect(new Headers(uploadInit.headers).get("authorization")).toBeNull();
  });

  it("rejects unsafe attachment upload URLs before PUTing bytes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = input.toString();

      if (url === "https://linq.example.test/api/partner/v3/attachments") {
        return createJsonResponse({
          attachment_id: "attachment_123",
          expires_at: "2026-06-29T12:00:00.000Z",
          http_method: "PUT",
          required_headers: {
            "content-type": "audio/x-m4a",
          },
          upload_url: "https://127.0.0.1/upload",
        }, 201);
      }

      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadHostedLinqAttachment({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a",
      filename: "murph-ops-voice-memo.m4a",
      sizeBytes: 3,
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload URL host is not safe.",
      retryable: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe attachment upload headers before PUTing bytes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = input.toString();

      if (url === "https://linq.example.test/api/partner/v3/attachments") {
        return createJsonResponse({
          attachment_id: "attachment_123",
          expires_at: "2026-06-29T12:00:00.000Z",
          http_method: "PUT",
          required_headers: {
            authorization: "Bearer unsafe",
            "content-type": "audio/x-m4a",
          },
          upload_url: "https://uploads.linq.example.test/attachment_123",
        }, 201);
      }

      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadHostedLinqAttachment({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a",
      filename: "murph-ops-voice-memo.m4a",
      sizeBytes: 3,
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload headers included an unsafe header.",
      retryable: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects attachment upload redirects instead of following them", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url === "https://linq.example.test/api/partner/v3/attachments") {
        return createJsonResponse({
          attachment_id: "attachment_123",
          expires_at: "2026-06-29T12:00:00.000Z",
          http_method: "PUT",
          required_headers: {
            "content-type": "audio/x-m4a",
          },
          upload_url: "https://uploads.linq.example.test/attachment_123",
        }, 201);
      }

      if (url === "https://uploads.linq.example.test/attachment_123") {
        expect(expectRequestInit(init).redirect).toBe("error");
        return new Response(null, {
          headers: {
            location: "https://169.254.169.254/latest/meta-data",
          },
          status: 307,
        });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadHostedLinqAttachment({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a",
      filename: "murph-ops-voice-memo.m4a",
      sizeBytes: 3,
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload failed with HTTP 307.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends a native voice memo by attachment id", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        voice_memo: {
          id: "voice_123",
        },
      }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqVoiceMemo({
      attachmentId: "attachment_123",
      chatId: "chat_123",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/voicememo", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(readJsonRequestBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      attachment_id: "attachment_123",
    });
  });

  it("rejects attachment upload responses with unsupported methods before uploading bytes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = input.toString();

      if (url === "https://linq.example.test/api/partner/v3/attachments") {
        return createJsonResponse({
          attachment_id: "attachment_123",
          expires_at: "2026-06-29T12:00:00.000Z",
          http_method: "POST",
          required_headers: {
            "content-type": "audio/x-m4a",
          },
          upload_url: "https://uploads.linq.example.test/attachment_123",
        }, 201);
      }

      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadHostedLinqAttachment({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/x-m4a",
      filename: "murph-ops-voice-memo.m4a",
      sizeBytes: 3,
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      message: "Linq attachment upload response returned an unsupported upload method.",
      retryable: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createHostedLinqWebhookSubscription", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts webhook subscriptions to the v3 webhook-subscriptions endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        created_at: "2026-04-04T00:00:00.000Z",
        id: "whsub_123",
        is_active: true,
        phone_numbers: ["+15550000000"],
        signing_secret: "whsec_123",
        subscribed_events: ["message.received"],
        target_url: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
        updated_at: "2026-04-04T00:00:00.000Z",
      }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createHostedLinqWebhookSubscription({
      phoneNumbers: ["+15550000000"],
      subscribedEvents: ["message.received"],
      targetUrl: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
    });

    expect(result).toEqual({
      createdAt: "2026-04-04T00:00:00.000Z",
      id: "whsub_123",
      isActive: true,
      phoneNumbers: ["+15550000000"],
      signingSecret: "whsec_123",
      subscribedEvents: ["message.received"],
      targetUrl: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
      updatedAt: "2026-04-04T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("webhook-subscriptions", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        body: JSON.stringify({
          phone_numbers: ["+15550000000"],
          subscribed_events: ["message.received"],
          target_url: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
        }),
        method: "POST",
      }),
    );
  });

  it("rejects webhook subscriptions with events outside the pinned Linq SDK contract", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHostedLinqWebhookSubscription({
      subscribedEvents: ["message.received", "unsupported.event"],
      targetUrl: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
    })).rejects.toThrow("Linq subscribed event is not supported by the Linq SDK contract.");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
