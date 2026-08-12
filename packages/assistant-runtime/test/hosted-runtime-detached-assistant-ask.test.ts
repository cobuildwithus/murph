import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AssistantProviderUsageDraft,
  ConsentedReadOnlyAssistantAskInput,
  ReadOnlyAssistantAskInput,
  ReadOnlyAssistantAskResult,
} from "@murphai/assistant-engine/assistant-ask";
import { initializeVault } from "@murphai/core";
import { buildHostedExecutionAssistantAskCompletedWake } from "@murphai/hosted-execution";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { describe, test, vi } from "vitest";

vi.mock("@murphai/assistant-engine", () => ({
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
}));
vi.mock("@murphai/assistant-engine/assistant-ask", () => ({
  executeConsentedReadOnlyAssistantAsk: vi.fn(),
  executeReadOnlyAssistantAsk: vi.fn(),
}));

import {
  createHostedDetachedAssistantAskController,
} from "../src/hosted-runtime/detached-assistant-ask.ts";
import {
  claimHostedSystemMailboxItem,
  resolveHostedSystemMailboxNextWakeCandidate,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import type {
  HostedWorkspaceDurableCheckpointEffect,
} from "../src/hosted-runtime/workspace-runner.ts";

const TEST_NOW = "2026-07-15T12:00:00.000Z";
const TEST_USER_ID = "member_synthetic_detached_ask";

describe("hosted detached assistant ask controller", () => {
  test("route-filtered claims leave requests to the detached owner and admit completions", async () => {
    const vaultRoot = await createVaultRoot();

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_requested", itemId: "item_requested" }),
        createPendingCompletion({
          eventId: "ask_event_completed",
          itemId: "item_completed",
        }),
      ]);

      const completion = await claimHostedSystemMailboxItem({
        allowedRouteActions: ["continue-assistant-ask"],
        now: () => TEST_NOW,
        vaultRoot,
      });

      assert.equal(completion?.itemId, "item_completed");
      assert.equal(completion?.status, "sending");
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => [
          item.itemId,
          item.status,
        ]),
        [
          ["item_requested", "pending"],
          ["item_completed", "sending"],
        ],
      );
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("runs at most one ask and kicks the next durable request after completion", async () => {
    const vaultRoot = await createVaultRoot();
    const firstAnswer = createDeferred<void>();
    const secondAnswer = createDeferred<void>();
    const executeAsk = vi.fn(async (input: {
      question: string;
      requesterParticipantId: string;
    }) => {
      if (input.question === "first question") {
        await firstAnswer.promise;
        return { answer: "first answer", outcome: "answered" as const };
      }
      await secondAnswer.promise;
      return { answer: "second answer", outcome: "answered" as const };
    });
    const completedRequestIds: string[] = [];
    const assistantAskPort = {
      async request(request: {
        action: "complete" | "prepare";
        requestId: string;
      }) {
        if (request.action === "prepare") {
          return {
            action: "prepare" as const,
            question: request.requestId === "ask_event_1"
              ? "first question"
              : "second question",
            status: "ready" as const,
            targetLabel: "100 Club",
          };
        }
        completedRequestIds.push(request.requestId);
        return {
          action: "complete" as const,
          status: "completed" as const,
        };
      },
    };

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_1", itemId: "item_1" }),
        createPendingAsk({ eventId: "ask_event_2", itemId: "item_2" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort,
        codexHome: null,
        env: {},
        executeAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      await waitUntil(() => assert.equal(executeAsk.mock.calls.length, 1));
      assert.equal(executeAsk.mock.calls[0]?.[0].question, "first question");
      assert.equal(
        executeAsk.mock.calls[0]?.[0].requesterParticipantId,
        "membership_synthetic_ask",
      );
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => [
          item.itemId,
          item.status,
        ]),
        [
          ["item_1", "sending"],
          ["item_2", "pending"],
        ],
      );

      firstAnswer.resolve();
      await waitUntil(() => assert.equal(executeAsk.mock.calls.length, 2));
      assert.equal(executeAsk.mock.calls[1]?.[0].question, "second question");
      assert.equal(
        executeAsk.mock.calls[1]?.[0].requesterParticipantId,
        "membership_synthetic_ask",
      );
      assert.deepEqual(completedRequestIds, ["ask_event_1"]);

      secondAnswer.resolve();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await controller.closeAndRequeue();
      assert.deepEqual(completedRequestIds, ["ask_event_1", "ask_event_2"]);
      assert.equal(executeAsk.mock.calls.length, 2);
    } finally {
      firstAnswer.resolve();
      secondAnswer.resolve();
      await removeVaultRoot(vaultRoot);
    }
  });

  test("preserves a legacy joined-group cannot-answer explanation on completion", async () => {
    const vaultRoot = await createVaultRoot();
    let completedResult: unknown;
    const explanation = "The authorized group evidence does not answer that question.";

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_legacy", itemId: "item_legacy" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "prepare") {
              return {
                action: "prepare",
                question: "What did the group decide?",
                status: "ready",
                targetLabel: "100 Club",
              };
            }
            completedResult = request.result;
            return { action: "complete", status: "completed" };
          },
        },
        codexHome: null,
        env: {},
        executeAsk: vi.fn(async (): Promise<ReadOnlyAssistantAskResult> => ({
          answer: explanation,
          outcome: "cannot_answer",
        })),
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await controller.closeAndRequeue();

      assert.deepEqual(completedResult, {
        answer: explanation,
        outcome: "cannot_answer",
      });
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("requeues immediately and closes the stale controller on provider handoff", async () => {
    const vaultRoot = await createVaultRoot();
    const resolveProviderAuthority = vi.fn(async () => "handoff" as const);
    let completionCalls = 0;
    let providerEgressCount = 0;

    try {
      await writePending(vaultRoot, [
        createPendingAsk({
          eventId: "ask_provider_handoff",
          itemId: "item_provider_handoff",
        }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "complete") {
              completionCalls += 1;
              return { action: "complete", status: "completed" };
            }
            return {
              action: "prepare",
              question: "What did the group decide?",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        codexHome: null,
        env: {},
        executeAsk: vi.fn(async (input: ReadOnlyAssistantAskInput) => {
          await input.beforeProviderEntry?.();
          providerEgressCount += 1;
          return { answer: "stale answer", outcome: "answered" as const };
        }),
        now: () => TEST_NOW,
        onStateMutation() {},
        resolveProviderAuthority,
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        assert.equal(resolveProviderAuthority.mock.calls.length, 1);
        const item = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
        assert.equal(item?.status, "pending");
        assert.equal(item?.nextAttemptAt, null);
      });
      controller.kick();
      await Promise.resolve();
      await controller.closeAndRequeue();

      assert.equal(resolveProviderAuthority.mock.calls.length, 1);
      assert.equal(providerEgressCount, 0);
      assert.equal(completionCalls, 0);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("delays retry without provider egress when live authority is unavailable", async () => {
    const vaultRoot = await createVaultRoot();
    let providerEgressCount = 0;

    try {
      await writePending(vaultRoot, [
        createPendingAsk({
          eventId: "ask_provider_unavailable",
          itemId: "item_provider_unavailable",
        }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "complete") {
              throw new Error("Unavailable authority must not complete the ask.");
            }
            return {
              action: "prepare",
              question: "What did the group decide?",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        codexHome: null,
        env: {},
        executeAsk: vi.fn(async (input: ReadOnlyAssistantAskInput) => {
          await input.beforeProviderEntry?.();
          providerEgressCount += 1;
          return { answer: "unreachable", outcome: "answered" as const };
        }),
        now: () => TEST_NOW,
        onStateMutation() {},
        resolveProviderAuthority: async () => {
          throw new Error("control plane unavailable");
        },
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        const item = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
        assert.equal(item?.status, "pending");
        assert.equal(item?.nextAttemptAt, "2026-07-15T12:01:00.000Z");
      });
      await controller.closeAndRequeue();

      assert.equal(providerEgressCount, 0);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("routes disclosure requests only through the consented executor before completion", async () => {
    const vaultRoot = await createVaultRoot();
    const executeAsk = vi.fn();
    let completedResult: unknown;
    const deferredUsageEffects: HostedWorkspaceDurableCheckpointEffect[] = [];
    const usageRecords: AssistantUsageRecord[] = [];
    const executeConsentedAsk = vi.fn(async (
      input: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ReadOnlyAssistantAskResult> => {
      input.onProviderUsage?.({
        stage: "answer",
        usage: createTestUsageDraft({
          inputTokens: 25,
          occurredAt: "2026-07-15T12:00:02.000Z",
          outputTokens: 5,
          providerRequestOrdinal: 0,
        }),
      });
      input.onProviderUsage?.({
        stage: "review",
        usage: createTestUsageDraft({
          inputTokens: 10,
          occurredAt: "2026-07-15T12:00:08.000Z",
          outputTokens: 1,
          providerRequestOrdinal: 0,
        }),
      });
      return { outcome: "cannot_answer" };
    });

    try {
      await writePending(vaultRoot, [
        createPendingAsk({
          consented: true,
          eventId: "ask_event_disclosure",
          itemId: "item_disclosure",
        }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "prepare") {
              return {
                action: "prepare",
                disclosure: {
                  permissionText: "Share only calendar availability for this call.",
                },
                question: "Are you free Tuesday afternoon?",
                status: "ready",
                targetLabel: "Call Circle",
              };
            }
            completedResult = request.result;
            return { action: "complete", status: "completed" };
          },
        },
        codexHome: "/codex-home",
        deferUsageUntilAfterDurableCheckpoint(effect) {
          deferredUsageEffects.push(effect);
        },
        env: {
          LANG: "en_US.UTF-8",
          OPENAI_API_KEY: "member-provider-key",
        },
        executeAsk,
        executeConsentedAsk,
        memberId: TEST_USER_ID,
        now: () => TEST_NOW,
        onStateMutation() {},
        usageRecordPort: {
          async recordUsage(record) {
            usageRecords.push(record);
            return { recorded: true, usageId: record.usageId };
          },
        },
        userEnvKeys: ["OPENAI_API_KEY"],
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await controller.closeAndRequeue();

      assert.equal(executeAsk.mock.calls.length, 0);
      const consentedInput = executeConsentedAsk.mock.calls[0]?.[0];
      assert.ok(consentedInput);
      assert.equal(
        consentedInput.permissionText,
        "Share only calendar availability for this call.",
      );
      assert.equal(consentedInput.question, "Are you free Tuesday afternoon?");
      assert.equal(consentedInput.workspaceRoot, vaultRoot);
      assert.deepEqual(completedResult, { answer: null, outcome: "cannot_answer" });
      assert.equal(usageRecords.length, 0);
      assert.equal(deferredUsageEffects.length, 1);
      await deferredUsageEffects[0]?.();
      assert.deepEqual(usageRecords.map((record) => ({
        attemptCount: record.attemptCount,
        credentialSource: record.credentialSource,
        memberId: record.memberId,
        occurredAt: record.occurredAt,
        providerRequestOrdinal: record.providerRequestOrdinal,
        sessionId: record.sessionId,
        turnId: record.turnId,
        usageId: record.usageId,
      })), [
        {
          attemptCount: 1,
          credentialSource: "member",
          memberId: TEST_USER_ID,
          occurredAt: "2026-07-15T12:00:02.000Z",
          providerRequestOrdinal: 0,
          sessionId: "ask_event_disclosure",
          turnId: "turn_assistant_ask_ask_event_disclosure.stage-answer",
          usageId:
            "turn_assistant_ask_ask_event_disclosure.stage-answer.attempt-1",
        },
        {
          attemptCount: 1,
          credentialSource: "member",
          memberId: TEST_USER_ID,
          occurredAt: "2026-07-15T12:00:08.000Z",
          providerRequestOrdinal: 0,
          sessionId: "ask_event_disclosure",
          turnId: "turn_assistant_ask_ask_event_disclosure.stage-review",
          usageId:
            "turn_assistant_ask_ask_event_disclosure.stage-review.attempt-1",
        },
      ]);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("keeps usage-record failures isolated from ask completion", async () => {
    const vaultRoot = await createVaultRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deferredUsageEffects: HostedWorkspaceDurableCheckpointEffect[] = [];
    let completionCalls = 0;

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_usage_failure", itemId: "item_usage_failure" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "prepare") {
              return {
                action: "prepare",
                question: "What happened?",
                status: "ready",
                targetLabel: "100 Club",
              };
            }
            completionCalls += 1;
            return { action: "complete", status: "completed" };
          },
        },
        codexHome: null,
        deferUsageUntilAfterDurableCheckpoint(effect) {
          deferredUsageEffects.push(effect);
        },
        env: {},
        async executeAsk(input) {
          input.onProviderUsage?.({
            stage: "answer",
            usage: createTestUsageDraft({
              inputTokens: 7,
              outputTokens: 2,
              providerRequestOrdinal: 0,
            }),
          });
          return { answer: "The group finished.", outcome: "answered" };
        },
        now: () => TEST_NOW,
        onStateMutation() {},
        usageRecordPort: {
          async recordUsage() {
            throw new Error("usage control plane unavailable");
          },
        },
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await controller.closeAndRequeue();

      assert.equal(completionCalls, 1);
      assert.equal(warn.mock.calls.length, 0);
      assert.equal(deferredUsageEffects.length, 1);
      await deferredUsageEffects[0]?.();
      assert.equal(warn.mock.calls.length, 1);
      assert.match(String(warn.mock.calls[0]?.[0]), /continuing without retry/u);
    } finally {
      warn.mockRestore();
      await removeVaultRoot(vaultRoot);
    }
  });

  test("defers retry usage until checkpoint and keeps attempt identities replay-safe", async () => {
    const vaultRoot = await createVaultRoot();
    const deferredUsageEffects: HostedWorkspaceDurableCheckpointEffect[] = [];
    const usageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort = {
      async recordUsage(record: AssistantUsageRecord) {
        usageRecords.push(record);
        return { recorded: true, usageId: record.usageId };
      },
    };

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_retry_usage", itemId: "item_retry_usage" }),
      ]);
      const firstController = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            assert.equal(request.action, "prepare");
            return {
              action: "prepare",
              question: "What happened?",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        codexHome: null,
        deferUsageUntilAfterDurableCheckpoint(effect) {
          deferredUsageEffects.push(effect);
        },
        env: {},
        async executeAsk(input) {
          input.onProviderUsage?.({
            stage: "answer",
            usage: createTestUsageDraft({
              inputTokens: 9,
              outputTokens: 3,
              providerRequestOrdinal: 0,
            }),
          });
          throw new Error("first provider attempt failed");
        },
        now: () => TEST_NOW,
        onStateMutation() {},
        usageRecordPort,
        vaultRoot,
      });

      firstController.kick();
      await waitUntil(async () => {
        const pending = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
        assert.equal(pending?.attemptCount, 1);
        assert.equal(pending?.status, "pending");
      });
      await firstController.closeAndRequeue();
      assert.equal(usageRecords.length, 0);
      assert.equal(deferredUsageEffects.length, 1);
      const firstEffect = deferredUsageEffects[0];
      assert.ok(firstEffect);
      await firstEffect();

      const secondController = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "prepare") {
              return {
                action: "prepare",
                question: "What happened?",
                status: "ready",
                targetLabel: "100 Club",
              };
            }
            return { action: "complete", status: "completed" };
          },
        },
        codexHome: null,
        deferUsageUntilAfterDurableCheckpoint(effect) {
          deferredUsageEffects.push(effect);
        },
        env: {},
        async executeAsk(input) {
          input.onProviderUsage?.({
            stage: "answer",
            usage: createTestUsageDraft({
              inputTokens: 9,
              outputTokens: 3,
              providerRequestOrdinal: 0,
            }),
          });
          return { answer: "The group finished.", outcome: "answered" };
        },
        now: () => "2026-07-15T12:01:00.000Z",
        onStateMutation() {},
        usageRecordPort,
        vaultRoot,
      });

      secondController.kick();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await secondController.closeAndRequeue();
      assert.equal(usageRecords.length, 1);
      assert.equal(deferredUsageEffects.length, 2);
      const secondEffect = deferredUsageEffects[1];
      assert.ok(secondEffect);
      await secondEffect();

      assert.deepEqual(usageRecords.map((record) => record.usageId), [
        "turn_assistant_ask_ask_retry_usage.stage-answer.attempt-1",
        "turn_assistant_ask_ask_retry_usage.stage-answer.attempt-2",
      ]);
      const firstRecord = usageRecords[0];
      assert.ok(firstRecord);
      await firstEffect();
      assert.deepEqual(usageRecords[2], firstRecord);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test.each([
    ["failed disclosure", true, true, 1],
    ["consented member without disclosure", true, false, 0],
    ["joined group with disclosure", false, true, 0],
  ])("requeues %s without completing or falling back", async (
    _label,
    consented,
    includeDisclosure,
    consentedCalls,
  ) => {
    const vaultRoot = await createVaultRoot();
    const executeAsk = vi.fn();
    const executeConsentedAsk = vi.fn(async () => {
      throw new Error(
        "assistant ask failed for https://r2.example.test/private?X-Amz-Signature=fixture-secret"
          + " with TOKEN=fixture-token and member_123",
        { cause: new TypeError("local scratch /tmp/hosted-runtime/assistant-ask.json") },
      );
    });
    let completionCalls = 0;
    try {
      await writePending(vaultRoot, [
        createPendingAsk({ consented, eventId: "ask_failure", itemId: "item_failure" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "complete") {
              completionCalls += 1;
              return { action: "complete", status: "completed" };
            }
            return {
              action: "prepare",
              ...(includeDisclosure
                ? { disclosure: { permissionText: "Share calendar availability only." } }
                : {}),
              question: "Are you free?",
              status: "ready",
              targetLabel: "Call Circle",
            };
          },
        },
        codexHome: null,
        env: {},
        executeAsk,
        executeConsentedAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        const item = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
        assert.equal(item?.status, "pending");
        assert.equal(item?.nextAttemptAt, "2026-07-15T12:01:00.000Z");
        assert.doesNotMatch(
          item?.lastErrorMessage ?? "",
          /fixture-secret|fixture-token|member_123|\/tmp\//u,
        );
      });
      await controller.closeAndRequeue();
      assert.equal(executeAsk.mock.calls.length, 0);
      assert.equal(executeConsentedAsk.mock.calls.length, consentedCalls);
      assert.equal(completionCalls, 0);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("runs a freshness read lazily inside the detached model and commits its result", async () => {
    const vaultRoot = await createVaultRoot();
    const sharedRead = vi.fn(async () => ({
      members: [] as const,
      requestedProjectionScopeKeys: ["deep-sleep-sources-days.v1"],
      status: "none" as const,
    }));
    const groupSharedReader = { request: sharedRead };
    const createGroupSharedReader = vi.fn(() => groupSharedReader);
    const executeAsk = vi.fn(async (input) => {
      assert.equal(input.groupSharedReader, groupSharedReader);
      assert.equal(sharedRead.mock.calls.length, 0);
      await input.groupSharedReader?.request({
        projectionScopes: [{
          projectionKind: "deep-sleep-sources-days.v1",
        }],
      });
      return {
        answer: "Deep sleep is not currently visible; the cause is unknown.",
        outcome: "answered" as const,
      };
    });
    const completionRequests: unknown[] = [];

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_authority", itemId: "item_authority" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "complete") {
              completionRequests.push(request);
              return { action: "complete", status: "completed" };
            }
            return {
              action: "prepare",
              question: "Can the group see my Deep sleep yet after I reconnected?",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        codexHome: null,
        createGroupSharedReader,
        env: {},
        executeAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      assert.equal(createGroupSharedReader.mock.calls.length, 0);
      assert.equal(sharedRead.mock.calls.length, 0);
      controller.kick();
      await waitUntil(async () => {
        const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
        assert.equal(pending.length, 0);
      });
      await controller.closeAndRequeue();
      assert.equal(createGroupSharedReader.mock.calls.length, 1);
      assert.equal(executeAsk.mock.calls.length, 1);
      assert.deepEqual(sharedRead.mock.calls, [[{
        projectionScopes: [{
          projectionKind: "deep-sleep-sources-days.v1",
        }],
      }]]);
      assert.deepEqual(completionRequests, [{
        action: "complete",
        requestId: "ask_event_authority",
        result: {
          answer: "Deep sleep is not currently visible; the cause is unknown.",
          outcome: "answered",
        },
      }]);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("suppresses a sending wake and aborts, awaits, then requeues the exact ask", async () => {
    const vaultRoot = await createVaultRoot();
    const askStarted = createDeferred<void>();
    const childExited = createDeferred<void>();
    const events: string[] = [];
    const executeAsk = vi.fn(async (input) => {
      events.push("child.started");
      askStarted.resolve();
      await new Promise<void>((_resolve, reject) => {
        input.abortSignal?.addEventListener("abort", async () => {
          events.push("child.aborted");
          await childExited.promise;
          events.push("child.exited");
          reject(input.abortSignal?.reason);
        }, { once: true });
      });
      throw new Error("Interrupted ask unexpectedly returned.");
    });
    let stopSettled = false;

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_abort", itemId: "item_abort" }),
        createPendingAsk({ eventId: "ask_event_later", itemId: "item_later" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            assert.equal(request.action, "prepare");
            return {
              action: "prepare",
              question: "question that will be interrupted",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        codexHome: null,
        env: {},
        executeAsk,
        now: () => TEST_NOW,
        onStateMutation() {
          events.push("state.mutated");
        },
        vaultRoot,
      });

      controller.kick();
      await askStarted.promise;
      assert.deepEqual(
        await resolveHostedSystemMailboxNextWakeCandidate({
          allowedRouteActions: ["run-assistant-ask"],
          now: () => TEST_NOW,
          vaultRoot,
        }),
        { at: null, reason: null },
      );

      const stopped = controller.closeAndRequeue().then(() => {
        stopSettled = true;
        events.push("controller.stopped");
      });
      await waitUntil(() => assert.ok(events.includes("child.aborted")));
      await Promise.resolve();
      assert.equal(stopSettled, false);
      assert.equal(events.includes("controller.stopped"), false);

      childExited.resolve();
      await stopped;
      assert.deepEqual(events.slice(-3), [
        "child.exited",
        "state.mutated",
        "controller.stopped",
      ]);
      const state = await readHostedSystemMailboxState(vaultRoot);
      assert.deepEqual(state.pending.map((item) => [
        item.itemId,
        item.status,
        item.nextAttemptAt,
      ]), [
        ["item_abort", "pending", null],
        ["item_later", "pending", null],
      ]);
      assert.equal(executeAsk.mock.calls.length, 1);
    } finally {
      childExited.resolve();
      await removeVaultRoot(vaultRoot);
    }
  });

  test("does not restart while paused and resumes one retained request after the boundary", async () => {
    const vaultRoot = await createVaultRoot();
    const secondRunStarted = createDeferred<void>();
    let executeCalls = 0;

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_pause", itemId: "item_pause" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "complete") {
              return { action: "complete", status: "completed" };
            }
            return {
              action: "prepare",
              question: "pause boundary question",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        codexHome: null,
        env: {},
        async executeAsk(input) {
          executeCalls += 1;
          if (executeCalls === 2) {
            secondRunStarted.resolve();
          }
          return await new Promise((_resolve, reject) => {
            input.abortSignal?.addEventListener(
              "abort",
              () => reject(input.abortSignal?.reason),
              { once: true },
            );
          });
        },
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      await waitUntil(() => assert.equal(executeCalls, 1));
      await controller.pauseAndRequeue();
      controller.kick();
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(executeCalls, 1);
      assert.equal(
        (await readHostedSystemMailboxState(vaultRoot)).pending[0]?.status,
        "pending",
      );

      controller.resume();
      await secondRunStarted.promise;
      assert.equal(executeCalls, 2);
      await controller.closeAndRequeue();
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("removes a terminal request without starting Codex", async () => {
    const vaultRoot = await createVaultRoot();
    const executeAsk = vi.fn();

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_expired", itemId: "item_expired" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request() {
            return {
              action: "prepare",
              status: "terminal",
              terminalReason: "expired",
            };
          },
        },
        codexHome: null,
        env: {},
        executeAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await controller.closeAndRequeue();
      assert.equal(executeAsk.mock.calls.length, 0);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("dequeues an expired current-sender replay and advances the next ask", async () => {
    const vaultRoot = await createVaultRoot();
    const executeAsk = vi.fn(async () => ({
      answer: "second answer",
      outcome: "answered" as const,
    }));
    const preparedRequestIds: string[] = [];

    try {
      await writePending(vaultRoot, [
        createPendingAsk({
          currentSender: true,
          eventId: "ask_event_expired_replay",
          itemId: "item_expired_replay",
        }),
        createPendingAsk({ eventId: "ask_event_after_replay", itemId: "item_after_replay" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "complete") {
              return { action: "complete", status: "completed" };
            }
            preparedRequestIds.push(request.requestId);
            return request.requestId === "ask_event_expired_replay"
              ? { action: "prepare", status: "already_completed" }
              : {
                  action: "prepare",
                  question: "second question",
                  status: "ready",
                  targetLabel: "100 Club",
                };
          },
        },
        codexHome: null,
        env: {},
        executeAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await controller.closeAndRequeue();

      assert.deepEqual(preparedRequestIds, [
        "ask_event_expired_replay",
        "ask_event_after_replay",
      ]);
      assert.equal(executeAsk.mock.calls.length, 1);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });
});

function createPendingAsk(input: {
  consented?: boolean;
  currentSender?: boolean;
  eventId: string;
  itemId: string;
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: input.eventId,
    mailboxLaneSeq: "1",
    nextAttemptAt: null,
    occurredAt: TEST_NOW,
    postCheckpointRecord: null,
    requestId: input.eventId,
    routeAction: "run-assistant-ask",
    status: "pending",
    wake: {
      ask: input.currentSender
        ? {
            expiresAt: "2026-07-15T12:10:00.000Z",
            origin: {
              assistantInputId: `ain_${"b".repeat(32)}`,
              kind: "accepted_input" as const,
              sessionId: "session_current_sender",
            },
            question: "current sender question",
            target: {
              groupRuntimeMemberId: "member_synthetic_group_runtime",
              kind: "group_sender" as const,
              permissionDigest: "e".repeat(64),
            },
          }
        : input.consented
        ? {
            expiresAt: "2026-07-15T12:10:00.000Z",
            origin: {
              assistantInputId: `ain_${"a".repeat(32)}`,
              kind: "accepted_input" as const,
              sessionId: "session_private",
            },
            question: "private question",
            target: {
              grantId: "grant_calendar",
              kind: "consented_member" as const,
              membershipId: "membership_synthetic_ask",
              permissionDigest: "d".repeat(64),
            },
          }
        : {
            expiresAt: "2026-07-15T12:10:00.000Z",
            originAssistantInputId: `ain_${"a".repeat(32)}`,
            originSessionId: "session_private",
            question: "private question",
            target: {
              kind: "joined_group" as const,
              membershipId: "membership_synthetic_ask",
              requestedLabel: "100 Club",
            },
          },
      eventId: input.eventId,
      kind: "assistant.ask.requested",
      occurredAt: TEST_NOW,
      userId: TEST_USER_ID,
    },
  };
}

function createPendingCompletion(input: {
  eventId: string;
  itemId: string;
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: input.eventId,
    mailboxLaneSeq: "2",
    nextAttemptAt: null,
    occurredAt: "2026-07-15T12:05:00.000Z",
    postCheckpointRecord: null,
    requestId: input.eventId,
    routeAction: "continue-assistant-ask",
    status: "pending",
    wake: buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: "2026-07-15T12:10:00.000Z",
        originAssistantInputId: `ain_${"a".repeat(32)}`,
        originSessionId: "session_private",
        question: "private question",
        requestId: "ask_event_requested",
        result: {
          answer: "group answer",
          outcome: "answered",
        },
        targetLabel: "100 Club",
      },
      eventId: input.eventId,
      memberId: TEST_USER_ID,
      occurredAt: "2026-07-15T12:05:00.000Z",
    }),
  };
}

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-detached-ask-"));
  await initializeVault({ createdAt: TEST_NOW, vaultRoot });
  return vaultRoot;
}

async function writePending(
  vaultRoot: string,
  pending: HostedSystemMailboxPendingItem[],
): Promise<void> {
  await updateHostedSystemMailboxState(vaultRoot, () => ({ pending }));
}

async function removeVaultRoot(vaultRoot: string): Promise<void> {
  await rm(vaultRoot, { force: true, recursive: true });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function waitUntil(
  assertion: () => Promise<void> | void,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}

function createTestUsageDraft(input: {
  inputTokens: number;
  occurredAt?: string;
  outputTokens: number;
  providerRequestOrdinal: number;
}): AssistantProviderUsageDraft {
  return {
    occurredAt: input.occurredAt ?? TEST_NOW,
    provider: "codex-cli",
    providerRequestOrdinal: input.providerRequestOrdinal,
    providerRequestOutcome: "succeeded",
    usage: {
      apiKeyEnv: null,
      baseUrl: null,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      providerMetadataJson: null,
      providerName: "hosted-openai",
      providerRequestId: null,
      rawUsageJson: {
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        total_tokens: input.inputTokens + input.outputTokens,
      },
      reasoningTokens: null,
      requestedModel: "gpt-5.5",
      servedModel: "gpt-5.5",
      tokenPricingBasis: "standard",
      totalTokens: input.inputTokens + input.outputTokens,
      turnProfileJson: null,
      usageExtractionSourcePath: "test.usage",
      usageExtractionVersion: "test-v1",
    },
  };
}
