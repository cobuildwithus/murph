import { afterEach, expect, test, vi } from "vitest";

import {
  relayHostedOpenAiResponsesWebSocketUpgrade,
} from "../../src/runner-egress-openai-responses-websocket.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
  hostedRunnerIntercept,
} from "../../src/runner-egress-intercept.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../../src/runner-outbound/headers.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../../src/runner-outbound.ts";
import {
  createHostedExecutionTestEnv,
} from "../hosted-execution-fixtures.ts";

const createdAt = 1_775_000_000;
const memberId = "member_123";

async function openImageGateSocket(nativeMemory = false) {
  const pair = new WebSocketPair();
  const provider = pair[1];
  provider.accept({ allowHalfOpen: true });
  provider.addEventListener("close", (event) => provider.close(event.code, event.reason), { once: true });
  let cardAllowed = false;
  const cardAccess = vi.fn(async () => Response.json({
    allowed: cardAllowed,
    reason: cardAllowed ? "allowed" : "card_required",
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (target) => {
    const url = new URL(target instanceof Request ? target.url : String(target));
    if (url.hostname === "api.openai.com") {
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    expect(url.pathname).toBe("/api/internal/hosted-execution/image-generation/access");
    return await cardAccess();
  }));
  const env: RunnerOutboundEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    OPENAI_API_KEY: "openai-worker-secret",
    USER_RUNNER: { getByName: () => ({ validateRuntimeWriteFence: async () => true }) },
  };
  const response = await hostedRunnerIntercept(new Request("https://api.openai.com/v1/responses", {
    headers: {
      [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_1",
      [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "7",
      [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "4",
      [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: memberId,
      authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      upgrade: "websocket",
      ...(nativeMemory ? { "x-codex-turn-metadata": JSON.stringify({ request_kind: "memory" }) } : {}),
    },
  }), env, { containerId: "opaque-container-id" });
  expect(response.status).toBe(101);
  const client = response.webSocket;
  if (!client) throw new Error("Expected image-gated Responses socket.");
  client.accept({ allowHalfOpen: true });
  client.addEventListener("close", (event) => { client.close(event.code, event.reason); }, { once: true });
  return { cardAccess, client, provider, setCard: (allowed: boolean) => { cardAllowed = allowed; } };
}

const imageFrame = JSON.stringify({
  type: "response.create",
  model: "gpt-5.6-terra",
  input: "Draw a synthetic geometric pattern.",
  tools: [{ type: "image_generation" }],
});

test.each([false, true])("blocks native image frames before provider spend (memory=%s)", async (nativeMemory) => {
  const { cardAccess, client, provider } = await openImageGateSocket(nativeMemory);
  const received = vi.fn();
  provider.addEventListener("message", received);
  const denied = nextMessage(client);
  const closed = nextClose(client);
  client.send(new TextEncoder().encode(imageFrame).buffer);
  expect(JSON.parse(String(await denied))).toMatchObject({ type: "error", error: { code: "MURPH_IMAGE_CARD_REQUIRED" } });
  await expect(closed).resolves.toMatchObject({ code: 1008 });
  expect(cardAccess).toHaveBeenCalledTimes(1);
  expect(received).not.toHaveBeenCalled();
});

test("preserves text streams and checks the current card for each image frame", async () => {
  const { cardAccess, client, provider, setCard } = await openImageGateSocket();
  const received: Array<string | ArrayBuffer> = [];
  provider.addEventListener("message", (event) => { received.push(event.data); });
  for (const streamId of ["first", "second"]) {
    const text = JSON.stringify({ type: "response.create", stream_id: streamId, model: "gpt-5.6-terra", input: "Synthetic text." });
    const forwarded = nextMessage(provider);
    client.send(text);
    await expect(forwarded).resolves.toBe(text);
  }
  expect(cardAccess).not.toHaveBeenCalled();
  setCard(true);
  const forwardedImage = nextMessage(provider);
  client.send(imageFrame);
  await expect(forwardedImage).resolves.toBe(imageFrame);
  expect(cardAccess).toHaveBeenCalledTimes(1);
  setCard(false);
  const denied = nextMessage(client);
  const closed = nextClose(client);
  client.send(imageFrame);
  expect(JSON.parse(String(await denied))).toMatchObject({ error: { code: "MURPH_IMAGE_CARD_REQUIRED" } });
  await expect(closed).resolves.toMatchObject({ code: 1008 });
  expect(cardAccess).toHaveBeenCalledTimes(2);
  expect(received).toHaveLength(3);
});

test("fails closed when image access is unavailable on an existing socket", async () => {
  const { cardAccess, client, provider } = await openImageGateSocket();
  cardAccess.mockResolvedValueOnce(Response.json({}));
  const received = vi.fn();
  provider.addEventListener("message", received);
  const denied = nextMessage(client);
  const closed = nextClose(client);
  client.send(imageFrame);
  expect(JSON.parse(String(await denied))).toMatchObject({ error: { code: "MURPH_IMAGE_ACCESS_UNAVAILABLE" } });
  await expect(closed).resolves.toMatchObject({ code: 1008 });
  expect(received).not.toHaveBeenCalled();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("close", (event) => {
      resolve({ code: event.code, reason: event.reason });
    }, { once: true });
    socket.addEventListener("error", () => {
      reject(new Error("WebSocket failed while closing."));
    }, { once: true });
  });
}

function nextMessage(socket: WebSocket): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string" || event.data instanceof ArrayBuffer) {
        resolve(event.data);
      } else {
        reject(new TypeError("Unexpected WebSocket frame type."));
      }
    }, { once: true });
    socket.addEventListener("error", () => {
      reject(new Error("WebSocket failed."));
    }, { once: true });
  });
}

test("terminates only the two relay legs and preserves application headers", async () => {
  const upstreamPair = new WebSocketPair();
  const upstreamClient = upstreamPair[0];
  const provider = upstreamPair[1];
  provider.binaryType = "arraybuffer";
  provider.accept({ allowHalfOpen: true });

  const persistUsage = vi.fn(async () => undefined);
  const response = relayHostedOpenAiResponsesWebSocketUpgrade({
    persistUsage,
    upstreamResponse: new Response(null, {
      headers: {
        connection: "Upgrade",
        "openai-model": "gpt-5.6-luna",
        "sec-websocket-accept": "opaque",
        "sec-websocket-extensions": "permessage-deflate",
        upgrade: "websocket",
        "x-reasoning-included": "true",
      },
      status: 101,
      webSocket: upstreamClient,
    }),
  });

  expect(response.status).toBe(101);
  expect(response.headers.get("connection")).toBeNull();
  expect(response.headers.get("sec-websocket-accept")).toBeNull();
  expect(response.headers.get("sec-websocket-extensions")).toBeNull();
  expect(response.headers.get("upgrade")).toBeNull();
  expect(response.headers.get("openai-model")).toBe("gpt-5.6-luna");
  expect(response.headers.get("x-reasoning-included")).toBe("true");

  const client = response.webSocket;
  expect(client).not.toBeNull();
  if (!client) throw new TypeError("Expected relayed WebSocket.");
  client.binaryType = "arraybuffer";
  client.accept({ allowHalfOpen: true });

  const request = JSON.stringify({
    model: "gpt-5.6-luna",
    service_tier: "flex",
    type: "response.create",
  });
  const providerMessage = nextMessage(provider);
  client.send(request);
  await expect(providerMessage).resolves.toBe(request);

  const completed = JSON.stringify({
    response: {
      created_at: createdAt,
      id: "resp_memory_worker",
      model: "gpt-5.6-luna-2026-07-30",
      service_tier: "flex",
      usage: {
        input_tokens: 10,
        input_tokens_details: {
          cache_write_tokens: 2,
          cached_tokens: 4,
        },
        output_tokens: 3,
        total_tokens: 13,
      },
    },
    type: "response.completed",
  });
  const clientMessage = nextMessage(client);
  provider.send(completed);
  await expect(clientMessage).resolves.toBe(completed);
  expect(persistUsage).toHaveBeenCalledWith({
    providerRequestOutcome: "succeeded",
    requestMetadata: {
      usageRequired: true,
      requestedModel: "gpt-5.6-luna",
      serviceTier: "flex",
    },
    usage: expect.objectContaining({
      cacheWriteTokens: 2,
      providerRequestId: "resp_memory_worker",
    }),
  });

  provider.addEventListener("close", (event) => {
    provider.close(event.code, event.reason);
  }, { once: true });
  const clientClosed = nextClose(client);
  const providerClosed = nextClose(provider);
  client.close(1_000, "done");
  await expect(clientClosed).resolves.toEqual({ code: 1_000, reason: "done" });
  await expect(providerClosed).resolves.toEqual({ code: 1_000, reason: "done" });
});

test("routes marked upgrades through durable native-memory accounting before delivery", async () => {
  const upstreamPair = new WebSocketPair();
  const upstreamClient = upstreamPair[0];
  const provider = upstreamPair[1];
  provider.binaryType = "arraybuffer";
  provider.accept({ allowHalfOpen: true });

  let markUsageStarted: (() => void) | undefined;
  const usageStarted = new Promise<void>((resolve) => {
    markUsageStarted = resolve;
  });
  let finishUsage: ((response: Response) => void) | undefined;
  const pendingUsage = new Promise<Response>((resolve) => {
    finishUsage = resolve;
  });
  const fetchMock = vi.fn<typeof fetch>(async (target) => {
    const url = target instanceof Request ? target.url : String(target);
    if (url === "https://api.openai.com/v1/responses") {
      return new Response(null, {
        headers: { "openai-model": "gpt-5.6-luna" },
        status: 101,
        webSocket: upstreamClient,
      });
    }
    if (url.endsWith("/api/internal/hosted-execution/usage/record")) {
      markUsageStarted?.();
      return await pendingUsage;
    }
    throw new Error(`Unexpected fetch target: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const waitUntilPromises: Promise<unknown>[] = [];
  const env: RunnerOutboundEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    OPENAI_API_KEY: "openai-worker-secret",
    USER_RUNNER: {
      getByName: () => ({
        validateRuntimeWriteFence: async () => true,
      }),
    },
  };

  const response = await hostedRunnerIntercept(
    new Request("https://api.openai.com/v1/responses", {
      headers: {
        [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_1",
        [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "7",
        [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "4",
        [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: memberId,
        authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        upgrade: "websocket",
        "x-codex-turn-metadata": JSON.stringify({ request_kind: "memory" }),
      },
      method: "GET",
    }),
    env,
    {
      containerId: "opaque-container-id",
      waitUntil: (promise) => {
        waitUntilPromises.push(Promise.resolve(promise));
      },
    },
  );

  expect(response.status).toBe(101);
  expect(response.headers.get("openai-model")).toBe("gpt-5.6-luna");
  const client = response.webSocket;
  expect(client).not.toBeNull();
  if (!client) throw new TypeError("Expected intercepted WebSocket.");
  client.accept({ allowHalfOpen: true });

  const request = new TextEncoder().encode(JSON.stringify({
    model: "gpt-5.6-luna",
    service_tier: "flex",
    type: "response.create",
  })).buffer;
  const providerMessage = nextMessage(provider);
  client.send(request);
  await expect(providerMessage).resolves.toEqual(request);

  const completed = JSON.stringify({
    response: {
      created_at: createdAt,
      id: "resp_memory_intercepted",
      model: "gpt-5.6-luna-2026-07-30",
      service_tier: "flex",
      usage: {
        input_tokens: 21,
        input_tokens_details: {
          cache_write_tokens: 3,
          cached_tokens: 8,
        },
        output_tokens: 5,
        total_tokens: 26,
      },
    },
    type: "response.completed",
  });
  let delivered = false;
  const clientMessage = nextMessage(client).then((message) => {
    delivered = true;
    return message;
  });
  provider.send(completed);
  await usageStarted;
  await Promise.resolve();
  expect(delivered).toBe(false);

  const usageCall = fetchMock.mock.calls.find(([target]) => {
    const url = target instanceof Request ? target.url : String(target);
    return url.endsWith("/api/internal/hosted-execution/usage/record");
  });
  expect(usageCall).toBeDefined();
  const payload = JSON.parse(String(usageCall?.[1]?.body)) as {
    usage: Record<string, unknown>;
  };
  expect(payload.usage).toEqual(expect.objectContaining({
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    cacheWriteTokens: 3,
    cachedInputTokens: 8,
    inputTokens: 21,
    memberId,
    outputTokens: 5,
    providerName: "hosted-openai",
    providerRequestId: "resp_memory_intercepted",
    providerRequestOutcome: "succeeded",
    requestedModel: "gpt-5.6-luna",
    servedModel: "gpt-5.6-luna-2026-07-30",
    tokenPricingBasis: "openai-flex",
    totalTokens: 26,
  }));

  finishUsage?.(Response.json({ recorded: true, usageId: "usage_memory_ws" }));
  await expect(clientMessage).resolves.toBe(completed);
  await Promise.all(waitUntilPromises);

  provider.addEventListener("close", (event) => {
    provider.close(event.code, event.reason);
  }, { once: true });
  const clientClosed = nextClose(client);
  const providerClosed = nextClose(provider);
  client.close(1_000, "done");
  await expect(clientClosed).resolves.toEqual({ code: 1_000, reason: "done" });
  await expect(providerClosed).resolves.toEqual({ code: 1_000, reason: "done" });
});
