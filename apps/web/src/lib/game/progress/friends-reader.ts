import "server-only";
import { ProgressReadTiming } from "./read-timing";
import { after } from "next/server";
import { runWithFreshHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { toLocalDayKey } from "@murphai/contracts";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import type { ClientUnits } from "../../companion/client-info";
import { getPrisma } from "../../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { assertGameMemberAuthCurrentTx } from "../http/auth";
import { gameNotFound } from "../http/errors";
import { lockGamePair } from "../blocks";
import type { Friends, FriendsQuery, SetSharingBody } from "./contract";
import { friendCohortIds, readFriendCohort } from "./friend-cohort";
import { friendMeasure, readFriendGameSeries, type FriendGameSeries } from "./friend-games";
import { readFriendHealthSeries } from "./friend-health";
import { readFriendRooms, shareWithFriends, type FriendRoom } from "./friend-sharing";
import { friendChallenge, friendPasses, friendRangeStart, friendsView, type FriendSeries } from "./friends";
import { settleAwards } from "./awards";
import type { Candidate, DayAmount } from "./registry";
import { scheduleInference } from "./series";

export async function readProgressFriends(auth: HostedNativeMemberAuth, query: FriendsQuery, signal: AbortSignal, units: ClientUnits, timing = new ProgressReadTiming()) {
  try {
    const db = getPrisma(), memberId = auth.member.id;
    const cohort = await timing.measure("cohort", () => readFriendCohort(memberId));
    const ids = cohort.people.map(person => person.memberId);
    timing.counts.friends = ids.length - 1;
    assertSelectedFriend(query.with, ids);
    const metric = query.measure;
    const health = metric === "steps" || metric === "sleep";
    const today = toLocalDayKey(new Date(), cohort.timeZone);
    const { players, period } = exerciseScope(cohort.people, query, today, health);
    const gameMemberIds = players.map(person => person.memberId);
    const gameRead = timing.measure("gameSeries", () => readFriendGameSeries(gameMemberIds, timing, { viewer: memberId, period }));
    const roomRead = readFriendsHealth(auth, cohort, query, signal, timing);
    // Drain both branches in the request scope, then inspect errors in their original order.
    await Promise.all([gameRead, roomRead].map(read => read.catch(() => undefined)));
    const games = await gameRead;
    const measure = friendMeasure(query.measure);
    const series = await roomRead;
    let people = series.people;
    if (!health) {
      people = players.map(person => ({ ...person, daily: friendDaily(games.amounts.get(person.memberId) ?? [], query.measure) }));
    }
    // Recheck once after the private reads. A departure or block must remove the friend before rendering.
    const current = await timing.measure("cohort", () => friendCohortIds(memberId, db));
    const currentIds = new Set(current.ids);
    people = people.filter(person => currentIds.has(person.memberId));
    const visibleIds = gameMemberIds.filter(id => currentIds.has(id));
    const visiblePending = games.pending.filter(task => currentIds.has(task.memberId));
    const pills = friendPills({ ...games, pending: visiblePending }, memberId, visibleIds, query.measure);
    assertSelectedFriend(query.with, visibleIds);
    await timing.measure("auth", () => assertGameMemberAuthCurrentTx(auth, db));
    if (people.length > 1 && !health && !games.windowed && visiblePending.length === 0 && pills.some(pill => pill.id === metric)) {
      after(async () => {
        try {
          await runWithFreshHostedDomainRootUnwrapCache(() =>
            settleFriendPasses(auth, people, friendPasses({ measureId: query.measure, people })));
        } catch {
          console.error("PROGRESS_BACKGROUND_SETTLEMENT_FAILED");
        }
      });
    }
    scheduleFriendInference(auth, visiblePending);
    const shareAudience = sharingPreview(people, series.rooms.filter(room => currentIds.has(room.otherMemberId)), query.measure);
    return await timing.measure("render", () => friendsView({ people, measure, pills, query, units, today,
      shareAudience, departureNotice: cohort.departure?.nameEncrypted === current.departure?.nameEncrypted ? cohort.departureNotice : null,
      challenge: friendChallenge(query.measure, games.tasks.get(memberId)?.get(query.measure)?.text) }));
  } catch (error) {
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: "PROGRESS_FRIENDS_UNAVAILABLE", httpStatus: 503, retryable: true,
      message: "Friends progress is temporarily unavailable." });
  }
}

function exerciseScope(people: FriendSeries[], query: FriendsQuery, today: string, health: boolean) {
  const players = !health && query.with ? people.filter(person => person.me || person.memberId === query.with) : people;
  const period = !health && query.range !== "all" ? { from: friendRangeStart(query.range, today), to: today } : null;
  return { players, period };
}

function assertSelectedFriend(selected: string | undefined, ids: readonly string[]) {
  if (selected && !ids.includes(selected)) throw gameNotFound();
}

async function readFriendsHealth(auth: HostedNativeMemberAuth, cohort: Awaited<ReturnType<typeof readFriendCohort>>,
  query: FriendsQuery, signal: AbortSignal, timing: ProgressReadTiming) {
  const metric = query.measure;
  if (metric !== "steps" && metric !== "sleep") return { people: [], rooms: [] };
  const friendIds = cohort.people.filter(person => !person.me).map(person => person.memberId);
  const rooms = await timing.measure("rooms", () => readFriendRooms(auth.member.id, friendIds, false));
  return readFriendHealthSeries({ auth, people: cohort.people, rooms, with: query.with,
    metric, timeZone: cohort.timeZone, signal, timing });
}

/** All exercise pills share one cohort, one game-series read and one award commit. */
export async function settleProgressFriends(auth: HostedNativeMemberAuth) {
  const db = getPrisma(), memberId = auth.member.id;
  await assertGameMemberAuthCurrentTx(auth, db);
  const cohort = await readFriendCohort(memberId);
  const ids = cohort.people.map(person => person.memberId);
  if (!cohort.people.some(person => !person.me)) return;
  const games = await readFriendGameSeries(ids);
  const current = await friendCohortIds(memberId, db);
  const currentIds = new Set(current.ids);
  const people = cohort.people.filter(person => currentIds.has(person.memberId));
  const currentGames = { ...games, pending: games.pending.filter(task => currentIds.has(task.memberId)) };
  if (currentGames.pending.length === 0) await settleGameFriendAwards(auth, currentGames, people, friendExerciseIds(currentGames, memberId, current.ids));
  await assertGameMemberAuthCurrentTx(auth, db);
  scheduleFriendInference(auth, currentGames.pending.filter(task => task.memberId !== memberId));
}

async function settleGameFriendAwards(auth: HostedNativeMemberAuth, games: FriendGameSeries, people: FriendSeries[], measures: string[]) {
  const candidates = measures.flatMap(measureId => friendPasses({ measureId,
    people: people.map(person => ({ ...person, daily: friendDaily(games.amounts.get(person.memberId) ?? [], measureId) })),
  }));
  await settleFriendPasses(auth, people, candidates);
}

async function settleFriendPasses(auth: HostedNativeMemberAuth, people: FriendSeries[], candidates: Candidate[]) {
  const memberId = auth.member.id;
  await settleAwards(memberId, candidates, async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    for (const subject of [...new Set(candidates.map(candidate => candidate.subjectMemberId!))].sort()) await lockGamePair(tx, memberId, subject);
    const atCommit = await friendCohortIds(memberId, tx);
    if (people.some(person => !atCommit.ids.includes(person.memberId))) throw audienceChanged();
  });
}

function scheduleFriendInference(auth: HostedNativeMemberAuth, pending: FriendGameSeries["pending"]) {
  const memberId = auth.member.id;
  scheduleInference(pending, async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    const owners = [...new Set(pending.map(task => task.memberId))].sort();
    for (const owner of owners) if (owner !== memberId) await lockGamePair(tx, memberId, owner);
    const atCommit = await friendCohortIds(memberId, tx);
    if (owners.some(owner => !atCommit.ids.includes(owner))) throw audienceChanged();
  });
}

function friendExerciseIds(games: FriendGameSeries, memberId: string, ids: string[]): string[] {
  const mine = new Set((games.amounts.get(memberId) ?? []).map(day => day.measureId));
  const shared = new Set(ids.filter(id => id !== memberId).flatMap(id => (games.amounts.get(id) ?? []).map(day => day.measureId)));
  return [...mine].filter(id => ids.length === 1 || shared.has(id) || games.pending.length > 0);
}

/** Pending classifications must not remove the member's known exercise pills. */
function friendPills(games: FriendGameSeries, memberId: string, ids: string[], selected: string): Friends["pills"] {
  const mine = new Set((games.amounts.get(memberId) ?? []).map(day => day.measureId));
  if (!["steps", "sleep"].includes(selected) && !mine.has(selected) && !games.pending.length) throw gameNotFound();
  const exercises = games.windowed ? [...mine] : friendExerciseIds(games, memberId, ids);
  return [...exercises.map(id => games.measures.get(id)!),
    { id: "steps", label: "Steps", icon: "steps" }, { id: "sleep", label: "Sleep", icon: "sleep" }]
    .map(({ id, label, icon }) => ({ id, label, icon }));
}

function sharingPreview(people: FriendSeries[], rooms: FriendRoom[], measure: string): Friends["shareAudience"] {
  if (measure !== "steps" && measure !== "sleep" || !rooms.some(room => !room.shared.includes(measure as "steps" | "sleep"))) return [];
  return sharingAudience(people, rooms);
}

function sharingAudience(people: FriendSeries[], rooms: FriendRoom[]): Friends["shareAudience"] {
  const byMember = new Map(rooms.map(room => [room.otherMemberId, room]));
  return people.flatMap(({ memberId, firstName, avatarUrl }) => {
    const room = byMember.get(memberId);
    return room ? [{ memberId, firstName, avatarUrl, sharingRevision: room.sharingRevision }] : [];
  });
}

export async function setProgressFriendSharing(auth: HostedNativeMemberAuth, body: SetSharingBody, signal: AbortSignal) {
  try {
    const cohort = await readFriendCohort(auth.member.id);
    const current = await friendCohortIds(auth.member.id, getPrisma());
    const currentIds = new Set(current.ids);
    const people = cohort.people.filter(person => currentIds.has(person.memberId));
    const rooms = await readFriendRooms(auth.member.id, people.filter(person => !person.me).map(person => person.memberId));
    const audience = sharingAudience(people, rooms);
    await assertGameMemberAuthCurrentTx(auth, getPrisma());
    return await shareWithFriends({ auth, body, rooms, audience, signal });
  } catch (error) {
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: "PROGRESS_SHARING_UNAVAILABLE", httpStatus: 503, retryable: true,
      message: "Sharing is temporarily unavailable." });
  }
}

/** Several games on one date contribute once to that date's aggregate point. */
export function friendDaily(amounts: readonly DayAmount[], measureId: string): NonNullable<FriendSeries["daily"]> {
  const daily = new Map<string, number>();
  for (const point of amounts) if (point.measureId === measureId) daily.set(point.date, (daily.get(point.date) ?? 0) + point.amount);
  return [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }));
}

function audienceChanged() {
  return hostedOnboardingError({ code: "PROGRESS_FRIENDS_CHANGED", httpStatus: 409, message: "Your friends changed. Reload Progress." });
}
