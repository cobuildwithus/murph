import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  sendLinqMessage,
  sendTelegramImageMessage,
  sendTelegramMessage,
  sendTelegramVoiceMemoMessage,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine/assistant-channel-runtime";
import {
  downloadHostedProviderTelegramFile,
  getHostedProviderTelegramFile,
} from "@murphai/assistant-runtime/hosted-provider-effects";
import {
  deleteTelegramMessages,
  setTelegramMessageReaction,
} from "@murphai/operator-config/telegram-runtime";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
  hostedRunnerIntercept,
} from "../src/runner-egress-intercept.ts";
import {
  HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";
import {
  createCloudflareHostedProviderFetch,
} from "../src/runtime-platform/provider-fetch.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import type {
  WorkerProviderEgressTokenValidationResult,
} from "../src/worker-contracts.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

const PROVIDER_EGRESS_TOKEN = "provider-egress-token-conformance";

const WRITE_FENCE_HEADERS = {
  [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_1",
  [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "7",
  [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "4",
  [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
} as const;

const TELEGRAM_CLIENT_ROUTES = [
  { method: "POST", operation: "sendMessage" },
  { method: "POST", operation: "sendPhoto" },
  { method: "POST", operation: "sendVoice" },
  { method: "POST", operation: "sendChatAction" },
  { method: "POST", operation: "deleteMessages" },
  { method: "POST", operation: "deleteBusinessMessages" },
  { method: "POST", operation: "setMessageReaction" },
  { method: "GET", operation: "getFile" },
] as const;

const NUTRITION_CARD = {
  kind: "daily_nutrition",
  localDate: "2026-08-06",
  mealCount: 1,
  totals: {
    calories: { mealCount: 1, total: 520 },
    carbsGrams: { mealCount: 1, total: 48 },
    fatGrams: { mealCount: 1, total: 20 },
    proteinGrams: { mealCount: 1, total: 42 },
  },
} as const;

const ELEVENLABS_MP3_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
const TELEGRAM_FILE_BYTES = new Uint8Array([1, 2, 3]);

type ForwardedRequest = {
  body: unknown;
  headers: Headers;
  method: string;
  url: URL;
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted provider egress conformance", () => {
  it("drives the real Linq response-card client through the production provider-fetch boundary", async () => {
    const validateRuntimeProviderEgressToken = vi.fn(
      createProviderEgressTokenValidationResult,
    );
    const validateRuntimeWriteFence = vi.fn(async () => {
      throw new Error("Provider fetch should authorize with the invocation token.");
    });
    const env = createProviderInterceptEnv({
      validateRuntimeProviderEgressToken,
      validateRuntimeWriteFence,
    });
    const forwarded: ForwardedRequest[] = [];
    vi.stubGlobal("fetch", createProviderUpstreamFetch(forwarded));

    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: "+15550000000",
      idempotencyKey: "card_egress_conformance_1",
      message: "Nutrition summary",
      target: "chat_1",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: {
        LINQ_API_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      },
      fetchImplementation: createProductionProviderFetch(env),
    })).resolves.toMatchObject({
      providerMessageId: "message_1",
      target: "chat_1",
    });

    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(validateRuntimeProviderEgressToken).toHaveBeenCalledTimes(2);
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0]).toMatchObject({
      body: {
        address: "+15550000001",
        from: "+15550000000",
      },
      method: "POST",
    });
    expect(forwarded[0]?.url.pathname)
      .toBe("/api/partner/v3/capability/check_imessage");
    expect(forwarded[0]?.headers.get("authorization"))
      .toBe("Bearer linq-worker-secret");
    expect(forwarded[1]?.body).toMatchObject({
      message: {
        idempotency_key: "card_egress_conformance_1",
        preferred_service: "iMessage",
        parts: [{ interactive: true, type: "imessage_app" }],
      },
    });
    expect(forwarded[1]?.url.pathname)
      .toBe("/api/partner/v3/chats/chat_1/messages");
    assertAuthorityHeadersStripped(forwarded);
  });

  it.each([
    "getMe",
    "getUpdates",
    "getWebhookInfo",
    "deleteWebhook",
    "getChat",
    "answerCallbackQuery",
  ])("keeps Telegram %s outside hosted runner egress", async (operation) => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const upstreamFetch = vi.fn<typeof fetch>(async () =>
      new Response("unexpected upstream call"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await hostedRunnerIntercept(
      new Request(
        `https://api.telegram.org/bot${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}/${operation}`,
        {
          headers: WRITE_FENCE_HEADERS,
          method: "POST",
        },
      ),
      createProviderInterceptEnv({ validateRuntimeWriteFence }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("drives every hosted Telegram client route through the production provider-fetch boundary", async () => {
    const validateRuntimeProviderEgressToken = vi.fn(
      createProviderEgressTokenValidationResult,
    );
    const validateRuntimeWriteFence = vi.fn(async () => {
      throw new Error("Provider fetch should authorize with the invocation token.");
    });
    const env = createProviderInterceptEnv({
      validateRuntimeProviderEgressToken,
      validateRuntimeWriteFence,
    });
    const forwarded: ForwardedRequest[] = [];
    vi.stubGlobal("fetch", createProviderUpstreamFetch(forwarded));

    const clientEnv = {
      ELEVENLABS_API_KEY: "elevenlabs-test-key",
      TELEGRAM_API_BASE_URL: "https://api.telegram.org",
      TELEGRAM_BOT_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      TELEGRAM_FILE_BASE_URL: "https://api.telegram.org/file",
    } satisfies NodeJS.ProcessEnv;
    const fetchImplementation = createProductionProviderFetch(env);

    await sendTelegramMessage({
      message: "hello",
      target: "123",
    }, {
      env: clientEnv,
      fetchImplementation,
      maxDeliveryAttempts: 1,
    });
    await sendTelegramImageMessage({
      media: [{
        alt: "photo",
        kind: "image",
        source: "conformance",
        url: "https://images.example.test/photo.jpg",
      }],
      message: "photo",
      target: "123",
    }, {
      env: clientEnv,
      fetchImplementation,
      maxDeliveryAttempts: 1,
    });
    await sendTelegramVoiceMemoMessage({
      filename: "memo",
      generation: {
        kind: "elevenlabs_speech",
        modelId: "eleven_multilingual_v2",
        outputFormat: "mp3_44100_128",
        text: "Short memo.",
        voiceId: "voice_murph",
      },
      target: "123",
    }, {
      env: clientEnv,
      fetchImplementation,
      maxDeliveryAttempts: 1,
    });
    const typing = await startTelegramTypingIndicator({
      target: "123",
    }, {
      env: clientEnv,
      fetchImplementation,
    });
    await typing.stop();
    await deleteTelegramMessages({
      messageIds: ["101"],
      target: "123",
    }, {
      env: clientEnv,
      fetchImplementation,
    });
    await deleteTelegramMessages({
      messageIds: ["102"],
      target: {
        businessConnectionId: "business_1",
        chatId: "123",
      },
    }, {
      env: clientEnv,
      fetchImplementation,
    });
    await setTelegramMessageReaction({
      reaction: "heart",
      target: "123",
      targetMessageId: "103",
    }, {
      env: clientEnv,
      fetchImplementation,
    });
    await expect(getHostedProviderTelegramFile({
      fileId: "file_1",
    }, {
      env: clientEnv,
      fetchImplementation,
    })).resolves.toMatchObject({
      file_id: "file_1",
      file_path: "photos/file_1.jpg",
    });
    await expect(downloadHostedProviderTelegramFile({
      filePath: "photos/file_1.jpg",
    }, {
      env: clientEnv,
      fetchImplementation,
    })).resolves.toEqual(TELEGRAM_FILE_BYTES);

    const botPrefix = "/bottelegram-worker-secret/";
    const botRoutes = forwarded
      .filter((request) => request.url.pathname.startsWith(botPrefix))
      .map((request) => ({
        method: request.method,
        operation: request.url.pathname.slice(botPrefix.length),
      }));
    expect(botRoutes).toEqual(TELEGRAM_CLIENT_ROUTES);
    expect(
      forwarded.find((request) => request.url.pathname.endsWith("/getFile"))
        ?.url.search,
    ).toBe("?file_id=file_1");
    expect(
      forwarded.find((request) => request.url.pathname.endsWith("/sendVoice"))
        ?.body,
    ).toMatchObject({
      contentType: expect.stringContaining("multipart/form-data; boundary="),
    });
    expect(forwarded.at(-1)?.url.toString()).toBe(
      "https://api.telegram.org/file/bottelegram-worker-secret/photos/file_1.jpg",
    );
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(validateRuntimeProviderEgressToken).toHaveBeenCalledTimes(9);
    assertAuthorityHeadersStripped(forwarded);
  });
});

function createProviderUpstreamFetch(
  forwarded: ForwardedRequest[],
): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request
      ? input.clone()
      : new Request(input, init);
    const url = new URL(request.url);
    forwarded.push({
      body: await readForwardedBody(request),
      headers: request.headers,
      method: request.method,
      url,
    });

    if (url.pathname.endsWith("/capability/check_imessage")) {
      return Response.json({
        address: "+15550000001",
        available: true,
      });
    }
    if (url.pathname.endsWith("/chats/chat_1/messages")) {
      return Response.json({ message: { id: "message_1" } });
    }
    if (url.pathname.startsWith("/file/bottelegram-worker-secret/")) {
      return new Response(TELEGRAM_FILE_BYTES, {
        headers: { "content-type": "image/jpeg" },
      });
    }

    const operation = url.pathname.split("/").at(-1);
    if (operation === "getFile") {
      return Response.json({
        ok: true,
        result: {
          file_id: "file_1",
          file_path: "photos/file_1.jpg",
          file_size: TELEGRAM_FILE_BYTES.byteLength,
          file_unique_id: "unique_1",
        },
      });
    }
    if (
      operation === "sendMessage"
      || operation === "sendPhoto"
      || operation === "sendVoice"
    ) {
      return Response.json({
        ok: true,
        result: { message_id: 101 },
      });
    }
    return Response.json({ ok: true, result: true });
  });
}

function createProductionProviderFetch(
  env: RunnerOutboundEnvironmentSource,
): typeof fetch {
  return createCloudflareHostedProviderFetch(
    "member_123",
    async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(input, init);
      if (new URL(request.url).hostname === "api.elevenlabs.io") {
        return new Response(ELEVENLABS_MP3_BYTES, {
          headers: { "content-type": "audio/mpeg" },
        });
      }
      return await hostedRunnerIntercept(
        request,
        env,
        { containerId: "opaque-container-id" },
      );
    },
    {
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "7",
        providerEgressToken: PROVIDER_EGRESS_TOKEN,
        userId: "member_123",
        workspaceVersion: "4",
      }),
    },
  );
}

async function readForwardedBody(request: Request): Promise<unknown> {
  if (request.body === null) {
    return null;
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await request.clone().json();
  }
  return { contentType };
}

function createProviderInterceptEnv(input: {
  validateRuntimeProviderEgressToken?: (input: {
    providerEgressToken: string;
    userId: string;
  }) => Promise<WorkerProviderEgressTokenValidationResult>;
  validateRuntimeWriteFence: (input: {
    attemptId: string;
    generation: string;
    userId: string;
  }) => Promise<boolean>;
}): RunnerOutboundEnvironmentSource {
  const env: RunnerOutboundEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    LINQ_API_TOKEN: "linq-worker-secret",
    TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
    USER_RUNNER: {
      getByName: () => ({
        validateRuntimeProviderEgressCredential: async () => ({ owns: false }),
        validateRuntimeProviderEgressToken:
          input.validateRuntimeProviderEgressToken
          ?? (async () => ({ owns: false })),
        validateRuntimeWriteFence: input.validateRuntimeWriteFence,
      }),
    },
  };
  return env;
}

async function createProviderEgressTokenValidationResult(input: {
  providerEgressToken: string;
  userId: string;
}): Promise<WorkerProviderEgressTokenValidationResult> {
  expect(input).toEqual({
    providerEgressToken: PROVIDER_EGRESS_TOKEN,
    userId: "member_123",
  });
  return {
    attemptId: "attempt_1",
    leaseGeneration: "7",
    owns: true,
    userId: input.userId,
    workspaceVersion: "4",
  };
}

function assertAuthorityHeadersStripped(
  requests: readonly ForwardedRequest[],
): void {
  for (const request of requests) {
    expect(request.headers.has(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER)).toBe(false);
    expect(request.headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe(false);
    expect(request.headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe(false);
    expect(request.headers.has(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe(false);
    expect(request.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  }
}
