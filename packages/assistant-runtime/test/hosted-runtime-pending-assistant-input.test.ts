import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";

import {
  enqueueHostedPendingAssistantInputId,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "../src/hosted-runtime/pending-assistant-input.ts";

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

describe("resolveHostedPendingAssistantInputWakeAt", () => {
  it("returns an immediate wake when the compacted pending index has input", async () => {
    const vaultRoot = await createTempVault();
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent(),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-06-02T12:02:00.000Z",
      vaultRoot,
    })).resolves.toBe("2026-06-02T12:02:00.000Z");
  });

  it("returns null when the compacted pending index is empty", async () => {
    const vaultRoot = await createTempVault();

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-06-02T12:02:00.000Z",
      vaultRoot,
    })).resolves.toBeNull();
  });
});

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-pending-wake-"));
  tempRoots.push(root);
  return path.join(root, "vault");
}

function createAssistantInputEvent() {
  const text = "pending wake note";
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
    occurredAt: "2026-04-23T00:00:02.000Z",
    receivedAt: "2026-04-23T00:00:03.000Z",
    replyTarget: {
      channel: "linq",
      messageId: "msg_pending",
      threadId: "thread_1",
    },
    sourceRef: {
      dedupeKey: "dedupe_pending",
      eventId: "evt_pending",
      itemId: "item_pending",
      kind: "hosted-mailbox" as const,
      lane: "conversation" as const,
      laneSeq: "42",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      payloadSource: "inline" as const,
      source: "hosted-mailbox" as const,
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}
