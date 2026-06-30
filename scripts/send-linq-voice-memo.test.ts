import { describe, expect, it } from "vitest";

import {
  parseLinqChatIdFromUrl,
  readLinqVoiceMemoSendOptions,
  runLinqVoiceMemoSend,
  type LinqVoiceMemoSendOptions,
} from "./send-linq-voice-memo.ts";

describe("send linq voice memo", () => {
  it("reads live identifiers from env and parses chat urls", () => {
    const options = readLinqVoiceMemoSendOptions(["--confirm-live-linq"], {
      LINQ_API_TOKEN: "token_secret_123",
      LINQ_VOICE_MEMO_CHAT_URL:
        "https://dashboard.linqapp.com/team-inbox/team_secret/phone/%2B15550100001/chat/chat_secret_123",
      LINQ_VOICE_MEMO_FILE: "/tmp/voice-secret.mp3",
    });

    expect(options.chatId).toBe("chat_secret_123");
    expect(options.confirmLiveLinq).toBe(true);
    expect(options.contentType).toBe("audio/mpeg");
    expect(options.uploadFilename).toBe("voice-memo.mp3");
  });

  it("rejects raw chat and file CLI arguments to keep live values out of argv", () => {
    expect(() =>
      readLinqVoiceMemoSendOptions(["--chat-id", "chat_secret_123"], {
        LINQ_API_TOKEN: "token_secret_123",
        LINQ_VOICE_MEMO_FILE: "/tmp/voice-secret.mp3",
      }),
    ).toThrow(/^Unknown argument: --chat-id$/u);
    expect(() =>
      readLinqVoiceMemoSendOptions(["/tmp/voice-secret.mp3"], {
        LINQ_API_TOKEN: "token_secret_123",
        LINQ_VOICE_MEMO_CHAT_ID: "chat_secret_123",
      }),
    ).toThrow(/^Unknown argument: <redacted>$/u);
  });

  it("refuses live Linq calls without explicit confirmation", async () => {
    await expect(
      runLinqVoiceMemoSend({
        ...createOptions(),
        confirmLiveLinq: false,
      }),
    ).rejects.toThrow(/--confirm-live-linq/u);
  });

  it("rejects non-canonical Linq API base urls unless explicitly allowed", async () => {
    expect(() =>
      readLinqVoiceMemoSendOptions(["--confirm-live-linq"], {
        LINQ_API_BASE_URL: "https://linq.example.test/api/partner/v3",
        LINQ_API_TOKEN: "token_secret_123",
        LINQ_VOICE_MEMO_CHAT_ID: "chat_secret_123",
        LINQ_VOICE_MEMO_FILE: "/tmp/voice-secret.mp3",
      }),
    ).toThrow(/canonical Linq API URL/u);

    const options = readLinqVoiceMemoSendOptions(["--confirm-live-linq"], {
      LINQ_API_BASE_URL: "https://linq.example.test/api/partner/v3",
      LINQ_API_TOKEN: "token_secret_123",
      LINQ_VOICE_MEMO_ALLOW_NON_LINQ_BASE_URL: "1",
      LINQ_VOICE_MEMO_CHAT_ID: "chat_secret_123",
      LINQ_VOICE_MEMO_FILE: "/tmp/voice-secret.mp3",
    });

    expect(options.allowNonLinqApiBaseUrl).toBe(true);
    expect(options.apiBaseUrl).toBe("https://linq.example.test/api/partner/v3");
  });

  it("uploads bytes and sends a voice memo without returning raw identifiers", async () => {
    const calls: ObservedFetchCall[] = [];

    const report = await runLinqVoiceMemoSend(createOptions(), {
      env: {
        LINQ_API_TOKEN: "token_secret_123",
      },
      fetchImplementation: createFetchStub(calls),
      readFile: async () => new Uint8Array([1, 2, 3, 4]),
      statFile: async () => ({
        isFile: () => true,
        size: 4,
      }),
    });

    expect(calls.map((call) => call.method)).toEqual(["POST", "PUT", "POST"]);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/partner/v3/attachments",
      "/upload-secret",
      "/api/partner/v3/chats/chat_secret_123/voicememo",
    ]);
    expect(calls[0]?.body).toEqual({
      content_type: "audio/mpeg",
      filename: "voice-memo.mp3",
      size_bytes: 4,
    });
    expect(calls[1]?.blobSize).toBe(4);
    expect(calls[2]?.body).toEqual({
      attachment_id: "attachment_secret_123",
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("chat_secret_123");
    expect(serialized).not.toContain("attachment_secret_123");
    expect(serialized).not.toContain("message_secret_123");
    expect(serialized).not.toContain("token_secret_123");
    expect(serialized).not.toContain("upload-secret");
    expect(serialized).not.toContain("/tmp/voice-secret.mp3");
    expect(report.upload.attachment.present).toBe(true);
    expect(report.voiceMemo.providerMessage.present).toBe(true);
    expect(report.voiceMemo.voiceMemoUrlPresent).toBe(true);
  });

  it("rejects mismatched explicit chat id and chat url", () => {
    expect(() =>
      readLinqVoiceMemoSendOptions(["--confirm-live-linq"], {
        LINQ_API_TOKEN: "token_secret_123",
        LINQ_VOICE_MEMO_CHAT_ID: "chat_secret_456",
        LINQ_VOICE_MEMO_CHAT_URL:
          "https://dashboard.linqapp.com/team-inbox/team_secret/chat/chat_secret_123",
        LINQ_VOICE_MEMO_FILE: "/tmp/voice-secret.mp3",
      }),
    ).toThrow(/different chats/u);
  });

  it("does not leak local file paths when file byte reads fail", async () => {
    await expect(
      runLinqVoiceMemoSend(createOptions(), {
        env: {
          LINQ_API_TOKEN: "token_secret_123",
        },
        readFile: async () => {
          throw new Error("cannot read /tmp/voice-secret.mp3");
        },
        statFile: async () => ({
          isFile: () => true,
          size: 4,
        }),
      }),
    ).rejects.toThrow(/^Voice memo file bytes could not be read\.$/u);
  });

  it("extracts chat ids from dashboard urls", () => {
    expect(parseLinqChatIdFromUrl(
      "https://dashboard.linqapp.com/team-inbox/team_secret/phone/%2B15550100001/chat/chat_secret_123",
    )).toBe("chat_secret_123");
  });
});

interface ObservedFetchCall {
  blobSize: number | null;
  body: Record<string, unknown> | null;
  method: string;
  url: string;
}

function createOptions(
  overrides: Partial<LinqVoiceMemoSendOptions> = {},
): LinqVoiceMemoSendOptions {
  return {
    apiBaseUrl: "https://api.linqapp.com/api/partner/v3",
    chatId: "chat_secret_123",
    confirmLiveLinq: true,
    contentType: "audio/mpeg",
    filePath: "/tmp/voice-secret.mp3",
    fingerprintSecret: "fingerprint-secret",
    uploadFilename: "voice-memo.mp3",
    ...overrides,
  };
}

function createFetchStub(calls: ObservedFetchCall[]): typeof fetch {
  return async (input, init) => {
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : null;
    const blobSize = init?.body instanceof Blob ? init.body.size : null;
    calls.push({
      blobSize,
      body,
      method: init?.method ?? "GET",
      url: String(input),
    });

    if (init?.method === "POST" && String(input).endsWith("/attachments")) {
      return new Response(JSON.stringify({
        attachment_id: "attachment_secret_123",
        download_url: "https://cdn.example.test/download-secret",
        expires_at: "2026-06-26T23:00:00.000Z",
        http_method: "PUT",
        required_headers: {
          "content-type": "audio/mpeg",
          "x-upload-token": "upload_secret_123",
        },
        upload_url: "https://uploads.example.test/upload-secret",
      }), {
        status: 200,
      });
    }

    if (init?.method === "PUT") {
      return new Response(null, { status: 200 });
    }

    if (init?.method === "POST" && String(input).endsWith("/voicememo")) {
      return new Response(JSON.stringify({
        voice_memo: {
          id: "message_secret_123",
          chat: {
            id: "chat_secret_123",
          },
          voice_memo: {
            id: "attachment_secret_123",
            url: "https://cdn.example.test/download-secret",
          },
        },
      }), {
        status: 200,
      });
    }

    return new Response(null, { status: 404 });
  };
}
