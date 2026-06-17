import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node/assistant-state-fs";

import {
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  readHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
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
  });

  it("ensures a missing rollout index without backfilling old inputs", async () => {
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

  it("drops indexed inputs that are no longer current auto-reply candidates", async () => {
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
  dedupeKey: string;
  eventId: string;
  itemId: string;
  laneSeq: string;
  messageId: string;
  occurredAt: string;
  receivedAt: string;
  replyTarget?: "linq" | null;
  text: string;
}) {
  const replyTarget = input.replyTarget === null
    ? null
    : {
        channel: "linq" as const,
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
      source: "linq",
      threadId: "thread_1",
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    replyTarget,
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
