import { access, mkdtemp, rm } from "node:fs/promises";
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
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  readHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  resolveHostedOldestPendingAssistantInputAt,
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
  it("returns an immediate wake when the existing pending index has input", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });
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

  it("returns null when the existing pending index is backfilled and empty", async () => {
    const vaultRoot = await createTempVault();
    await expect(compactHostedPendingAssistantInputIds({ vaultRoot })).resolves.toEqual([]);

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-06-02T12:02:00.000Z",
      vaultRoot,
    })).resolves.toBeNull();
  });

  it("keeps foreground inspection read-only before background wake resolution compacts stale indexed input", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent(),
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [],
      updatedAt: "2026-06-02T12:01:00.000Z",
      version: 1,
    });

    await expect(resolveHostedPendingAssistantInputWakeAt({
      inspectOnly: true,
      now: () => "2026-06-02T12:02:00.000Z",
      vaultRoot,
    })).resolves.toBe("2026-06-02T12:02:30.000Z");
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([event.inputId]);
    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-06-02T12:02:30.000Z",
      vaultRoot,
    })).resolves.toBeNull();
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([]);
  });

  it("backfills a missing rollout index before scheduling background work", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent(),
    });

    await expect(resolveHostedPendingAssistantInputWakeAt({
      now: () => "2026-06-02T12:02:00.000Z",
      vaultRoot,
    })).resolves.toBe("2026-06-02T12:02:00.000Z");
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toContain(event.inputId);
  });

  it("schedules maintenance for a missing index without backfilling in an inspect-only probe", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });

    await expect(resolveHostedPendingAssistantInputWakeAt({
      inspectOnly: true,
      now: () => "2026-06-02T12:02:00.000Z",
      vaultRoot,
    })).resolves.toBe("2026-06-02T12:02:30.000Z");
    await expect(access(resolveHostedPendingAssistantInputStatePath(vaultRoot)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("resolveHostedOldestPendingAssistantInputAt", () => {
  it("uses the oldest pending input received time", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });
    const event = await upsertAssistantInputEvent({
      event: createAssistantInputEvent(),
      vault: vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    await expect(resolveHostedOldestPendingAssistantInputAt({ vaultRoot }))
      .resolves.toBe("2026-04-23T00:00:03.000Z");
  });

  it("falls back to the oldest pending input occurrence time", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });
    const { receivedAt: _receivedAt, ...eventWithoutReceivedAt } =
      createAssistantInputEvent();
    const event = await upsertAssistantInputEvent({
      event: eventWithoutReceivedAt,
      vault: vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    await expect(resolveHostedOldestPendingAssistantInputAt({ vaultRoot }))
      .resolves.toBe("2026-04-23T00:00:02.000Z");
  });

  it("compacts stale indexed residue before resolving the oldest live input", async () => {
    const vaultRoot = await createTempVault();
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: "2026-06-02T12:00:00.000Z",
      }],
      updatedAt: "2026-06-02T12:00:00.000Z",
      version: 1,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: "ain_99999999999999999999999999999999",
      vaultRoot,
    });
    const event = await upsertAssistantInputEvent({
      event: createAssistantInputEvent(),
      vault: vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot,
    });

    await expect(resolveHostedOldestPendingAssistantInputAt({ vaultRoot }))
      .resolves.toBe("2026-04-23T00:00:03.000Z");
    await expect(readHostedPendingAssistantInputIds({ vaultRoot }))
      .resolves.toEqual([event.inputId]);
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
