import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedAssistantDeliveryPayload } from "@murphai/hosted-execution/side-effects";

import type { R2BucketLike } from "../src/bundle-store.js";
import {
  persistHostedExecutionCommit,
  persistHostedExecutionFinalBundles,
} from "../src/execution-journal.js";

const textEncoder = new TextEncoder();

class InMemoryR2Bucket implements R2BucketLike {
  readonly entries = new Map<string, string>();

  async get(key: string) {
    const value = this.entries.get(key);

    if (value === undefined) {
      return null;
    }

    return {
      async arrayBuffer() {
        return textEncoder.encode(value).buffer.slice(0);
      },
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }
}

function createBaseCommit(bucket: InMemoryR2Bucket) {
  return {
    bucket,
    currentBundleRef: null,
    eventId: "evt_123",
    key: textEncoder.encode("murph-cloudflare-execution-journal-test-key"),
    keyId: "test-key",
    userId: "user_123",
  } as const;
}

function encodeBundle(label: string): string {
  return Buffer.from(label, "utf8").toString("base64");
}

function createAssistantDeliveryPayload(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
): HostedAssistantDeliveryPayload {
  return {
    actorId: "actor_123",
    bindingDeliveryKind: "participant",
    bindingDeliveryTarget: "chat_123",
    channel: "telegram",
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent_123",
    identityId: "identity_123",
    message: "hello from execution journal",
    subject: null,
    replyToMessageId: null,
    sessionId: "session_123",
    threadId: "thread_123",
    threadIsDirect: true,
    transportIdempotent: false,
    turnId: "turn_123",
    ...overrides,
  };
}

function createAssistantDeliveryEffect(input: {
  effectId: string;
  fingerprint: string;
  payload?: Partial<HostedAssistantDeliveryPayload>;
}) {
  return {
    effectId: input.effectId,
    fingerprint: input.fingerprint,
    kind: "assistant.delivery" as const,
    payload: createAssistantDeliveryPayload({
      idempotencyKey: `assistant-outbox:${input.effectId}`,
      sessionId: `session_${input.effectId}`,
      turnId: `turn_${input.effectId}`,
      ...input.payload,
    }),
  };
}

function createAssistantDeliveryEffectSummary(input: {
  effectId: string;
  fingerprint: string;
  payload?: Partial<HostedAssistantDeliveryPayload>;
}) {
  const effect = createAssistantDeliveryEffect(input);
  return {
    effectId: effect.effectId,
    fingerprint: effect.fingerprint,
    payload: {
      actorId: effect.payload.actorId,
      bindingDeliveryKind: effect.payload.bindingDeliveryKind,
      bindingDeliveryTarget: effect.payload.bindingDeliveryTarget,
      channel: effect.payload.channel,
      idempotencyKey: effect.payload.idempotencyKey,
      identityId: effect.payload.identityId,
      message: effect.payload.message,
      sessionId: effect.payload.sessionId,
      threadId: effect.payload.threadId,
      threadIsDirect: effect.payload.threadIsDirect,
      transportIdempotent: effect.payload.transportIdempotent,
      turnId: effect.payload.turnId,
    },
  };
}

afterEach(() => {
  delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
  vi.restoreAllMocks();
});

describe("persistHostedExecutionCommit", () => {
  it("accepts duplicate commits when structured payload keys are reordered", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    const first = await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        gatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-12T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await expect(
      persistHostedExecutionCommit({
        ...baseCommit,
        payload: {
          assistantDeliveryEffects: [],
          bundle: null,
          gatewayProjectionSnapshot: {
            permissions: [],
            messages: [],
            conversations: [],
            generatedAt: "2026-04-12T00:00:00.000Z",
            schema: "murph.gateway-projection-snapshot.v1",
          },
          result: {
            summary: "ok",
            nextWakeAt: null,
            eventsHandled: 1,
          },
        },
      }),
    ).resolves.toEqual(first);

    expect(bucket.entries.size).toBe(1);
  });

  it("logs duplicate-attempt info when an equivalent duplicate commit reuses the durable result", async () => {
    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "true";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    const first = await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await expect(
      persistHostedExecutionCommit({
        ...baseCommit,
        payload: {
          assistantDeliveryEffects: [],
          bundle: null,
          result: {
            summary: "ok",
            nextWakeAt: null,
            eventsHandled: 1,
          },
        },
      }),
    ).resolves.toEqual(first);

    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleInfo.mock.calls[0]?.[0]))).toMatchObject({
      component: "runner",
      details: {
        existingAssistantDeliveryCount: 0,
        existingCommittedAt: expect.any(String),
        incomingAssistantDeliveryCount: 0,
      },
      eventId: "evt_123",
      level: "info",
      message: "Hosted duplicate durable commit attempt encountered an existing commit.",
      phase: "commit.recorded",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("accepts duplicate commits when assistant deliveries are only reordered", async () => {
    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "true";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    const first = await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [
          createAssistantDeliveryEffect({
            effectId: "outbox_b",
            fingerprint: "fingerprint-b",
          }),
          createAssistantDeliveryEffect({
            effectId: "outbox_a",
            fingerprint: "fingerprint-a",
          }),
        ],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await expect(
      persistHostedExecutionCommit({
        ...baseCommit,
        payload: {
          assistantDeliveryEffects: [
            createAssistantDeliveryEffect({
              effectId: "outbox_a",
              fingerprint: "fingerprint-a",
            }),
            createAssistantDeliveryEffect({
              effectId: "outbox_b",
              fingerprint: "fingerprint-b",
            }),
          ],
          bundle: null,
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "ok",
          },
        },
      }),
    ).resolves.toEqual(first);

    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("accepts duplicate commits when assistant delivery fingerprints match but effect ids rotate", async () => {
    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "true";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    const first = await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [
          createAssistantDeliveryEffect({
            effectId: "outbox_original",
            fingerprint: "fingerprint-stable",
          }),
        ],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await expect(
      persistHostedExecutionCommit({
        ...baseCommit,
        payload: {
          assistantDeliveryEffects: [
            createAssistantDeliveryEffect({
              effectId: "outbox_regenerated",
              fingerprint: "fingerprint-stable",
              payload: {
                idempotencyKey: "assistant-outbox:outbox_original",
                sessionId: "session_outbox_original",
                turnId: "turn_outbox_original",
              },
            }),
          ],
          bundle: null,
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "ok",
          },
        },
      }),
    ).resolves.toEqual(first);

    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs sanitized assistant-delivery diagnostics when duplicate commit effects diverge", async () => {
    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "true";
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [
          createAssistantDeliveryEffect({
            effectId: "outbox_b",
            fingerprint: "fingerprint-b",
          }),
          createAssistantDeliveryEffect({
            effectId: "outbox_a",
            fingerprint: "fingerprint-a",
          }),
        ],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await expect(
      persistHostedExecutionCommit({
        ...baseCommit,
        payload: {
          assistantDeliveryEffects: [
            createAssistantDeliveryEffect({
              effectId: "outbox_a",
              fingerprint: "fingerprint-a",
            }),
            createAssistantDeliveryEffect({
              effectId: "outbox_b",
              fingerprint: "fingerprint-b-updated",
            }),
          ],
          bundle: null,
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "ok",
          },
        },
      }),
    ).rejects.toThrow(/assistant deliveries do not match the existing durable commit/i);

    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleInfo.mock.calls[0]?.[0]))).toMatchObject({
      component: "runner",
      details: {
        existingAssistantDeliveryCount: 2,
        existingCommittedAt: expect.any(String),
        incomingAssistantDeliveryCount: 2,
      },
      eventId: "evt_123",
      level: "info",
      message: "Hosted duplicate durable commit attempt encountered an existing commit.",
      phase: "commit.recorded",
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [payload] = consoleError.mock.calls[0] ?? [];
    expect(typeof payload).toBe("string");
    expect(JSON.parse(String(payload))).toMatchObject({
      component: "runner",
      details: {
        existingAssistantDeliveryCount: 2,
        existingAssistantDeliveriesInOrder: [
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_b",
            fingerprint: "fingerprint-b",
          }),
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_a",
            fingerprint: "fingerprint-a",
          }),
        ],
        existingAssistantDeliveriesSorted: [
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_a",
            fingerprint: "fingerprint-a",
          }),
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_b",
            fingerprint: "fingerprint-b",
          }),
        ],
        incomingAssistantDeliveryCount: 2,
        incomingAssistantDeliveriesInOrder: [
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_a",
            fingerprint: "fingerprint-a",
          }),
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_b",
            fingerprint: "fingerprint-b-updated",
          }),
        ],
        incomingAssistantDeliveriesSorted: [
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_a",
            fingerprint: "fingerprint-a",
          }),
          createAssistantDeliveryEffectSummary({
            effectId: "outbox_b",
            fingerprint: "fingerprint-b-updated",
          }),
        ],
        mismatch: "assistant_delivery_effects",
        sortedAssistantDeliveriesMatch: false,
      },
      eventId: "evt_123",
      level: "error",
      message: "Hosted duplicate durable commit payload diverged from the existing commit.",
      phase: "failed",
    });
  });

  it("rejects duplicate commits when assistant delivery payloads diverge under the same identity", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [
          createAssistantDeliveryEffect({
            effectId: "outbox_payload",
            fingerprint: "fingerprint-stable",
            payload: { message: "first payload" },
          }),
        ],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await expect(
      persistHostedExecutionCommit({
        ...baseCommit,
        payload: {
          assistantDeliveryEffects: [
            createAssistantDeliveryEffect({
              effectId: "outbox_payload",
              fingerprint: "fingerprint-stable",
              payload: { message: "changed payload" },
            }),
          ],
          bundle: null,
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "ok",
          },
        },
      }),
    ).rejects.toThrow(/assistant deliveries do not match the existing durable commit/i);
  });
});

describe("persistHostedExecutionFinalBundles", () => {
  it("accepts equivalent duplicate finalizes without rewriting the durable result", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    const finalized = await persistHostedExecutionFinalBundles({
      bucket,
      eventId: baseCommit.eventId,
      key: baseCommit.key,
      keyId: baseCommit.keyId,
      payload: {
        bundle: encodeBundle("bundle-a"),
        gatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-12T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
      },
      userId: baseCommit.userId,
    });

    await expect(
      persistHostedExecutionFinalBundles({
        bucket,
        eventId: baseCommit.eventId,
        key: baseCommit.key,
        keyId: baseCommit.keyId,
        payload: {
          bundle: encodeBundle("bundle-a"),
          gatewayProjectionSnapshot: {
            permissions: [],
            messages: [],
            conversations: [],
            generatedAt: "2026-04-12T00:00:00.000Z",
            schema: "murph.gateway-projection-snapshot.v1",
          },
        },
        userId: baseCommit.userId,
      }),
    ).resolves.toEqual(finalized);

    expect(bucket.entries.size).toBe(2);
  });

  it("rejects post-finalize retries that try to replace the durable gateway snapshot", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await persistHostedExecutionFinalBundles({
      bucket,
      eventId: baseCommit.eventId,
      key: baseCommit.key,
      keyId: baseCommit.keyId,
      payload: {
        bundle: encodeBundle("bundle-a"),
        gatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-12T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
      },
      userId: baseCommit.userId,
    });

    await expect(
      persistHostedExecutionFinalBundles({
        bucket,
        eventId: baseCommit.eventId,
        key: baseCommit.key,
        keyId: baseCommit.keyId,
        payload: {
          bundle: encodeBundle("bundle-a"),
          gatewayProjectionSnapshot: {
            schema: "murph.gateway-projection-snapshot.v1",
            generatedAt: "2026-04-12T00:00:00.000Z",
            conversations: [
              {
                schema: "murph.gateway-conversation.v1",
                sessionKey: "conversation-2",
                title: null,
                titleSource: null,
                lastMessagePreview: null,
                lastActivityAt: null,
                messageCount: null,
                canSend: false,
                route: {
                  channel: null,
                  identityId: null,
                  participantId: null,
                  threadId: null,
                  directness: null,
                  reply: {
                    kind: null,
                    target: null,
                  },
                },
              },
            ],
            messages: [],
            permissions: [],
          },
        },
        userId: baseCommit.userId,
      }),
    ).rejects.toThrow(/gateway projection snapshot does not match the existing durable finalize/i);

    expect(bucket.entries.size).toBe(2);
  });

  it("rejects post-finalize retries that try to replace the durable bundle", async () => {
    const bucket = new InMemoryR2Bucket();
    const baseCommit = createBaseCommit(bucket);

    await persistHostedExecutionCommit({
      ...baseCommit,
      payload: {
        assistantDeliveryEffects: [],
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

    await persistHostedExecutionFinalBundles({
      bucket,
      eventId: baseCommit.eventId,
      key: baseCommit.key,
      keyId: baseCommit.keyId,
      payload: {
        bundle: encodeBundle("bundle-a"),
      },
      userId: baseCommit.userId,
    });

    await expect(
      persistHostedExecutionFinalBundles({
        bucket,
        eventId: baseCommit.eventId,
        key: baseCommit.key,
        keyId: baseCommit.keyId,
        payload: {
          bundle: encodeBundle("bundle-b"),
        },
        userId: baseCommit.userId,
      }),
    ).rejects.toThrow(/vault bundle ref does not match the existing durable finalize/i);

    expect(bucket.entries.size).toBe(2);
  });
});
