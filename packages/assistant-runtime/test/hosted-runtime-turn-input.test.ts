import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";

import {
  createHostedAssistantInputSource,
} from "../src/hosted-runtime/turn-input.ts";

const tempRoots: string[] = [];

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

describe("createHostedAssistantInputSource", () => {
  it("uses the store-backed source for hosted active-turn input", async () => {
    const vaultRoot = await createTempVault();
    const source = createHostedAssistantInputSource({
      vaultRoot,
    });

    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    await expect(source.listInputCandidates({ sourceId: "linq" })).resolves.toEqual({
      inputs: [],
      nextCursor: null,
    });
  });

  it("reads conversation input that the foreground mailbox import staged", async () => {
    const vaultRoot = await createTempVault();
    const staged = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent(),
    });
    const source = createHostedAssistantInputSource({
      vaultRoot,
    });

    await expect(source.refresh()).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    const listed = await source.listInputCandidates({
      sourceId: "linq",
    });
    const conversation = await source.listNewConversationInputs({
      conversation: staged.conversation!,
    });

    expect(listed.inputs).toHaveLength(1);
    expect(listed.inputs[0]).toMatchObject({
      acceptedInput: {
        source: "assistant-input",
        contentRef: {
          kind: "assistant-input-event",
        },
      },
      event: {
        source: "linq",
        text: "late same-conversation note",
      },
      projection: {
        captureId: null,
        status: "not_attempted",
      },
    });
    expect(conversation.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      staged.inputId,
    ]);
  });

  it("does not let newer preferred input skip older unprocessed input", async () => {
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
        text: "older unprocessed note",
      }),
    });
    const preferred = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_preferred",
        eventId: "evt_preferred",
        itemId: "item_preferred",
        laneSeq: "20",
        messageId: "msg_preferred",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "newer preferred note",
      }),
    });
    const source = createHostedAssistantInputSource({
      preferredInputIds: [preferred.inputId],
      vaultRoot,
    });

    const fullPage = await source.listInputCandidates({
      limit: 2,
      sourceId: "linq",
    });
    const first = await source.listInputCandidates({
      limit: 1,
      sourceId: "linq",
    });
    const second = await source.listInputCandidates({
      afterCursor: first.nextCursor,
      limit: 1,
      sourceId: "linq",
    });
    const afterPreferred = await source.listInputCandidates({
      afterCursor: preferred.cursor,
      limit: 1,
      sourceId: "linq",
    });

    expect(fullPage.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      older.inputId,
      preferred.inputId,
    ]);
    expect(fullPage.nextCursor).toEqual(preferred.cursor);
    expect(first.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      older.inputId,
    ]);
    expect(first.nextCursor).toEqual(older.cursor);
    expect(second.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      preferred.inputId,
    ]);
    expect(second.nextCursor).toEqual(preferred.cursor);
    expect(afterPreferred.inputs).toEqual([]);
    expect(afterPreferred.nextCursor).toEqual(preferred.cursor);
  });

  it("can coalesce foreground replay prompt content without hiding terminal candidates", async () => {
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
        text: "older replayed note",
      }),
    });
    const latest = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_latest",
        eventId: "evt_latest",
        itemId: "item_latest",
        laneSeq: "20",
        messageId: "msg_latest",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "latest foreground note",
      }),
    });
    const source = createHostedAssistantInputSource({
      foregroundReplayInputIds: [older.inputId, latest.inputId],
      foregroundReplayPromptInputIds: [latest.inputId],
      preferredInputIds: [latest.inputId],
      vaultRoot,
    });

    const listed = await source.listInputCandidates({
      limit: 2,
      sourceId: "linq",
    });
    const onlyLatest = await source.listInputCandidates({
      limit: 1,
      sourceId: "linq",
    });
    const afterLatest = await source.listInputCandidates({
      afterCursor: latest.cursor,
      limit: 2,
      sourceId: "linq",
    });

    expect(listed.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      older.inputId,
      latest.inputId,
    ]);
    expect(listed.inputs[0]?.event.text).toBeNull();
    expect(listed.inputs[0]?.event.transcriptText).toBeNull();
    expect(listed.inputs[0]?.event.userMessageContent).toBeNull();
    expect(listed.inputs[1]?.event.text).toBe("latest foreground note");
    expect(onlyLatest.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      latest.inputId,
    ]);
    expect(listed.nextCursor).toEqual(latest.cursor);
    expect(afterLatest.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      latest.inputId,
    ]);
    expect(afterLatest.inputs[0]?.event.text).toBe("latest foreground note");
    expect(afterLatest.nextCursor).toEqual(latest.cursor);
  });

  it("reserves foreground replay slots when old base candidates would fill the scan page", async () => {
    const vaultRoot = await createTempVault();
    const older = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_oldest_base",
        eventId: "evt_oldest_base",
        itemId: "item_oldest_base",
        laneSeq: "10",
        messageId: "msg_oldest_base",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "oldest base note",
      }),
    });
    const recentBase = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_recent_base",
        eventId: "evt_recent_base",
        itemId: "item_recent_base",
        laneSeq: "20",
        messageId: "msg_recent_base",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "recent base note",
      }),
    });
    const replay = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_latest_replay_reserved",
        eventId: "evt_latest_replay_reserved",
        itemId: "item_latest_replay_reserved",
        laneSeq: "30",
        messageId: "msg_latest_replay_reserved",
        occurredAt: "2026-04-23T00:00:05.000Z",
        receivedAt: "2026-04-23T00:00:06.000Z",
        text: "latest replay note",
      }),
    });
    const source = createHostedAssistantInputSource({
      foregroundReplayInputIds: [replay.inputId],
      foregroundReplayPromptInputIds: [replay.inputId],
      vaultRoot,
    });

    const listed = await source.listInputCandidates({
      limit: 2,
      sourceId: "linq",
    });
    const replayOnly = await source.listInputCandidates({
      limit: 1,
      sourceId: "linq",
    });

    expect(listed.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      recentBase.inputId,
      replay.inputId,
    ]);
    expect(replayOnly.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      replay.inputId,
    ]);
    expect(listed.inputs.map((candidate) => candidate.event.inputId))
      .not.toContain(older.inputId);
    expect(listed.nextCursor).toEqual(replay.cursor);
  });
});

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-source-"));
  tempRoots.push(root);
  return path.join(root, "vault");
}

function createAssistantInputEvent(input: {
  dedupeKey?: string;
  eventId?: string;
  itemId?: string;
  laneSeq?: string;
  messageId?: string;
  occurredAt?: string;
  receivedAt?: string;
  text?: string;
} = {}) {
  const text = input.text ?? "late same-conversation note";
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
      source: "linq",
      threadId: "thread_1",
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt ?? "2026-04-23T00:00:02.000Z",
    receivedAt: input.receivedAt ?? "2026-04-23T00:00:03.000Z",
    replyTarget: {
      channel: "linq",
      messageId: input.messageId ?? "msg_late",
      threadId: "thread_1",
    },
    sourceRef: {
      dedupeKey: input.dedupeKey ?? "dedupe_late",
      eventId: input.eventId ?? "evt_late",
      itemId: input.itemId ?? "item_late",
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
