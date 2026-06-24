import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  initializeVault,
} from "@murphai/core";
import {
  persistCanonicalInboxCapture,
} from "@murphai/inboxd";
import {
  updateAssistantInputProjection,
} from "@murphai/assistant-engine";
import {
  updateAssistantInputAttachmentEvidence,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine/assistant-automation";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, test, vi } from "vitest";

const idleMaintenanceMock = vi.hoisted(() => vi.fn());
vi.mock("../src/hosted-runtime/idle-maintenance.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/hosted-runtime/idle-maintenance.ts")
  >();
  return {
    ...actual,
    runHostedIdleCheckpointMaintenance: idleMaintenanceMock,
  };
});

import {
  runHostedPendingInputProtectedIdleMaintenance,
} from "../src/hosted-runtime.ts";
import {
  enqueueHostedPendingAssistantInputId,
} from "../src/hosted-runtime/pending-input-index.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const CAPTURE_RECORDED_AT = "2026-04-01T00:00:00.000Z";
const TEST_USER_ID = "member_retention_protected";

beforeEach(() => {
  idleMaintenanceMock.mockReset();
  idleMaintenanceMock.mockResolvedValue({
    kind: "skipped",
    reason: "pending_work",
    threadContextTokensBefore: null,
  });
});

describe("runHostedPendingInputProtectedIdleMaintenance", () => {
  // Regression for PR 240 round 31: the retention-only checkpoint shared the
  // same idle-retention call as the normal idle path but skipped the pending
  // assistant-input protection collection, so unresolved auto-reply media older
  // than 14 days could be tombstoned. The helper now owns both wirings; this
  // test pins the structural invariant by asserting the collected
  // pending-input protections (captureId/attachmentId/storedPath) reach the
  // underlying idle maintenance call.
  test("forwards collected pending-input protections to runHostedIdleCheckpointMaintenance", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-retention-helper-"));
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await persistCanonicalInboxCapture({
        captureId: "cap_helper_audio",
        eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41V9",
        input: {
          accountId: "self",
          actor: {
            isSelf: false,
          },
          attachments: [
            {
              data: Buffer.from("helper-audio"),
              fileName: "voice.m4a",
              kind: "audio",
              mime: "audio/mp4",
            },
          ],
          externalId: "msg-helper-audio",
          occurredAt: CAPTURE_RECORDED_AT,
          raw: {},
          receivedAt: CAPTURE_RECORDED_AT,
          source: "telegram",
          text: "helper audio",
          thread: {
            id: "thread-helper-audio",
            isDirect: true,
          },
        },
        storedAt: CAPTURE_RECORDED_AT,
        vaultRoot,
      });
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "telegram",
          eligibleAfter: null,
          enabledAt: CAPTURE_RECORDED_AT,
        }],
        updatedAt: CAPTURE_RECORDED_AT,
        version: 1,
      });
      const pendingInput = await upsertAssistantInputEvent({
        event: {
          content: {
            text: "pending helper input",
            transcriptText: "pending helper input",
            userMessageContent: [{
              text: "pending helper input",
              type: "text" as const,
            }],
          },
          conversation: {
            accountId: "acct_helper",
            actorId: "actor_helper",
            actorIsSelf: false,
            source: "telegram",
            threadId: "thread-helper-audio",
            threadIsDirect: true,
          },
          occurredAt: CAPTURE_RECORDED_AT,
          receivedAt: CAPTURE_RECORDED_AT,
          replyTarget: {
            channel: "telegram",
            messageId: "msg-helper-audio",
            threadId: "thread-helper-audio",
          },
          sourceRef: {
            dedupeKey: "dedupe_helper_audio",
            eventId: "evt_helper_audio",
            itemId: "item_helper_audio",
            kind: "hosted-mailbox" as const,
            lane: "conversation" as const,
            laneSeq: "10",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            payloadSource: "inline" as const,
            source: "hosted-mailbox" as const,
            wakeSchema: "murph.hosted-execution-wake.v1",
          },
        },
        vault: vaultRoot,
      });
      await updateAssistantInputProjection({
        inputId: pendingInput.inputId,
        projection: {
          captureId: "cap_helper_audio",
          status: "succeeded",
        },
        vault: vaultRoot,
      });
      await updateAssistantInputAttachmentEvidence({
        attachmentEvidence: {
          attachments: [],
          optionalInboxCaptureId: "cap_helper_audio",
          reasonCode: "inbox_projection_unavailable",
          source: "hosted-inbox-projection",
          status: "failed",
          updatedAt: CAPTURE_RECORDED_AT,
        },
        inputId: pendingInput.inputId,
        vault: vaultRoot,
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: pendingInput.inputId,
        vaultRoot,
      });

      const outcome = await runHostedPendingInputProtectedIdleMaintenance({
        credentialSource: "platform",
        materializeWorkspaceArtifacts: async () => ({
          materializedArtifactPaths: new Set<string>(),
          missingArtifactPaths: new Set<string>(),
        }),
        memberId: TEST_USER_ID,
        model: null,
        pendingWork: false,
        providerName: null,
        recordUsage: null,
        resolveAssistantSessionId: null,
        shutdownSignal: null,
        vaultRoot,
        wakeSignal: null,
      });

      expect(outcome).toEqual({
        kind: "skipped",
        reason: "pending_work",
        threadContextTokensBefore: null,
      });
      expect(idleMaintenanceMock).toHaveBeenCalledTimes(1);
      const callArg = idleMaintenanceMock.mock.calls[0]?.[0] as {
        protectedAttachmentIds?: readonly string[];
        protectedCaptureIds?: readonly string[];
        protectedStoredPaths?: readonly string[];
      };
      assert.deepEqual(callArg.protectedAttachmentIds ?? [], []);
      assert.deepEqual(callArg.protectedCaptureIds ?? [], ["cap_helper_audio"]);
      assert.deepEqual(callArg.protectedStoredPaths ?? [], []);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});
