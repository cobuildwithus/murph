import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ConsentedReadOnlyAssistantAskInput,
  ConsentedReadOnlyAssistantAskResult,
  ReadOnlyAssistantAskResult,
} from "@murphai/assistant-engine/assistant-ask";
import { initializeVault } from "@murphai/core";
import {
  HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT,
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
  targetKind: "group_sender" | "group_sender_private" = "group_sender",
): HostedSystemMailboxPendingItem {
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
      ask: {
        expiresAt: "2026-07-27T20:10:00.000Z",
        origin: {
          assistantInputId: GROUP_INPUT_ID,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        question: "Murph, tell the group about my sleep.",
        target: {
          groupRuntimeMemberId: "member_group_runtime",
          kind: targetKind,
          permissionDigest: "d".repeat(64),
        },
      },
      eventId: "ask_current_sender_request",
      kind: "assistant.ask.requested",
      occurredAt: TEST_NOW,
      userId: TEST_USER_ID,
    },
  };
}

describe("hosted current-sender Assistant Ask execution", () => {
  test("uses the existing fresh reviewer to select the group audience and forwards it on completion", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-current-sender-assistant-ask-"),
    );
    let completedRequest: unknown;
    const executeAsk = vi.fn();
    const executeConsentedAsk = vi.fn(async (
      input: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ConsentedReadOnlyAssistantAskResult> => ({
      answer: `Reviewed: ${input.question}`,
      outcome: "answered",
      responseDestination: "group",
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
                    HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT,
                },
                question: "Murph, tell the group about my sleep.",
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
        executeAsk,
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

      assert.equal(executeAsk.mock.calls.length, 0);
      assert.equal(executeConsentedAsk.mock.calls.length, 1);
      const reviewedInput = executeConsentedAsk.mock.calls[0]?.[0];
      assert.ok(reviewedInput);
      assert.equal(reviewedInput.answerMode, "reviewer_selected_audience");
      assert.equal(
        reviewedInput.permissionText,
        HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT,
      );
      assert.deepEqual(completedRequest, {
        action: "complete",
        requestId: "ask_current_sender_request",
        responseDestination: "group",
        result: {
          answer: "Reviewed: Murph, tell the group about my sleep.",
          outcome: "answered",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("persists the reviewer-selected private audience even when disclosure is denied", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-current-sender-denied-assistant-ask-"),
    );
    let completedRequest: unknown;
    const executeConsentedAsk = vi.fn(async (
      _input: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ConsentedReadOnlyAssistantAskResult> => ({
        outcome: "cannot_answer",
        responseDestination: "current_sender",
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
                    HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT,
                },
                question: "Murph, message me privately about my sleep.",
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

      assert.equal(
        executeConsentedAsk.mock.calls[0]?.[0].answerMode,
        "reviewer_selected_audience",
      );
      assert.deepEqual(completedRequest, {
        action: "complete",
        requestId: "ask_current_sender_request",
        responseDestination: "current_sender",
        result: { answer: null, outcome: "cannot_answer" },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("keeps fixed legacy group work on caller handoff while it drains", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-legacy-group-current-sender-assistant-ask-"),
    );
    let completedRequest: unknown;
    const executeConsentedAsk = vi.fn(async (
      input: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ReadOnlyAssistantAskResult> => ({
      answer: `Legacy reviewed: ${input.question}`,
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
                  permissionText: "Legacy fixed group disclosure.",
                },
                question: "Murph, tell the group about my sleep.",
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

      assert.equal(executeConsentedAsk.mock.calls[0]?.[0].answerMode, "caller_handoff");
      assert.deepEqual(completedRequest, {
        action: "complete",
        requestId: "ask_current_sender_request",
        result: {
          answer: "Legacy reviewed: Murph, tell the group about my sleep.",
          outcome: "answered",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("keeps fixed legacy private work on direct-recipient review", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-private-current-sender-assistant-ask-"),
    );
    let completedRequest: unknown;
    const executeAsk = vi.fn();
    const executeConsentedAsk = vi.fn(async (
      input: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ReadOnlyAssistantAskResult> => ({
      answer: `Privately reviewed: ${input.question}`,
      outcome: "answered",
    }));

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [createPendingCurrentSenderAsk("group_sender_private")],
      }));

      const controller = createHostedDetachedAssistantAskController({
        assistantAskPort: {
          async request(request) {
            if (request.action === "prepare") {
              return {
                action: "prepare",
                disclosure: {
                  permissionText: "One-time private owner-only answer.",
                },
                question: "Murph, message me privately about my sleep.",
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
        executeAsk,
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

      assert.equal(executeAsk.mock.calls.length, 0);
      assert.equal(executeConsentedAsk.mock.calls.length, 1);
      assert.equal(
        executeConsentedAsk.mock.calls[0]?.[0].answerMode,
        "direct_recipient",
      );
      assert.deepEqual(completedRequest, {
        action: "complete",
        requestId: "ask_current_sender_request",
        result: {
          answer: "Privately reviewed: Murph, message me privately about my sleep.",
          outcome: "answered",
        },
      });
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
