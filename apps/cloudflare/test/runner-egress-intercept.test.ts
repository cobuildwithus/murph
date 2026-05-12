import { describe, expect, it, vi, afterEach } from "vitest";

import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
  hostedRunnerIntercept,
} from "../src/runner-egress-intercept.ts";
import {
  HOSTED_EXECUTION_RUNNER_LINQ_SEND_PATH,
} from "../src/runner-effects-contract.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

const WRITE_FENCE_HEADERS = {
  "x-hosted-runtime-attempt-id": "attempt_1",
  "x-hosted-runtime-lease-generation": "7",
  "x-hosted-runtime-workspace-version": "4",
} as const;
const BOUND_USER_WRITE_FENCE_HEADERS = {
  ...WRITE_FENCE_HEADERS,
  [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hostedRunnerIntercept", () => {
  it("preserves runtime write-fence headers for internal intercepted requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      chat_id: "linq_chat_123",
      message: {
        id: "linq_message_123",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_LINQ_SEND_PATH}`, {
        body: JSON.stringify({
          message: "hello",
          target: "linq_chat_123",
          targetKind: "thread",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "7",
          "x-hosted-runtime-workspace-version": "42",
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "42",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects internal virtual-host requests without a runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("http://web-control.worker/internal/hosted-runtime/mailbox-payload/decode", {
        headers: {
          [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("injects OpenAI authorization without forwarding runtime authority headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: {
          ...WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.openai.com/v1/responses");
    expect(forwarded.headers.get("authorization")).toBe("Bearer openai-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
  });

  it("does not inject OpenAI authorization without the sentinel bearer token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.openai.com/v1/responses");
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
  });

  it("allows the observed OpenAI models read path", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/models", {
        headers: {
          ...WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.openai.com/v1/models");
    const authorization = forwarded.headers.get("authorization");
    expect(authorization?.startsWith("Bearer ")).toBe(true);
    expect(authorization?.slice("Bearer ".length)).toBe("openai-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
  });

  it("rejects OpenAI paths outside the explicit hosted runner policy", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/chat/completions", {
        body: JSON.stringify({ messages: [] }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...WRITE_FENCE_HEADERS,
        },
        method: "POST",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects wrong OpenAI methods on otherwise allowed paths", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.openai.com/v1/responses", {
        headers: WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        OPENAI_API_KEY: "openai-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("injects Mapbox access tokens only for allowed GET path families", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request(
        `https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4?access_token=${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        {
          headers: WRITE_FENCE_HEADERS,
          method: "GET",
        },
      ),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.origin).toBe("https://api.mapbox.com");
    expect(forwardedUrl.pathname).toBe("/directions/v5/mapbox/walking/1,2;3,4");
    expect(forwardedUrl.searchParams.get("access_token")).toBe("mapbox-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
  });

  it("does not inject Mapbox tokens without the sentinel query parameter", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4", {
        headers: WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.searchParams.has("access_token")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
  });

  it("rejects non-GET Mapbox requests on otherwise allowed path families", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4", {
        body: JSON.stringify({ coordinates: [] }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...WRITE_FENCE_HEADERS,
        },
        method: "POST",
      }),
      createInterceptEnv({
        MAPBOX_ACCESS_TOKEN: "mapbox-worker-secret",
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strips runtime authority headers from unclassified passthrough egress", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://unexpected.example.test/path", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({}),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://unexpected.example.test/path");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-lease-generation")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-workspace-version")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("requires the active write fence before injecting Linq credentials for sends", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("requires the active write fence before injecting Linq credentials for reads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      phone_numbers: [],
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/phone_numbers", {
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.linqapp.com/api/partner/v3/phone_numbers");
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("honors configured Linq base URL pathname prefixes before validating allowed suffixes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test/custom/tenant/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: {
          ...BOUND_USER_WRITE_FENCE_HEADERS,
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3/",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://linq.example.test/custom/tenant/v3/chats/chat_1/messages");
    expect(forwarded.headers.get("authorization")).toBe("Bearer linq-worker-secret");
  });

  it("does not inject Linq credentials without the sentinel bearer token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("passthrough"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages");
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("does not inject Linq credentials for paths outside the configured base URL prefix", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("passthrough"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://linq.example.test/api/partner/v3/chats/chat_1/messages", {
        body: JSON.stringify({ text: "hello" }),
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_BASE_URL: "https://linq.example.test/custom/tenant/v3",
        LINQ_API_TOKEN: "linq-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://linq.example.test/api/partner/v3/chats/chat_1/messages");
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects Linq writes without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/chats/chat_1/messages", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "POST",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq reads without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.linqapp.com/api/partner/v3/phone_numbers", {
        headers: {
          authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        },
        method: "GET",
      }),
      createInterceptEnv({
        LINQ_API_TOKEN: "linq-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites Telegram sentinel tokens before upstream fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/sendMessage", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://api.telegram.org/bottelegram-worker-secret/sendMessage");
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("requires the active write fence before rewriting Telegram getFile", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const validateRuntimeWriteFence = vi.fn(async () => true);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/getFile?file_id=file_1", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
        validateRuntimeWriteFence,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "7",
      userId: "member_123",
      workspaceVersion: "4",
    });
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe(
      "https://api.telegram.org/bottelegram-worker-secret/getFile?file_id=file_1",
    );
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("rejects Telegram getFile without a valid runtime write fence", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unexpected"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://api.telegram.org/bot__cloudflare_injected__/getFile?file_id=file_1", {
        method: "GET",
      }),
      createInterceptEnv({
        TELEGRAM_BOT_TOKEN: "telegram-worker-secret",
      }),
      { containerId: "member_123--v-version_1" },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites WhatsApp sentinel phone ids only for numeric graph versions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/v25.0/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://graph.facebook.com/v25.0/phone_123/messages");
    expect(forwarded.headers.get("authorization")?.startsWith("Bearer ")).toBe(true);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });

  it("does not inject WhatsApp credentials for malformed graph versions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("passthrough"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await hostedRunnerIntercept(
      new Request("https://graph.facebook.com/vbeta/__cloudflare_injected__/messages", {
        headers: BOUND_USER_WRITE_FENCE_HEADERS,
        method: "POST",
      }),
      createInterceptEnv({
        WHATSAPP_ACCESS_TOKEN: "whatsapp-worker-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone_123",
        validateRuntimeWriteFence: async () => true,
      }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    const forwarded = readForwardedRequest(fetchMock);
    expect(forwarded.url).toBe("https://graph.facebook.com/vbeta/__cloudflare_injected__/messages");
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("x-hosted-runtime-attempt-id")).toBe(false);
    expect(forwarded.headers.has(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(false);
  });
});

function createInterceptEnv(input: {
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
  OPENAI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  validateRuntimeWriteFence?: (input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }) => Promise<boolean>;
}): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    LINQ_API_BASE_URL: input.LINQ_API_BASE_URL,
    LINQ_API_TOKEN: input.LINQ_API_TOKEN,
    MAPBOX_ACCESS_TOKEN: input.MAPBOX_ACCESS_TOKEN,
    OPENAI_API_KEY: input.OPENAI_API_KEY,
    TELEGRAM_BOT_TOKEN: input.TELEGRAM_BOT_TOKEN,
    WHATSAPP_ACCESS_TOKEN: input.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: input.WHATSAPP_PHONE_NUMBER_ID,
    USER_RUNNER: {
      getByName: () => ({
        validateRuntimeWriteFence: input.validateRuntimeWriteFence ?? (async () => false),
      }),
    },
  };
}

function readForwardedRequest(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): Request {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  return request as Request;
}
