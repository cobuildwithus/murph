import "server-only";
import { buildHostedVaultShareProjectionScopeKey } from "@murphai/hosted-execution/vault-share";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { getPrisma } from "../../prisma";
import { addHostedGroupPairBoardSharingTx, lockHostedGroupRow } from "../../hosted-groups/group-store";
import { boardSharingRevision, HOSTED_GROUP_BOARD_SCOPES } from "../../hosted-groups/board-scopes";
import { finishHostedGroupJoin } from "../../hosted-groups/join-post-commit";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../../hosted-onboarding/shared";
import { readHostedThreadRouteByThreadIdentity } from "../../hosted-routing/thread-route-store";
import { lockGamePair } from "../blocks";
import { hasGameChatRestriction, readGameChatAudience, sameGamePlayers } from "../chat-membership";
import { verifiedGameContactKeys } from "../audience";
import { assertGameMemberAuthCurrentTx } from "../http/auth";
import { gameNotFound } from "../http/errors";
import type { Friends, SetSharingBody, SetSharingResponse } from "./contract";

export interface FriendRoom {
  gameId: string; groupId: string; runtimeMemberId: string; otherMemberId: string;
  membershipId: string | null; sharingRevision?: string; shared: ("steps" | "sleep")[];
}

/** Rooms remain the sole health-sharing owner; a group-game acquaintance gains no grant. */
export async function readFriendRooms(memberId: string, friendIds: readonly string[], includeShared = true): Promise<{ rooms: FriendRoom[]; incomplete: boolean }> {
  const db = getPrisma();
  if (!friendIds.length) return { rooms: [], incomplete: false };
  const games = await db.game.findMany({ where: { maxPlayers: 2, status: { in: ["live", "settled"] },
    chatContainerMemberId: { not: null }, AND: [
      { players: { some: { memberId, leftAt: null } } },
      { players: { some: { memberId: { in: [...friendIds] }, leftAt: null } } },
    ], players: { every: { memberId: { in: [memberId, ...friendIds] }, leftAt: null } } },
    take: 501, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, chatContainerMemberId: true, players: { take: 2, select: { memberId: true } } } });
  if (games.length > 500) return { rooms: [], incomplete: true };
  // A person's board can manage only their newest bound game, even if that room is ineligible.
  const current = new Map<string, (typeof games)[number]>();
  for (const game of games) {
    const friend = game.players.find(player => player.memberId !== memberId)?.memberId;
    if (friend && !current.has(friend)) current.set(friend, game);
  }
  const roomIds = [...current.values()].flatMap(game => game.chatContainerMemberId ?? []);
  if (!roomIds.length) return { rooms: [], incomplete: false };
  const [groups, containers, shares] = await Promise.all([
    db.hostedGroup.findMany({ where: { runtimeMemberId: { in: roomIds } }, take: 501,
      select: { id: true, runtimeMemberId: true, members: { take: 3, select: { id: true, memberId: true } } } }),
    db.hostedThreadContainer.findMany({ where: { memberId: { in: roomIds } }, take: 501,
      select: { memberId: true, participants: { where: { removedAt: null }, take: 3, select: { participantMemberId: true } } } }),
    includeShared ? db.hostedVaultShare.findMany({ where: { grantorMemberId: memberId, destinationMemberId: { in: roomIds },
      projectionScopeKey: { in: HOSTED_GROUP_BOARD_SCOPES.map(buildHostedVaultShareProjectionScopeKey) } },
      orderBy: { id: "asc" }, take: HOSTED_GROUP_BOARD_SCOPES.length * roomIds.length,
      select: { id: true, status: true, destinationMemberId: true, projectionScopeKey: true } }) : [],
  ]);
  const rooms: FriendRoom[] = [];
  for (const [otherMemberId, game] of current) {
    const runtimeMemberId = game.chatContainerMemberId!;
    const group = groups.find(group => group.runtimeMemberId === runtimeMemberId);
    const container = containers.find(container => container.memberId === runtimeMemberId);
    if (!group || !container) continue;
    const pair = [memberId, otherMemberId];
    if (container.participants.length !== 2 || !sameGamePlayers(container.participants.map(person => person.participantMemberId), pair)
      || group.members.some(person => !pair.includes(person.memberId))) continue;
    const grants = shares.filter(share => share.destinationMemberId === runtimeMemberId);
    rooms.push({ gameId: game.id, groupId: group.id, runtimeMemberId, otherMemberId,
      membershipId: group.members.find(person => person.memberId === memberId)?.id ?? null,
      sharingRevision: includeShared ? boardSharingRevision(memberId, runtimeMemberId, grants) : undefined,
      shared: (["sleep", "steps"] as const).filter((_, index) => grants.some(share => share.status === "granted"
        && share.projectionScopeKey === buildHostedVaultShareProjectionScopeKey(HOSTED_GROUP_BOARD_SCOPES[index + 1]))) });
  }
  return { rooms, incomplete: false };
}

export async function shareWithFriends(input: {
  auth: HostedNativeMemberAuth; body: SetSharingBody; rooms: FriendRoom[];
  audience: Friends["shareAudience"]; signal: AbortSignal;
}): Promise<SetSharingResponse> {
  const db = getPrisma(), memberId = input.auth.member.id;
  const sharedWith: SetSharingResponse["sharedWith"] = [];
  if (input.body.share && (input.body.audience.length !== input.audience.length
    || input.audience.some(person => !input.body.audience.includes(person.memberId)))) throw audienceChanged();
  try {
    for (const room of input.rooms) {
      const { firstName, avatarUrl } = input.audience.find(person => person.memberId === room.otherMemberId)!;
      const person = { memberId: room.otherMemberId, firstName, avatarUrl };
      if (input.body.share) {
        const result = await grantFriendRoom(input.auth, room, input.body);
        sharedWith.push({ ...person, metrics: input.body.metrics });
        await finishHostedGroupJoin({ result, memberId, prisma: db, signal: input.signal });
      } else {
        const metrics = input.body.metrics.filter(metric => room.shared.includes(metric));
        if (metrics.length) sharedWith.push({ ...person, metrics });
      }
    }
  } catch (error) {
    // Older apps decode recipients only from the success body. A committed grant must reach that path.
    if (sharedWith.length) return { ok: true, partial: sharedWith.length < input.audience.length, sharedWith };
    throw hostedOnboardingError({ code: isHostedOnboardingError(error) ? error.code : "PROGRESS_SHARING_UNAVAILABLE",
      httpStatus: isHostedOnboardingError(error) ? error.httpStatus : 503,
      message: isHostedOnboardingError(error) ? error.message : "Sharing is temporarily unavailable.",
      retryable: isHostedOnboardingError(error) ? error.retryable : true, details: { sharedWith } });
  }
  return { ok: true, sharedWith };
}

async function grantFriendRoom(auth: HostedNativeMemberAuth, room: FriendRoom, body: SetSharingBody) {
  const memberId = auth.member.id;
  // Every grant checks the live provider roster, including existing memberships.
  const audience = await readGameChatAudience(room.runtimeMemberId);
  if (audience.contacts.length !== 2 || !sameGamePlayers(audience.memberIds, [memberId, room.otherMemberId])) throw audienceChanged();
  return getPrisma().$transaction(async tx => {
    await lockHostedGroupRow(tx, room.groupId);
    await assertGameMemberAuthCurrentTx(auth, tx);
    await lockGamePair(tx, memberId, room.otherMemberId);
    await tx.$executeRaw`SELECT id FROM game WHERE id = ${room.gameId} FOR UPDATE`;
    if (await hasGameChatRestriction(tx, [memberId, room.otherMemberId])) throw gameNotFound();
    const route = await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: audience.threadId, prisma: tx });
    const game = await tx.game.findFirst({ where: { chatContainerMemberId: { not: null },
      maxPlayers: 2, status: { in: ["live", "settled"] },
      AND: [{ players: { some: { memberId, leftAt: null } } },
      { players: { some: { memberId: room.otherMemberId, leftAt: null, profile: { member: { suspendedAt: null } } } } }],
      players: { every: { memberId: { in: [memberId, room.otherMemberId] }, leftAt: null } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, chatContainerMemberId: true } });
    if (game?.id !== room.gameId || game.chatContainerMemberId !== room.runtimeMemberId || route?.containerMemberId !== room.runtimeMemberId) throw audienceChanged();
    for (const id of [memberId, room.otherMemberId]) {
      if (!(await verifiedGameContactKeys(tx, id, audience.contacts)).length) throw audienceChanged();
    }
    return addHostedGroupPairBoardSharingTx({ ...room, memberId, expectedMembershipId: room.membershipId,
      expectedSharingRevision: body.expectedSharingRevisions?.[room.otherMemberId], metrics: body.metrics, now: new Date(), tx });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function audienceChanged() {
  return hostedOnboardingError({ code: "PROGRESS_SHARING_AUDIENCE_CHANGED", httpStatus: 409,
    message: "Your sharing audience changed. Reload before sharing." });
}
