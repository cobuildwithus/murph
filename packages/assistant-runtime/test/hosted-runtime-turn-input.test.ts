import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as assistantEngine from "@murphai/assistant-engine";
import {
  hasPendingAssistantAutoReplyInput,
  recordHostedMailboxAssistantInputItem,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";

import {
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  readHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  createHostedAssistantInputSource,
  resolveHostedPersonalizationInputIdForAcceptedInputs,
  selectHostedAssistantInputIds,
} from "../src/hosted-runtime/turn-input.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("createHostedAssistantInputSource", () => {
  it("direct-reads selected ids and applies candidate filters without broad store listing", async () => {
    const listSpy = vi.spyOn(assistantEngine, "listAssistantInputEvents");
    const vaultRoot = await createTempVault();
    const older = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_older",
        eventId: "evt_older",
        itemId: "item_older",
        laneSeq: "10",
        messageId: "msg_older",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "older selected note",
      }),
    });
    const newer = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_newer",
        eventId: "evt_newer",
        itemId: "item_newer",
        laneSeq: "20",
        messageId: "msg_newer",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "newer selected note",
      }),
    });
    await updateAssistantInputProjection({
      inputId: newer.inputId,
      projection: {
        captureId: "cap_newer",
        status: "succeeded",
      },
      vault: vaultRoot,
    });
    const unrelated = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_unrelated_email",
        eventId: "evt_unrelated_email",
        itemId: "item_unrelated_email",
        laneSeq: "30",
        messageId: "msg_unrelated_email",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        source: "email",
        text: "unrelated email note",
        threadId: "email_thread",
      }),
    });
    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: [unrelated.inputId, newer.inputId, older.inputId],
      vaultRoot,
    });

    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });

    const first = await source.listInputCandidates({
      limit: 1,
      sourceId: "linq",
    });
    const second = await source.listInputCandidates({
      afterCursor: first.nextCursor,
      knownInputIds: [older.inputId],
      limit: 2,
      sourceId: "linq",
    });
    const conversation = await source.listNewConversationInputs({
      conversation: older.conversation!,
      knownProjectionCaptureIds: ["cap_newer"],
      limit: 10,
    });

    expect(first.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      older.inputId,
    ]);
    expect(first.nextCursor).toEqual(older.cursor);
    expect(second.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      newer.inputId,
    ]);
    expect(second.nextCursor).toEqual(newer.cursor);
    expect(conversation.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      older.inputId,
    ]);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("hydrates selected hosted mailbox proof from the sidecar", async () => {
    const vaultRoot = await createTempVault();
    const selected = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_selected_raw_mailbox",
        eventId: "evt_selected_raw_mailbox",
        itemId: "blinded_item_selected_raw_mailbox",
        laneSeq: "10",
        messageId: "msg_selected_raw_mailbox",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        routeAuthority: true,
        text: "selected continuation message",
        threadIsDirect: false,
      }),
    });
    await recordHostedMailboxAssistantInputItem({
      groupParticipantAdded: true,
      inputId: selected.inputId,
      mailboxItemId: "mailbox_item_runtime_resume_001",
      vault: vaultRoot,
    });
    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: [selected.inputId],
      vaultRoot,
    });

    const listed = await source.listInputCandidates({
      sourceId: "linq",
    });

    expect(listed.inputs).toHaveLength(1);
    expect(listed.inputs[0]?.event.inputId).toBe(selected.inputId);
    const sourceRef = listed.inputs[0]?.event.sourceRef;
    expect(sourceRef?.kind).toBe("hosted-mailbox");
    expect(sourceRef?.kind === "hosted-mailbox" ? sourceRef.itemId : null)
      .toBe("blinded_item_selected_raw_mailbox");
    expect(listed.inputs[0]?.event.hostedMailboxItemId)
      .toBe("mailbox_item_runtime_resume_001");
    expect(listed.inputs[0]?.event.groupParticipantAdded).toBe(true);
  });

  it("defers newly enqueued pending ids once the turn has a frozen batch", async () => {
    const listSpy = vi.spyOn(assistantEngine, "listAssistantInputEvents");
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const oldUnrelated = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_old_unrelated",
        eventId: "evt_old_unrelated",
        itemId: "item_old_unrelated",
        laneSeq: "10",
        messageId: "msg_old_unrelated",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "old unrelated pending",
        threadId: "thread_old",
      }),
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_active",
        eventId: "evt_fresh_active",
        itemId: "item_fresh_active",
        laneSeq: "20",
        messageId: "msg_fresh_active",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "fresh active input",
      }),
    });
    for (const inputId of [oldUnrelated.inputId, fresh.inputId]) {
      await enqueueHostedPendingAssistantInputId({
        inputId,
        vaultRoot,
      });
    }
    const source = createHostedAssistantInputSource({
      initialPendingInputIds: [oldUnrelated.inputId, fresh.inputId],
      pendingInputRefreshMode: "none",
      selectedInputIds: [fresh.inputId],
      vaultRoot,
    });

    const late = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_late_active",
        eventId: "evt_late_active",
        itemId: "item_late_active",
        laneSeq: "30",
        messageId: "msg_late_active",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        text: "late active input",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: late.inputId,
      vaultRoot,
    });

    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    expect(source.readSelectedInputIds()).toEqual([fresh.inputId]);
    expect(source.readObservedInputIds()).toEqual([
      oldUnrelated.inputId,
      fresh.inputId,
    ]);
    const allSelected = await source.listInputCandidates({
      sourceId: "linq",
    });
    const lateConversationInputs = await source.listNewConversationInputs({
      afterCursor: fresh.cursor,
      conversation: fresh.conversation!,
    });

    expect(allSelected.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      fresh.inputId,
    ]);
    expect(lateConversationInputs.inputs.map((candidate) => candidate.event.inputId))
      .toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      oldUnrelated.inputId,
      fresh.inputId,
      late.inputId,
    ]);
    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    expect(source.readSelectedInputIds()).toEqual([fresh.inputId]);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("batches newly enqueued exact successors while the pre-provider selection is empty", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const source = createHostedAssistantInputSource({
      initialPendingInputIds: [],
      pendingInputRefreshMode: "compact",
      selectedInputIds: [],
      vaultRoot,
    });
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "40",
        dedupeKey: "dedupe_refresh_batch_first",
        eventId: "evt_refresh_batch_first",
        itemId: "item_refresh_batch_first",
        laneSeq: "40",
        messageId: "msg_refresh_batch_first",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "first refresh batch input",
      }),
    });
    const second = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "41",
        dedupeKey: "dedupe_refresh_batch_second",
        eventId: "evt_refresh_batch_second",
        itemId: "item_refresh_batch_second",
        laneSeq: "41",
        messageId: "msg_refresh_batch_second",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "second refresh batch input",
      }),
    });
    const third = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "42",
        dedupeKey: "dedupe_refresh_batch_third",
        eventId: "evt_refresh_batch_third",
        itemId: "item_refresh_batch_third",
        laneSeq: "42",
        messageId: "msg_refresh_batch_third",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        text: "third refresh batch input",
      }),
    });
    for (const inputId of [first.inputId, second.inputId, third.inputId]) {
      await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    }

    await expect(source.refresh()).resolves.toEqual({
      progressed: true,
      reason: "ingested_input",
    });
    expect(source.readSelectedInputIds()).toEqual([
      first.inputId,
      second.inputId,
      third.inputId,
    ]);
    const selected = await source.listInputCandidates({
      limit: 50,
      sourceId: "linq",
    });
    expect(selected.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      first.inputId,
      second.inputId,
      third.inputId,
    ]);

    const late = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "43",
        dedupeKey: "dedupe_refresh_batch_late",
        eventId: "evt_refresh_batch_late",
        itemId: "item_refresh_batch_late",
        laneSeq: "43",
        messageId: "msg_refresh_batch_late",
        occurredAt: "2026-04-23T00:00:07.000Z",
        receivedAt: "2026-04-23T00:00:08.000Z",
        text: "late input after refresh freeze",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: late.inputId,
      vaultRoot,
    });
    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    expect(source.readSelectedInputIds()).toEqual([
      first.inputId,
      second.inputId,
      third.inputId,
    ]);
  });

  it("discovers input queued after an empty background selection", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const selection = await selectHostedAssistantInputIds({
      mode: "background",
      vaultRoot,
    });
    expect(selection.inputIds).toEqual([]);
    const source = createHostedAssistantInputSource({
      initialPendingInputIds: selection.pendingInputIds,
      pendingInputRefreshMode: "compact",
      selectedInputIds: selection.inputIds,
      vaultRoot,
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_background_refresh_fresh",
        eventId: "evt_background_refresh_fresh",
        itemId: "item_background_refresh_fresh",
        laneSeq: "10",
        messageId: "msg_background_refresh_fresh",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "fresh input during background refresh",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: fresh.inputId,
      vaultRoot,
    });

    await expect(source.refresh()).resolves.toEqual({
      progressed: true,
      reason: "ingested_input",
    });
    expect(source.readSelectedInputIds()).toEqual([fresh.inputId]);
    const candidates = await source.listInputCandidates({ sourceId: "linq" });
    expect(candidates.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      fresh.inputId,
    ]);
  });

  it("keeps selected pending ids visible when the automation cursor already advanced", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const pending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_cursor_advanced_pending",
        eventId: "evt_cursor_advanced_pending",
        itemId: "item_cursor_advanced_pending",
        laneSeq: "10",
        messageId: "msg_cursor_advanced_pending",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "cursor-advanced pending input",
      }),
    });
    const state = {
      autoReply: [{
        channel: "linq",
        eligibleAfter: pending.cursor,
        enabledAt: "2026-04-23T00:00:00.000Z",
      }],
    };

    await expect(hasPendingAssistantAutoReplyInput({
      inputSource: createHostedAssistantInputSource({
        pendingInputRefreshMode: "compact",
        selectedInputIds: [pending.inputId],
        vaultRoot,
      }),
      state,
      vault: vaultRoot,
    })).resolves.toBe(true);

    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "compact",
      selectedInputIds: [pending.inputId],
      vaultRoot,
    });
    const first = await source.listInputCandidates({
      afterCursor: pending.cursor,
      limit: 1,
      sourceId: "linq",
    });
    const second = await source.listInputCandidates({
      afterCursor: first.nextCursor,
      limit: 1,
      sourceId: "linq",
    });

    expect(first.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      pending.inputId,
    ]);
    expect(second.inputs).toEqual([]);
  });
});

describe("selectHostedAssistantInputIds", () => {
  it("does not let older pending input displace fresh foreground input", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const pending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_pending_same",
        eventId: "evt_pending_same",
        itemId: "item_pending_same",
        laneSeq: "10",
        messageId: "msg_pending_same",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "pending same conversation",
      }),
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_same",
        eventId: "evt_fresh_same",
        itemId: "item_fresh_same",
        laneSeq: "20",
        messageId: "msg_fresh_same",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "fresh same conversation",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: pending.inputId,
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [fresh.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([fresh.inputId]);
    expect(selection.pendingInputIds).toEqual([]);
  });

  it("batches rapid same-wake messages in cursor order", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_rapid",
        eventId: "evt_fresh_rapid",
        itemId: "item_fresh_rapid",
        causalSeq: "10",
        laneSeq: "10",
        messageId: "msg_fresh_rapid",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "first rapid message",
      }),
    });
    const laterFirst = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_later_rapid_1",
        eventId: "evt_later_rapid_1",
        itemId: "item_later_rapid_1",
        causalSeq: "11",
        laneSeq: "11",
        messageId: "msg_later_rapid_1",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "second rapid message",
      }),
    });
    const laterSecond = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_later_rapid_2",
        eventId: "evt_later_rapid_2",
        itemId: "item_later_rapid_2",
        causalSeq: "12",
        laneSeq: "12",
        messageId: "msg_later_rapid_2",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        text: "third rapid message",
      }),
    });
    for (const inputId of [fresh.inputId, laterFirst.inputId, laterSecond.inputId]) {
      await enqueueHostedPendingAssistantInputId({
        inputId,
        vaultRoot,
      });
    }

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [
        laterSecond.inputId,
        fresh.inputId,
        laterFirst.inputId,
        laterFirst.inputId,
      ],
      mode: "foreground",
      vaultRoot,
    });
    const selectedSource = createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: selection.inputIds,
      vaultRoot,
    });
    const selectedCandidates = await selectedSource.listInputCandidates({
      limit: 3,
    });

    expect(selection.inputIds).toEqual([
      fresh.inputId,
      laterFirst.inputId,
      laterSecond.inputId,
    ]);
    expect(selectedCandidates.inputs.map((candidate) => candidate.event.inputId))
      .toEqual(selection.inputIds);
    expect(selection.pendingInputIds).toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      fresh.inputId,
      laterFirst.inputId,
      laterSecond.inputId,
    ]);
  });

  it("ends a same-conversation batch at a causal-sequence gap", async () => {
    const vaultRoot = await createTempVault();
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "7",
        dedupeKey: "dedupe_causal_gap_first",
        eventId: "evt_causal_gap_first",
        itemId: "item_causal_gap_first",
        laneSeq: "10",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
      }),
    });
    const afterGap = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "9",
        dedupeKey: "dedupe_causal_gap_second",
        eventId: "evt_causal_gap_second",
        itemId: "item_causal_gap_second",
        laneSeq: "11",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
      }),
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [first.inputId, afterGap.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([first.inputId]);
  });

  it("ends a same-conversation batch at a native reply-anchor change", async () => {
    const vaultRoot = await createTempVault();
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "7",
        dedupeKey: "dedupe_reply_anchor_first",
        eventId: "evt_reply_anchor_first",
        itemId: "item_reply_anchor_first",
        laneSeq: "10",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        replyToMessageId: "assistant_message_1",
      }),
    });
    const nextAnchor = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "8",
        dedupeKey: "dedupe_reply_anchor_second",
        eventId: "evt_reply_anchor_second",
        itemId: "item_reply_anchor_second",
        laneSeq: "11",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        replyToMessageId: "assistant_message_2",
      }),
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [first.inputId, nextAnchor.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([first.inputId]);
  });

  it("ends a causal batch when the conversation changes", async () => {
    const vaultRoot = await createTempVault();
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "7",
        dedupeKey: "dedupe_conversation_boundary_first",
        eventId: "evt_conversation_boundary_first",
        itemId: "item_conversation_boundary_first",
        laneSeq: "10",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        threadId: "thread_1",
      }),
    });
    const nextConversation = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "8",
        dedupeKey: "dedupe_conversation_boundary_second",
        eventId: "evt_conversation_boundary_second",
        itemId: "item_conversation_boundary_second",
        laneSeq: "11",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        threadId: "thread_2",
      }),
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [first.inputId, nextConversation.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([first.inputId]);
  });

  it("ends a causal batch before a legacy unsequenced input", async () => {
    const vaultRoot = await createTempVault();
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "7",
        dedupeKey: "dedupe_legacy_boundary_first",
        eventId: "evt_legacy_boundary_first",
        itemId: "item_legacy_boundary_first",
        laneSeq: "10",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
      }),
    });
    const legacy = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: null,
        dedupeKey: "dedupe_legacy_boundary_second",
        eventId: "evt_legacy_boundary_second",
        itemId: "item_legacy_boundary_second",
        laneSeq: "11",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
      }),
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [first.inputId, legacy.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([first.inputId]);
  });

  it("caps a foreground causal batch at 50 inputs", async () => {
    const vaultRoot = await createTempVault();
    const inputIds: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const sequence = String(index + 1);
      const staged = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          causalSeq: sequence,
          dedupeKey: `dedupe_batch_bound_${sequence}`,
          eventId: `evt_batch_bound_${sequence}`,
          itemId: `item_batch_bound_${sequence}`,
          laneSeq: sequence,
          occurredAt: "2026-04-23T00:00:01.000Z",
          receivedAt: "2026-04-23T00:00:02.000Z",
        }),
      });
      inputIds.push(staged.inputId);
    }

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [...inputIds].reverse(),
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual(inputIds.slice(0, 50));
    expect(selection.inputIds).not.toContain(inputIds[50]);
    await expect(resolveHostedPreferenceCausalSeqForSelectedInput({
      assistantInputIds: inputIds,
      vaultRoot,
    })).resolves.toBeNull();
  });

  it("does not select mismatched pending input during fresh foreground selection", async () => {
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
    await ensureHostedPendingAssistantInputIndex({ vaultRoot });
    const pending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_pending_mismatched",
        eventId: "evt_pending_mismatched",
        itemId: "item_pending_mismatched",
        laneSeq: "10",
        messageId: "msg_pending_mismatched",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        replyTarget: "telegram",
        source: "linq",
        text: "pending mismatched conversation",
      }),
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_mismatched",
        eventId: "evt_fresh_mismatched",
        itemId: "item_fresh_mismatched",
        laneSeq: "20",
        messageId: "msg_fresh_mismatched",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "fresh same conversation",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: pending.inputId,
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [fresh.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection).toEqual({
      freshInputIds: [fresh.inputId],
      inputIds: [fresh.inputId],
      mode: "foreground",
      pendingInputIds: [],
    });
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      pending.inputId,
    ]);
  });

  it("does not let unrelated old pending input delay fresh foreground input", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const pending = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_pending_unrelated",
        eventId: "evt_pending_unrelated",
        itemId: "item_pending_unrelated",
        laneSeq: "10",
        messageId: "msg_pending_unrelated",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "pending unrelated conversation",
        threadId: "thread_old",
      }),
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_unrelated",
        eventId: "evt_fresh_unrelated",
        itemId: "item_fresh_unrelated",
        laneSeq: "20",
        messageId: "msg_fresh_unrelated",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "fresh unrelated conversation",
        threadId: "thread_new",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: pending.inputId,
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [fresh.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([fresh.inputId]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      pending.inputId,
    ]);
  });

  it("does not inspect malformed background state during foreground selection or refresh", async () => {
    const vaultRoot = await createTempVault();
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_with_malformed_background",
        eventId: "evt_fresh_with_malformed_background",
        itemId: "item_fresh_with_malformed_background",
        laneSeq: "10",
        messageId: "msg_fresh_with_malformed_background",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "fresh foreground input",
      }),
    });
    const pendingStatePath = resolveHostedPendingAssistantInputStatePath(vaultRoot);
    await mkdir(path.dirname(pendingStatePath), { recursive: true });
    await writeFile(pendingStatePath, "{not-json", "utf8");

    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).rejects.toThrow();

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [fresh.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([fresh.inputId]);
    expect(selection.pendingInputIds).toEqual([]);

    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: selection.inputIds,
      vaultRoot,
    });
    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    const candidates = await source.listInputCandidates({ sourceId: "linq" });
    expect(candidates.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      fresh.inputId,
    ]);
  });

  it("keeps a fresh direct-message foreground selection bounded to that input", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const baseTime = Date.parse("2026-04-23T00:00:00.000Z");
    const stored = [];
    for (let index = 0; index < 52; index += 1) {
      const event = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          causalSeq: String(index + 1),
          dedupeKey: `dedupe_bounded_foreground_${index}`,
          eventId: `evt_bounded_foreground_${index}`,
          itemId: `item_bounded_foreground_${index}`,
          laneSeq: String(index + 1),
          messageId: `msg_bounded_foreground_${index}`,
          occurredAt: new Date(baseTime + index * 2_000).toISOString(),
          receivedAt: new Date(baseTime + index * 2_000 + 1_000).toISOString(),
          text: `adjacent direct message ${index}`,
        }),
      });
      stored.push(event);
      await enqueueHostedPendingAssistantInputId({
        inputId: event.inputId,
        vaultRoot,
      });
    }

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [stored.at(-1)!.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([stored.at(-1)!.inputId]);
    expect(selection.pendingInputIds).toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toHaveLength(52);
  });

  it("background mode selects bounded oldest non-terminal pending ids", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const oldest = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_oldest",
        eventId: "evt_oldest",
        itemId: "item_oldest",
        causalSeq: "10",
        laneSeq: "10",
        messageId: "msg_oldest",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "oldest pending",
      }),
    });
    const middle = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_middle",
        eventId: "evt_middle",
        itemId: "item_middle",
        causalSeq: "11",
        laneSeq: "20",
        messageId: "msg_middle",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "middle pending",
      }),
    });
    const newest = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_newest",
        eventId: "evt_newest",
        itemId: "item_newest",
        causalSeq: "12",
        laneSeq: "30",
        messageId: "msg_newest",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        text: "newest pending",
      }),
    });
    for (const inputId of [newest.inputId, oldest.inputId, middle.inputId]) {
      await enqueueHostedPendingAssistantInputId({
        inputId,
        vaultRoot,
      });
    }

    const selection = await selectHostedAssistantInputIds({
      limit: 2,
      mode: "background",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([oldest.inputId, middle.inputId]);
    expect(selection.pendingInputIds).toEqual([
      oldest.inputId,
      middle.inputId,
      newest.inputId,
    ]);
  });

});

describe("resolveHostedPersonalizationInputIdForAcceptedInputs", () => {
  it("uses the terminal input id of an exact-successor batch", async () => {
    const vaultRoot = await createTempVault();
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "7",
        dedupeKey: "dedupe_causal_batch_first",
        eventId: "evt_causal_batch_first",
        itemId: "item_causal_batch_first",
        laneSeq: "41",
      }),
    });
    const second = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "8",
        dedupeKey: "dedupe_causal_batch_second",
        eventId: "evt_causal_batch_second",
        itemId: "item_causal_batch_second",
        laneSeq: "42",
      }),
    });

    await expect(resolveHostedPersonalizationInputIdForAcceptedInputs({
      assistantInputIds: [second.inputId, first.inputId],
      vaultRoot,
    })).resolves.toBe(second.inputId);
  });

  it("fails closed instead of crossing a causal-sequence gap", async () => {
    const vaultRoot = await createTempVault();
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "7",
        dedupeKey: "dedupe_causal_batch_gap_first",
        eventId: "evt_causal_batch_gap_first",
        itemId: "item_causal_batch_gap_first",
        laneSeq: "41",
      }),
    });
    const afterGap = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        causalSeq: "9",
        dedupeKey: "dedupe_causal_batch_gap_second",
        eventId: "evt_causal_batch_gap_second",
        itemId: "item_causal_batch_gap_second",
        laneSeq: "42",
      }),
    });

    await expect(resolveHostedPersonalizationInputIdForAcceptedInputs({
      assistantInputIds: [first.inputId, afterGap.inputId],
      vaultRoot,
    })).resolves.toBeNull();
  });
});

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-source-"));
  tempRoots.push(root);
  return path.join(root, "vault");
}

async function enableLinqAutoReply(vaultRoot: string): Promise<void> {
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel: "linq",
      eligibleAfter: null,
      enabledAt: "2026-04-23T00:00:00.000Z",
    }],
    updatedAt: "2026-04-23T00:00:00.000Z",
    version: 1,
  });
  await ensureHostedPendingAssistantInputIndex({ vaultRoot });
}

function createAssistantInputEvent(input: {
  causalSeq?: string | null;
  dedupeKey?: string;
  eventId?: string;
  itemId?: string;
  laneSeq?: string;
  messageId?: string;
  occurredAt?: string;
  receivedAt?: string;
  replyToMessageId?: string | null;
  replyTarget?: string | null;
  routeAuthority?: boolean;
  source?: string;
  text?: string;
  threadId?: string;
  threadIsDirect?: boolean;
} = {}) {
  const source = input.source ?? "linq";
  const threadId = input.threadId ?? "thread_1";
  const text = input.text ?? "selected conversation note";
  return {
    content: {
      text,
      transcriptText: text,
      userMessageContent: [
        {
          text,
          type: "text" as const,
        },
      ],
    },
    conversation: {
      accountId: "acct_1",
      actorId: "actor_1",
      actorIsSelf: false,
      source,
      threadId,
      threadIsDirect: input.threadIsDirect ?? true,
    },
    occurredAt: input.occurredAt ?? "2026-04-23T00:00:02.000Z",
    receivedAt: input.receivedAt ?? "2026-04-23T00:00:03.000Z",
    replyTarget: input.replyTarget === null
      ? null
      : {
          channel: input.replyTarget ?? source,
          messageId: input.messageId ?? "msg_selected",
          threadId,
        },
    sourceMetadata: source === "linq"
      ? {
          externalThreadRouteAuthorityPresent: input.routeAuthority ?? false,
          kind: "linq" as const,
          partCount: 1,
          reactionEligible: false,
          replyToMessageId: input.replyToMessageId ?? null,
          service: null,
        }
      : null,
    sourceRef: {
      ...(input.causalSeq === undefined ? {} : { causalSeq: input.causalSeq }),
      dedupeKey: input.dedupeKey ?? "dedupe_selected",
      eventId: input.eventId ?? "evt_selected",
      itemId: input.itemId ?? "item_selected",
      kind: "hosted-mailbox" as const,
      lane: "conversation" as const,
      laneSeq: input.laneSeq ?? "42",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      payloadSource: "inline" as const,
      source: "hosted-mailbox" as const,
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}
