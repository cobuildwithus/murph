import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
  type HostedExecutionAssistantAskRequestedPayload,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX,
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, it } from "vitest";

import {
  findNextHostedSystemMailboxQueueItem,
  isHostedApprovedContinuationSystemMailboxItem,
  readHostedSystemMailboxState,
  resolveHostedSystemMailboxHandledThroughSeq,
  resolveHostedSystemMailboxNextWakeCandidate,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
  type HostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";

const OCCURRED_AT = "2036-08-22T19:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(OCCURRED_AT) + HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
).toISOString();
const BEFORE_EXPIRY = new Date(Date.parse(EXPIRES_AT) - 1).toISOString();

describe("system mailbox delegated direction state", () => {
  it.each([
    "joined_group",
    "current_sender_personal",
    "group_sender",
    "group_sender_private",
  ] as const)("selects a later due %s ask ahead of an older device row", (targetKind) => {
    const device = createDeviceItem("1");
    const ask = createAskItem(targetKind, "2");

    expect(isHostedApprovedContinuationSystemMailboxItem(ask)).toBe(true);

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: OCCURRED_AT,
      state: { pending: [device, ask] },
    })).toEqual(ask);
  });

  it("projects a later due delegated ask as an assistant wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-delegated-ask-"));
    try {
      await updateHostedSystemMailboxState(
        vaultRoot,
        () => ({
          pending: [
            createDeviceItem("1"),
            createAskItem("current_sender_personal", "2"),
          ],
        }),
        { now: () => OCCURRED_AT },
      );

      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => OCCURRED_AT,
        vaultRoot,
      })).resolves.toEqual({
        at: OCCURRED_AT,
        executionClass: "default_owned",
        reason: "assistant",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("selects only the exact fresh group handoff ahead of older model-free work", async () => {
    const device = createDeviceItem("1");
    const handoff = createGroupHandoffItem("2");
    expect(isHostedApprovedContinuationSystemMailboxItem(handoff)).toBe(true);
    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: BEFORE_EXPIRY,
      state: { pending: [device, handoff] },
    })).toEqual(handoff);

    const malformed = {
      ...handoff,
      wake: {
        ...handoff.wake,
        eventId: "assistant.notification.requested:ordinary",
      },
    } as HostedSystemMailboxPendingItem;
    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: BEFORE_EXPIRY,
      state: { pending: [device, malformed] },
    })).toEqual(device);

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-delegated-handoff-"));
    try {
      await updateHostedSystemMailboxState(
        vaultRoot,
        () => ({ pending: [device, handoff] }),
        { now: () => BEFORE_EXPIRY },
      );
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => BEFORE_EXPIRY,
        vaultRoot,
      })).resolves.toEqual({
        at: BEFORE_EXPIRY,
        executionClass: "default_owned",
        reason: "assistant",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps pending-effects first and leaves consented asks in ordinary order", () => {
    const device = createDeviceItem("1");
    const delegated = createAskItem("joined_group", "2");
    const continuation = createPendingEffectsItem("3");
    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: OCCURRED_AT,
      state: { pending: [device, delegated, continuation] },
    })).toEqual(continuation);

    const consented = createAskItem("consented_member", "2");
    expect(isHostedApprovedContinuationSystemMailboxItem(consented)).toBe(false);
    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: OCCURRED_AT,
      state: { pending: [device, consented] },
    })).toEqual(device);
  });

  it("excludes an expired handoff from selection, wakes, and handled blocking, then prunes it on mutation", async () => {
    const handoff = createGroupHandoffItem("2");
    const device = createDeviceItem("3");
    const state: HostedSystemMailboxState = { pending: [handoff, device] };

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: EXPIRES_AT,
      state,
    })).toEqual(device);
    expect(resolveHostedSystemMailboxHandledThroughSeq({
      importedSeq: "9",
      now: BEFORE_EXPIRY,
      state,
    })).toBe("1");
    expect(resolveHostedSystemMailboxHandledThroughSeq({
      importedSeq: "9",
      now: EXPIRES_AT,
      state,
    })).toBe("2");

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-expired-handoff-"));
    try {
      await updateHostedSystemMailboxState(
        vaultRoot,
        () => ({ pending: [handoff] }),
        { now: () => BEFORE_EXPIRY },
      );
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => EXPIRES_AT,
        vaultRoot,
      })).resolves.toEqual({ at: null, executionClass: null, reason: null });
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([handoff]);

      await updateHostedSystemMailboxState(
        vaultRoot,
        (current) => current,
        { now: () => EXPIRES_AT },
      );
      const pruned = await readHostedSystemMailboxState(vaultRoot);
      expect(pruned.pending).toEqual([]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "9",
        now: EXPIRES_AT,
        state: pruned,
      })).toBe("9");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it.each(["sending", "recording"] as const)(
    "keeps an expired %s handoff ordered and handled-frontier blocking",
    (status) => {
      const handoff = { ...createGroupHandoffItem("2"), status };
      const state: HostedSystemMailboxState = {
        pending: [handoff, createDeviceItem("3")],
      };
      expect(findNextHostedSystemMailboxQueueItem({
        allowedRouteActions: null,
        now: EXPIRES_AT,
        state,
      })).toEqual(handoff);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "9",
        now: EXPIRES_AT,
        state,
      })).toBe("1");
    },
  );
});

function createBaseItem(input: {
  itemId: string;
  mailboxDedupeKey: string;
  mailboxLaneSeq: string;
  routeAction: HostedSystemMailboxPendingItem["routeAction"];
  wake: HostedSystemMailboxPendingItem["wake"];
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: input.mailboxDedupeKey,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: null,
    occurredAt: input.wake.occurredAt,
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: input.routeAction,
    status: "pending",
    wake: input.wake,
  };
}

function createDeviceItem(mailboxLaneSeq: string): HostedSystemMailboxPendingItem {
  const eventId = `device-sync.wake:synthetic-${mailboxLaneSeq}`;
  return createBaseItem({
    itemId: `device_${mailboxLaneSeq}`,
    mailboxDedupeKey: eventId,
    mailboxLaneSeq,
    routeAction: "run-device-sync-wake",
    wake: {
      eventId,
      kind: "device-sync.wake",
      occurredAt: OCCURRED_AT,
      reason: "reconcile_due",
      userId: "member_synthetic",
    },
  });
}

function createAskItem(
  targetKind:
    | "joined_group"
    | "consented_member"
    | "current_sender_personal"
    | "group_sender"
    | "group_sender_private",
  mailboxLaneSeq: string,
): HostedSystemMailboxPendingItem {
  const common = {
    expiresAt: EXPIRES_AT,
    question: "What synthetic fact should be shared?",
  };
  let ask: HostedExecutionAssistantAskRequestedPayload;
  if (targetKind === "joined_group") {
    ask = {
      ...common,
      originAssistantInputId: `ain_${"a".repeat(32)}`,
      originSessionId: "session_synthetic",
      target: {
        kind: targetKind,
        membershipId: "membership_synthetic",
        requestedLabel: null,
      },
    };
  } else if (targetKind === "consented_member") {
    ask = {
      ...common,
      origin: {
        assistantInputId: `ain_${"a".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_synthetic",
      },
      target: {
        grantId: "grant_synthetic",
        kind: targetKind,
        membershipId: "membership_synthetic",
        permissionDigest: "d".repeat(64),
      },
    };
  } else if (targetKind === "current_sender_personal") {
    ask = {
      ...common,
      origin: {
        assistantInputId: `ain_${"a".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_synthetic",
      },
      resultDestination: { kind: "origin_context" },
      target: {
        groupRuntimeMemberId: "member_group_synthetic",
        kind: targetKind,
        permissionDigest: "d".repeat(64),
      },
    };
  } else {
    ask = {
      ...common,
      origin: {
        assistantInputId: `ain_${"a".repeat(32)}`,
        kind: "accepted_input",
        sessionId: "session_synthetic",
      },
      target: {
        groupRuntimeMemberId: "member_group_synthetic",
        kind: targetKind,
        permissionDigest: "d".repeat(64),
      },
    };
  }
  const eventId = `assistant.ask.requested:synthetic-${mailboxLaneSeq}`;
  return createBaseItem({
    itemId: `ask_${targetKind}_${mailboxLaneSeq}`,
    mailboxDedupeKey: eventId,
    mailboxLaneSeq,
    routeAction: "run-assistant-ask",
    wake: buildHostedExecutionAssistantAskRequestedWake({
      ask,
      eventId,
      memberId: "member_synthetic",
      occurredAt: OCCURRED_AT,
    }),
  });
}

function createGroupHandoffItem(mailboxLaneSeq: string): HostedSystemMailboxPendingItem {
  const eventId = `${HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX}${
    "b".repeat(64)
  }`;
  return createBaseItem({
    itemId: `handoff_${mailboxLaneSeq}`,
    mailboxDedupeKey: eventId,
    mailboxLaneSeq,
    routeAction: "dispatch-assistant-notification",
    wake: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId,
      memberId: "member_synthetic",
      notification: {
        deliveryDedupeToken: eventId,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: eventId,
        externalThreadRouteAuthority: {
          accountLookupKey: "account_synthetic",
          channel: "linq",
          containerMemberId: "member_synthetic",
          threadId: "thread_synthetic",
        },
        groupContextHandoff: {
          membershipId: "membership_synthetic",
          originAssistantInputId: `ain_${"a".repeat(32)}`,
        },
        instructions: "Use bounded synthetic context.",
        notificationPromptProfile: "context-handoff",
        responsePolicy: { kind: "require_send" },
        route: {
          actorId: null,
          channel: "linq",
          delivery: { kind: "thread", target: "thread_synthetic" },
          identityId: "identity_synthetic",
          threadId: "thread_synthetic",
          threadIsDirect: false,
        },
      },
      occurredAt: OCCURRED_AT,
    }),
  });
}

function createPendingEffectsItem(mailboxLaneSeq: string): HostedSystemMailboxPendingItem {
  const eventId = "runtime-control:pending-effects:effect_synthetic";
  return createBaseItem({
    itemId: `pending_effects_${mailboxLaneSeq}`,
    mailboxDedupeKey: eventId,
    mailboxLaneSeq,
    routeAction: "apply-runtime-control-request",
    wake: {
      effectId: "effect_synthetic",
      eventId,
      kind: "runtime.pending-effects-reconcile-requested",
      occurredAt: OCCURRED_AT,
      userId: "member_synthetic",
    },
  });
}
