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
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node/assistant-state-fs";

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
const TERMINAL_EVIDENCE_SCHEMA = "murph.assistant-auto-reply-terminal-evidence.v1";

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
      selectedInputIds: [older.inputId, newer.inputId, unrelated.inputId],
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

  it("keeps the hosted channel page as the bounded active-turn frontier", async () => {
    const vaultRoot = await createTempVault();
    const persistInput = async (input: {
      conversationThreadId: string;
      index: number;
      replyThreadId: string;
      text: string;
    }) => {
      const occurredAt = new Date(
        Date.parse("2026-04-23T00:00:00.000Z") + input.index * 1_000,
      ).toISOString();
      return upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createAssistantInputEvent({
          actorId: null,
          dedupeKey: `dedupe_hosted_frontier_${input.index}`,
          eventId: `event_hosted_frontier_${input.index}`,
          itemId: `item_hosted_frontier_${input.index}`,
          laneSeq: String(input.index),
          messageId: `telegram_message_${input.index}`,
          occurredAt,
          receivedAt: occurredAt,
          replyThreadId: input.replyThreadId,
          source: "telegram",
          text: input.text,
          threadId: input.conversationThreadId,
        }),
      });
    };
    const unrelated = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        persistInput({
          conversationThreadId: `telegram_other_conversation_${index + 1}`,
          index: index + 1,
          replyThreadId: `telegram_other_route_${index + 1}`,
          text: `unrelated Telegram input ${index + 1}`,
        })
      ),
    );
    const fallback = await persistInput({
      conversationThreadId: "telegram_projection_drift",
      index: 101,
      replyThreadId: "telegram_current_thread",
      text: "earlier route fallback input",
    });
    const strict = await persistInput({
      conversationThreadId: "telegram_current_thread",
      index: 102,
      replyThreadId: "telegram_current_thread",
      text: "later strict conversation input",
    });
    const source = createHostedAssistantInputSource({
      selectedInputIds: [
        ...unrelated.map((candidate) => candidate.inputId),
        fallback.inputId,
        strict.inputId,
      ],
      vaultRoot,
    });
    if (!strict.conversation) {
      throw new Error("expected strict hosted conversation");
    }

    const channelPage = await source.listInputCandidates({
      limit: 100,
      purpose: "active-turn",
      sourceId: "telegram",
    });
    const strictPage = await source.listNewConversationInputs({
      conversation: strict.conversation,
      limit: 100,
    });

    expect(channelPage.inputs).toHaveLength(100);
    expect(channelPage.inputs.at(-1)?.event.inputId).toBe(
      unrelated.at(-1)?.inputId,
    );
    expect(channelPage.inputs.map((candidate) => candidate.event.inputId))
      .not.toContain(fallback.inputId);
    expect(channelPage.inputs.map((candidate) => candidate.event.inputId))
      .not.toContain(strict.inputId);
    expect(strictPage.inputs.map((candidate) => candidate.event.inputId))
      .toEqual([strict.inputId]);
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
        text: "selected continuation message",
      }),
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: selected.inputId,
      mailboxItemId: "mailbox_item_runtime_resume_001",
      vault: vaultRoot,
    });
    const source = createHostedAssistantInputSource({
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
  });

  it("keeps one causal discovery input while active turns see the pending frontier", async () => {
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
      initialActiveTurnInputIds: [oldUnrelated.inputId, fresh.inputId],
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
      late.inputId,
    ]);
    const discovered = await source.listInputCandidates({
      purpose: "discovery",
      sourceId: "linq",
    });
    const activeTurnFrontier = await source.listInputCandidates({
      purpose: "active-turn",
      sourceId: "linq",
    });
    const lateConversationInputs = await source.listNewConversationInputs({
      afterCursor: fresh.cursor,
      conversation: fresh.conversation!,
    });

    expect(discovered.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      fresh.inputId,
    ]);
    expect(activeTurnFrontier.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      oldUnrelated.inputId,
      fresh.inputId,
      late.inputId,
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

  it("bounds event and mailbox hydration to the requested candidate page", async () => {
    const vaultRoot = await createTempVault();
    const oldUnrelated = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_bounded_old_unrelated",
        eventId: "evt_bounded_old_unrelated",
        itemId: "item_bounded_old_unrelated",
        laneSeq: "10",
        messageId: "msg_bounded_old_unrelated",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "old unrelated pending",
        threadId: "thread_old",
      }),
    });
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_bounded_fresh",
        eventId: "evt_bounded_fresh",
        itemId: "item_bounded_fresh",
        laneSeq: "20",
        messageId: "msg_bounded_fresh",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "fresh selected input",
      }),
    });
    const readEventSpy = vi.spyOn(assistantEngine, "readAssistantInputEvent");
    const readMailboxSpy = vi.spyOn(
      assistantEngine,
      "readHostedMailboxAssistantInputItems",
    );
    const source = createHostedAssistantInputSource({
      initialActiveTurnInputIds: [oldUnrelated.inputId, fresh.inputId],
      selectedInputIds: [fresh.inputId],
      vaultRoot,
    });

    const discovered = await source.listInputCandidates({
      limit: 1,
      purpose: "discovery",
      sourceId: "linq",
    });

    expect(discovered.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      fresh.inputId,
    ]);
    expect(readEventSpy).toHaveBeenCalledTimes(1);
    expect(readEventSpy).toHaveBeenCalledWith({
      inputId: fresh.inputId,
      vault: vaultRoot,
    });
    expect(readMailboxSpy).toHaveBeenCalledTimes(1);
    expect(readMailboxSpy).toHaveBeenCalledWith({
      inputIds: [fresh.inputId],
      vault: vaultRoot,
    });

    readEventSpy.mockClear();
    readMailboxSpy.mockClear();
    const activeTurnSource = createHostedAssistantInputSource({
      initialActiveTurnInputIds: [oldUnrelated.inputId, fresh.inputId],
      selectedInputIds: [fresh.inputId],
      vaultRoot,
    });
    const activeTurn = await activeTurnSource.listInputCandidates({
      limit: 1,
      purpose: "active-turn",
      sourceId: "linq",
    });

    expect(activeTurn.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      oldUnrelated.inputId,
    ]);
    expect(readEventSpy).toHaveBeenCalledTimes(1);
    expect(readMailboxSpy).toHaveBeenCalledWith({
      inputIds: [oldUnrelated.inputId],
      vault: vaultRoot,
    });
  });

  it.each([
    {
      barrierActorId: null,
      barrierConversationThreadId: "telegram_projection_drift",
      initialActorId: null,
      name: "same-route Telegram projection drift",
      source: "telegram",
      threadIsDirect: true,
    },
    {
      barrierActorId: "actor_bob",
      barrierConversationThreadId: "linq_group_current",
      initialActorId: "actor_alice",
      name: "non-direct Linq sender barrier",
      source: "linq",
      threadIsDirect: false,
    },
  ])("keeps an older $name outside a fresh active turn", async (scenario) => {
    const vaultRoot = await createTempVault();
    await enableAutoReply(vaultRoot, scenario.source);
    const initial = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        actorId: scenario.initialActorId,
        dedupeKey: `dedupe_${scenario.source}_frontier_initial`,
        eventId: `event_${scenario.source}_frontier_initial`,
        itemId: `item_${scenario.source}_frontier_initial`,
        laneSeq: "10",
        messageId: `${scenario.source}_frontier_initial_message`,
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        replyThreadId: `${scenario.source}_route_current`,
        source: scenario.source,
        text: "initial foreground input",
        threadId: `${scenario.source}_group_current`,
        threadIsDirect: scenario.threadIsDirect,
      }),
    });
    const barrier = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        actorId: scenario.barrierActorId,
        dedupeKey: `dedupe_${scenario.source}_frontier_barrier`,
        eventId: `event_${scenario.source}_frontier_barrier`,
        itemId: `item_${scenario.source}_frontier_barrier`,
        laneSeq: "20",
        messageId: `${scenario.source}_frontier_barrier_message`,
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        replyThreadId: `${scenario.source}_route_current`,
        source: scenario.source,
        text: "older pending barrier",
        threadId: scenario.barrierConversationThreadId,
        threadIsDirect: scenario.threadIsDirect,
      }),
    });
    for (const inputId of [initial.inputId, barrier.inputId]) {
      await enqueueHostedPendingAssistantInputId({ inputId, vaultRoot });
    }
    const selection = await selectHostedAssistantInputIds({
      freshAssistantInputIds: [initial.inputId],
      mode: "foreground",
      vaultRoot,
    });
    expect(selection.inputIds).toEqual([initial.inputId]);
    expect(selection.activeTurnInputIds).toEqual([initial.inputId]);
    const source = createHostedAssistantInputSource({
      initialActiveTurnInputIds: selection.activeTurnInputIds,
      pendingInputRefreshMode: "existing",
      selectedInputIds: selection.inputIds,
      vaultRoot,
    });
    const laterStrict = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        actorId: scenario.initialActorId,
        dedupeKey: `dedupe_${scenario.source}_frontier_later`,
        eventId: `event_${scenario.source}_frontier_later`,
        itemId: `item_${scenario.source}_frontier_later`,
        laneSeq: "30",
        messageId: `${scenario.source}_frontier_later_message`,
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        replyThreadId: `${scenario.source}_route_current`,
        source: scenario.source,
        text: "later strict input",
        threadId: `${scenario.source}_group_current`,
        threadIsDirect: scenario.threadIsDirect,
      }),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: laterStrict.inputId,
      vaultRoot,
    });
    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    if (!initial.conversation) {
      throw new Error("expected initial hosted conversation");
    }

    const channelPage = await source.listInputCandidates({
      afterCursor: initial.cursor,
      knownInputIds: [initial.inputId],
      purpose: "active-turn",
      sourceId: scenario.source,
    });
    const strictPage = await source.listNewConversationInputs({
      afterCursor: initial.cursor,
      conversation: initial.conversation,
      knownInputIds: [initial.inputId],
    });

    expect(channelPage.inputs.map((candidate) => candidate.event.inputId))
      .toEqual([barrier.inputId, laterStrict.inputId]);
    expect(channelPage.nextCursor).toEqual(laterStrict.cursor);
    expect(strictPage.inputs.map((candidate) => candidate.event.inputId))
      .toEqual([]);
  });

  it("does not fold late existing pending ids into an active causal turn", async () => {
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
    const fresh = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_refresh_fresh",
        eventId: "evt_refresh_fresh",
        itemId: "item_refresh_fresh",
        laneSeq: "10",
        messageId: "msg_refresh_fresh",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "fresh active input",
      }),
    });
    const source = createHostedAssistantInputSource({
      initialActiveTurnInputIds: [],
      pendingInputRefreshMode: "existing",
      selectedInputIds: [fresh.inputId],
      vaultRoot,
    });
    const processable = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_refresh_processable",
        eventId: "evt_refresh_processable",
        itemId: "item_refresh_processable",
        laneSeq: "20",
        messageId: "msg_refresh_processable",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "late processable input",
      }),
    });
    const mismatched = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_refresh_mismatched",
        eventId: "evt_refresh_mismatched",
        itemId: "item_refresh_mismatched",
        laneSeq: "30",
        messageId: "msg_refresh_mismatched",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        replyTarget: "telegram",
        source: "linq",
        text: "late mismatched input",
      }),
    });
    for (const inputId of [processable.inputId, mismatched.inputId]) {
      await enqueueHostedPendingAssistantInputId({
        inputId,
        vaultRoot,
      });
    }

    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    const lateConversationInputs = await source.listNewConversationInputs({
      afterCursor: fresh.cursor,
      conversation: fresh.conversation!,
    });

    expect(lateConversationInputs.inputs.map((candidate) => candidate.event.inputId))
      .toEqual([]);
    expect(source.readObservedInputIds()).toEqual([
      fresh.inputId,
      processable.inputId,
      mismatched.inputId,
    ]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      processable.inputId,
      mismatched.inputId,
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
        selectedInputIds: [pending.inputId],
        vaultRoot,
      }),
      state,
      vault: vaultRoot,
    })).resolves.toBe(true);

    const source = createHostedAssistantInputSource({
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
    expect(selection.pendingInputIds).toEqual([pending.inputId]);
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
    expect(selection.pendingInputIds).toEqual([
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
      activeTurnInputIds: [fresh.inputId],
      freshInputIds: [fresh.inputId],
      inputIds: [fresh.inputId],
      mode: "foreground",
      pendingInputIds: [pending.inputId],
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

    expect(selection.inputIds).toEqual([fresh.inputId]);
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

    expect(selection.inputIds).toEqual([oldest.inputId]);
    expect(selection.pendingInputIds).toEqual([
      oldest.inputId,
      middle.inputId,
      newest.inputId,
    ]);
  });

  it("background mode skips terminal route proof without dropping it", async () => {
    const vaultRoot = await createTempVault();
    await enableLinqAutoReply(vaultRoot);
    const terminalProof = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_terminal_route_proof",
        eventId: "evt_terminal_route_proof",
        itemId: "item_terminal_route_proof",
        laneSeq: "10",
        messageId: "msg_terminal_route_proof",
        occurredAt: "2026-04-23T00:00:01.000Z",
        previousHomeThreadId: "thread_previous",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "terminal route proof",
      }),
    });
    const replyable = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_replyable_after_proof",
        eventId: "evt_replyable_after_proof",
        itemId: "item_replyable_after_proof",
        laneSeq: "20",
        messageId: "msg_replyable_after_proof",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "replyable after terminal proof",
      }),
    });
    await writeTerminalEvidence({
      evidenceId: terminalProof.inputId,
      groupInputIds: [terminalProof.inputId],
      vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: terminalProof.inputId,
      routeProof: true,
      vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: replyable.inputId,
      vaultRoot,
    });

    const selection = await selectHostedAssistantInputIds({
      mode: "background",
      vaultRoot,
    });

    expect(selection.inputIds).toEqual([replyable.inputId]);
    expect(selection.pendingInputIds).toEqual([
      terminalProof.inputId,
      replyable.inputId,
    ]);
    await expect(readHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([
      terminalProof.inputId,
      replyable.inputId,
    ]);
  });
});

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-source-"));
  tempRoots.push(root);
  return path.join(root, "vault");
}

async function enableLinqAutoReply(vaultRoot: string): Promise<void> {
  await enableAutoReply(vaultRoot, "linq");
}

async function enableAutoReply(
  vaultRoot: string,
  channel: string,
): Promise<void> {
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel,
      eligibleAfter: null,
      enabledAt: "2026-04-23T00:00:00.000Z",
    }],
    updatedAt: "2026-04-23T00:00:00.000Z",
    version: 1,
  });
  await ensureHostedPendingAssistantInputIndex({ vaultRoot });
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
  actorId?: string | null;
  dedupeKey?: string;
  eventId?: string;
  itemId?: string;
  laneSeq?: string;
  messageId?: string;
  occurredAt?: string;
  receivedAt?: string;
  replyThreadId?: string;
  replyTarget?: string | null;
  previousHomeThreadId?: string;
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
      actorId: input.actorId === undefined ? "actor_1" : input.actorId,
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
          threadId: input.replyThreadId ?? threadId,
        },
    sourceMetadata: source === "linq"
      ? {
          externalThreadRouteAuthorityPresent: false,
          kind: "linq" as const,
          partCount: 1,
          previousHomeThreadId: input.previousHomeThreadId ?? null,
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
