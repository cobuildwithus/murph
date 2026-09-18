import { HOSTED_RUNTIME_OWNER_PATH } from "@murphai/hosted-execution/runtime-owner";
import { createPostgresTestOwner, forbiddenLegacyRuntime, settledNativeRuntime } from "../postgres-owner-fixtures.ts";
import { afterEach, expect, test, vi } from "vitest";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";

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


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const createdAt = 1_775_000_000;
const memberId = "member_123";

async function openImageGateSocket(nativeMemory = false, logStatus?: Promise<number>) {
  const pair = new WebSocketPair();
  const provider = pair[1];
  provider.accept({ allowHalfOpen: true });
  provider.addEventListener("close", (event) => provider.close(event.code, event.reason), { once: true });
  const diagnostics: Array<{ eventCode: string; level: string; redactedJson: Record<string, unknown> }> = [];
  let subscriptionAllowed = false;
  const subscriptionAccess = vi.fn(async () => Response.json({
    allowed: subscriptionAllowed,
    reason: subscriptionAllowed ? "allowed" : "subscription_required",
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (target, init) => {
    const outgoing = new Request(target, init);
    const url = new URL(outgoing.url);
    if (url.pathname === HOSTED_RUNTIME_OWNER_PATH) return Response.json({ cutover: "postgres", status: "authorized", owner: createPostgresTestOwner() });
    if (url.hostname === "api.openai.com") {
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/api/internal/hosted-runtime/log") {
      const body = parseHostedRuntimeLogRequest(await outgoing.json());
      diagnostics.push(...body.entries.map((entry) => ({
        eventCode: entry.eventCode, level: entry.level, redactedJson: entry.redactedJson ?? {},
      })));
      return Response.json({ ok: true }, { status: logStatus ? await logStatus : 200 });
    }
    expect(url.pathname).toBe("/api/internal/hosted-execution/image-generation/access");
    return await subscriptionAccess();
  }));
  const env: RunnerOutboundEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    OPENAI_API_KEY: "openai-worker-secret",
    USER_RUNNER: forbiddenLegacyRuntime,
    RUNNER_CONTAINER: { getByName: () => settledNativeRuntime },
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
  return { diagnostics, subscriptionAccess, client, provider, setSubscription: (allowed: boolean) => { subscriptionAllowed = allowed; } };
}

const imageFrame = JSON.stringify({
  type: "response.create",
  model: "gpt-5.6-terra",
  input: "Draw a synthetic geometric pattern.",
  tools: [{ type: "image_generation" }],
});

test("persists content-free relay milestones through the real Worker egress log route", async () => {
  const { client, provider, diagnostics } = await openImageGateSocket();
  const request = JSON.stringify({ type: "response.create", model: "gpt-5.6-terra", input: "PRIVATE_REQUEST_FIXTURE" });
  const upstreamMessage = nextMessage(provider);
  client.send(request);
  await upstreamMessage;
  await vi.waitFor(() => expect(diagnostics).toHaveLength(2));
  const response = nextMessage(client);
  provider.send(JSON.stringify({ type: "response.created", private: "PRIVATE_RESPONSE_FIXTURE" }));
  await response;
  await vi.waitFor(() => expect(diagnostics).toHaveLength(4));
  const closed = nextClose(client);
  provider.close(1000, "PRIVATE_CLOSE_REASON_FIXTURE");
  await closed;
  await vi.waitFor(() => expect(diagnostics).toHaveLength(5));
  expect(diagnostics.map((entry) => entry.eventCode)).toEqual(Array(5).fill("runner.provider_egress_diagnostic"));
  expect(diagnostics.map((entry) => entry.redactedJson.websocketMilestone)).toEqual([
    "client_received", "upstream_sent", "upstream_received", "downstream_sent", "closed",
  ]);
  expect(diagnostics.at(-1)?.redactedJson).toMatchObject({
    clientFrameCount: 1, upstreamSends: 1, upstreamFrameCount: 1, downstreamFrameCount: 1,
    upstreamSendObserved: true, upstreamFrameObserved: true, closeSide: "provider",
    firstUpstreamMessageKind: "response.created",
  });
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});

test.each([
  { kind: "incomplete generation", closeCode: 1011, expectedLevel: "warn" },
  { kind: "normal close", closeCode: 1000, expectedLevel: "debug" },
  { kind: "completed generation", closeCode: 1011, expectedLevel: "debug" },
  { kind: "prewarm", closeCode: 1011, expectedLevel: "debug" },
  { kind: "overlapping requests", closeCode: 1011, expectedLevel: "debug" },
  { kind: "uninspected response", closeCode: 1011, expectedLevel: "debug" },
  { kind: "no provider frames", closeCode: 1000, expectedLevel: "warn" },
])("classifies persisted socket closure after $kind", async ({ kind, closeCode, expectedLevel }) => {
  const { client, provider, diagnostics } = await openImageGateSocket();
  const request = JSON.stringify({ type: "response.create", generate: kind !== "prewarm" });
  for (let index = 0; index < (kind === "overlapping requests" ? 2 : 1); index++) {
    const sent = nextMessage(provider);
    client.send(request);
    await sent;
    await vi.waitFor(() => expect(diagnostics).toHaveLength((index + 1) * 2));
  }
  if (kind !== "no provider frames") {
    const frames = kind === "uninspected response" ? ["PRIVATE_INVALID_JSON"] : [
      JSON.stringify({ type: "response.created", response: { id: "resp_synthetic_close" } }),
      JSON.stringify(kind === "completed generation"
        ? { type: "response.completed", response: { id: "resp_synthetic_close" } }
        : { type: "response.output_text.delta", delta: "Synthetic output." }),
    ];
    for (const frame of frames) {
      const received = nextMessage(client);
      provider.send(frame);
      await expect(received).resolves.toBe(frame);
    }
  }
  const closed = nextClose(client);
  provider.close(closeCode, "Synthetic close.");
  await expect(closed).resolves.toMatchObject({ code: closeCode });
  await vi.waitFor(() => expect(diagnostics.at(-1)?.redactedJson.websocketMilestone).toBe("closed"));
  expect(diagnostics.at(-1)).toMatchObject({
    level: expectedLevel,
    redactedJson: { websocketMilestone: "closed", providerResponseOutcomeKind: "closed", closeCode },
  });
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});

test("persists acknowledgement after metadata and separate progress and terminal forwarding", async () => {
  const { client, provider, diagnostics } = await openImageGateSocket();
  const sent = nextMessage(provider);
  client.send(JSON.stringify({
    type: "response.create", client_metadata: { turn_id: "PRIVATE_SYNTHETIC_TURN" },
  }));
  await sent;
  await vi.waitFor(() => expect(diagnostics).toHaveLength(2));
  const frames = [
    { type: "codex.response.metadata" },
    { type: "response.created", response: { id: "PRIVATE_RESPONSE" } },
    { type: "response.output_text.delta", delta: "PRIVATE_TEXT" },
    { type: "response.completed", response: { id: "PRIVATE_RESPONSE" } },
  ];
  for (const [index, frame] of frames.entries()) {
    const received = nextMessage(client);
    provider.send(JSON.stringify(frame));
    await received;
    await vi.waitFor(() => expect(diagnostics).toHaveLength(4 + index * 2));
  }
  expect(diagnostics[3]?.redactedJson.responseAcknowledged).toBe(false);
  expect(diagnostics[5]?.redactedJson).toMatchObject({
    websocketMilestone: "response_forwarded", responseMilestone: "acknowledged",
    responseAcknowledged: true, responseAssociationKind: "single-request",
    codexTurnCorrelation: expect.any(Number),
  });
  expect(diagnostics[7]?.redactedJson.responseMilestone).toBe("progress");
  expect(diagnostics[9]?.redactedJson).toMatchObject({
    responseMilestone: "terminal", responseTerminalKind: "response.completed",
  });
  const closed = nextClose(client);
  provider.close(1000, "Synthetic completion");
  await closed;
  await vi.waitFor(() => expect(diagnostics).toHaveLength(11));
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});

test("bounds pending diagnostic writes without delaying forwarding when persistence stalls or fails", async () => {
  const logGate = deferred<number>();
  const { client, provider, diagnostics } = await openImageGateSocket(false, logGate.promise);
  try {
    const request = JSON.stringify({ type: "response.create", input: "Synthetic request." });
    const firstRequest = nextMessage(provider);
    client.send(request);
    await expect(firstRequest).resolves.toBe(request);
    const firstResponse = nextMessage(client);
    provider.send(JSON.stringify({ type: "response.created" }));
    await firstResponse;
    await vi.waitFor(() => expect(diagnostics).toHaveLength(4));

    // The four log writes are still held. The next request and response pass.
    const nextRequest = nextMessage(provider);
    client.send(request);
    await expect(nextRequest).resolves.toBe(request);
    const nextResponse = nextMessage(client);
    provider.send(JSON.stringify({ type: "response.completed" }));
    await nextResponse;
    expect(diagnostics).toHaveLength(4);
    logGate.resolve(503);

    const finalResponse = nextMessage(client);
    provider.send(JSON.stringify({ type: "response.output_text.delta", delta: "Synthetic output." }));
    await finalResponse;
  } finally {
    logGate.resolve(503);
    const closed = nextClose(client);
    provider.close(1000, "Synthetic close.");
    await closed;
    await vi.waitFor(() => expect(diagnostics.some(entry => entry.redactedJson.websocketMilestone === "closed")).toBe(true));
  }
});

test("reserves a terminal diagnostic when ordinary writes are still pending at close", async () => {
  const logGate = deferred<number>();
  const { client, provider, diagnostics } = await openImageGateSocket(false, logGate.promise);
  try {
    const sent = nextMessage(provider);
    client.send(JSON.stringify({ type: "response.create", input: "Synthetic request." }));
    await sent;
    const received = nextMessage(client);
    provider.send(JSON.stringify({ type: "response.created" }));
    await received;
    await vi.waitFor(() => expect(diagnostics).toHaveLength(4));
    const closed = nextClose(client);
    provider.close(1000, "Synthetic close.");
    await closed;
    await vi.waitFor(() => expect(diagnostics).toHaveLength(5));
    expect(diagnostics.at(-1)?.redactedJson).toMatchObject({
      websocketMilestone: "closed", closeSide: "provider", closeCode: 1000, runtimeLogScheduled: true,
    });
  } finally {
    logGate.resolve(200);
  }
});

test.each([false, true])("blocks native image frames before provider spend (memory=%s)", async (nativeMemory) => {
  const { subscriptionAccess, client, provider } = await openImageGateSocket(nativeMemory);
  const received = vi.fn();
  provider.addEventListener("message", received);
  const denied = nextMessage(client);
  const closed = nextClose(client);
  client.send(new TextEncoder().encode(imageFrame).buffer);
  expect(JSON.parse(String(await denied))).toMatchObject({ type: "error", error: { code: "MURPH_IMAGE_SUBSCRIPTION_REQUIRED" } });
  await expect(closed).resolves.toMatchObject({ code: 1008 });
  expect(subscriptionAccess).toHaveBeenCalledTimes(1);
  expect(received).not.toHaveBeenCalled();
});

test("preserves text streams and checks the current subscription for each image frame", async () => {
  const { subscriptionAccess, client, provider, setSubscription } = await openImageGateSocket();
  const received: Array<string | ArrayBuffer> = [];
  provider.addEventListener("message", (event) => { received.push(event.data); });
  for (const streamId of ["first", "second"]) {
    const text = JSON.stringify({ type: "response.create", stream_id: streamId, model: "gpt-5.6-terra", input: "Synthetic text." });
    const forwarded = nextMessage(provider);
    client.send(text);
    await expect(forwarded).resolves.toBe(text);
  }
  expect(subscriptionAccess).not.toHaveBeenCalled();
  setSubscription(true);
  const forwardedImage = nextMessage(provider);
  client.send(imageFrame);
  await expect(forwardedImage).resolves.toBe(imageFrame);
  expect(subscriptionAccess).toHaveBeenCalledTimes(1);
  setSubscription(false);
  const denied = nextMessage(client);
  const closed = nextClose(client);
  client.send(imageFrame);
  expect(JSON.parse(String(await denied))).toMatchObject({ error: { code: "MURPH_IMAGE_SUBSCRIPTION_REQUIRED" } });
  await expect(closed).resolves.toMatchObject({ code: 1008 });
  expect(subscriptionAccess).toHaveBeenCalledTimes(2);
  expect(received).toHaveLength(3);
});

test("fails closed when image access is unavailable on an existing socket", async () => {
  const { subscriptionAccess, client, provider } = await openImageGateSocket();
  subscriptionAccess.mockResolvedValueOnce(Response.json({}));
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

test("drains a metered terminal through real WebSockets before closing an overflowing provider stream", async () => {
  const pair = new WebSocketPair();
  const provider = pair[1];
  provider.accept({ allowHalfOpen: true });
  provider.addEventListener("close", (event) => provider.close(event.code, event.reason), { once: true });
  const persistence = deferred<void>();
  const started = deferred<void>();
  const persistUsage = vi.fn(() => {
    started.resolve();
    return persistence.promise;
  });
  const response = relayHostedOpenAiResponsesWebSocketUpgrade({
    persistUsage,
    upstreamResponse: new Response(null, { status: 101, webSocket: pair[0] }),
  });
  const client = response.webSocket;
  if (!client) throw new Error("Expected relayed WebSocket.");
  client.accept({ allowHalfOpen: true });
  client.addEventListener("close", (event) => client.close(event.code, event.reason), { once: true });
  const request = JSON.stringify({ type: "response.create", model: "gpt-5.6-terra" });
  const forwarded = nextMessage(provider);
  client.send(request);
  await expect(forwarded).resolves.toBe(request);
  const completed = JSON.stringify({
    type: "response.completed",
    response: {
      id: "resp_synthetic_overflow", model: "gpt-5.6-terra", created_at: createdAt,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  const received: Array<string | ArrayBuffer> = [];
  client.addEventListener("message", (event) => { received.push(event.data); });
  let clientClosed = false;
  const closed = nextClose(client).then((event) => { clientClosed = true; return event; });
  const providerClosed = nextClose(provider);
  provider.send(completed);
  await started.promise;
  // Tiny messages exercise actual event delivery without allocating huge payloads.
  for (let index = 0; index < 4096; index++) provider.send("");
  await expect(providerClosed).resolves.toMatchObject({ code: 1009 });
  expect(clientClosed).toBe(false);
  expect(received).toHaveLength(0);
  persistence.resolve();
  await expect(closed).resolves.toMatchObject({ code: 1009 });
  expect(received[0]).toBe(completed);
  expect(received).toHaveLength(4096);
  expect(persistUsage).toHaveBeenCalledOnce();
}, 15_000);

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
    if (new URL(url).pathname === HOSTED_RUNTIME_OWNER_PATH) return Response.json({ cutover: "postgres", status: "authorized", owner: createPostgresTestOwner() });
    if (new URL(url).pathname === "/api/internal/hosted-runtime/log") return Response.json({ ok: true });
    if (new URL(url).pathname === "/api/internal/hosted-execution/usage/record") {
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
    USER_RUNNER: forbiddenLegacyRuntime,
    RUNNER_CONTAINER: { getByName: () => settledNativeRuntime },
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
    return new URL(url).pathname === "/api/internal/hosted-execution/usage/record";
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
  await Promise.all(waitUntilPromises);
});
