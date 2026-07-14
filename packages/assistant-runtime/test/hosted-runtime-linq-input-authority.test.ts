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
        inputs: [assistantInputCandidateFromStoredEvent(event, {
          hostedMailboxItemId: "mailbox_group",
        })],
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
      answeredMailboxItemIds: ["mailbox_group"],
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
        inputs: [assistantInputCandidateFromStoredEvent(event, {
          hostedMailboxItemId: "mailbox_group",
        })],
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
      answeredMailboxItemIds: ["mailbox_group"],
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

  it("uses the raw hosted mailbox id after a legitimate direct-route rebind", async () => {
    const vaultRoot = await createTemporaryVault();
    const event = await createStoredLinqInput({
      threadIsDirect: true,
      vaultRoot,
    });
    const assertAuthority = vi.fn().mockResolvedValue({});

    const filtered = await filterHostedAssistantInputBatchByLinqRouteAuthority({
      batch: {
        inputs: [assistantInputCandidateFromStoredEvent(event, {
          hostedMailboxItemId: "mailbox_group",
        })],
        nextCursor: event.cursor,
      },
      effectsPort: {
        assertLinqRecentInboundEngagement: assertAuthority,
      },
      userId: "member_personal",
      vaultRoot,
    });

    expect(filtered.inputs).toHaveLength(1);
    expect(assertAuthority).toHaveBeenCalledWith({
      answeredMailboxItemIds: ["mailbox_group"],
      authorityCheckOnly: true,
      idempotencyKey: null,
      replyToMessageId: "message_group",
      routeAuthority: null,
      target: "chat_group",
      targetKind: "thread",
    }, {
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
        inputs: [assistantInputCandidateFromStoredEvent(event, {
          hostedMailboxItemId: "mailbox_group",
        })],
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
        inputs: [assistantInputCandidateFromStoredEvent(event, {
          hostedMailboxItemId: "mailbox_group",
        })],
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

  it("suppresses a stale non-retryable 403 and continues to the fresh input", async () => {
    const vaultRoot = await createTemporaryVault();
    const staleEvent = await createStoredLinqInput({
      identity: "stale",
      vaultRoot,
    });
    const freshEvent = await createStoredLinqInput({
      identity: "fresh",
      vaultRoot,
    });
    const assertAuthority = vi.fn()
      .mockRejectedValueOnce({
        code: "authorization_error",
        retryable: false,
        status: 403,
        statusCode: 403,
      })
      .mockResolvedValueOnce({});

    const filtered = await filterHostedAssistantInputBatchByLinqRouteAuthority({
      batch: {
        inputs: [
          assistantInputCandidateFromStoredEvent(staleEvent, {
            hostedMailboxItemId: "mailbox_stale",
          }),
          assistantInputCandidateFromStoredEvent(freshEvent, {
            hostedMailboxItemId: "mailbox_fresh",
          }),
        ],
        nextCursor: freshEvent.cursor,
      },
      effectsPort: {
        assertLinqRecentInboundEngagement: assertAuthority,
      },
      userId: "member_personal",
      vaultRoot,
    });

    expect(filtered.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      freshEvent.inputId,
    ]);
    expect(assertAuthority).toHaveBeenCalledTimes(2);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      inputId: staleEvent.inputId,
      vault: vaultRoot,
    })).resolves.toBe(true);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      inputId: freshEvent.inputId,
      vault: vaultRoot,
    })).resolves.toBe(false);
  });

  it("suppresses a legacy input without canonical mailbox identity and continues", async () => {
    const vaultRoot = await createTemporaryVault();
    const staleEvent = await createStoredLinqInput({
      identity: "legacy",
      vaultRoot,
    });
    const freshEvent = await createStoredLinqInput({
      identity: "current",
      vaultRoot,
    });
    const assertAuthority = vi.fn().mockResolvedValue({});

    const filtered = await filterHostedAssistantInputBatchByLinqRouteAuthority({
      batch: {
        inputs: [
          assistantInputCandidateFromStoredEvent(staleEvent),
          assistantInputCandidateFromStoredEvent(freshEvent, {
            hostedMailboxItemId: "mailbox_current",
          }),
        ],
        nextCursor: freshEvent.cursor,
      },
      effectsPort: {
        assertLinqRecentInboundEngagement: assertAuthority,
      },
      userId: "member_personal",
      vaultRoot,
    });

    expect(filtered.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      freshEvent.inputId,
    ]);
    expect(assertAuthority).toHaveBeenCalledTimes(1);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      inputId: staleEvent.inputId,
      vault: vaultRoot,
    })).resolves.toBe(true);
    await expect(hasCompleteAssistantAutoReplyTerminalEvidence({
      inputId: freshEvent.inputId,
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
  identity?: string;
  threadIsDirect?: boolean;
  vaultRoot: string;
}) {
  const identity = input.identity ?? "group";
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
        messageId: `message_${identity}`,
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
        dedupeKey: `blinded_event_${identity}`,
        eventId: `blinded_event_${identity}`,
        itemId: `blinded_mailbox_${identity}`,
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
