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

  it("defers newly enqueued pending ids once the turn has a causal input", async () => {
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

  it("leaves newer pending same-conversation inputs for later turns", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_rapid",
        eventId: "evt_fresh_rapid",
        itemId: "item_fresh_rapid",
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
      freshAssistantInputIds: [fresh.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([fresh.inputId]);
    expect(selection.pendingInputIds).toEqual([]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      fresh.inputId,
      laterFirst.inputId,
      laterSecond.inputId,
    ]);
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

  it("background mode selects bounded oldest non-terminal pending ids", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const oldest = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_oldest",
        eventId: "evt_oldest",
        itemId: "item_oldest",
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

    expect(selection.inputIds).toEqual([oldest.inputId]);
    expect(selection.pendingInputIds).toEqual([
      oldest.inputId,
      middle.inputId,
      newest.inputId,
    ]);
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
  dedupeKey?: string;
  eventId?: string;
  itemId?: string;
  laneSeq?: string;
  messageId?: string;
  occurredAt?: string;
  receivedAt?: string;
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
          replyToMessageId: null,
          service: null,
        }
      : null,
    sourceRef: {
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
