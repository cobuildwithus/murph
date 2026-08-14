import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ConsentedReadOnlyAssistantAskInput,
  ReadOnlyAssistantAskResult,
} from "@murphai/assistant-engine/assistant-ask";
import { initializeVault } from "@murphai/core";
import {
  HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
  HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
  type HostedExecutionAssistantAskRequestedPayload,
} from "@murphai/hosted-execution/contracts";
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
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";

const TEST_NOW = "2026-07-27T20:00:00.000Z";
const TEST_USER_ID = "member_personal_runtime";
const GROUP_INPUT_ID = `ain_${"a".repeat(32)}`;

function createPendingCurrentSenderAsk(
  targetKind:
    | "current_sender_personal"
    | "group_sender"
    | "group_sender_private" = "current_sender_personal",
  resultDestination: "origin_context" | "requester_direct" = "origin_context",
): HostedSystemMailboxPendingItem {
  const commonAsk = {
    expiresAt: "2026-07-27T20:10:00.000Z",
    origin: {
      assistantInputId: GROUP_INPUT_ID,
      kind: "accepted_input" as const,
      sessionId: "session_group",
    },
    question: "Murph, ask my Murph about my synthetic activity.",
  };
  const ask: HostedExecutionAssistantAskRequestedPayload =
    targetKind === "current_sender_personal"
      ? {
          ...commonAsk,
          resultDestination: resultDestination === "requester_direct"
            ? { channel: "linq", kind: "requester_direct" }
            : { kind: "origin_context" },
          target: {
            groupRuntimeMemberId: "member_group_runtime",
            kind: "current_sender_personal",
            permissionDigest: "d".repeat(64),
          },
        }
      : {
          ...commonAsk,
          target: {
            groupRuntimeMemberId: "member_group_runtime",
            kind: targetKind,
            permissionDigest: "d".repeat(64),
          },
        };
  return {
    attemptCount: 0,
    itemId: "item_current_sender",
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: "ask_current_sender_request",
    mailboxLaneSeq: "1",
    nextAttemptAt: null,
    occurredAt: TEST_NOW,
    postCheckpointRecord: null,
    requestId: "ask_current_sender_request",
    routeAction: "run-assistant-ask",
    status: "pending",
    wake: {
      ask,
      eventId: "ask_current_sender_request",
      kind: "assistant.ask.requested",
      occurredAt: TEST_NOW,
      userId: TEST_USER_ID,
    },
  };
}

async function runFixedAudienceAsk(input: {
  permissionText: string;
  resultDestination?: "origin_context" | "requester_direct";
  targetKind:
    | "current_sender_personal"
    | "group_sender"
    | "group_sender_private";
}) {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-fixed-current-sender-assistant-ask-"),
  );
  let completedRequest: unknown;
  const executeConsentedAsk = vi.fn(async (
    askInput: ConsentedReadOnlyAssistantAskInput,
  ): Promise<ReadOnlyAssistantAskResult> => ({
    answer: `Reviewed: ${askInput.question}`,
    outcome: "answered",
  }));

  await initializeVault({ createdAt: TEST_NOW, vaultRoot });
  await updateHostedSystemMailboxState(vaultRoot, () => ({
    pending: [createPendingCurrentSenderAsk(
      input.targetKind,
      input.resultDestination,
    )],
  }));
  const controller = createHostedDetachedAssistantAskController({
    assistantAskPort: {
      async request(request) {
        if (request.action === "prepare") {
          return {
            action: "prepare",
            disclosure: { permissionText: input.permissionText },
            question: "Murph, ask my Murph about my synthetic activity.",
            status: "ready",
            targetLabel: null,
          };
        }
        completedRequest = request;
        return { action: "complete", status: "completed" };
      },
    },
    codexHome: null,
    env: {},
    executeAsk: vi.fn(),
    executeConsentedAsk,
    now: () => TEST_NOW,
    onStateMutation() {},
    vaultRoot,
  });

  controller.kick();
  await waitUntil(async () => {
    assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
  });
  await controller.closeAndRequeue();
  return { completedRequest, controller, executeConsentedAsk, vaultRoot };
}

describe("hosted current-sender Assistant Ask execution", () => {
  test("uses the canonical result destination independently of target identity", async () => {
    const group = await runFixedAudienceAsk({
      permissionText: HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
      resultDestination: "origin_context",
      targetKind: "current_sender_personal",
    });
    try {
      assert.equal(
        group.executeConsentedAsk.mock.calls[0]?.[0].answerMode,
        "caller_handoff",
      );
    } finally {
      await rm(group.vaultRoot, { force: true, recursive: true });
    }

    const direct = await runFixedAudienceAsk({
      permissionText: HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
      resultDestination: "requester_direct",
      targetKind: "current_sender_personal",
    });
    try {
      assert.equal(
        direct.executeConsentedAsk.mock.calls[0]?.[0].answerMode,
        "direct_recipient",
      );
    } finally {
      await rm(direct.vaultRoot, { force: true, recursive: true });
    }
  });

  test("uses caller handoff for a Web-fixed group audience despite a legacy private target", async () => {
    const run = await runFixedAudienceAsk({
      permissionText: HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
      targetKind: "group_sender_private",
    });
    try {
      assert.equal(
        run.executeConsentedAsk.mock.calls[0]?.[0].answerMode,
        "caller_handoff",
      );
      assert.deepEqual(run.completedRequest, {
        action: "complete",
        requestId: "ask_current_sender_request",
        result: {
          answer: "Reviewed: Murph, ask my Murph about my synthetic activity.",
          outcome: "answered",
        },
      });
    } finally {
      await rm(run.vaultRoot, { force: true, recursive: true });
    }
  });

  test("uses direct recipient for a Web-fixed private audience despite a legacy group target", async () => {
    const run = await runFixedAudienceAsk({
      permissionText: HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
      targetKind: "group_sender",
    });
    try {
      assert.equal(
        run.executeConsentedAsk.mock.calls[0]?.[0].answerMode,
        "direct_recipient",
      );
      assert.deepEqual(run.completedRequest, {
        action: "complete",
        requestId: "ask_current_sender_request",
        result: {
          answer: "Reviewed: Murph, ask my Murph about my synthetic activity.",
          outcome: "answered",
        },
      });
    } finally {
      await rm(run.vaultRoot, { force: true, recursive: true });
    }
  });

  test("settles an already-persisted completion without another model turn", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-current-sender-replay-"),
    );
    const executeConsentedAsk = vi.fn();
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [createPendingCurrentSenderAsk()],
      }));
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request() {
            return { action: "prepare", status: "already_completed" };
          },
        },
        codexHome: null,
        env: {},
        executeAsk: vi.fn(),
        executeConsentedAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });
      controller.kick();
      await waitUntil(async () => {
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 0);
      });
      await controller.closeAndRequeue();
      assert.equal(executeConsentedAsk.mock.calls.length, 0);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("does not consume current-sender work when Web returns terminal without a completion", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-current-sender-terminal-requeue-"),
    );
    const executeConsentedAsk = vi.fn();
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [createPendingCurrentSenderAsk()],
      }));
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request() {
            return {
              action: "prepare",
              status: "terminal",
              terminalReason: "unavailable",
            };
          },
        },
        codexHome: null,
        env: {},
        executeAsk: vi.fn(),
        executeConsentedAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });
      controller.kick();
      await waitUntil(async () => {
        const [pending] = (await readHostedSystemMailboxState(vaultRoot)).pending;
        assert.equal(pending?.attemptCount, 1);
        assert.equal(pending?.status, "pending");
      });
      await controller.closeAndRequeue();
      assert.equal(executeConsentedAsk.mock.calls.length, 0);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("does not consume current-sender work when completion is terminal without persistence", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-current-sender-completion-requeue-"),
    );
    const executeConsentedAsk = vi.fn(async (
      askInput: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ReadOnlyAssistantAskResult> => ({
      answer: `Reviewed: ${askInput.question}`,
      outcome: "answered",
    }));
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [createPendingCurrentSenderAsk()],
      }));
      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "prepare") {
              return {
                action: "prepare",
                disclosure: {
                  permissionText:
                    HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
                },
                question: "Murph, ask my Murph about my synthetic activity.",
                status: "ready",
                targetLabel: null,
              };
            }
            return {
              action: "complete",
              status: "terminal",
              terminalReason: "unavailable",
            };
          },
        },
        codexHome: null,
        env: {},
        executeAsk: vi.fn(),
        executeConsentedAsk,
        now: () => TEST_NOW,
        onStateMutation() {},
        vaultRoot,
      });
      controller.kick();
      await waitUntil(async () => {
        const [pending] = (await readHostedSystemMailboxState(vaultRoot)).pending;
        assert.equal(pending?.attemptCount, 1);
        assert.equal(pending?.status, "pending");
      });
      await controller.closeAndRequeue();
      assert.equal(executeConsentedAsk.mock.calls.length, 1);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});

async function waitUntil(assertion: () => void | Promise<void>): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
