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
      currentInbound: {
        dedupeKey: "event_group",
        eventId: "event_group",
        mailboxItemId: "mailbox_group",
        occurredAt: "2026-07-12T12:00:00.000Z",
        replyToMessageId: "message_group",
        target: "chat_group",
      },
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
      currentInbound: expect.objectContaining({
        dedupeKey: "event_group",
        mailboxItemId: "mailbox_group",
        target: "chat_group",
      }),
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

  it("preserves a trusted current inbound after a legitimate direct-route rebind", async () => {
    const vaultRoot = await createTemporaryVault();
    const event = await createStoredLinqInput({
      threadIsDirect: true,
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
      userId: "member_personal",
      vaultRoot,
    });

    expect(filtered.inputs).toHaveLength(1);
    expect(assertAuthority).toHaveBeenCalledWith(expect.objectContaining({
      currentInbound: {
        dedupeKey: "event_group",
        eventId: "event_group",
        mailboxItemId: "mailbox_group",
        occurredAt: "2026-07-12T12:00:00.000Z",
        replyToMessageId: "message_group",
        target: "chat_group",
      },
      routeAuthority: null,
    }), {
      signal: undefined,
    });
  });

  it("terminally suppresses a routed input after active route access is revoked", async () => {
    const vaultRoot = await createTemporaryVault();
    const event = await createStoredLinqInput({
      externalThreadRouteAuthorityPresent: true,
      vaultRoot,
    });

    const filtered = await filterHostedAssistantInputBatchByLinqRouteAuthority({
      batch: {
        inputs: [assistantInputCandidateFromStoredEvent(event)],
        nextCursor: event.cursor,
      },
      effectsPort: {
        assertLinqRecentInboundEngagement: vi.fn().mockRejectedValue({
          code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
        }),
      },
      userId: "member_container",
      vaultRoot,
    });

    expect(filtered.inputs).toEqual([]);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      inputId: event.inputId,
      vault: vaultRoot,
    })).resolves.toBe(true);
  });

  it("retries a transient authority failure without terminal suppression", async () => {
    const vaultRoot = await createTemporaryVault();
    const event = await createStoredLinqInput({ vaultRoot });

    await expect(filterHostedAssistantInputBatchByLinqRouteAuthority({
      batch: {
        inputs: [assistantInputCandidateFromStoredEvent(event)],
        nextCursor: event.cursor,
      },
      effectsPort: {
        assertLinqRecentInboundEngagement: vi.fn().mockRejectedValue({
          code: "HOSTED_LINQ_AUTHORITY_UNAVAILABLE",
        }),
      },
      userId: "member_personal",
      vaultRoot,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_AUTHORITY_UNAVAILABLE",
    });
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      inputId: event.inputId,
      vault: vaultRoot,
    })).resolves.toBe(false);
  });
});

async function createTemporaryVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-linq-input-authority-"));
  temporaryVaults.push(vault);
  return vault;
}

async function createStoredLinqInput(input: {
  externalThreadRouteAuthorityPresent?: boolean;
  threadIsDirect?: boolean;
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
        threadIsDirect: input.threadIsDirect === true,
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
