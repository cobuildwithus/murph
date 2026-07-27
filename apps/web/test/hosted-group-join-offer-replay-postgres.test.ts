import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";
import { describe, expect, it } from "vitest";

import {
  acceptHostedGroupOfferAffirmation,
} from "@/src/lib/hosted-groups/group-offer-affirmation";
import {
  acceptHostedGroupJoinCodeTx,
  acceptHostedGroupJoinOfferTx,
  leaveHostedGroupMemberTx,
  prepareHostedLinqGroupJoinApplicationClaimTx,
} from "@/src/lib/hosted-groups/group-store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  ingestHostedLinqProviderEventTx,
} from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import {
  parseHostedLinqProviderEvent,
  type ParsedHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import {
  buildCurrentHostedConsentDocumentVersions,
} from "@/src/lib/legal/consent";
import {
  revokeHostedVaultSharesTx,
} from "@/src/lib/hosted-vault-share/share-grant-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error("The Linq join replay proof requires a local DATABASE_URL.");
}

const transactionOptions = {
  ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  timeout: 15_000,
} as const;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type JoinReplayFixture = {
  actionClient: PrismaClient;
  alternateMemberId: string;
  chatId: string;
  groupId: string;
  joinCode: string;
  joinerMemberId: string;
  leaveClient: PrismaClient;
  messageId: string;
  observer: PrismaClient;
  ownerMemberId: string;
  replayClient: PrismaClient;
  runtimeMemberId: string;
  threadIdentityLookupKey: string;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createJoinReplayFixture(): Promise<JoinReplayFixture> {
  const fixtureId = randomUUID();
  const ownerMemberId = `member_join_replay_owner_${fixtureId}`;
  const runtimeMemberId = `member_join_replay_runtime_${fixtureId}`;
  const joinerMemberId = `member_join_replay_joiner_${fixtureId}`;
  const alternateMemberId = `member_join_replay_alternate_${fixtureId}`;
  const groupId = `group_join_replay_${fixtureId}`;
  const joinCode = `join_${fixtureId}`;
  const chatId = `chat_join_replay_${fixtureId}`;
  const messageId = `message_join_replay_${fixtureId}`;
  const messageLookupKey = createHostedLinqMessageLookupKey(messageId);
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: "linq",
    threadId: chatId,
  });
  if (!messageLookupKey || !threadIdentityLookupKey) {
    throw new Error("Expected durable Linq lookup keys for the replay fixture.");
  }

  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const actionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const leaveClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const replayClient = createPrismaClient({ databaseUrl, poolMax: 1 });

  await observer.hostedMember.createMany({
    data: [
      { billingStatus: HostedBillingStatus.active, id: ownerMemberId },
      { id: runtimeMemberId },
      { billingStatus: HostedBillingStatus.active, id: joinerMemberId },
      { billingStatus: HostedBillingStatus.active, id: alternateMemberId },
    ],
  });
  await observer.hostedThreadContainer.create({
    data: {
      memberId: runtimeMemberId,
      ownerMemberId,
    },
  });
  await observer.hostedGroup.create({
    data: {
      displayName: "Replay proof group",
      id: groupId,
      joinCode,
      joinCodeCreatedAt: new Date("2026-07-26T12:00:00.000Z"),
      joinPolicyJson: {
        requestedVaultShareProjectionScopes: [
          { projectionKind: "sleep-times.v0" },
        ],
        schema: "murph.hosted-group.join-policy.v1",
      },
      kind: "friends",
      ownerMemberId,
      runtimeMemberId,
    },
  });
  await observer.hostedThreadRoute.create({
    data: {
      channel: "linq",
      containerMemberId: runtimeMemberId,
      threadIdentityLookupKey,
      threadLookupKey: `join-replay:${fixtureId}`,
    },
  });
  await observer.hostedGroupJoinOffer.create({
    data: {
      groupId,
      id: `offer_join_replay_${fixtureId}`,
      messageLookupKey,
      postedAt: new Date("2026-07-26T12:01:00.000Z"),
      projectionKindsJson: [{ projectionKind: "sleep-times.v0" }],
    },
  });
  await observer.hostedConsentGrant.createMany({
    data: [
      {
        documentVersionsJson:
          buildCurrentHostedConsentDocumentVersions("launch.legal"),
        grantedAt: new Date("2026-07-26T11:00:00.000Z"),
        memberId: joinerMemberId,
        scope: "launch.legal",
        source: "test",
        status: "granted",
      },
      {
        documentVersionsJson:
          buildCurrentHostedConsentDocumentVersions("launch.health-data"),
        grantedAt: new Date("2026-07-26T11:00:00.000Z"),
        memberId: joinerMemberId,
        scope: "launch.health-data",
        source: "test",
        status: "granted",
      },
    ],
  });

  return {
    actionClient,
    alternateMemberId,
    chatId,
    groupId,
    joinCode,
    joinerMemberId,
    leaveClient,
    messageId,
    observer,
    ownerMemberId,
    replayClient,
    runtimeMemberId,
    threadIdentityLookupKey,
  };
}

async function cleanupJoinReplayFixture(fixture: JoinReplayFixture): Promise<void> {
  await fixture.observer.hostedLinqProviderEvent.deleteMany({
    where: {
      messageLookupKey: createHostedLinqMessageLookupKey(fixture.messageId),
    },
  });
  await fixture.observer.hostedGroup.deleteMany({ where: { id: fixture.groupId } });
  await fixture.observer.hostedThreadRoute.deleteMany({
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  await fixture.observer.hostedThreadContainer.deleteMany({
    where: { memberId: fixture.runtimeMemberId },
  });
  await fixture.observer.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          fixture.joinerMemberId,
          fixture.alternateMemberId,
          fixture.runtimeMemberId,
          fixture.ownerMemberId,
        ],
      },
    },
  });
  await Promise.all([
    fixture.actionClient.$disconnect(),
    fixture.leaveClient.$disconnect(),
    fixture.observer.$disconnect(),
    fixture.replayClient.$disconnect(),
  ]);
}

function buildReactionEvent(input: {
  eventId: string;
  fixture: JoinReplayFixture;
  reactedAt: string;
}): ParsedHostedLinqProviderEvent {
  const event = {
    api_version: "v3",
    created_at: input.reactedAt,
    data: {
      chat_id: input.fixture.chatId,
      from_handle: {
        handle: "+15551234567",
        service: "iMessage",
      },
      message_id: input.fixture.messageId,
      reacted_at: input.reactedAt,
      reaction_type: "love",
    },
    event_id: input.eventId,
    event_type: "reaction.added",
    trace_id: `trace_${input.eventId}`,
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
  const parsed = parseHostedLinqProviderEvent({
    event,
    rawBody: JSON.stringify(event),
  });
  if (!parsed?.linqChatId || !parsed.messageLookupKey || !parsed.payloadHash) {
    throw new Error("Expected a complete Linq reaction event.");
  }
  return parsed;
}

async function ingestReaction(input: {
  event: ParsedHostedLinqProviderEvent;
  fixture: JoinReplayFixture;
  prisma: PrismaClient;
}): Promise<{ duplicate: boolean }> {
  if (!input.event.linqChatId) {
    throw new Error("Expected complete Linq application context.");
  }
  return input.prisma.$transaction(async (tx) => {
    const groupJoinApplicationClaim =
      await prepareHostedLinqGroupJoinApplicationClaimTx({
        memberId: input.fixture.joinerMemberId,
        messageLookupKeyReadCandidates: input.event.messageLookupKeyReadCandidates,
        threadIdentityLookupKeyReadCandidates:
          createHostedExternalThreadIdentityLookupKeyReadCandidates({
            channel: "linq",
            threadId: input.event.linqChatId,
          }),
        tx,
      });
    if (!groupJoinApplicationClaim) {
      throw new Error("Expected the reaction receipt to bind join authority.");
    }
    return ingestHostedLinqProviderEventTx({
      event: input.event,
      groupJoinApplicationClaim,
      prisma: tx,
      receivedAt: new Date("2026-07-26T12:02:00.000Z"),
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function acceptReaction(input: {
  deferPostCommit?: (run: () => Promise<void>) => void;
  event: ParsedHostedLinqProviderEvent;
  fixture: JoinReplayFixture;
  memberId?: string;
  prisma: PrismaClient;
}) {
  if (!input.event.linqChatId || !input.event.payloadHash) {
    throw new Error("Expected complete Linq application context.");
  }
  return acceptHostedGroupOfferAffirmation({
    affirmationEventId: input.event.eventId,
    channel: "linq",
    deferPostCommit: input.deferPostCommit ?? (() => undefined),
    kinds: ["join"],
    linqApplicationContext: {
      linqChatLookupKeyReadCandidates:
        createHostedLinqChatLookupKeyReadCandidates(input.event.linqChatId),
      payloadHash: input.event.payloadHash,
    },
    memberId: input.memberId ?? input.fixture.joinerMemberId,
    messageLookupKeyReadCandidates: input.event.messageLookupKeyReadCandidates,
    now: input.event.providerCreatedAt,
    prisma: input.prisma,
    threadIdentityLookupKeyReadCandidates:
      createHostedExternalThreadIdentityLookupKeyReadCandidates({
        channel: "linq",
        threadId: input.event.linqChatId,
      }),
  });
}

async function acceptReactionTx(input: {
  event: ParsedHostedLinqProviderEvent;
  fixture: JoinReplayFixture;
  memberId?: string;
  tx: Prisma.TransactionClient;
}) {
  if (!input.event.linqChatId || !input.event.payloadHash) {
    throw new Error("Expected complete Linq application context.");
  }
  return acceptHostedGroupJoinOfferTx({
    channel: "linq",
    linqAffirmation: {
      eventId: input.event.eventId,
      linqChatLookupKeyReadCandidates:
        createHostedLinqChatLookupKeyReadCandidates(input.event.linqChatId),
      payloadHash: input.event.payloadHash,
    },
    memberId: input.memberId ?? input.fixture.joinerMemberId,
    messageLookupKeyReadCandidates: input.event.messageLookupKeyReadCandidates,
    now: input.event.providerCreatedAt,
    threadIdentityLookupKeyReadCandidates:
      createHostedExternalThreadIdentityLookupKeyReadCandidates({
        channel: "linq",
        threadId: input.event.linqChatId,
      }),
    tx: input.tx,
  });
}

async function readMembership(fixture: JoinReplayFixture) {
  return fixture.observer.hostedGroupMember.findUnique({
    where: {
      groupId_memberId: {
        groupId: fixture.groupId,
        memberId: fixture.joinerMemberId,
      },
    },
    select: { id: true },
  });
}

async function readMembershipSharingDecisionRevision(
  fixture: JoinReplayFixture,
): Promise<number | null | undefined> {
  return (await fixture.observer.hostedGroupMember.findUnique({
    where: {
      groupId_memberId: {
        groupId: fixture.groupId,
        memberId: fixture.joinerMemberId,
      },
    },
    select: { sharingDecisionRevision: true },
  }))?.sharingDecisionRevision;
}

async function readShares(fixture: JoinReplayFixture) {
  return fixture.observer.hostedVaultShare.findMany({
    orderBy: { projectionKind: "asc" },
    select: {
      id: true,
      grantedAt: true,
      projectionKind: true,
      revokedAt: true,
      status: true,
    },
    where: {
      destinationMemberId: fixture.runtimeMemberId,
      grantorMemberId: fixture.joinerMemberId,
    },
  });
}

async function readApplicationState(
  fixture: JoinReplayFixture,
  eventId: string,
): Promise<string | null | undefined> {
  return (await fixture.observer.hostedLinqProviderEvent.findUnique({
    where: { eventId: createHostedLinqProviderEventLookupKey(eventId) },
    select: { groupJoinApplicationState: true },
  }))?.groupJoinApplicationState;
}

async function rollBackReactionAcceptance(input: {
  event: ParsedHostedLinqProviderEvent;
  fixture: JoinReplayFixture;
}): Promise<void> {
  await expect(input.fixture.actionClient.$transaction(async (tx) => {
    await acceptReactionTx({ event: input.event, fixture: input.fixture, tx });
    throw new Error("injected acceptance rollback");
  }, transactionOptions)).rejects.toThrow("injected acceptance rollback");
}

async function revokeSelectedSleepShare(input: {
  fixture: JoinReplayFixture;
  membershipId: string;
  now: Date;
}): Promise<void> {
  await input.fixture.actionClient.$transaction((tx) => acceptHostedGroupJoinCodeTx({
    expectedMembershipId: input.membershipId,
    joinCode: input.fixture.joinCode,
    memberId: input.fixture.joinerMemberId,
    now: input.now,
    selectedVaultShareProjectionScopes: [],
    tx,
  }), transactionOptions);
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the replay transaction to wait behind leave.");
}

function pauseMembershipDeleteAfterWrite(input: {
  deleted: Deferred<void>;
  release: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const hostedGroupMember = new Proxy(input.tx.hostedGroupMember, {
    get(target, property) {
      if (property === "delete") {
        return async (args: Prisma.HostedGroupMemberDeleteArgs) => {
          const result = await target.delete(args);
          input.deleted.resolve();
          await input.release.promise;
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedGroupMember") {
        return hostedGroupMember;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "Linq group-join affirmation replay PostgreSQL ownership",
  () => {
    it("consumes E1 once, preserves later revoke/leave, allows E2, and fails legacy rows closed", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_e1_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:03:00.000Z",
        });
        await expect(ingestReaction({ event: e1, fixture, prisma: fixture.actionClient }))
          .resolves.toMatchObject({ duplicate: false });
        await expect(ingestReaction({ event: e1, fixture, prisma: fixture.actionClient }))
          .resolves.toMatchObject({ duplicate: true });
        await expect(fixture.observer.hostedLinqProviderEvent.findUnique({
          where: {
            eventId: createHostedLinqProviderEventLookupKey(e1.eventId),
          },
          select: { groupJoinApplicationState: true },
        })).resolves.toEqual({ groupJoinApplicationState: "pending:v2" });

        const deferredPostCommit: Array<() => Promise<void>> = [];
        await expect(acceptReaction({
          deferPostCommit: (run) => deferredPostCommit.push(run),
          event: e1,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toEqual({ kind: "join", status: "accepted" });
        const firstMembership = await readMembership(fixture);
        if (!firstMembership) {
          throw new Error("Expected E1 to create a membership.");
        }
        expect((await readShares(fixture)).map((share) => [share.projectionKind, share.status]))
          .toEqual([
            ["profile-name.v0", "granted"],
            ["sleep-times.v0", "granted"],
          ]);
        await expect(fixture.observer.hostedLinqProviderEvent.findUnique({
          where: {
            eventId: createHostedLinqProviderEventLookupKey(e1.eventId),
          },
          select: { groupJoinApplicationState: true },
        })).resolves.toEqual({
          groupJoinApplicationState: `applied:${firstMembership.id}`,
        });

        await expect(acceptReaction({
          deferPostCommit: (run) => deferredPostCommit.push(run),
          event: e1,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toEqual({ kind: "join", status: "accepted" });
        expect((await readMembership(fixture))?.id).toBe(firstMembership.id);
        expect(deferredPostCommit).toHaveLength(2);

        const sleepScope = hostedVaultShareProjectionKindToScope("sleep-times.v0");
        await fixture.actionClient.$transaction((tx) => revokeHostedVaultSharesTx({
          destinationMemberId: fixture.runtimeMemberId,
          grantorMemberId: fixture.joinerMemberId,
          now: new Date("2026-07-26T12:04:00.000Z"),
          projectionScopes: [sleepScope],
          tx,
        }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
        const revokedSleepShare = (await readShares(fixture)).find(
          (share) => share.projectionKind === "sleep-times.v0",
        );
        expect(revokedSleepShare?.status).toBe("revoked");

        await expect(acceptReaction({
          event: e1,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toEqual({ kind: "join", status: "accepted" });
        const replayedSleepShare = (await readShares(fixture)).find(
          (share) => share.projectionKind === "sleep-times.v0",
        );
        expect(replayedSleepShare).toEqual(revokedSleepShare);

        await expect(fixture.actionClient.$transaction((tx) => leaveHostedGroupMemberTx({
          memberId: fixture.joinerMemberId,
          membershipId: firstMembership.id,
          now: new Date("2026-07-26T12:05:00.000Z"),
          tx,
        }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS)).resolves.toEqual({ kind: "left" });

        await expect(acceptReaction({
          event: e1,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toEqual({ kind: "join", status: "accepted" });
        expect(await readMembership(fixture)).toBeNull();
        expect((await readShares(fixture)).every((share) => share.status === "revoked"))
          .toBe(true);

        const e2 = buildReactionEvent({
          eventId: `evt_join_replay_e2_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:06:00.000Z",
        });
        await ingestReaction({ event: e2, fixture, prisma: fixture.actionClient });
        await expect(acceptReaction({
          event: e2,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toEqual({ kind: "join", status: "accepted" });
        const secondMembership = await readMembership(fixture);
        expect(secondMembership?.id).not.toBe(firstMembership.id);
        expect((await readShares(fixture)).every((share) => share.status === "granted"))
          .toBe(true);

        if (!secondMembership) {
          throw new Error("Expected E2 to create a new membership.");
        }
        await expect(fixture.observer.hostedLinqProviderEvent.findUnique({
          where: {
            eventId: createHostedLinqProviderEventLookupKey(e2.eventId),
          },
          select: { groupJoinApplicationState: true },
        })).resolves.toEqual({
          groupJoinApplicationState: `applied:${secondMembership.id}`,
        });
        await expect(fixture.actionClient.$transaction((tx) => acceptReactionTx({
          event: e1,
          fixture,
          tx,
        }), transactionOptions)).resolves.toMatchObject({
          alreadyMember: false,
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
          revokedVaultShareProjectionKinds: [],
        });
        await expect(readMembership(fixture)).resolves.toEqual(secondMembership);
        await fixture.actionClient.$transaction((tx) => leaveHostedGroupMemberTx({
          memberId: fixture.joinerMemberId,
          membershipId: secondMembership.id,
          now: new Date("2026-07-26T12:07:00.000Z"),
          tx,
        }), transactionOptions);

        const legacyEvent = buildReactionEvent({
          eventId: `evt_join_replay_legacy_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:08:00.000Z",
        });
        await fixture.observer.hostedLinqProviderEvent.create({
          data: {
            eventId: createHostedLinqProviderEventLookupKey(legacyEvent.eventId),
            eventType: "reaction.added",
            groupJoinApplicationState: null,
            linqChatLookupKey: legacyEvent.linqChatLookupKey,
            messageLookupKey: legacyEvent.messageLookupKey,
            payloadHash: legacyEvent.payloadHash,
            providerCreatedAt: legacyEvent.providerCreatedAt,
            receivedAt: new Date("2026-07-26T12:08:01.000Z"),
          },
        });
        await expect(acceptReaction({
          event: legacyEvent,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toEqual({ reason: "no_offer_match", status: "ignored" });
        expect(await readMembership(fixture)).toBeNull();
        expect((await readShares(fixture)).every((share) => share.status === "revoked"))
          .toBe(true);
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("keeps E1 pending when acceptance rolls back after provider receipt", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_retry_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:30:00.000Z",
        });
        await expect(ingestReaction({ event: e1, fixture, prisma: fixture.actionClient }))
          .resolves.toMatchObject({ duplicate: false });

        await expect(fixture.actionClient.$transaction(async (tx) => {
          await acceptReactionTx({ event: e1, fixture, tx });
          throw new Error("injected acceptance rollback");
        }, transactionOptions))
          .rejects.toThrow("injected acceptance rollback");

        await expect(fixture.observer.hostedLinqProviderEvent.findUnique({
          where: {
            eventId: createHostedLinqProviderEventLookupKey(e1.eventId),
          },
          select: { groupJoinApplicationState: true },
        })).resolves.toEqual({ groupJoinApplicationState: "pending:v2" });
        await expect(readMembership(fixture)).resolves.toBeNull();
        await expect(readShares(fixture)).resolves.toEqual([]);

        await expect(ingestReaction({ event: e1, fixture, prisma: fixture.actionClient }))
          .resolves.toMatchObject({ duplicate: true });
        await expect(acceptReaction({
          event: e1,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toEqual({ kind: "join", status: "accepted" });
        const membership = await readMembership(fixture);
        if (!membership) {
          throw new Error("Expected the retried E1 to create membership.");
        }
        await expect(fixture.observer.hostedLinqProviderEvent.findUnique({
          where: {
            eventId: createHostedLinqProviderEventLookupKey(e1.eventId),
          },
          select: { groupJoinApplicationState: true },
        })).resolves.toEqual({
          groupJoinApplicationState: `applied:${membership.id}`,
        });
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("supersedes pending E1 instead of attaching it to E2's membership", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_pending_e1_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:40:00.000Z",
        });
        await ingestReaction({ event: e1, fixture, prisma: fixture.actionClient });
        await rollBackReactionAcceptance({ event: e1, fixture });

        const e2 = buildReactionEvent({
          eventId: `evt_join_replay_pending_e2_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:41:00.000Z",
        });
        await ingestReaction({ event: e2, fixture, prisma: fixture.actionClient });
        await acceptReaction({ event: e2, fixture, prisma: fixture.actionClient });
        const e2Membership = await readMembership(fixture);
        if (!e2Membership) {
          throw new Error("Expected E2 to create the current membership.");
        }
        const sharesBeforeRetry = await readShares(fixture);

        await expect(fixture.actionClient.$transaction((tx) => acceptReactionTx({
          event: e1,
          fixture,
          tx,
        }), transactionOptions)).resolves.toMatchObject({
          alreadyMember: false,
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
          revokedVaultShareProjectionKinds: [],
        });

        await expect(readApplicationState(fixture, e1.eventId))
          .resolves.toBe("superseded:v1");
        await expect(readMembership(fixture)).resolves.toEqual(e2Membership);
        await expect(readShares(fixture)).resolves.toEqual(sharesBeforeRetry);
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("supersedes pending E1 after the selected share is revoked", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const seed = buildReactionEvent({
          eventId: `evt_join_replay_share_seed_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:45:00.000Z",
        });
        await ingestReaction({ event: seed, fixture, prisma: fixture.actionClient });
        await acceptReaction({ event: seed, fixture, prisma: fixture.actionClient });
        const membership = await readMembership(fixture);
        if (!membership) {
          throw new Error("Expected the seed event to create membership.");
        }

        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_share_e1_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:46:00.000Z",
        });
        await ingestReaction({ event: e1, fixture, prisma: fixture.actionClient });
        await rollBackReactionAcceptance({ event: e1, fixture });
        await revokeSelectedSleepShare({
          fixture,
          membershipId: membership.id,
          now: new Date("2026-07-26T12:47:00.000Z"),
        });
        const sharesAfterRevocation = await readShares(fixture);
        expect(sharesAfterRevocation.find(
          (share) => share.projectionKind === "sleep-times.v0",
        )?.status).toBe("revoked");

        await expect(fixture.actionClient.$transaction((tx) => acceptReactionTx({
          event: e1,
          fixture,
          tx,
        }), transactionOptions)).resolves.toMatchObject({
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
          revokedVaultShareProjectionKinds: [],
        });

        await expect(readApplicationState(fixture, e1.eventId))
          .resolves.toBe("superseded:v1");
        await expect(readMembership(fixture)).resolves.toEqual(membership);
        await expect(readShares(fixture)).resolves.toEqual(sharesAfterRevocation);
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("supersedes pending E1 after a newer no-op permission denial", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const seed = buildReactionEvent({
          eventId: `evt_join_replay_noop_denial_seed_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:48:00.000Z",
        });
        await ingestReaction({ event: seed, fixture, prisma: fixture.actionClient });
        await acceptReaction({ event: seed, fixture, prisma: fixture.actionClient });
        const membership = await readMembership(fixture);
        if (!membership) {
          throw new Error("Expected the seed event to create membership.");
        }

        await revokeSelectedSleepShare({
          fixture,
          membershipId: membership.id,
          now: new Date("2026-07-26T12:49:00.000Z"),
        });
        await expect(readMembershipSharingDecisionRevision(fixture))
          .resolves.toBe(2);
        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_noop_denial_e1_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:50:00.000Z",
        });
        await ingestReaction({ event: e1, fixture, prisma: fixture.actionClient });
        await rollBackReactionAcceptance({ event: e1, fixture });

        // The selected scope is already revoked, but this authenticated Web
        // submission is a newer explicit denial and must supersede E1.
        await revokeSelectedSleepShare({
          fixture,
          membershipId: membership.id,
          now: new Date("2026-07-26T12:51:00.000Z"),
        });
        await expect(readMembershipSharingDecisionRevision(fixture))
          .resolves.toBe(3);
        const sharesAfterDenial = await readShares(fixture);
        expect(sharesAfterDenial.find(
          (share) => share.projectionKind === "sleep-times.v0",
        )?.status).toBe("revoked");

        await expect(fixture.actionClient.$transaction((tx) => acceptReactionTx({
          event: e1,
          fixture,
          tx,
        }), transactionOptions)).resolves.toMatchObject({
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
          revokedVaultShareProjectionKinds: [],
        });

        await expect(readApplicationState(fixture, e1.eventId))
          .resolves.toBe("superseded:v1");
        await expect(readMembership(fixture)).resolves.toEqual(membership);
        await expect(readShares(fixture)).resolves.toEqual(sharesAfterDenial);
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("supersedes pending E1 after leave while a genuinely new event may rejoin", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const seed = buildReactionEvent({
          eventId: `evt_join_replay_leave_seed_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:50:00.000Z",
        });
        await ingestReaction({ event: seed, fixture, prisma: fixture.actionClient });
        await acceptReaction({ event: seed, fixture, prisma: fixture.actionClient });
        const firstMembership = await readMembership(fixture);
        if (!firstMembership) {
          throw new Error("Expected the seed event to create membership.");
        }

        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_leave_e1_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:51:00.000Z",
        });
        await ingestReaction({ event: e1, fixture, prisma: fixture.actionClient });
        await rollBackReactionAcceptance({ event: e1, fixture });
        await fixture.actionClient.$transaction((tx) => leaveHostedGroupMemberTx({
          memberId: fixture.joinerMemberId,
          membershipId: firstMembership.id,
          now: new Date("2026-07-26T12:52:00.000Z"),
          tx,
        }), transactionOptions);
        const sharesAfterLeave = await readShares(fixture);
        expect(sharesAfterLeave.every((share) => share.status === "revoked")).toBe(true);

        await expect(fixture.actionClient.$transaction((tx) => acceptReactionTx({
          event: e1,
          fixture,
          tx,
        }), transactionOptions)).resolves.toMatchObject({
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
          revokedVaultShareProjectionKinds: [],
        });
        await expect(readApplicationState(fixture, e1.eventId))
          .resolves.toBe("superseded:v1");
        await expect(readMembership(fixture)).resolves.toBeNull();
        await expect(readShares(fixture)).resolves.toEqual(sharesAfterLeave);

        const e2 = buildReactionEvent({
          eventId: `evt_join_replay_leave_e2_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:53:00.000Z",
        });
        await ingestReaction({ event: e2, fixture, prisma: fixture.actionClient });
        await acceptReaction({ event: e2, fixture, prisma: fixture.actionClient });
        const secondMembership = await readMembership(fixture);
        expect(secondMembership?.id).not.toBe(firstMembership.id);
        expect((await readShares(fixture)).every((share) => share.status === "granted"))
          .toBe(true);
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("supersedes pending E1 when retry resolves to a different member", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_member_e1_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:55:00.000Z",
        });
        await ingestReaction({ event: e1, fixture, prisma: fixture.actionClient });
        await rollBackReactionAcceptance({ event: e1, fixture });

        await expect(fixture.actionClient.$transaction((tx) => acceptReactionTx({
          event: e1,
          fixture,
          memberId: fixture.alternateMemberId,
          tx,
        }), transactionOptions)).resolves.toMatchObject({
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
          revokedVaultShareProjectionKinds: [],
        });

        await expect(readApplicationState(fixture, e1.eventId))
          .resolves.toBe("superseded:v1");
        await expect(readMembership(fixture)).resolves.toBeNull();
        await expect(fixture.observer.hostedGroupMember.findUnique({
          where: {
            groupId_memberId: {
              groupId: fixture.groupId,
              memberId: fixture.alternateMemberId,
            },
          },
          select: { id: true },
        })).resolves.toBeNull();
        await expect(readShares(fixture)).resolves.toEqual([]);
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("does not let a duplicate bind an old bare-pending receipt", async () => {
      const fixture = await createJoinReplayFixture();
      try {
        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_legacy_pending_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T12:58:00.000Z",
        });
        await fixture.observer.hostedLinqProviderEvent.create({
          data: {
            eventId: createHostedLinqProviderEventLookupKey(e1.eventId),
            eventType: "reaction.added",
            groupJoinApplicationState: "pending",
            linqChatLookupKey: e1.linqChatLookupKey,
            messageLookupKey: e1.messageLookupKey,
            payloadHash: e1.payloadHash,
            providerCreatedAt: e1.providerCreatedAt,
            receivedAt: new Date("2026-07-26T12:58:01.000Z"),
          },
        });

        await expect(ingestReaction({
          event: e1,
          fixture,
          prisma: fixture.actionClient,
        })).resolves.toMatchObject({ duplicate: true });
        await expect(fixture.actionClient.$transaction((tx) => acceptReactionTx({
          event: e1,
          fixture,
          tx,
        }), transactionOptions)).resolves.toMatchObject({
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
          revokedVaultShareProjectionKinds: [],
        });

        await expect(readApplicationState(fixture, e1.eventId))
          .resolves.toBe("superseded:v1");
        await expect(readMembership(fixture)).resolves.toBeNull();
        await expect(readShares(fixture)).resolves.toEqual([]);
      } finally {
        await cleanupJoinReplayFixture(fixture);
      }
    });

    it("keeps an applied E1 replay that waits behind leave left and revoked", async () => {
      const fixture = await createJoinReplayFixture();
      let leave: Promise<unknown> | null = null;
      let replay: Promise<unknown> | null = null;
      let releaseLeave: Deferred<void> | null = null;
      try {
        const e1 = buildReactionEvent({
          eventId: `evt_join_replay_race_${randomUUID()}`,
          fixture,
          reactedAt: "2026-07-26T13:00:00.000Z",
        });
        await ingestReaction({ event: e1, fixture, prisma: fixture.actionClient });
        await acceptReaction({ event: e1, fixture, prisma: fixture.actionClient });
        const membership = await readMembership(fixture);
        if (!membership) {
          throw new Error("Expected the race fixture membership.");
        }

        const deleted = createDeferred();
        const release = createDeferred();
        releaseLeave = release;
        leave = fixture.leaveClient.$transaction((tx) => leaveHostedGroupMemberTx({
          memberId: fixture.joinerMemberId,
          membershipId: membership.id,
          now: new Date("2026-07-26T13:01:00.000Z"),
          tx: pauseMembershipDeleteAfterWrite({
            deleted,
            release,
            tx,
          }),
        }), transactionOptions);
        await deleted.promise;

        const replayPid = createDeferred<number>();
        replay = fixture.replayClient.$transaction(async (tx) => {
          replayPid.resolve(await readBackendPid(tx));
          return acceptReactionTx({ event: e1, fixture, tx });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await replayPid.promise,
        });

        releaseLeave.resolve();
        await expect(leave).resolves.toEqual({ kind: "left" });
        await expect(replay).resolves.toMatchObject({
          alreadyMember: false,
          grantedVaultShareProjectionKinds: [],
          membershipId: null,
        });
        expect(await readMembership(fixture)).toBeNull();
        expect((await readShares(fixture)).every((share) => share.status === "revoked"))
          .toBe(true);
      } finally {
        releaseLeave?.resolve();
        await Promise.allSettled(
          [leave, replay].filter(
            (transaction): transaction is Promise<unknown> => transaction !== null,
          ),
        );
        await cleanupJoinReplayFixture(fixture);
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
