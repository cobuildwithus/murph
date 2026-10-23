import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { HostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { readGameChatFundingRooms } from "@/src/lib/game/chat-access";
import { prepareGameChatBootstrap } from "@/src/lib/game/chat-bootstrap";
import { deliverGameChangeProposal } from "@/src/lib/game/chat-delivery";
import { markGameChatGenerationQueuedTx, reserveGameChatLifecycleTx, reserveGameChatProposalTx } from "@/src/lib/game/chat-lifecycle-receipt";

const m = vi.hoisted(() => ({ published: [] as HostedExecutionAssistantNotificationRequestedWake[], room: "" }));
// Keep the real mailbox query and database transaction. Only envelope crypto,
// provider roster/identity discovery and runtime signalling are test boundaries.
vi.mock("@/src/lib/hosted-mailbox/store", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-mailbox/store")>(),
  prepareHostedMailboxEnvelopeAppend: async ({ envelope }: { envelope: HostedExecutionAssistantNotificationRequestedWake }) => ({ envelope }),
  appendPreparedHostedMailboxEnvelopeTx: async ({ prepared, tx }: { prepared: { envelope: HostedExecutionAssistantNotificationRequestedWake }; tx: Prisma.TransactionClient }) => {
    m.published.push(prepared.envelope);
    const id = randomUUID();
    await tx.hostedMailboxItem.create({ data: { id, userId: prepared.envelope.userId, lane: "system", laneSeq: 2n,
      kind: "assistant.notification.requested", dedupeKey: prepared.envelope.eventId, occurredAt: new Date(), payloadSchema: "synthetic" } });
    return { mailboxItemId: id };
  },
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: vi.fn(async () => {}) }));
vi.mock("@/src/lib/game/crypto", () => ({ openGameTexts: async (values: unknown[]) => values.map(() => "Player") }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: async ({ memberId }: { memberId: string }) => ({ phoneNumber: memberId.startsWith("first_") ? "+15555550101" : "+15555550102", phoneNumberVerifiedAt: new Date() }),
}));
vi.mock("@/src/lib/game/chat-membership", () => ({ requireExactChat: vi.fn(async () => {}) }));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination: async () => ({ conversationShape: "thread-container", route: { channel: "linq" } }),
  bindHostedAssistantNotificationDestination: () => ({ route: { actorId: null, channel: "linq", identityId: m.room, threadId: "synthetic-chat", threadIsDirect: false, delivery: { kind: "thread", target: "synthetic-chat" } } }),
  assertHostedAssistantNotificationRouteAuthority: vi.fn(async () => {}),
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Bootstrap cancellation proof needs an isolated local test database.");
const members: string[] = [];
const games: string[] = [];

async function fixture() {
  const db = getPrisma(), suffix = randomUUID(), now = new Date();
  const first = `first_${suffix}`, second = `second_${suffix}`, room = `room_${suffix}`, gameId = `game_${suffix}`;
  members.push(first, second, room); games.push(gameId); m.room = room;
  await db.hostedMember.createMany({ data: [first, second, room].map(id => ({ id, billingStatus: "not_started" })) });
  await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: first,
    participants: { create: [first, second].map(participantMemberId => ({ participantMemberId, handleLookupKey: participantMemberId, firstSeenAt: now, lastSeenAt: now })) } } });
  await db.gameProfile.createMany({ data: [first, second].map(memberId => ({ memberId, firstNameEncrypted: "synthetic", timeZone: "UTC" })) });
  await db.game.create({ data: { id: gameId, createdBy: first, status: "negotiating", liveRosterKey: `${first}:${second}`,
    chatContainerMemberId: room, terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic",
    players: { create: [first, second].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC" })) } } });
  const oldProposal = randomUUID(), cancellation = `game-change-cancelled:${gameId}:${oldProposal}`;
  await reserveGameChatProposalTx({ gameId, proposalId: oldProposal, now, tx: db });
  await markGameChatGenerationQueuedTx(`game-change:${gameId}:${oldProposal}`, db, room);
  await db.hostedLinqDelivery.updateMany({ where: { source: "game_lifecycle", sourceRef: gameId }, data: { status: "skipped", skippedAt: now } });
  await reserveGameChatLifecycleTx({ gameId, kind: "change_cancelled", proposalId: oldProposal, now, tx: db });
  await markGameChatGenerationQueuedTx(cancellation, db, room);
  await db.hostedMailboxItem.create({ data: { id: randomUUID(), userId: room, lane: "system", laneSeq: 1n,
    kind: "assistant.notification.requested", dedupeKey: cancellation, occurredAt: now, payloadSchema: "synthetic" } });
  return { db, first, room, gameId, now, cancellation };
}

describe.skipIf(!enabled)("cancellation bootstrap ordering PostgreSQL", () => {
  beforeEach(() => { m.published.length = 0; vi.stubEnv("MURPH_GAME_ENABLED", "true"); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", ""); });
  afterAll(async () => {
    await getPrisma().game.deleteMany({ where: { id: { in: games } } });
    await getPrisma().hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } });
    vi.unstubAllEnvs();
  });
  it("keeps free-player access through an unfrozen cancellation after the old proposal retires", async () => {
    const { db, room, gameId, now } = await fixture();
    expect(await readGameChatFundingRooms({ memberIds: [room], now, prisma: db })).toEqual(new Map([[room, room]]));
    await db.hostedLinqDelivery.updateMany({ where: { sourceRef: { startsWith: `${gameId}:` } }, data: { template: "unrelated" } });
    expect(await readGameChatFundingRooms({ memberIds: [room], now, prisma: db })).toEqual(new Map());
  });
  it("holds the replacement until cancellation attaches the room, then publishes it once on the ordinary route", async () => {
    const { db, first, room, gameId, now, cancellation } = await fixture();
    const proposalId = randomUUID(), eventId = `game-change:${gameId}:${proposalId}`;
    await db.game.update({ where: { id: gameId }, data: { pendingChange: { v: 1, id: proposalId, proposedByMemberId: first,
      expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 0, startsOn: null, origin: "app", deliveryStatus: "pending" } } });
    await reserveGameChatProposalTx({ gameId, proposalId, now, tx: db });
    await expect(prepareGameChatBootstrap(gameId, eventId, "Ask about the replacement.")).resolves.toBeNull();
    expect(m.published).toEqual([]);
    expect(await db.hostedMailboxItem.count({ where: { userId: room } })).toBe(1);
    expect(await db.hostedLinqDelivery.findFirst({ where: { sourceRef: gameId, status: "awaiting_generation" } })).not.toBeNull();
    // Provider acceptance/attachment is separately covered by the bootstrap suite.
    await db.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: room, threadLookupKey: room, threadIdentityLookupKey: room } });
    await db.hostedMailboxItem.updateMany({ where: { userId: room, dedupeKey: cancellation }, data: { consumedAt: now } });
    await expect(deliverGameChangeProposal(gameId, proposalId)).resolves.toBe(true);
    await expect(deliverGameChangeProposal(gameId, proposalId)).resolves.toBe(true);
    expect(m.published).toHaveLength(1);
    expect(m.published[0]).toMatchObject({ eventId, notification: { deliveryDispatchMode: "queue-only", deliveryIdempotencyKey: eventId } });
    expect(m.published[0].notification.gameChatBootstrap).toBeUndefined();
    expect(await db.hostedMailboxItem.count({ where: { userId: room, dedupeKey: eventId } })).toBe(1);
  });
});
