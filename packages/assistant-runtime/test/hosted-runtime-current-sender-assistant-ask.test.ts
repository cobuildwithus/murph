import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ConsentedReadOnlyAssistantAskInput,
  ReadOnlyAssistantAskResult,
} from "@murphai/assistant-engine/assistant-ask";
import { initializeVault } from "@murphai/core";
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

function createPendingCurrentSenderAsk(): HostedSystemMailboxPendingItem {
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
        question: "Murph tell them about my sleep",
        target: {
          groupRuntimeMemberId: "member_group_runtime",
          kind: "group_sender",
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
  test("uses the reviewed personal-vault executor before exact group completion", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-current-sender-assistant-ask-"),
    );
    let completedResult: unknown;
    const executeAsk = vi.fn();
    const executeConsentedAsk = vi.fn(async (
      input: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ReadOnlyAssistantAskResult> => ({
      answer: `Reviewed: ${input.question}`,
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
                  permissionText: "One-time self-only group disclosure.",
                },
                question: "Murph tell them about my sleep",
                status: "ready",
                targetLabel: null,
              };
            }
            completedResult = request.result;
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
      assert.equal(reviewedInput.answerMode, "caller_handoff");
      assert.equal(reviewedInput.permissionText, "One-time self-only group disclosure.");
      assert.equal(reviewedInput.question, "Murph tell them about my sleep");
      assert.deepEqual(completedResult, {
        answer: "Reviewed: Murph tell them about my sleep",
        outcome: "answered",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
  test("uses the same reviewed personal-vault executor for private delivery", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-private-current-sender-assistant-ask-"),
    );
    let completedResult: unknown;
    const executeAsk = vi.fn();
    const executeConsentedAsk = vi.fn(async (
      input: ConsentedReadOnlyAssistantAskInput,
    ): Promise<ReadOnlyAssistantAskResult> => ({
      answer: `Privately reviewed: ${input.question}`,
      outcome: "answered",
    }));

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const pending = createPendingCurrentSenderAsk();
      if (pending.wake.kind !== "assistant.ask.requested") {
        throw new Error("Expected an Assistant Ask request wake.");
      }
      pending.wake.ask.target = {
        groupRuntimeMemberId: "member_group_runtime",
        kind: "group_sender_private",
        permissionDigest: "e".repeat(64),
      };
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [pending],
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
                question: "Murph tell them about my sleep",
                status: "ready",
                targetLabel: null,
              };
            }
            completedResult = request.result;
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
      assert.equal(
        executeConsentedAsk.mock.calls[0]?.[0].permissionText,
        "One-time private owner-only answer.",
      );
      assert.deepEqual(completedResult, {
        answer: "Privately reviewed: Murph tell them about my sleep",
        outcome: "answered",
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
