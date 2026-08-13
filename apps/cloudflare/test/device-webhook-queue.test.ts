import {
  DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
  DEVICE_WEBHOOK_TRANSPORT_USER_ID,
  HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH,
  sealDeviceWebhookQueueEnvelope,
  type DeviceWebhookQueueEnvelopeV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleHostedDeviceWebhookQueueBatch } from "../src/device-webhook-queue.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { verifyHostedWebCallbackSignatureHeaders } from "../src/web-callback-auth.ts";
import { deviceWebhookEnqueueRoutes } from "../src/worker/route-handlers/device-webhook-enqueue.ts";
import {
  asWorkerStringEnvironment,
} from "../src/worker-contracts.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";
import {
  createHostedExecutionTestEnv,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
} from "./hosted-execution-fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hosted device webhook Queue consumer", () => {
  it("keeps enqueue OIDC-only and returns success only after Queue.send resolves", async () => {
    const envelope = await createEnvelope(0);
    const send = vi.fn(async (_envelope: DeviceWebhookQueueEnvelopeV1) =>
      createQueueSendResponse());
    const env = createWorkerEnv();
    const route = deviceWebhookEnqueueRoutes[0]!;
    expect(route.authorization).toBe("vercel-oidc");
    expect(route.authorizeBeforeMethod).toBe(true);

    const response = await route.handle({
      env: {
        ...env,
        DEVICE_WEBHOOK_QUEUE: createQueueBinding(send),
      },
      environment: readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
      request: new Request("https://runner.example.test/internal/device-webhooks/enqueue", {
        body: JSON.stringify(envelope),
        method: "POST",
      }),
      url: new URL("https://runner.example.test/internal/device-webhooks/enqueue"),
    }, {});

    expect(send).toHaveBeenCalledOnce();
    const persisted = send.mock.calls[0]?.[0];
    expect(persisted?.transportId).not.toBe(envelope.transportId);
    expect(persisted).not.toEqual(envelope);
    expect(response.status).toBe(202);
  });

  it("returns a retryable service failure when Queue.send rejects", async () => {
    const envelope = await createEnvelope(0);
    const route = deviceWebhookEnqueueRoutes[0]!;
    const env = createWorkerEnv();
    const response = await route.handle({
      env: {
        ...env,
        DEVICE_WEBHOOK_QUEUE: createQueueBinding(async () => {
          throw new Error("synthetic Queue failure");
        }),
      },
      environment: readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
      request: new Request("https://runner.example.test/internal/device-webhooks/enqueue", {
        body: JSON.stringify(envelope),
        method: "POST",
      }),
      url: new URL("https://runner.example.test/internal/device-webhooks/enqueue"),
    }, {});

    expect(response.status).toBe(503);
  });

  it("authenticates ciphertext before persistence and rejects unsafe visible metadata", async () => {
    const original = await createEnvelope(0);
    const mutations: Array<(envelope: DeviceWebhookQueueEnvelopeV1) => void> = [
      (envelope) => {
        envelope.rootKeyWrap.encryptionContext.userId = "plaintext-member-marker";
      },
      (envelope) => {
        envelope.encryptedPayload.rootKeyId = "plaintext-root-marker";
      },
      (envelope) => {
        envelope.rootKeyWrap.recipientKeyId = "plaintext-key-marker";
      },
      (envelope) => {
        envelope.rootKeyWrap.iv = btoa("plaintext-marker");
      },
      (envelope) => {
        envelope.encryptedPayload.ciphertext = replaceFirstBase64Character(
          envelope.encryptedPayload.ciphertext,
        );
      },
    ];

    for (const mutate of mutations) {
      const envelope = structuredClone(original);
      mutate(envelope);
      const send = vi.fn(async () => createQueueSendResponse());
      const env = createWorkerEnv();
      const response = await deviceWebhookEnqueueRoutes[0]!.handle({
        env: {
          ...env,
          DEVICE_WEBHOOK_QUEUE: createQueueBinding(send),
        },
        environment: readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
        request: new Request("https://runner.example.test/internal/device-webhooks/enqueue", {
          body: JSON.stringify(envelope),
          method: "POST",
        }),
        url: new URL("https://runner.example.test/internal/device-webhooks/enqueue"),
      }, {});

      expect(response.status).toBe(400);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("delivers a maximum 100-message Queue batch as four signed serial callbacks and settles once", async () => {
    const envelopes = await Promise.all(
      Array.from({ length: 100 }, (_, index) => createEnvelope(index)),
    );
    const observedCallbacks: number[] = [];
    const observedTransportIds: string[] = [];
    let activeCallbacks = 0;
    let maxActiveCallbacks = 0;
    const workerEnv = createWorkerEnv();
    const environment = readHostedExecutionEnvironment(
      asWorkerStringEnvironment(workerEnv),
    );
    const consumedNonces = new Set<string>();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const callback = new Request(url, init);
      const body = String(init?.body);
      expect(callback.headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(
        DEVICE_WEBHOOK_TRANSPORT_USER_ID,
      );
      expect(await verifyHostedWebCallbackSignatureHeaders({
        environment: environment.webCallbackSigning,
        method: "POST",
        nonceStore: {
          async consume(input) {
            if (consumedNonces.has(input.nonceHash)) return false;
            consumedNonces.add(input.nonceHash);
            return true;
          },
        },
        path: HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH,
        payload: body,
        request: callback,
        userId: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
      })).toBe(true);
      activeCallbacks += 1;
      maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks);
      const request = JSON.parse(body);
      observedCallbacks.push(request.entries.length);
      observedTransportIds.push(...request.entries.map(
        (entry: { transportId: string }) => entry.transportId,
      ));
      await Promise.resolve();
      activeCallbacks -= 1;
      return Response.json({
        entries: request.entries.map((entry: { transportId: string }) => ({
          disposition: "accepted",
          transportId: entry.transportId,
        })),
        schema: DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
      });
    }));
    const messages = envelopes.map(createQueueMessage);

    await handleHostedDeviceWebhookQueueBatch(
      createQueueBatch(messages),
      workerEnv,
    );

    expect(observedCallbacks).toEqual([25, 25, 25, 25]);
    expect(observedTransportIds).toEqual(
      envelopes.map((envelope) => envelope.transportId),
    );
    expect(new Set(observedTransportIds).size).toBe(100);
    expect(consumedNonces.size).toBe(4);
    expect(maxActiveCallbacks).toBe(1);
    expect(messages.every((message) => message.ack.mock.calls.length === 1)).toBe(true);
    expect(messages.every((message) => message.retry.mock.calls.length === 0)).toBe(true);
  });

  it("retries a tampered message without suppressing a valid sibling", async () => {
    const valid = await createEnvelope(1);
    const tampered = structuredClone(await createEnvelope(2));
    tampered.encryptedPayload.ciphertext = replaceFirstBase64Character(
      tampered.encryptedPayload.ciphertext,
    );
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return Response.json({
        entries: request.entries.map((entry: { transportId: string }) => ({
          disposition: "accepted",
          transportId: entry.transportId,
        })),
        schema: DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
      });
    }));
    const validMessage = createQueueMessage(valid);
    const tamperedMessage = createQueueMessage(tampered);

    await handleHostedDeviceWebhookQueueBatch(
      createQueueBatch([tamperedMessage, validMessage]),
      createWorkerEnv(),
    );

    expect(tamperedMessage.retry).toHaveBeenCalledOnce();
    expect(tamperedMessage.ack).not.toHaveBeenCalled();
    expect(validMessage.ack).toHaveBeenCalledOnce();
    expect(validMessage.retry).not.toHaveBeenCalled();
  });

  it("coalesces same-batch at-least-once duplicates and settles every copy", async () => {
    const envelope = await createEnvelope(1);
    const observedEntryCounts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      observedEntryCounts.push(request.entries.length);
      return Response.json({
        entries: request.entries.map((entry: { transportId: string }) => ({
          disposition: "accepted",
          transportId: entry.transportId,
        })),
        schema: DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
      });
    }));
    const first = createQueueMessage(envelope);
    const duplicate = createQueueMessage(structuredClone(envelope));

    await handleHostedDeviceWebhookQueueBatch(
      createQueueBatch([first, duplicate]),
      createWorkerEnv(),
    );

    expect(observedEntryCounts).toEqual([1]);
    expect(first.ack).toHaveBeenCalledOnce();
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
    expect(duplicate.retry).not.toHaveBeenCalled();
  });

  it("backs retryable admission failures off per message attempt", async () => {
    const envelope = await createEnvelope(1);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return Response.json({
        entries: request.entries.map((entry: { transportId: string }) => ({
          disposition: "retry",
          transportId: entry.transportId,
        })),
        schema: DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
      });
    }));
    const message = createQueueMessage(envelope);
    message.attempts = 4;

    await handleHostedDeviceWebhookQueueBatch(
      createQueueBatch([message]),
      createWorkerEnv(),
    );

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(message.ack).not.toHaveBeenCalled();
  });
});

async function createEnvelope(index: number): Promise<DeviceWebhookQueueEnvelopeV1> {
  return sealDeviceWebhookQueueEnvelope({
    env: "test",
    preparedWebhook: {
      acceptanceMode: "level_dirty_hint",
      eventType: "demo.updated",
      externalAccountId: `opaque-account-${index}`,
      jobs: [],
      provider: "oura",
      receivedAt: "2026-04-10T12:00:00.000Z",
      schema: "murph.device-sync-prepared-webhook.v1",
      traceId: index.toString(16).padStart(64, "0"),
    },
    recipientKeyId: TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    recipientPublicJwk: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  });
}

function createQueueMessage(envelope: DeviceWebhookQueueEnvelopeV1) {
  return {
    ack: vi.fn(),
    attempts: 1,
    body: envelope,
    id: envelope.transportId,
    retry: vi.fn(),
    timestamp: new Date(),
  };
}

function createQueueBatch(
  messages: ReturnType<typeof createQueueMessage>[],
): MessageBatch<DeviceWebhookQueueEnvelopeV1> {
  return {
    ackAll: vi.fn(),
    messages,
    metadata: {
      metrics: {
        backlogBytes: 0,
        backlogCount: messages.length,
      },
    },
    queue: "test-device-webhooks",
    retryAll: vi.fn(),
  };
}

function createWorkerEnv(): WorkerEnvironmentSource {
  const runnerContainer = {
    getByName() {
      throw new Error("Device webhook tests must not access runner containers.");
    },
  };
  return {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {
      async get() {
        return null;
      },
      async put() {},
    },
    RUNNER_CONTAINER: runnerContainer,
    RUNNER_CONTAINER_SMOKE: runnerContainer,
    USER_RUNNER: {
      getByName() {
        throw new Error("Queue consumer must not access a user runner.");
      },
    },
  };
}

function createQueueBinding(
  send: Queue<DeviceWebhookQueueEnvelopeV1>["send"],
): Queue<DeviceWebhookQueueEnvelopeV1> {
  return {
    async metrics() {
      return { backlogBytes: 0, backlogCount: 0 };
    },
    send,
    async sendBatch() {
      return createQueueSendResponse();
    },
  };
}

function createQueueSendResponse(): QueueSendResponse {
  return {
    metadata: {
      metrics: { backlogBytes: 0, backlogCount: 0 },
    },
  };
}

function replaceFirstBase64Character(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}
