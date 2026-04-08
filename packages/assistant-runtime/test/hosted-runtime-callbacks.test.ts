import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
  buildHostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  dispatchAssistantOutboxIntent: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  shouldDispatchAssistantOutboxIntent: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", () => ({
  dispatchAssistantOutboxIntent: mocks.dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
  normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
  shouldDispatchAssistantOutboxIntent: mocks.shouldDispatchAssistantOutboxIntent,
}));

import {
  collectHostedExecutionSideEffects,
  commitHostedExecutionResult,
  drainHostedCommittedSideEffectsAfterCommit,
  resumeHostedCommittedExecution,
} from "../src/hosted-runtime/callbacks.ts";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.normalizeAssistantDeliveryError.mockImplementation((error: Error) => ({
    message: error.message,
  }));
});

describe("hosted runtime callbacks", () => {
  it("rebuilds committed resume state from the request payload", () => {
    const sideEffect = buildHostedAssistantDeliverySideEffect({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
    });

    const resumed = resumeHostedCommittedExecution({
      bundle: "bundle_123",
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_resume",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed",
          },
          sideEffects: [sideEffect],
        },
      },
    });

    assert.equal(resumed.committedResult.bundle, "bundle_123");
    assert.deepEqual(resumed.committedResult.result, {
      eventsHandled: 1,
      nextWakeAt: null,
      summary: "completed",
    });
    assert.deepEqual(resumed.committedSideEffects, [sideEffect]);
    assert.equal(
      resumed.committedGatewayProjectionSnapshot.schema,
      "murph.gateway-projection-snapshot.v1",
    );
  });

  it("skips durable commit callbacks when no commit handler is present", async () => {
    const commit = vi.fn();

    await commitHostedExecutionResult({
      commit: null,
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_no_commit",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        commit,
        async deletePreparedSideEffect() {},
        async readRawEmailMessage() {
          return null;
        },
        async readSideEffect() {
          return null;
        },
        async sendEmail() {},
        async writeSideEffect(record) {
          return record;
        },
      },
      result: {
        bundle: "bundle_123",
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "completed",
        },
      },
      sideEffects: [],
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it("wraps durable commit callback failures with user and event context", async () => {
    await expect(
      commitHostedExecutionResult({
        commit: {
          bundleRef: {
            hash: "hash_123",
            key: "bundles/member/vault.json",
            size: 42,
            updatedAt: "2026-04-08T00:00:00.000Z",
          },
        },
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_commit",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        effectsPort: {
          async commit() {
            throw new Error("boom");
          },
          async deletePreparedSideEffect() {},
          async readRawEmailMessage() {
            return null;
          },
          async readSideEffect() {
            return null;
          },
          async sendEmail() {},
          async writeSideEffect(record) {
            return record;
          },
        },
        result: {
          bundle: "bundle_123",
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed",
          },
        },
        sideEffects: [],
      }),
    ).rejects.toThrow(/durable commit failed for member_123\/evt_commit/u);
  });

  it("collects only dispatchable side effects and caps the committed batch size", async () => {
    const intents = Array.from({ length: 25 }, (_, index) => ({
      dedupeKey: `dedupe_${index}`,
      intentId: `intent_${index}`,
    }));
    mocks.listAssistantOutboxIntents.mockResolvedValue(intents);
    mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(true);

    const sideEffects = await collectHostedExecutionSideEffects("/tmp/vault");

    expect(mocks.listAssistantOutboxIntents).toHaveBeenCalledWith("/tmp/vault");
    assert.equal(sideEffects.length, 20);
    assert.deepEqual(
      sideEffects.map((effect) => effect.intentId),
      intents.slice(0, 20).map((intent) => intent.intentId),
    );
  });

  it("skips intents that are not ready to dispatch", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      { dedupeKey: "dedupe_skip", intentId: "intent_skip" },
      { dedupeKey: "dedupe_send", intentId: "intent_send" },
    ]);
    mocks.shouldDispatchAssistantOutboxIntent
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const sideEffects = await collectHostedExecutionSideEffects("/tmp/vault");

    assert.deepEqual(sideEffects, [
      buildHostedAssistantDeliverySideEffect({
        dedupeKey: "dedupe_send",
        intentId: "intent_send",
      }),
    ]);
  });

  it("passes no journal hooks when draining committed side effects without a commit callback", async () => {
    let observedDispatchHooks: object | undefined;

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedSideEffectsAfterCommit({
      commit: null,
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_no_hooks",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        async commit() {},
        async deletePreparedSideEffect() {},
        async readRawEmailMessage() {
          return null;
        },
        async readSideEffect() {
          return null;
        },
        async sendEmail() {},
        async writeSideEffect(record) {
          return record;
        },
      },
      sideEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    expect(observedDispatchHooks).toBeUndefined();
  });

  it("writes prepared and sent delivery records through the hosted side-effect journal hooks", async () => {
    let observedDispatchHooks:
      | {
          prepareDispatchIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const writes: object[] = [];
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });
    const sentRecord = buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe_123",
      delivery: {
        channel: "email",
        idempotencyKey: "idem_123",
        messageLength: 5,
        providerMessageId: "provider_message_123",
        providerThreadId: "provider_thread_123",
        sentAt: "2026-04-08T00:01:00.000Z",
        target: "user@example.com",
        targetKind: "explicit",
      },
      intentId: "intent_123",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedSideEffectsAfterCommit({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_hooks",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        ...createHostedRuntimeEffectsPortStub(),
        async readSideEffect() {
          return sentRecord;
        },
        async writeSideEffect(record) {
          writes.push(record);
          return record;
        },
      },
      sideEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await observedDispatchHooks.prepareDispatchIntent({
      intent: {
        dedupeKey: "dedupe_123",
        intentId: "intent_123",
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
      },
      vault: "/tmp/vault",
    });
    assert.deepEqual(writes[0], preparedRecord);

    const resolved = await observedDispatchHooks.resolveDeliveredIntent({
      intent: {
        dedupeKey: "dedupe_123",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(resolved, {
      channel: "email",
      idempotencyKey: "idem_123",
      messageLength: 5,
      providerMessageId: "provider_message_123",
      providerThreadId: "provider_thread_123",
      sentAt: "2026-04-08T00:01:00.000Z",
      target: "user@example.com",
      targetKind: "explicit",
    });
  });

  it("clears prepared delivery records through the hosted side-effect journal hooks", async () => {
    let observedDispatchHooks:
      | {
          clearPreparedIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
        }
      | undefined;
    const deleted: Array<Record<string, string>> = [];

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedSideEffectsAfterCommit({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_delete_hook",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async deletePreparedSideEffect(input) {
          deleted.push(input);
        },
      }),
      sideEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await observedDispatchHooks.clearPreparedIntent({
      intent: {
        dedupeKey: "dedupe_123",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(deleted, [{
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
    }]);
  });

  it("fails closed when local delivery confirmation is still pending after the send", async () => {
    let observedDispatchHooks:
      | {
          persistDeliveredIntent(args: {
            delivery: Record<string, unknown>;
            intent: Record<string, unknown>;
            vault: string;
          }): Promise<void>;
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedSideEffectsAfterCommit({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_pending_confirmation",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        ...createHostedRuntimeEffectsPortStub(),
        async readSideEffect() {
          return preparedRecord;
        },
      },
      sideEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
      deliveryMayHaveSucceeded: true,
      retryable: true,
    });

    await expect(
      observedDispatchHooks.persistDeliveredIntent({
        delivery: {
          channel: "email",
          idempotencyKey: "",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: null,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "user@example.com",
          targetKind: "explicit",
        },
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toThrow(/require a non-empty idempotencyKey/u);
  });

  it("reconciles delivered intents from the local record when the journal is still prepared", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const writes: object[] = [];
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedSideEffectsAfterCommit({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_local_reconcile",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readSideEffect() {
          return preparedRecord;
        },
        async writeSideEffect(record) {
          writes.push(record);
          return record;
        },
      }),
      sideEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    const resolved = await observedDispatchHooks.resolveDeliveredIntent({
      intent: {
        dedupeKey: "dedupe_123",
        delivery: {
          channel: "email",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: null,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "user@example.com",
          targetKind: "explicit",
        },
        deliveryIdempotencyKey: "idem_fallback",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(resolved, {
      channel: "email",
      idempotencyKey: "idem_fallback",
      messageLength: 5,
      providerMessageId: "provider_message_123",
      providerThreadId: null,
      sentAt: "2026-04-08T00:01:00.000Z",
      target: "user@example.com",
      targetKind: "explicit",
    });
    assert.deepEqual(writes, [
      buildHostedAssistantDeliverySentRecord({
        dedupeKey: "dedupe_123",
        delivery: {
          channel: "email",
          idempotencyKey: "idem_fallback",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: null,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "user@example.com",
          targetKind: "explicit",
        },
        intentId: "intent_123",
      }),
    ]);
  });

  it("marks delivery confirmation pending when journal reconciliation fails after a local send", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const journalError = new Error("journal unavailable");
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedSideEffectsAfterCommit({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_reconcile_error",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readSideEffect() {
          return preparedRecord;
        },
        async writeSideEffect() {
          throw journalError;
        },
      }),
      sideEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          delivery: {
            channel: "email",
            idempotencyKey: "idem_123",
            messageLength: 5,
            providerMessageId: "provider_message_123",
            providerThreadId: null,
            sentAt: "2026-04-08T00:01:00.000Z",
            target: "user@example.com",
            targetKind: "explicit",
          },
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        cause: journalError,
        code: "HOSTED_SIDE_EFFECT_JOURNAL_FAILED",
      }),
      code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
      deliveryMayHaveSucceeded: true,
      retryable: true,
    });
  });
});
