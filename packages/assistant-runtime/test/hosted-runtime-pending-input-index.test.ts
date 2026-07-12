import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAssistantInputEventId,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  hasCompleteAssistantAutoReplyTerminalEvidence,
  updateAssistantInputAttachmentEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  resolveAssistantStatePaths,
  writeAssistantStateVersionedJson,
} from "@murphai/runtime-state/node/assistant-state-fs";

import {
  HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA,
  HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION,
  compactHostedPendingAssistantInputIds,
  collectHostedPendingAssistantInputMediaRetentionProtections,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  readHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "../src/hosted-runtime/pending-assistant-input.ts";
import {
  selectHostedAssistantInputIds,
} from "../src/hosted-runtime/turn-input.ts";

const tempRoots: string[] = [];
const TERMINAL_EVIDENCE_SCHEMA =
  "murph.assistant-auto-reply-terminal-evidence.v1";

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("hosted pending assistant input index", () => {
  it("treats a missing file as an empty greenfield index", async () => {
    const vaultRoot = await createTempVault();

    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
  });

  it("fails closed when the pending index is malformed", async () => {
    const vaultRoot = await createTempVault();
    const filePath = resolveHostedPendingAssistantInputStatePath(vaultRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not-json", "utf8");

    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).rejects.toThrow();
  });

  it("enqueues input ids idempotently without duplicates", async () => {
    const vaultRoot = await createTempVault();
    const inputId = "ain_00000000000000000000000000000001";

    await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });

    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      inputId,
    ]);
  });

  it("retains deferred Linq context without scheduling work and selects it with the next message", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-07-10T00:00:00.000Z",
      }],
      updatedAt: "2026-07-10T00:00:00.000Z",
      version: 1,
    });
    const context = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        contextOnly: true,
        dedupeKey: "dedupe_reaction_context",
        eventId: "evt_reaction_context",
        itemId: "item_reaction_context",
        laneSeq: "10",
        messageId: "msg_reaction_context",
        occurredAt: "2026-07-10T00:00:01.000Z",
        receivedAt: "2026-07-10T00:00:02.000Z",
        replyTarget: null,
        text: "weak reaction context",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: context.inputId,
      vaultRoot,
    });

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-07-10T00:00:03.000Z",
      vaultRoot,
    })).resolves.toBeNull();
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      context.inputId,
    ]);

    const message = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_next_message",
        eventId: "evt_next_message",
        itemId: "item_next_message",
        laneSeq: "20",
        messageId: "msg_next_message",
        occurredAt: "2026-07-10T00:00:04.000Z",
        receivedAt: "2026-07-10T00:00:05.000Z",
        text: "the next natural message",
        threadIsDirect: false,
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: message.inputId,
      vaultRoot,
    });

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-07-10T00:00:06.000Z",
      vaultRoot,
    })).resolves.toBe("2026-07-10T00:00:06.000Z");
    await expect(selectHostedAssistantInputIds({
      freshAssistantInputIds: [message.inputId],
      mode: "foreground",
      vaultRoot,
    })).resolves.toEqual({
      freshInputIds: [message.inputId],
      inputIds: [context.inputId, message.inputId],
      mode: "foreground",
      pendingInputIds: [context.inputId, message.inputId],
    });
  });

  it("bounds deferred reaction context per group and terminally suppresses overflow", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-07-10T00:00:00.000Z",
      }],
      updatedAt: "2026-07-10T00:00:00.000Z",
      version: 1,
    });
    const contexts = [];
    for (let index = 0; index < 35; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const context = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          contextOnly: true,
          dedupeKey: `dedupe_bounded_reaction_${suffix}`,
          eventId: `evt_bounded_reaction_${suffix}`,
          itemId: `item_bounded_reaction_${suffix}`,
          laneSeq: String(index + 1),
          messageId: `msg_bounded_reaction_${suffix}`,
          occurredAt: `2026-07-10T00:00:${suffix}.000Z`,
          receivedAt: `2026-07-10T00:01:${suffix}.000Z`,
          replyTarget: null,
          text: `weak reaction context ${suffix}`,
        }),
      });
      contexts.push(context);
      await enqueueHostedPendingAssistantInputId({
        inputId: context.inputId,
        vaultRoot,
      });
    }

    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual(
      contexts.slice(-32).map((context) => context.inputId),
    );
    for (const context of contexts.slice(0, 3)) {
      await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
        captureId: null,
        inputId: context.inputId,
        vault: vaultRoot,
      })).resolves.toBe(true);
    }
  });

  it("uses provider occurrence order when overflow spans a reordered add and removal", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-07-10T00:00:00.000Z",
      }],
      updatedAt: "2026-07-10T00:00:00.000Z",
      version: 1,
    });
    const removal = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        contextOnly: true,
        dedupeKey: "dedupe_reordered_removal",
        eventId: "evt_reordered_removal",
        itemId: "item_reordered_removal",
        laneSeq: "1",
        messageId: "msg_reordered_removal",
        occurredAt: "2026-07-10T00:00:02.000Z",
        receivedAt: "2026-07-10T00:01:01.000Z",
        replyTarget: null,
        text: "reaction removal delivered first",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: removal.inputId,
      vaultRoot,
    });
    for (let index = 0; index < 31; index += 1) {
      const second = String(index + 3).padStart(2, "0");
      const filler = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          contextOnly: true,
          dedupeKey: `dedupe_reordered_filler_${second}`,
          eventId: `evt_reordered_filler_${second}`,
          itemId: `item_reordered_filler_${second}`,
          laneSeq: String(index + 2),
          messageId: `msg_reordered_filler_${second}`,
          occurredAt: `2026-07-10T00:00:${second}.000Z`,
          receivedAt: `2026-07-10T00:01:${String(index + 2).padStart(2, "0")}.000Z`,
          replyTarget: null,
          text: `filler reaction ${second}`,
        }),
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: filler.inputId,
        vaultRoot,
      });
    }
    const delayedAdd = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        contextOnly: true,
        dedupeKey: "dedupe_reordered_delayed_add",
        eventId: "evt_reordered_delayed_add",
        itemId: "item_reordered_delayed_add",
        laneSeq: "33",
        messageId: "msg_reordered_delayed_add",
        occurredAt: "2026-07-10T00:00:01.000Z",
        receivedAt: "2026-07-10T00:01:59.000Z",
        replyTarget: null,
        text: "reaction add delivered last",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: delayedAdd.inputId,
      vaultRoot,
    });

    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves
      .not.toContain(delayedAdd.inputId);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves
      .toContain(removal.inputId);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: null,
      inputId: delayedAdd.inputId,
      vault: vaultRoot,
    })).resolves.toBe(true);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: null,
      inputId: removal.inputId,
      vault: vaultRoot,
    })).resolves.toBe(false);
  });

  it("uses mailbox cursor order when equal-time context overflows", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-07-10T00:00:00.000Z",
      }],
      updatedAt: "2026-07-10T00:00:00.000Z",
      version: 1,
    });
    const definitions = Array.from({ length: 33 }, (_, index) => {
      const suffix = String(index).padStart(2, "0");
      const event = createAssistantInputEvent({
        contextOnly: true,
        dedupeKey: `dedupe_equal_time_${suffix}`,
        eventId: `evt_equal_time_${suffix}`,
        itemId: `item_equal_time_${suffix}`,
        laneSeq: "1",
        messageId: `msg_equal_time_${suffix}`,
        occurredAt: "2026-07-10T00:00:01.000Z",
        receivedAt: "2026-07-10T00:00:02.000Z",
        replyTarget: null,
        text: `equal-time reaction ${suffix}`,
      });
      return {
        event,
        inputId: createAssistantInputEventId({ sourceRef: event.sourceRef }),
      };
    }).sort((left, right) => right.inputId.localeCompare(left.inputId));
    const contexts = [];

    for (const [index, definition] of definitions.entries()) {
      const context = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          ...definition.event,
          sourceRef: {
            ...definition.event.sourceRef,
            laneSeq: String(index + 1),
          },
        },
      });
      contexts.push(context);
      await enqueueHostedPendingAssistantInputId({
        inputId: context.inputId,
        vaultRoot,
      });
    }

    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual(
      contexts.slice(1).map((context) => context.inputId),
    );
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: null,
      inputId: contexts[0]!.inputId,
      vault: vaultRoot,
    })).resolves.toBe(true);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: null,
      inputId: contexts.at(-1)!.inputId,
      vault: vaultRoot,
    })).resolves.toBe(false);
  });

  it("compacts deferred reaction context to the global limit across distinct groups", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-07-10T00:00:00.000Z",
      }],
      updatedAt: "2026-07-10T00:00:00.000Z",
      version: 1,
    });
    const contexts: Array<{ inputId: string }> = [];
    const baseTimeMs = Date.parse("2026-07-10T00:00:01.000Z");
    for (let index = 0; index < 257; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const context = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          contextOnly: true,
          dedupeKey: `dedupe_global_reaction_${suffix}`,
          eventId: `evt_global_reaction_${suffix}`,
          itemId: `item_global_reaction_${suffix}`,
          laneSeq: String(index + 1),
          messageId: `msg_global_reaction_${suffix}`,
          occurredAt: new Date(baseTimeMs + (index * 2_000)).toISOString(),
          receivedAt: new Date(baseTimeMs + (index * 2_000) + 1_000).toISOString(),
          replyTarget: null,
          text: `weak reaction context ${suffix}`,
          threadId: `group_${suffix}`,
        }),
      });
      contexts.push(context);
    }
    await writeAssistantStateVersionedJson({
      filePath: resolveHostedPendingAssistantInputStatePath(vaultRoot),
      schema: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA,
      schemaVersion: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION,
      value: {
        backfilled: true,
        inputIds: contexts.map((context) => context.inputId),
      },
    });

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual(
      contexts.slice(-256).map((context) => context.inputId),
    );
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: null,
      inputId: contexts[0]!.inputId,
      vault: vaultRoot,
    })).resolves.toBe(true);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: null,
      inputId: contexts[1]!.inputId,
      vault: vaultRoot,
    })).resolves.toBe(false);
  });

  it("collects raw inbox media protections from active pending inputs", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_pending_media",
        eventId: "evt_pending_media",
        itemId: "item_pending_media",
        laneSeq: "10",
        messageId: "msg_pending_media",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "pending media input",
      }),
    });
    const rawPath = "raw/inbox/linq/self/2026/06/cap_pending_media/attachments/01__photo.webp";

    await updateAssistantInputAttachmentEvidence({
      attachmentEvidence: {
        attachments: [{
          byteSize: 123,
          derived: null,
          descriptorAttachmentId: "descriptor_image_1",
          fileName: "photo.webp",
          inlineFragments: [],
          kind: "image",
          mime: "image/webp",
          ordinal: 1,
          parseState: null,
          raw: {
            byteSize: 123,
            kind: "vault-relative-file",
            mediaType: "image/webp",
            path: rawPath,
            sha256: "a".repeat(64),
          },
          sourceAttachmentId: "att_cap_pending_media_01",
        }],
        optionalInboxCaptureId: "cap_pending_media",
        reasonCode: null,
        source: "hosted-inbox-projection",
        status: "available",
        updatedAt: "2026-04-23T00:00:03.000Z",
      },
      inputId: event.inputId,
      vault: vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    await expect(collectHostedPendingAssistantInputMediaRetentionProtections({
      now: "2026-04-25T00:00:00.000Z",
      vaultRoot,
    })).resolves.toEqual({
      protectedAttachmentIds: ["att_cap_pending_media_01", "descriptor_image_1"],
      protectedCaptureIds: ["cap_pending_media"],
      protectedStoredPaths: [rawPath],
    });
  });

  it("protects a pending capture when attachment evidence failed without attachment rows", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const captureId = "cap_pending_failed_evidence";
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_pending_failed_evidence",
        eventId: "evt_pending_failed_evidence",
        itemId: "item_pending_failed_evidence",
        laneSeq: "10",
        messageId: "msg_pending_failed_evidence",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "pending media input with failed evidence",
      }),
    });

    await updateAssistantInputProjection({
      inputId: event.inputId,
      projection: {
        captureId,
        status: "succeeded",
      },
      vault: vaultRoot,
    });
    await updateAssistantInputAttachmentEvidence({
      attachmentEvidence: {
        attachments: [],
        optionalInboxCaptureId: captureId,
        reasonCode: "inbox_projection_unavailable",
        source: "hosted-inbox-projection",
        status: "failed",
        updatedAt: "2026-04-23T00:00:03.000Z",
      },
      inputId: event.inputId,
      vault: vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    await expect(collectHostedPendingAssistantInputMediaRetentionProtections({
      now: "2026-04-25T00:00:00.000Z",
      vaultRoot,
    })).resolves.toEqual({
      protectedAttachmentIds: [],
      protectedCaptureIds: [captureId],
      protectedStoredPaths: [],
    });
  });

  it("drops protection for a pending input older than the inbox media retention window so a stuck or churned-user input cannot pin media past the 14-day privacy guarantee", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-01T00:00:00.000Z",
      }],
      updatedAt: "2026-04-01T00:00:00.000Z",
      version: 1,
    });
    const captureId = "cap_stuck_pending_media";
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_stuck_pending_media",
        eventId: "evt_stuck_pending_media",
        itemId: "item_stuck_pending_media",
        laneSeq: "10",
        messageId: "msg_stuck_pending_media",
        occurredAt: "2026-04-01T00:00:01.000Z",
        receivedAt: "2026-04-01T00:00:02.000Z",
        text: "stuck pending input that never resolves",
      }),
    });
    await updateAssistantInputProjection({
      inputId: event.inputId,
      projection: {
        captureId,
        status: "succeeded",
      },
      vault: vaultRoot,
    });
    await updateAssistantInputAttachmentEvidence({
      attachmentEvidence: {
        attachments: [],
        optionalInboxCaptureId: captureId,
        reasonCode: "inbox_projection_unavailable",
        source: "hosted-inbox-projection",
        status: "failed",
        updatedAt: "2026-04-01T00:00:03.000Z",
      },
      inputId: event.inputId,
      vault: vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    // now is 35 days after receivedAt — well past the 14-day window.
    await expect(collectHostedPendingAssistantInputMediaRetentionProtections({
      now: "2026-05-06T00:00:00.000Z",
      vaultRoot,
    })).resolves.toEqual({
      protectedAttachmentIds: [],
      protectedCaptureIds: [],
      protectedStoredPaths: [],
    });
  });

  it("enqueues a fresh input without backfilling a missing rollout index", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const oldPending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_old_pending",
        eventId: "evt_old_pending",
        itemId: "item_old_pending",
        laneSeq: "10",
        messageId: "msg_old_pending",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "old pending input",
      }),
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh",
        eventId: "evt_fresh",
        itemId: "item_fresh",
        laneSeq: "40",
        messageId: "msg_fresh",
        occurredAt: "2026-04-23T00:00:07.000Z",
        receivedAt: "2026-04-23T00:00:08.000Z",
        text: "fresh input",
      }),
    });

    await enqueueHostedPendingAssistantInputId({
      inputId: fresh.inputId,
      vaultRoot,
    });

    const indexedInputIds = await readHostedPendingAssistantInputIds({ vaultRoot });
    expect(indexedInputIds).toEqual([fresh.inputId]);
    expect(indexedInputIds).not.toContain(oldPending.inputId);

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-04-23T00:00:09.000Z",
      vaultRoot,
    })).resolves.toBe("2026-04-23T00:00:09.000Z");
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      oldPending.inputId,
      fresh.inputId,
    ]);
  });

  it("backfills an incomplete rollout index when resolving a pending wake", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const oldPending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_old_pending",
        eventId: "evt_old_pending",
        itemId: "item_old_pending",
        laneSeq: "10",
        messageId: "msg_old_pending",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "old pending input",
      }),
    });

    await expect(ensureHostedPendingAssistantInputIndex({ vaultRoot }))
      .resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.not.toContain(oldPending.inputId);

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-04-23T00:00:09.000Z",
      vaultRoot,
    })).resolves.toBe("2026-04-23T00:00:09.000Z");
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      oldPending.inputId,
    ]);
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      oldPending.inputId,
    ]);
  });

  it("backfills a missing rollout index during background compaction", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const oldPending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_old_pending",
        eventId: "evt_old_pending",
        itemId: "item_old_pending",
        laneSeq: "10",
        messageId: "msg_old_pending",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "old pending input",
      }),
    });
    const oldContextOnly = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_context_only",
        eventId: "evt_context_only",
        itemId: "item_context_only",
        laneSeq: "20",
        messageId: "msg_context_only",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        replyTarget: null,
        text: "context only input",
      }),
    });
    const oldComplete = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_complete",
        eventId: "evt_complete",
        itemId: "item_complete",
        laneSeq: "30",
        messageId: "msg_complete",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        text: "already complete input",
      }),
    });
    await writeTerminalEvidence({
      evidenceId: oldComplete.inputId,
      groupInputIds: [oldComplete.inputId],
      vaultRoot,
    });
    const indexedInputIds = await compactHostedPendingAssistantInputIds({ vaultRoot });
    expect(indexedInputIds).toEqual([
      oldPending.inputId,
    ]);
    expect(indexedInputIds).not.toContain(oldContextOnly.inputId);
    expect(indexedInputIds).not.toContain(oldComplete.inputId);
  });

  it("compacts only after terminal group evidence is complete", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_first",
        eventId: "evt_first",
        itemId: "item_first",
        laneSeq: "10",
        messageId: "msg_first",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "first group input",
      }),
    });
    const second = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_second",
        eventId: "evt_second",
        itemId: "item_second",
        laneSeq: "20",
        messageId: "msg_second",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "second group input",
      }),
    });
    for (const inputId of [first.inputId, second.inputId]) {
      await enqueueHostedPendingAssistantInputId({
        inputId,
        vaultRoot,
      });
    }

    await writeTerminalEvidence({
      evidenceId: first.inputId,
      groupInputIds: [first.inputId, second.inputId],
      vaultRoot,
    });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      first.inputId,
      second.inputId,
    ]);

    await writeTerminalEvidence({
      evidenceId: second.inputId,
      groupInputIds: [first.inputId, second.inputId],
      vaultRoot,
    });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
  });

  it("sorts remaining pending inputs by cursor during compaction", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const later = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_later",
        eventId: "evt_later",
        itemId: "item_later",
        laneSeq: "20",
        messageId: "msg_later",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "later pending input",
      }),
    });
    const earlier = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_earlier",
        eventId: "evt_earlier",
        itemId: "item_earlier",
        laneSeq: "10",
        messageId: "msg_earlier",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "earlier pending input",
      }),
    });

    await enqueueHostedPendingAssistantInputId({
      inputId: later.inputId,
      vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: earlier.inputId,
      vaultRoot,
    });
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      later.inputId,
      earlier.inputId,
    ]);

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      earlier.inputId,
      later.inputId,
    ]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      earlier.inputId,
      later.inputId,
    ]);
  });

  it("drops indexed inputs whose event record is missing", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const missingInputId = "ain_00000000000000000000000000000001";

    await enqueueHostedPendingAssistantInputId({
      inputId: missingInputId,
      vaultRoot,
    });
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      missingInputId,
    ]);

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
  });

  it("drops indexed inputs whose source cannot be processed by the reply channel", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const processable = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_processable",
        eventId: "evt_processable",
        itemId: "item_processable",
        laneSeq: "10",
        messageId: "msg_processable",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        source: "linq",
        text: "processable input",
      }),
    });
    const mismatched = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_mismatched",
        eventId: "evt_mismatched",
        itemId: "item_mismatched",
        laneSeq: "20",
        messageId: "msg_mismatched",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        replyTarget: "linq",
        source: "telegram",
        text: "mismatched input",
      }),
    });
    for (const inputId of [processable.inputId, mismatched.inputId]) {
      await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    }

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      processable.inputId,
    ]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      processable.inputId,
    ]);
  });

  it("preserves indexed inputs after cursor advancement until terminal evidence exists", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_cursor_advanced",
        eventId: "evt_cursor_advanced",
        itemId: "item_cursor_advanced",
        laneSeq: "10",
        messageId: "msg_cursor_advanced",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "cursor-advanced input",
      }),
    });
    const second = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_channel_disabled",
        eventId: "evt_channel_disabled",
        itemId: "item_channel_disabled",
        laneSeq: "20",
        messageId: "msg_channel_disabled",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "channel-disabled input",
      }),
    });
    for (const inputId of [first.inputId, second.inputId]) {
      await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    }

    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: first.cursor,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:01:00.000Z",
      version: 1,
    });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      first.inputId,
      second.inputId,
    ]);

    await writeTerminalEvidence({
      evidenceId: first.inputId,
      groupInputIds: [first.inputId],
      vaultRoot,
    });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      second.inputId,
    ]);

    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [],
      updatedAt: "2026-04-23T00:02:00.000Z",
      version: 1,
    });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-04-23T00:03:00.000Z",
      vaultRoot,
    })).resolves.toBeNull();
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
  });

  it("does not backfill before eligibleAfter when compacting for consume-ack safety", async () => {
    const vaultRoot = await createTempVault();
    const oldPending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_old_unindexed",
        eventId: "evt_old_unindexed",
        itemId: "item_old_unindexed",
        laneSeq: "10",
        messageId: "msg_old_unindexed",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "old unindexed pending input",
      }),
    });
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: oldPending.cursor,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:01:00.000Z",
      version: 1,
    });

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-04-23T00:03:00.000Z",
      vaultRoot,
    })).resolves.toBeNull();
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
  });
});

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-pending-inputs-"));
  tempRoots.push(root);
  return path.join(root, "vault");
}

async function writeTerminalEvidence(input: {
  evidenceId: string;
  groupInputIds: readonly string[];
  vaultRoot: string;
}): Promise<void> {
  const directory = path.join(
    resolveAssistantStatePaths(input.vaultRoot).assistantStateRoot,
    "auto-reply",
    "evidence",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${encodeURIComponent(input.evidenceId)}.json`),
    `${JSON.stringify({
      captureId: input.evidenceId,
      groupCaptureIds: input.groupInputIds,
      groupId: `group_${input.groupInputIds.join("__")}`,
      groupInputIds: input.groupInputIds,
      inputId: input.evidenceId,
      primaryCaptureId: input.groupInputIds[0] ?? input.evidenceId,
      primaryInputId: input.groupInputIds[0] ?? input.evidenceId,
      providerCleanup: {
        linqMessageIds: [],
        queuedAt: null,
      },
      recordedAt: "2026-04-23T00:05:00.000Z",
      schema: TERMINAL_EVIDENCE_SCHEMA,
      terminal: {
        kind: "suppressed",
        reason: "test",
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

function createAssistantInputEvent(input: {
  actorId?: string;
  accountId?: string;
  contextOnly?: boolean;
  dedupeKey: string;
  eventId: string;
  itemId: string;
  laneSeq: string;
  messageId: string;
  occurredAt: string;
  receivedAt: string;
  replyTarget?: "linq" | null;
  source?: "linq" | "telegram";
  text: string;
  threadId?: string;
  threadIsDirect?: boolean;
}) {
  const source = input.source ?? "linq";
  const threadId = input.threadId ?? "thread_1";
  const replyTarget = input.replyTarget === null
    ? null
    : {
        channel: "linq" as const,
        messageId: input.messageId,
        threadId,
      };

  return {
    content: {
      text: input.text,
      transcriptText: input.text,
      userMessageContent: [
        {
          text: input.text,
          type: "text" as const,
        },
      ],
    },
    conversation: {
      accountId: input.accountId ?? "acct_1",
      actorId: input.actorId ?? "actor_1",
      actorIsSelf: false,
      source,
      threadId,
      threadIsDirect: input.threadIsDirect ?? !input.contextOnly,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    replyTarget,
    ...(source === "linq"
      ? {
          sourceMetadata: {
            ...(input.contextOnly ? { contextOnly: true } : {}),
            kind: "linq" as const,
            partCount: 1,
          },
        }
      : {}),
    sourceRef: {
      dedupeKey: input.dedupeKey,
      eventId: input.eventId,
      itemId: input.itemId,
      kind: "hosted-mailbox" as const,
      lane: "conversation" as const,
      laneSeq: input.laneSeq,
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      payloadSource: "inline" as const,
      source: "hosted-mailbox" as const,
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}
