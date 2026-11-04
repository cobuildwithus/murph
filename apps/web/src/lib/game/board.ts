import "server-only";
import { Prisma } from "@prisma/client";
import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { buildHostedVaultShareProjectionScopeKey } from "@murphai/hosted-execution/vault-share";
import { getPrisma } from "../prisma";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedThreadRouteByThreadIdentity } from "../hosted-routing/thread-route-store";
import { HOSTED_GROUP_BOARD_SCOPES } from "../hosted-groups/board-scopes";
import { readHostedGroupBoardData, saveHostedGroupBoardSharingTx } from "../hosted-groups/group-store";
import { finishHostedGroupJoin } from "../hosted-groups/join-post-commit";
import { gameOnWhere } from "./access";
import { areGamePlayersBlocked, lockGamePair } from "./blocks";
import { gameChatContextCurrent, readGameChatAudience } from "./chat-membership";
import { verifiedGameContactKeys } from "./audience";
import { gameNotFound } from "./http/errors";
import { BOARD_METRICS, boardCrowns, boardNumber, type BoardMetric, type BoardPerson, type PairBoard } from "./board-numbers";
import { pairBoardStreak } from "./board-streak";
import { parseStoredTerms, type RuleState } from "./rules";
import { addDays } from "./time";

const BOARD_GAME_LIMIT = 100;
const BOARD_ENTRY_LIMIT = 5_000;
type Db = Prisma.TransactionClient;
export function isGameBoardEnabled(): boolean { return process.env.MURPH_GAME_BOARD_ENABLED !== "false"; }

function pairWhere(viewerId: string, otherId: string): Prisma.GameWhereInput {
  return { AND: [gameOnWhere(), { maxPlayers: 2, status: { in: ["live", "settled"] },
    players: { every: { memberId: { in: [viewerId, otherId] }, leftAt: null } } },
  { players: { some: { memberId: viewerId, leftAt: null } } },
  { players: { some: { memberId: otherId, leftAt: null } } }] };
}

async function resolvePairBoard(db: Db, viewerId: string, otherId: string) {
  if (viewerId === otherId || await areGamePlayersBlocked(db, viewerId, otherId)) throw gameNotFound();
  const game = await db.game.findFirst({ where: pairWhere(viewerId, otherId),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, chatContainerMemberId: true, players: {
      where: { memberId: viewerId }, take: 1, select: { timeZone: true } } } });
  if (!game) throw gameNotFound();
  if (!game.chatContainerMemberId) return null;
  const group = await db.hostedGroup.findUnique({ where: { runtimeMemberId: game.chatContainerMemberId }, select: { id: true } });
  return group ? { gameId: game.id, groupId: group.id, runtimeMemberId: game.chatContainerMemberId,
    timeZone: game.players[0]?.timeZone ?? "UTC" } : null;
}

async function boardGameFacts(db: Db, viewerId: string, otherId: string, room: string, clock: Date) {
  const where = { ...pairWhere(viewerId, otherId), chatContainerMemberId: room };
  // Independent uncapped minimum: activation time and capped history are not Day 1.
  const first = await db.gamePlayer.findFirst({ where: { memberId: viewerId, dayOne: { not: null }, game: where },
    orderBy: [{ dayOne: "asc" }, { gameId: "asc" }], select: { dayOne: true } });
  if (!first?.dayOne) return null;
  const rows = await db.game.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: BOARD_GAME_LIMIT + 1,
    select: { id: true, status: true, terms: true, lengthDays: true, createdBy: true, startsOn: true,
      devClockOffsetMs: true, players: { take: 2, select: { memberId: true, seat: true, timeZone: true, dayOne: true, joinedAt: true, leftAt: true } } } });
  const streaks = new Map<string, number | null>([[viewerId, null], [otherId, null]]);
  if (rows.length <= BOARD_GAME_LIMIT) {
    const entries = await db.gameEntry.findMany({ where: { gameId: { in: rows.map(row => row.id) }, attempt: { gt: 0 }, withdrawnAt: null },
      take: BOARD_ENTRY_LIMIT + 1,
      select: { id: true, gameId: true, memberId: true, dayIndex: true, attempt: true, incomplete: true, withdrawnAt: true, receivedAt: true } });
    if (entries.length > BOARD_ENTRY_LIMIT) return { firstGameOn: first.dayOne.toISOString().slice(0, 10), streaks };
    const states = rows.map(row => {
      const state: RuleState = { game: { id: row.id, createdBy: row.createdBy, seats: 2, status: row.status === "settled" ? "settled" : "live",
        lengthDays: row.lengthDays, terms: parseStoredTerms(row.terms), startsOn: row.startsOn?.toISOString().slice(0, 10) ?? null, inviteExpiresAt: null },
      players: row.players.flatMap(player => player.memberId && player.timeZone ? [{ ...player, memberId: player.memberId,
        timeZone: player.timeZone, dayOne: player.dayOne?.toISOString().slice(0, 10) ?? null }] : []),
      entries: entries.filter(entry => entry.gameId === row.id).map(entry => ({ ...entry, kind: "words", mediaKeys: [], blurHash: null })) };
      return { state, now: new Date(clock.getTime() + Number(row.devClockOffsetMs ?? 0)) };
    });
    for (const id of [viewerId, otherId]) streaks.set(id, pairBoardStreak(states, id));
  }
  return { firstGameOn: first.dayOne.toISOString().slice(0, 10), streaks };
}

export async function readPairBoard(viewerId: string, otherId: string): Promise<PairBoard | null> {
  if (!isGameBoardEnabled()) return null;
  const db = getPrisma();
  const binding = await resolvePairBoard(db, viewerId, otherId);
  if (!binding) return null;
  const now = new Date();
  const facts = await boardGameFacts(db, viewerId, otherId, binding.runtimeMemberId, now);
  if (!facts) return null;
  const shared = await readHostedGroupBoardData({ ...binding, viewerId, otherId, now, prisma: db });
  if (!shared) return null;
  const current = await resolvePairBoard(db, viewerId, otherId);
  if (!current || current.groupId !== binding.groupId || current.runtimeMemberId !== binding.runtimeMemberId) return null;
  const through = formatTimeZoneDateTimeParts(now, binding.timeZone).dayKey;
  const window = { from: addDays(through, -89), through };
  const people: BoardPerson[] = shared.people.map(person => {
    const number = (index: number) => boardNumber(BOARD_METRICS[index], person.projections[index], window, facts.firstGameOn);
    return { memberId: person.memberId, me: person.memberId === viewerId, member: person.member,
      inARow: facts.streaks.get(person.memberId) ?? null,
      numbers: { restingHeartRate: number(0), sleep: number(1), steps: number(2), vo2Max: number(3) } };
  });
  return { groupId: binding.groupId, membershipId: shared.membershipId, firstGameOn: facts.firstGameOn, window,
    myShares: BOARD_METRICS.filter((_, index) => shared.myScopes.includes(buildHostedVaultShareProjectionScopeKey(HOSTED_GROUP_BOARD_SCOPES[index]))),
    people, crowns: boardCrowns(people) };
}

export async function savePairBoardSharing(viewerId: string, otherId: string, input: {
  expectedMembershipId: string | null; numbers: readonly BoardMetric[];
}, signal?: AbortSignal): Promise<PairBoard | null> {
  if (!isGameBoardEnabled()) throw gameNotFound();
  const db = getPrisma();
  const binding = await resolvePairBoard(db, viewerId, otherId);
  if (!binding) throw gameNotFound();
  // Only first enrollment needs provider audience evidence. Existing members
  // retain the same self-service sharing authority as the join page.
  const audience = input.expectedMembershipId === null
    ? await readGameChatAudience(binding.runtimeMemberId).catch(() => { throw gameNotFound(); }) : null;
  let result;
  try {
    result = await db.$transaction(async tx => {
      await lockGamePair(tx, viewerId, otherId);
      await tx.$executeRaw`SELECT id FROM game WHERE id = ${binding.gameId} FOR UPDATE`;
      const current = await resolvePairBoard(tx, viewerId, otherId);
      if (!current || current.gameId !== binding.gameId || current.groupId !== binding.groupId || current.runtimeMemberId !== binding.runtimeMemberId) throw gameNotFound();
      if (audience) {
        const row = await tx.game.findUnique({ where: { id: binding.gameId },
          select: { maxPlayers: true, audienceKey: true, chatContainerMemberId: true, status: true, previousGameId: true, createdBy: true, invitees: { take: 2, select: { memberId: true } }, players: { take: 2, select: { memberId: true, leftAt: true, seat: true } } } });
        const route = await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: audience.threadId, prisma: tx });
        if (!row || route?.containerMemberId !== binding.runtimeMemberId || !await gameChatContextCurrent(row, {
          chatContainerMemberId: binding.runtimeMemberId, chatPlayerMemberIds: audience.memberIds, chatAudience: audience,
        }, tx)) throw gameNotFound();
        for (const memberId of [viewerId, otherId]) {
          if (!(await verifiedGameContactKeys(tx, memberId, audience.contacts)).length) throw gameNotFound();
        }
      }
      return saveHostedGroupBoardSharingTx({ ...binding, memberId: viewerId, expectedMembershipId: input.expectedMembershipId,
        selectedVaultShareProjectionScopes: HOSTED_GROUP_BOARD_SCOPES.filter((_, index) => input.numbers.includes(BOARD_METRICS[index])), now: new Date(), tx });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isHostedOnboardingError(error) && error.code === "HOSTED_GROUP_MEMBERSHIP_CHANGED") {
      throw hostedOnboardingError({ code: "MEMBERSHIP_CHANGED", httpStatus: 409, message: "Your group membership changed. Reload and try again." });
    }
    throw error;
  }
  await finishHostedGroupJoin({ result, memberId: viewerId, prisma: db, signal });
  return readPairBoard(viewerId, otherId);
}
