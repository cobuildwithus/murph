import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as assistantEngine from "@murphai/assistant-engine";
import {
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

  it("refreshes newly enqueued pending ids without admitting old unselected pending ids", async () => {
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
      progressed: true,
      reason: "ingested_input",
    });
    const allSelected = await source.listInputCandidates({
      sourceId: "linq",
    });
    const lateConversationInputs = await source.listNewConversationInputs({
      afterCursor: fresh.cursor,
      conversation: fresh.conversation!,
    });

    expect(allSelected.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      fresh.inputId,
      late.inputId,
    ]);
    expect(lateConversationInputs.inputs.map((candidate) => candidate.event.inputId))
      .toEqual([late.inputId]);
    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    expect(listSpy).not.toHaveBeenCalled();
  });
});

describe("selectHostedAssistantInputIds", () => {
  it("selects older pending same-conversation input with fresh foreground input", async () => {
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

    expect(selection.inputIds).toEqual([pending.inputId, fresh.inputId]);
    expect(selection.pendingInputIds).toEqual([pending.inputId]);
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

  it("does not compact or materialize old pending backlog before fresh foreground input", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    await enqueueHostedPendingAssistantInputId({
      inputId: "ain_0000000000000000000000000000aaa1",
      vaultRoot,
    });
    const oldSameConversation = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_old_same_before_large_backlog",
        eventId: "evt_old_same_before_large_backlog",
        itemId: "item_old_same_before_large_backlog",
        laneSeq: "9",
        messageId: "msg_old_same_before_large_backlog",
        occurredAt: "2026-04-23T00:00:00.000Z",
        receivedAt: "2026-04-23T00:00:01.000Z",
        text: "old same conversation pending",
        threadId: "thread_fresh",
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: oldSameConversation.inputId,
      vaultRoot,
    });
    for (let index = 0; index < 51; index += 1) {
      const oldUnrelated = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          dedupeKey: `dedupe_old_unrelated_${index}`,
          eventId: `evt_old_unrelated_${index}`,
          itemId: `item_old_unrelated_${index}`,
          laneSeq: String(10 + index),
          messageId: `msg_old_unrelated_${index}`,
          occurredAt: "2026-04-23T00:00:01.000Z",
          receivedAt: "2026-04-23T00:00:02.000Z",
          text: "old unrelated pending",
          threadId: `thread_old_${index}`,
        }),
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: oldUnrelated.inputId,
        vaultRoot,
      });
    }
    await enqueueHostedPendingAssistantInputId({
      inputId: "ain_0000000000000000000000000000aaa2",
      vaultRoot,
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_fresh_after_large_backlog",
        eventId: "evt_fresh_after_large_backlog",
        itemId: "item_fresh_after_large_backlog",
        laneSeq: "100",
        messageId: "msg_fresh_after_large_backlog",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "fresh foreground input",
        threadId: "thread_fresh",
      }),
    });

    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [fresh.inputId],
      mode: "foreground",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([oldSameConversation.inputId, fresh.inputId]);
    expect(selection.pendingInputIds[0]).toBe("ain_0000000000000000000000000000aaa1");
    expect(selection.pendingInputIds.at(-1)).toBe("ain_0000000000000000000000000000aaa2");
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves
      .toContain("ain_0000000000000000000000000000aaa1");
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

    expect(selection.inputIds).toEqual([oldest.inputId, middle.inputId]);
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
  source?: string;
  text?: string;
  threadId?: string;
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
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt ?? "2026-04-23T00:00:02.000Z",
    receivedAt: input.receivedAt ?? "2026-04-23T00:00:03.000Z",
    replyTarget: {
      channel: source,
      messageId: input.messageId ?? "msg_selected",
      threadId,
    },
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
