import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  recordHostedMailboxAssistantInputItem,
  readAssistantInputEvent,
  readHostedMailboxAssistantInputItemDetails,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  createAssistantOutboxIntent,
  markAssistantOutboxIntentSentById,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from "@murphai/assistant-engine/assistant-outbox";
import {
  updateAssistantInputAttachmentEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  initializeVault,
} from "@murphai/core";
import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node/assistant-state-fs";

import {
  collectHostedAssistantDeliverySideEffects,
} from "../src/hosted-runtime/callbacks.ts";
import {
  compactHostedConversationMailboxHandledItemIds,
  compactHostedConversationMailboxHandledItemSelection,
  compactHostedPendingAssistantInputIds,
  collectHostedPendingAssistantInputMediaRetentionProtections,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  inspectHostedPendingAssistantInputWakeCandidate,
  readHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
  runHostedPendingAssistantInputContentRetention,
  selectHostedConversationMailboxHandledItemBatch,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "../src/hosted-runtime/pending-assistant-input.ts";

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
  it("rotates bounded exact handled-item batches without starving the tail", () => {
    const candidates = Array.from({ length: 258 }, (_, index) => ({
      inputId: `input-${index + 1}`,
      mailboxItemId: `item-${index + 1}`,
    }));

    const first = selectHostedConversationMailboxHandledItemBatch({
      candidates,
      cursorInputId: null,
      frontierInputId: "input-257",
    });
    expect(first.candidates).toHaveLength(256);
    expect(first.candidates[0]?.mailboxItemId).toBe("item-1");
    expect(first.candidates.at(-1)?.mailboxItemId).toBe("item-256");
    expect(first.frontierSelected).toBe(false);
    expect(first.nextCursorInputId).toBe("input-256");

    const second = selectHostedConversationMailboxHandledItemBatch({
      candidates,
      cursorInputId: first.nextCursorInputId,
      frontierInputId: "input-257",
    });
    expect(second.candidates).toHaveLength(256);
    expect(second.candidates.slice(0, 3).map((candidate) => candidate.mailboxItemId))
      .toEqual(["item-257", "item-258", "item-1"]);
    expect(second.candidates.at(-1)?.mailboxItemId).toBe("item-254");
    expect(second.frontierSelected).toBe(true);
    expect(second.nextCursorInputId).toBe("input-254");

    const missingFrontierMapping = selectHostedConversationMailboxHandledItemBatch({
      candidates: candidates.slice(1),
      cursorInputId: null,
      frontierInputId: "input-1",
    });
    expect(missingFrontierMapping.candidates).toHaveLength(256);
    expect(missingFrontierMapping.frontierSelected).toBe(false);
  });

  it("preserves the exact abort reason before background compaction starts", async () => {
    const vaultRoot = await createTempVault();
    const controller = new AbortController();
    const reason = new Error("foreground input interrupted pending compaction");
    controller.abort(reason);

    await expect(compactHostedPendingAssistantInputIds({
      signal: controller.signal,
      vaultRoot,
    })).rejects.toBe(reason);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
  });

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

  it("fails closed when the handled-item batch cursor is not indexed", async () => {
    const vaultRoot = await createTempVault();
    const filePath = resolveHostedPendingAssistantInputStatePath(vaultRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({
      schema: "murph.hosted-pending-assistant-inputs.v2",
      schemaVersion: 2,
      value: {
        backfilled: true,
        handledBatchCursorInputId: "input-not-indexed",
        inputIds: [],
      },
    }, null, 2)}\n`, "utf8");

    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .rejects.toThrow("must reference an indexed input");
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

  it("keeps the legacy value shape while appending before v2 compaction", async () => {
    const vaultRoot = await createTempVault();
    const inputId = "ain_00000000000000000000000000000001";
    const filePath = resolveHostedPendingAssistantInputStatePath(vaultRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({
      schema: "murph.hosted-pending-assistant-inputs.v1",
      schemaVersion: 1,
      value: {
        backfilled: true,
        inputIds: [],
      },
    }, null, 2)}\n`, "utf8");

    await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });

    await expect(readFile(filePath, "utf8").then((value) => JSON.parse(value)))
      .resolves.toEqual({
        schema: "murph.hosted-pending-assistant-inputs.v1",
        schemaVersion: 1,
        value: {
          backfilled: true,
          inputIds: [inputId],
        },
      });
  });

  it("reports exact terminal mailbox items without crossing a mixed-channel pending input", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [
        {
          channel: "linq",
          eligibleAfter: null,
          enabledAt: "2026-04-23T00:00:00.000Z",
        },
        {
          channel: "telegram",
          eligibleAfter: null,
          enabledAt: "2026-04-23T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const earlier = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_prefix_linq",
        eventId: "evt_prefix_linq",
        itemId: "item_prefix_linq",
        laneSeq: "2",
        messageId: "msg_prefix_linq",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        source: "linq",
        text: "earliest pending input",
      }),
    });
    const later = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_prefix_telegram",
        eventId: "evt_prefix_telegram",
        itemId: "item_prefix_telegram",
        laneSeq: "5",
        messageId: "msg_prefix_telegram",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        source: "telegram",
        text: "later pending input",
      }),
    });
    for (const inputId of [earlier.inputId, later.inputId]) {
      await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    }
    await recordHostedMailboxAssistantInputItem({
      inputId: earlier.inputId,
      mailboxItemId: "item_prefix_linq",
      vault: vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: later.inputId,
      mailboxItemId: "item_prefix_telegram",
      vault: vaultRoot,
    });

    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual([]);

    await writeTerminalEvidence({
      evidenceId: earlier.inputId,
      groupInputIds: [earlier.inputId],
      vaultRoot,
    });
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual(["item_prefix_linq"]);
    await expect(compactHostedConversationMailboxHandledItemSelection({
      consumedThroughSeq: null,
      vaultRoot,
    })).resolves.toEqual({
      frontierSelected: false,
      itemIds: ["item_prefix_linq"],
    });
    await expect(compactHostedConversationMailboxHandledItemSelection({
      consumedThroughSeq: "1",
      vaultRoot,
    })).resolves.toEqual({
      frontierSelected: true,
      itemIds: ["item_prefix_linq"],
    });

    await writeTerminalEvidence({
      evidenceId: later.inputId,
      groupInputIds: [later.inputId],
      vaultRoot,
    });
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "2",
      vaultRoot,
    })).resolves.toEqual(["item_prefix_telegram"]);
  });

  it("keeps an uncovered reaction successor pending and outside handled checkpoint selection", async () => {
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
    const accepted = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_reaction_accepted",
        eventId: "evt_reaction_accepted",
        itemId: "item_reaction_accepted",
        laneSeq: "10",
        messageId: "msg_reaction_accepted",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "accepted reaction input",
      }),
    });
    const uncovered = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_reaction_uncovered",
        eventId: "evt_reaction_uncovered",
        itemId: "item_reaction_uncovered",
        laneSeq: "20",
        messageId: "msg_reaction_uncovered",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "uncovered reaction successor",
      }),
    });
    for (const event of [accepted, uncovered]) {
      await enqueueHostedPendingAssistantInputId({
        inputId: event.inputId,
        vaultRoot,
      });
    }
    await recordHostedMailboxAssistantInputItem({
      inputId: accepted.inputId,
      mailboxItemId: "item_reaction_accepted",
      vault: vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: uncovered.inputId,
      mailboxItemId: "item_reaction_uncovered",
      vault: vaultRoot,
    });

    await writeTerminalEvidence({
      evidenceId: accepted.inputId,
      groupInputIds: [accepted.inputId],
      terminal: {
        deliveryIntentId: "intent_frozen_reaction",
        kind: "reply_intent_committed",
        sessionId: "session_frozen_reaction",
      },
      vaultRoot,
    });

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([uncovered.inputId]);
    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({ hasCandidate: true, indexComplete: true });
    await expect(compactHostedConversationMailboxHandledItemSelection({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual({
      frontierSelected: false,
      itemIds: ["item_reaction_accepted"],
    });
  });

  it("persists the exact handled-item batch cursor across checkpoint collection", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "telegram",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    for (const laneSeq of ["2", "3"] as const) {
      const event = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          dedupeKey: `dedupe_exact_page_${laneSeq}`,
          eventId: `evt_exact_page_${laneSeq}`,
          itemId: `item_exact_page_${laneSeq}`,
          laneSeq,
          messageId: `msg_exact_page_${laneSeq}`,
          occurredAt: `2026-04-23T00:00:0${laneSeq}.000Z`,
          receivedAt: `2026-04-23T00:00:1${laneSeq}.000Z`,
          source: "telegram",
          text: `terminal input ${laneSeq}`,
        }),
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: event.inputId,
        vaultRoot,
      });
      await recordHostedMailboxAssistantInputItem({
        inputId: event.inputId,
        mailboxItemId: `item_exact_page_${laneSeq}`,
        vault: vaultRoot,
      });
      await writeTerminalEvidence({
        evidenceId: event.inputId,
        groupInputIds: [event.inputId],
        vaultRoot,
      });
    }

    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "1",
      vaultRoot,
    })).resolves.toEqual(["item_exact_page_2", "item_exact_page_3"]);

    const appended = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_exact_page_4",
        eventId: "evt_exact_page_4",
        itemId: "item_exact_page_4",
        laneSeq: "4",
        messageId: "msg_exact_page_4",
        occurredAt: "2026-04-23T00:00:04.000Z",
        receivedAt: "2026-04-23T00:00:14.000Z",
        source: "telegram",
        text: "terminal input 4",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: appended.inputId,
      vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: appended.inputId,
      mailboxItemId: "item_exact_page_4",
      vault: vaultRoot,
    });
    await writeTerminalEvidence({
      evidenceId: appended.inputId,
      groupInputIds: [appended.inputId],
      vaultRoot,
    });

    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "1",
      vaultRoot,
    })).resolves.toEqual([
      "item_exact_page_4",
      "item_exact_page_2",
      "item_exact_page_3",
    ]);
  });

  it("fails closed without discarding malformed conversation-prefix evidence", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "telegram",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const malformed = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_prefix_malformed",
        eventId: "evt_prefix_malformed",
        itemId: "item_prefix_malformed",
        laneSeq: "not-a-sequence",
        messageId: "msg_prefix_malformed",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        source: "telegram",
        text: "malformed pending input",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: malformed.inputId,
      vaultRoot,
    });

    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      malformed.inputId,
    ]);
  });

  it("fails closed without discarding an indexed input whose event is missing", async () => {
    const vaultRoot = await createTempVault();
    const missingInputId = "ain_00000000000000000000000000000001";
    await enqueueHostedPendingAssistantInputId({
      inputId: missingInputId,
      vaultRoot,
    });

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({ hasCandidate: false, indexComplete: true });
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      missingInputId,
    ]);
  });

  it("finds fresh runnable input after a large missing prefix without an unbounded wake probe", async () => {
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
    const missingInputIds = Array.from(
      { length: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT + 10 },
      (_, index) => `ain_${String(index + 1).padStart(32, "0")}`,
    );
    for (const inputId of missingInputIds) {
      await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    }
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
    const valid = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_valid_after_missing_prefix",
        eventId: "evt_valid_after_missing_prefix",
        itemId: "item_valid_after_missing_prefix",
        laneSeq: "10",
        messageId: "msg_valid_after_missing_prefix",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "fresh runnable input",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: valid.inputId,
      vaultRoot,
    });

    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({ hasCandidate: true, indexComplete: true });
  });

  it("defers rather than immediately waking when a bounded probe sees only missing blockers", async () => {
    const vaultRoot = await createTempVault();
    for (let index = 0; index < DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT + 10; index += 1) {
      await enqueueHostedPendingAssistantInputId({
        inputId: `ain_${String(index + 1).padStart(32, "0")}`,
        vaultRoot,
      });
    }
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);

    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({ hasCandidate: false, indexComplete: false });
    await expect(resolveHostedPendingAssistantInputWakeAt({
      inspectOnly: true,
      now: () => "2026-04-23T00:00:00.000Z",
      vaultRoot,
    })).resolves.toBe("2026-04-23T00:00:30.000Z");
  });

  it("does not report a pending system-lane assistant input as handled conversation work", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "telegram",
        eligibleAfter: null,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
      updatedAt: "2026-04-23T00:00:00.000Z",
      version: 1,
    });
    const systemInput = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_prefix_system",
        eventId: "evt_prefix_system",
        itemId: "item_prefix_system",
        lane: "system",
        laneSeq: "system-item-token",
        messageId: "msg_prefix_system",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        source: "telegram",
        text: "pending system input",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: systemInput.inputId,
      vaultRoot,
    });

    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual([]);
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
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [],
      updatedAt: "2026-04-23T00:00:04.000Z",
      version: 1,
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

  it("suppresses and redacts a pending input at its receipt-anchored deadline", async () => {
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
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_retention_suppressed",
        eventId: "evt_retention_suppressed",
        itemId: "item_retention_suppressed",
        laneSeq: "10",
        messageId: "msg_retention_suppressed",
        occurredAt: "2026-04-01T00:00:01.000Z",
        receivedAt: "2026-04-01T00:00:02.000Z",
        text: "private pending content",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      groupReactionContext: "private quoted message in a Linq sidecar",
      inputId: event.inputId,
      mailboxItemId: "item_retention_suppressed",
      vault: vaultRoot,
    });
    const deadline = "2026-04-15T00:00:02.000Z";

    await expect(runHostedPendingAssistantInputContentRetention({
      now: deadline,
      vaultRoot,
    })).resolves.toEqual({
      inputsRetired: 1,
      inputsSuppressed: 1,
      nextEligibleAt: null,
    });

    const retired = await readAssistantInputEvent({
      inputId: event.inputId,
      vault: vaultRoot,
    });
    expect(retired).toMatchObject({
      content: {
        text: null,
        transcriptText: null,
        userMessageContent: null,
      },
      contentRetiredAt: deadline,
      inputId: event.inputId,
    });
    await expect(readHostedMailboxAssistantInputItemDetails({
      inputIds: [event.inputId],
      vault: vaultRoot,
    })).resolves.toEqual(new Map([
      [event.inputId, {
        inputId: event.inputId,
        mailboxItemId: "item_retention_suppressed",
      }],
    ]));
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([]);
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: null,
      vaultRoot,
    })).resolves.toEqual(["item_retention_suppressed"]);

    await expect(runHostedPendingAssistantInputContentRetention({
      now: deadline,
      vaultRoot,
    })).resolves.toEqual({
      inputsRetired: 0,
      inputsSuppressed: 0,
      nextEligibleAt: null,
    });
  });

  it("abandons a committed reply intent before suppressing expired input", async () => {
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
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_retention_committed_intent",
        eventId: "evt_retention_committed_intent",
        itemId: "item_retention_committed_intent",
        laneSeq: "11",
        messageId: "msg_retention_committed_intent",
        occurredAt: "2026-04-01T00:00:01.000Z",
        receivedAt: "2026-04-01T00:00:02.000Z",
        text: "private input with a queued reply",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });
    const intent = await createAssistantOutboxIntent({
      channel: "linq",
      createdAt: "2026-04-01T00:01:00.000Z",
      message: "reply that must not be sent after the input expires",
      sessionId: "session_retention_committed_intent",
      threadId: "thread_1",
      threadIsDirect: true,
      turnId: "turn_retention_committed_intent",
      turnTrigger: "automation-auto-reply",
      vault: vaultRoot,
    });
    await saveAssistantOutboxIntent(vaultRoot, {
      ...intent,
      attemptCount: 1,
      lastAttemptAt: "2026-04-01T00:02:00.000Z",
      nextAttemptAt: "2026-04-15T01:00:00.000Z",
      status: "retryable",
      updatedAt: "2026-04-01T00:02:00.000Z",
    });
    await writeTerminalEvidence({
      evidenceId: event.inputId,
      groupInputIds: [event.inputId],
      terminal: {
        deliveryIntentId: intent.intentId,
        kind: "reply_intent_committed",
        sessionId: "session_retention_committed_intent",
      },
      vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: event.inputId,
      mailboxItemId: "item_retention_committed_intent",
      vault: vaultRoot,
    });
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "11",
      vaultRoot,
    })).resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([]);

    await expect(runHostedPendingAssistantInputContentRetention({
      now: "2026-04-15T00:00:02.000Z",
      vaultRoot,
    })).resolves.toEqual({
      inputsRetired: 1,
      inputsSuppressed: 1,
      nextEligibleAt: null,
    });
    await expect(readAssistantOutboxIntent(vaultRoot, intent.intentId))
      .resolves.toMatchObject({
        nextAttemptAt: null,
        status: "abandoned",
      });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([]);
    await expect(collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      vaultRoot,
    })).resolves.toEqual([]);
  });

  it("abandons idempotent and non-idempotent sending claims before retirement", async () => {
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

    const intentIds: string[] = [];
    for (const [index, deliveryTransportIdempotent] of [true, false].entries()) {
      const event = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          dedupeKey: `dedupe_retention_sending_${index}`,
          eventId: `evt_retention_sending_${index}`,
          itemId: `item_retention_sending_${index}`,
          lane: "system",
          laneSeq: String(20 + index),
          messageId: `msg_retention_sending_${index}`,
          occurredAt: `2026-04-01T00:00:0${index + 1}.000Z`,
          receivedAt: `2026-04-01T00:00:1${index + 1}.000Z`,
          text: "private input with an ambiguous sending reply",
        }),
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: event.inputId,
        vaultRoot,
      });
      const intent = await createAssistantOutboxIntent({
        channel: "linq",
        createdAt: "2026-04-01T00:01:00.000Z",
        deliveryTransportIdempotent,
        message: "reply whose stale sending claim must be terminalized",
        sessionId: `session_retention_sending_${index}`,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: `turn_retention_sending_${index}`,
        turnTrigger: "automation-auto-reply",
        vault: vaultRoot,
      });
      await saveAssistantOutboxIntent(vaultRoot, {
        ...intent,
        attemptCount: 1,
        lastAttemptAt: "2026-04-01T00:02:00.000Z",
        nextAttemptAt: null,
        status: "sending",
        updatedAt: "2026-04-01T00:02:00.000Z",
      });
      await writeTerminalEvidence({
        evidenceId: event.inputId,
        groupInputIds: [event.inputId],
        terminal: {
          deliveryIntentId: intent.intentId,
          kind: "reply_intent_committed",
          sessionId: `session_retention_sending_${index}`,
        },
        vaultRoot,
      });
      intentIds.push(intent.intentId);
    }

    await expect(runHostedPendingAssistantInputContentRetention({
      now: "2026-04-15T00:00:12.000Z",
      vaultRoot,
    })).resolves.toEqual({
      inputsRetired: 2,
      inputsSuppressed: 2,
      nextEligibleAt: null,
    });
    for (const intentId of intentIds) {
      await expect(readAssistantOutboxIntent(vaultRoot, intentId))
        .resolves.toMatchObject({
          nextAttemptAt: null,
          status: "abandoned",
        });
    }
    await expect(collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      vaultRoot,
    })).resolves.toEqual([]);
  });

  it("keeps a genuinely sent linked reply terminal during retirement", async () => {
    const vaultRoot = await createTempVault();
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_retention_sent",
        eventId: "evt_retention_sent",
        itemId: "item_retention_sent",
        lane: "system",
        laneSeq: "30",
        messageId: "msg_retention_sent",
        occurredAt: "2026-04-01T00:00:01.000Z",
        receivedAt: "2026-04-01T00:00:02.000Z",
        text: "private input with a reply already sent",
      }),
    });
    const intent = await createAssistantOutboxIntent({
      channel: "linq",
      createdAt: "2026-04-01T00:01:00.000Z",
      message: "reply already sent",
      sessionId: "session_retention_sent",
      threadId: "thread_1",
      threadIsDirect: true,
      turnId: "turn_retention_sent",
      turnTrigger: "automation-auto-reply",
      vault: vaultRoot,
    });
    await markAssistantOutboxIntentSentById({
      delivery: {
        channel: "linq",
        idempotencyKey: null,
        messageLength: "reply already sent".length,
        providerMessageId: "linq_message_retention_sent",
        providerThreadId: "thread_1",
        sentAt: "2026-04-01T00:02:00.000Z",
        target: "thread_1",
        targetKind: "thread",
      },
      intentId: intent.intentId,
      vault: vaultRoot,
    });
    await writeTerminalEvidence({
      evidenceId: event.inputId,
      groupInputIds: [event.inputId],
      terminal: {
        deliveryIntentId: intent.intentId,
        kind: "reply_intent_committed",
        sessionId: "session_retention_sent",
      },
      vaultRoot,
    });

    await expect(runHostedPendingAssistantInputContentRetention({
      now: "2026-04-15T00:00:02.000Z",
      vaultRoot,
    })).resolves.toEqual({
      inputsRetired: 1,
      inputsSuppressed: 0,
      nextEligibleAt: null,
    });
    await expect(readAssistantOutboxIntent(vaultRoot, intent.intentId))
      .resolves.toMatchObject({
        status: "sent",
      });
  });

  it("redacts terminal input content after it leaves the pending index", async () => {
    const vaultRoot = await createTempVault();
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_retention_terminal",
        eventId: "evt_retention_terminal",
        itemId: "item_retention_terminal",
        lane: "system",
        laneSeq: "12",
        messageId: "msg_retention_terminal",
        occurredAt: "2026-04-01T00:00:01.000Z",
        receivedAt: "2026-04-01T00:00:02.000Z",
        text: "terminal content outside the pending index",
      }),
    });
    await writeTerminalEvidence({
      evidenceId: event.inputId,
      groupInputIds: [event.inputId],
      vaultRoot,
    });
    await ensureHostedPendingAssistantInputIndex({ vaultRoot });
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([]);

    await expect(runHostedPendingAssistantInputContentRetention({
      now: "2026-04-15T00:00:02.000Z",
      vaultRoot,
    })).resolves.toEqual({
      inputsRetired: 1,
      inputsSuppressed: 0,
      nextEligibleAt: null,
    });
    await expect(readAssistantInputEvent({
      inputId: event.inputId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      content: {
        text: null,
      },
      contentRetiredAt: "2026-04-15T00:00:02.000Z",
    });
  });

  it("schedules a fresh pending input from receivedAt rather than stored time", async () => {
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
    const event = await upsertAssistantInputEvent({
      now: new Date("2026-04-10T00:00:00.000Z"),
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_retention_future",
        eventId: "evt_retention_future",
        itemId: "item_retention_future",
        laneSeq: "11",
        messageId: "msg_retention_future",
        occurredAt: "2026-04-01T00:00:00.000Z",
        receivedAt: "2026-04-02T03:04:05.000Z",
        text: "fresh private content",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    await expect(runHostedPendingAssistantInputContentRetention({
      now: "2026-04-03T00:00:00.000Z",
      vaultRoot,
    })).resolves.toEqual({
      inputsRetired: 0,
      inputsSuppressed: 0,
      nextEligibleAt: "2026-04-16T03:04:05.000Z",
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
      inspectOnly: true,
      now: () => "2026-04-23T00:00:08.000Z",
      vaultRoot,
    })).resolves.toBe("2026-04-23T00:00:38.000Z");
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
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      first.inputId,
      second.inputId,
    ]);
  });

  it("does not wake for terminal inputs retained until exact acknowledgement", async () => {
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
        dedupeKey: "dedupe_terminal_inspection",
        eventId: "evt_terminal_inspection",
        itemId: "item_terminal_inspection",
        laneSeq: "10",
        messageId: "msg_terminal_inspection",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "terminal indexed input",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([event.inputId]);
    await writeTerminalEvidence({
      evidenceId: event.inputId,
      groupInputIds: [event.inputId],
      vaultRoot,
    });

    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({ hasCandidate: false, indexComplete: true });
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([event.inputId]);
    await expect(resolveHostedPendingAssistantInputWakeAt({ vaultRoot }))
      .resolves.toBeNull();
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([event.inputId]);
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

  it("keeps missing indexed events durable while returning valid runnable inputs", async () => {
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
    const valid = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_valid_with_missing",
        eventId: "evt_valid_with_missing",
        itemId: "item_valid_with_missing",
        laneSeq: "10",
        messageId: "msg_valid_with_missing",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "valid pending input",
      }),
    });

    await enqueueHostedPendingAssistantInputId({
      inputId: missingInputId,
      vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: valid.inputId,
      vaultRoot,
    });
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      missingInputId,
      valid.inputId,
    ]);

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      valid.inputId,
    ]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      missingInputId,
      valid.inputId,
    ]);
  });

  it("retains nonterminal indexed inputs whose source cannot currently use the reply channel", async () => {
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
      mismatched.inputId,
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
    await recordHostedMailboxAssistantInputItem({
      inputId: first.inputId,
      mailboxItemId: "item_cursor_advanced",
      vault: vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: second.inputId,
      mailboxItemId: "item_channel_disabled",
      vault: vaultRoot,
    });

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
    await expect(resolveHostedPendingAssistantInputWakeAt({
      inspectOnly: true,
      now: () => "2026-04-23T00:03:00.000Z",
      vaultRoot,
    })).resolves.toBeNull();
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      first.inputId,
      second.inputId,
    ]);
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual(["item_cursor_advanced"]);
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "10",
      vaultRoot,
    })).resolves.toEqual([]);

    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: first.cursor,
        enabledAt: "2026-04-23T00:04:00.000Z",
      }],
      updatedAt: "2026-04-23T00:04:00.000Z",
      version: 1,
    });
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      second.inputId,
    ]);

    await writeTerminalEvidence({
      evidenceId: second.inputId,
      groupInputIds: [second.inputId],
      vaultRoot,
    });
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "10",
      vaultRoot,
    })).resolves.toEqual(["item_channel_disabled"]);
    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({
        hasCandidate: false,
        indexComplete: true,
      });
    await expect(resolveHostedPendingAssistantInputWakeAt({
      inspectOnly: true,
      now: () => "2026-04-23T00:05:00.000Z",
      vaultRoot,
    })).resolves.toBeNull();
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "20",
      vaultRoot,
    })).resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);
  });

  it("keeps ambiguous v1 omissions nonreplyable while recovering terminal acknowledgements", async () => {
    const vaultRoot = await createTempVault();
    const terminal = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_legacy_v1_terminal",
        eventId: "evt_legacy_v1_terminal",
        itemId: "item_legacy_v1_terminal",
        laneSeq: "5",
        messageId: "msg_legacy_v1_terminal",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        source: "telegram",
        text: "terminal input omitted by the legacy index",
      }),
    });
    const previouslyAdmitted = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_legacy_v1_previously_admitted",
        eventId: "evt_legacy_v1_previously_admitted",
        itemId: "item_legacy_v1_previously_admitted",
        laneSeq: "10",
        messageId: "msg_legacy_v1_previously_admitted",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        source: "telegram",
        text: "previously admitted input later omitted by v1",
      }),
    });
    const recordedPending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_legacy_v1_recorded_pending",
        eventId: "evt_legacy_v1_recorded_pending",
        itemId: "item_legacy_v1_recorded_pending",
        laneSeq: "15",
        messageId: "msg_legacy_v1_recorded_pending",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        source: "telegram",
        text: "pending input that v1 still records",
      }),
    });
    const contextOnly = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_legacy_v1_context_only",
        eventId: "evt_legacy_v1_context_only",
        itemId: "item_legacy_v1_context_only",
        laneSeq: "20",
        messageId: "msg_legacy_v1_context_only",
        occurredAt: "2026-04-23T00:00:07.000Z",
        receivedAt: "2026-04-23T00:00:08.000Z",
        source: "telegram",
        text: "context-only input that was never admitted",
      }),
    });
    // These histories are intentionally indistinguishable once deployed v1
    // has omitted the only admitted ID: one was genuinely pending, while the
    // other was retained only as context. The migration must not infer that
    // either is safe to reply to.
    await enqueueHostedPendingAssistantInputId({
      inputId: previouslyAdmitted.inputId,
      vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: terminal.inputId,
      mailboxItemId: "item_legacy_v1_terminal",
      vault: vaultRoot,
    });
    await writeTerminalEvidence({
      evidenceId: terminal.inputId,
      groupInputIds: [terminal.inputId],
      vaultRoot,
    });
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "telegram",
        eligibleAfter: contextOnly.cursor,
        enabledAt: "2026-04-23T00:01:00.000Z",
      }],
      updatedAt: "2026-04-23T00:01:00.000Z",
      version: 1,
    });

    const filePath = resolveHostedPendingAssistantInputStatePath(vaultRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({
      schema: "murph.hosted-pending-assistant-inputs.v1",
      schemaVersion: 1,
      value: {
        backfilled: true,
        inputIds: [recordedPending.inputId],
      },
    }, null, 2)}\n`, "utf8");

    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({
        hasCandidate: true,
        indexComplete: false,
      });
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual(["item_legacy_v1_terminal"]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      terminal.inputId,
      recordedPending.inputId,
    ]);
    await expect(readFile(filePath, "utf8").then((value) => JSON.parse(value)))
      .resolves.toMatchObject({
        schema: "murph.hosted-pending-assistant-inputs.v2",
        schemaVersion: 2,
      });

    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      recordedPending.inputId,
    ]);
    await expect(inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }))
      .resolves.toEqual({
        hasCandidate: true,
        indexComplete: true,
      });
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "0",
      vaultRoot,
    })).resolves.toEqual(["item_legacy_v1_terminal"]);
    await expect(compactHostedConversationMailboxHandledItemIds({
      consumedThroughSeq: "5",
      vaultRoot,
    })).resolves.toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      recordedPending.inputId,
    ]);
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
  terminal?: {
    deliveryIntentId: string | null;
    kind: "deferred" | "replied" | "reply_intent_committed";
    sessionId: string;
  };
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
      terminal: input.terminal ?? {
        kind: "suppressed",
        reason: "test",
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

function createAssistantInputEvent(input: {
  dedupeKey: string;
  eventId: string;
  itemId: string;
  lane?: "conversation" | "system";
  laneSeq: string;
  messageId: string;
  occurredAt: string;
  receivedAt: string;
  replyTarget?: "linq" | "telegram" | null;
  source?: "linq" | "telegram";
  text: string;
}) {
  const source = input.source ?? "linq";
  const replyTarget = input.replyTarget === null
    ? null
    : {
        channel: input.replyTarget ?? source,
        messageId: input.messageId,
        threadId: "thread_1",
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
      accountId: "acct_1",
      actorId: "actor_1",
      actorIsSelf: false,
      source,
      threadId: "thread_1",
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    replyTarget,
    sourceMetadata: source === "linq"
      ? {
          externalThreadRouteAuthorityPresent: false,
          kind: "linq" as const,
          partCount: 1,
          reactionEligible: false,
          replyToMessageId: null,
          service: null,
        }
      : null,
    sourceRef: {
      dedupeKey: input.dedupeKey,
      eventId: input.eventId,
      itemId: input.itemId,
      kind: "hosted-mailbox" as const,
      lane: input.lane ?? "conversation",
      laneSeq: input.laneSeq,
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      payloadSource: "inline" as const,
      source: "hosted-mailbox" as const,
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}
