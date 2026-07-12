import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assistantInputCandidateFromStoredEvent,
  hasCompleteAssistantAutoReplyTerminalEvidence,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterHostedAssistantInputBatchByLinqRouteAuthority,
} from "../src/hosted-runtime/linq-input-authority.ts";

const temporaryVaults: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryVaults.splice(0).map((vault) =>
    rm(vault, { force: true, recursive: true })
  ));
});

describe("hosted Linq input authority", () => {
  it("writes terminal suppression and excludes a staged personal input after route revocation", async () => {
    const vaultRoot = await createTemporaryVault();
    const event = await createStoredLinqInput({ vaultRoot });
    const assertAuthority = vi.fn().mockRejectedValue({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
    });

    const filtered = await filterHostedAssistantInputBatchByLinqRouteAuthority({
      batch: {
        inputs: [assistantInputCandidateFromStoredEvent(event)],
        nextCursor: event.cursor,
      },
      effectsPort: {
        assertLinqRecentInboundEngagement: assertAuthority,
      },
      userId: "member_personal",
      vaultRoot,
    });

    expect(filtered.inputs).toEqual([]);
    expect(assertAuthority).toHaveBeenCalledWith({
      authorityCheckOnly: true,
      idempotencyKey: null,
      replyToMessageId: "message_group",
      routeAuthority: null,
      target: "chat_group",
      targetKind: "thread",
    }, {
      signal: undefined,
    });
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      inputId: event.inputId,
      vault: vaultRoot,
    })).resolves.toBe(true);
  });

  it("admits a staged group input only with current container route authority", async () => {
    const vaultRoot = await createTemporaryVault();
    const event = await createStoredLinqInput({
      externalThreadRouteAuthorityPresent: true,
      vaultRoot,
    });
    const assertAuthority = vi.fn().mockResolvedValue({});

    const filtered = await filterHostedAssistantInputBatchByLinqRouteAuthority({
      batch: {
        inputs: [assistantInputCandidateFromStoredEvent(event)],
        nextCursor: event.cursor,
      },
      effectsPort: {
        assertLinqRecentInboundEngagement: assertAuthority,
      },
      userId: "member_container",
      vaultRoot,
    });

    expect(filtered.inputs).toHaveLength(1);
    expect(assertAuthority).toHaveBeenCalledWith(expect.objectContaining({
      authorityCheckOnly: true,
      routeAuthority: {
        channel: "linq",
        containerMemberId: "member_container",
        threadId: "chat_group",
      },
      target: "chat_group",
    }), {
      signal: undefined,
    });
  });
});

async function createTemporaryVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-linq-input-authority-"));
  temporaryVaults.push(vault);
  return vault;
}

async function createStoredLinqInput(input: {
  externalThreadRouteAuthorityPresent?: boolean;
  vaultRoot: string;
}) {
  return await upsertAssistantInputEvent({
    event: {
      content: {
        text: "hello group",
      },
      conversation: {
        accountId: null,
        actorId: "participant",
        actorIsSelf: false,
        source: "linq",
        threadId: "chat_group",
        threadIsDirect: false,
      },
      occurredAt: "2026-07-12T12:00:00.000Z",
      replyTarget: {
        channel: "linq",
        messageId: "message_group",
        threadId: "chat_group",
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent:
          input.externalThreadRouteAuthorityPresent === true,
        kind: "linq",
        partCount: 1,
        reactionEligible: true,
        replyToMessageId: null,
        service: "iMessage",
      },
      sourceRef: {
        dedupeKey: "event_group",
        eventId: "event_group",
        itemId: "mailbox_group",
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: "1",
        payloadSchema: "murph.hosted-mailbox-item.v1",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    },
    vault: input.vaultRoot,
  });
}
