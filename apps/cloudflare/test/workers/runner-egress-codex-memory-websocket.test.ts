import { expect, test, vi } from "vitest";

import {
  relayHostedCodexMemoryWebSocketUpgrade,
} from "../../src/runner-egress-codex-memory-websocket.ts";

const createdAt = 1_775_000_000;

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
  const response = relayHostedCodexMemoryWebSocketUpgrade({
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
