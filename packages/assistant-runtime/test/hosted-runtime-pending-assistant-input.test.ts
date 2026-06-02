import assert from "node:assert/strict";

import { beforeEach, describe, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assistantInputSource: {
    listInputCandidates: vi.fn(),
    listNewConversationInputs: vi.fn(),
    refresh: vi.fn(),
  },
  createStoreBackedAssistantInputSource: vi.fn(),
  hasPendingAssistantAutoReplyInput: vi.fn(),
  readAssistantAutomationState: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", () => ({
  createStoreBackedAssistantInputSource: mocks.createStoreBackedAssistantInputSource,
}));

vi.mock("@murphai/assistant-engine/assistant-automation", () => ({
  hasPendingAssistantAutoReplyInput: mocks.hasPendingAssistantAutoReplyInput,
}));

vi.mock("@murphai/assistant-engine/assistant-store", () => ({
  readAssistantAutomationState: mocks.readAssistantAutomationState,
}));

import {
  resolveHostedPendingAssistantInputWakeAt,
} from "../src/hosted-runtime/pending-assistant-input.ts";

describe("resolveHostedPendingAssistantInputWakeAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createStoreBackedAssistantInputSource.mockReturnValue(mocks.assistantInputSource);
    mocks.readAssistantAutomationState.mockResolvedValue({
      autoReply: [{
        channel: "linq",
        eligibleAfter: {
          createdAt: "2026-06-02T12:00:00.000Z",
          inputId: "ain_00000000000000000000000000000001",
          occurredAt: "2026-06-02T12:00:00.000Z",
          sourceKind: "hosted-conversation",
          sourcePosition: "hosted-mailbox:conversation:00000000000000000001",
        },
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });
  });

  test("returns an immediate wake when scanner-backed pending detection sees input", async () => {
    mocks.hasPendingAssistantAutoReplyInput.mockResolvedValueOnce(true);

    assert.equal(
      await resolveHostedPendingAssistantInputWakeAt({
        now: () => "2026-06-02T12:02:00.000Z",
        vaultRoot: "/tmp/murph-synthetic-vault",
      }),
      "2026-06-02T12:02:00.000Z",
    );

    assert.equal(mocks.readAssistantAutomationState.mock.calls[0]?.[0], "/tmp/murph-synthetic-vault");
    assert.deepEqual(mocks.createStoreBackedAssistantInputSource.mock.calls[0]?.[0], {
      vault: "/tmp/murph-synthetic-vault",
    });
    assert.deepEqual(
      mocks.hasPendingAssistantAutoReplyInput.mock.calls[0]?.[0],
      {
        inputSource: mocks.assistantInputSource,
        signal: undefined,
        state: {
          autoReply: [{
            channel: "linq",
            eligibleAfter: {
              createdAt: "2026-06-02T12:00:00.000Z",
              inputId: "ain_00000000000000000000000000000001",
              occurredAt: "2026-06-02T12:00:00.000Z",
              sourceKind: "hosted-conversation",
              sourcePosition: "hosted-mailbox:conversation:00000000000000000001",
            },
            enabledAt: "2026-06-02T12:00:00.000Z",
          }],
          updatedAt: "2026-06-02T12:00:00.000Z",
          version: 1,
        },
        vault: "/tmp/murph-synthetic-vault",
      },
    );
  });

  test("returns null when scanner-backed pending detection sees no input", async () => {
    mocks.hasPendingAssistantAutoReplyInput.mockResolvedValueOnce(false);

    assert.equal(
      await resolveHostedPendingAssistantInputWakeAt({
        now: () => "2026-06-02T12:02:00.000Z",
        vaultRoot: "/tmp/murph-synthetic-vault",
      }),
      null,
    );
  });
});
