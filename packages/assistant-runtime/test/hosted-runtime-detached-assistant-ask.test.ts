import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import { buildHostedExecutionAssistantAskCompletedWake } from "@murphai/hosted-execution";
import { describe, test, vi } from "vitest";

vi.mock("@murphai/assistant-engine", () => ({
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
}));
vi.mock("@murphai/assistant-engine/assistant-ask", () => ({
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
    const executeAsk = vi.fn(async (input: { question: string }) => {
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
        beforeExecuteAsk: async () => undefined,
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

  test("redacts a detached ask failure before durable requeue", async () => {
    const vaultRoot = await createVaultRoot();

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_failure", itemId: "item_failure" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            assert.equal(request.action, "prepare");
            return {
              action: "prepare",
              question: "question whose execution will fail",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        beforeExecuteAsk: async () => undefined,
        codexHome: null,
        env: {},
        async executeAsk() {
          throw new Error(
            "assistant ask failed for "
              + "https://r2.example.test/private?X-Amz-Signature=fixture-secret "
              + "with TOKEN=fixture-token and member_123",
            {
              cause: new TypeError(
                "local scratch /tmp/hosted-runtime/assistant-ask.json",
              ),
            },
          );
        },
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      const safeErrorMessage =
        "assistant ask failed for <redacted-url> with TOKEN=<redacted>"
        + " and <redacted-user-id> | local scratch <redacted-path>";
      await waitUntil(async () => {
        const failed = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
        assert.equal(failed?.status, "pending");
        assert.equal(failed?.lastErrorMessage, safeErrorMessage);
        assert.equal(failed?.nextAttemptAt, "2026-07-15T12:01:00.000Z");
        assert.doesNotMatch(
          failed?.lastErrorMessage ?? "",
          /fixture-secret|fixture-token|member_123|\/tmp\//u,
        );
      });
      await controller.closeAndRequeue();
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("requeues the exact ask without starting Codex when its pre-execution gate fails", async () => {
    const vaultRoot = await createVaultRoot();
    const executeAsk = vi.fn();
    const beforeExecuteAsk = vi.fn(async () => {
      throw new Error("share authority unavailable");
    });

    try {
      await writePending(vaultRoot, [
        createPendingAsk({ eventId: "ask_event_authority", itemId: "item_authority" }),
      ]);
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            assert.equal(request.action, "prepare");
            return {
              action: "prepare",
              question: "question blocked by authority",
              status: "ready",
              targetLabel: "100 Club",
            };
          },
        },
        beforeExecuteAsk,
        codexHome: null,
        env: {},
        executeAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });

      controller.kick();
      await waitUntil(async () => {
        const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
        assert.equal(pending[0]?.itemId, "item_authority");
        assert.equal(pending[0]?.status, "pending");
        assert.equal(pending[0]?.nextAttemptAt, "2026-07-15T12:01:00.000Z");
      });
      await controller.closeAndRequeue();
      assert.equal(beforeExecuteAsk.mock.calls.length, 1);
      assert.equal(executeAsk.mock.calls.length, 0);
    } finally {
      await removeVaultRoot(vaultRoot);
    }
  });

  test("suppresses a sending wake and aborts, awaits, then requeues the exact ask", async () => {
    const vaultRoot = await createVaultRoot();
    const askStarted = createDeferred<void>();
    const childExited = createDeferred<void>();
    const events: string[] = [];
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
        beforeExecuteAsk: async () => undefined,
        codexHome: null,
        env: {},
        async executeAsk(input) {
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
        },
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
        beforeExecuteAsk: async () => undefined,
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
        beforeExecuteAsk: async () => undefined,
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
});

function createPendingAsk(input: {
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
    preferenceCausalSeq: null,
    requestId: input.eventId,
    routeAction: "run-assistant-ask",
    status: "pending",
    wake: {
      ask: {
        expiresAt: "2026-07-15T12:10:00.000Z",
        originAssistantInputId: `ain_${"a".repeat(32)}`,
        originSessionId: "session_private",
        question: "private question",
        target: {
          kind: "joined_group",
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
    preferenceCausalSeq: null,
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
