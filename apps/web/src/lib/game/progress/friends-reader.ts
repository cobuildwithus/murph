import "server-only";
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
import { friendChallenge, friendPasses, friendsView, type FriendSeries } from "./friends";
import { settleAwards } from "./awards";
import type { DayAmount } from "./registry";
import { scheduleInference } from "./series";

export async function readProgressFriends(auth: HostedNativeMemberAuth, query: FriendsQuery, signal: AbortSignal, units: ClientUnits) {
  try {
    const db = getPrisma(), memberId = auth.member.id;
    const cohort = await readFriendCohort(memberId), ids = cohort.people.map(person => person.memberId);
    if (query.with && !cohort.people.some(person => person.memberId === query.with)) throw gameNotFound();
    const metric = query.measure;
    const health = metric === "steps" || metric === "sleep";
    const gameRead = readFriendGameSeries(ids);
    const roomRead = readFriendRooms(memberId, ids.filter(id => id !== memberId)).then(async rooms => {
      const incomplete = cohort.incomplete || rooms.incomplete;
      const series = health && !incomplete
        ? await readFriendHealthSeries({ auth, people: cohort.people, rooms: rooms.rooms, with: query.with,
            metric, timeZone: cohort.timeZone, signal })
        : { people: [], incomplete };
      return { rooms, series };
    });
    // Drain both branches in the request scope, then inspect errors in their original order.
    await Promise.all([gameRead, roomRead].map(read => read.catch(() => undefined)));
    const games = await gameRead;
    const pills = friendPills(games, memberId, ids, query.measure);
    const measure = friendMeasure(query.measure);
    const { rooms, series } = await roomRead;
    let incomplete = series.incomplete || (!health && games.incomplete);
    let people = series.people;
    if (!health && !incomplete) {
      people = cohort.people.map(person => ({ ...person, daily: friendDaily(games.amounts.get(person.memberId) ?? [], query.measure) }));
    }
    const current = await friendCohortIds(memberId, db);
    incomplete ||= current.incomplete;
    people = incomplete ? [] : people.filter(person => current.ids.includes(person.memberId));
    if (!incomplete && !health && games.pending.length === 0) {
      await settleGameFriendAwards(auth, games, people, [query.measure]);
    }
    await assertGameMemberAuthCurrentTx(auth, db);
    scheduleFriendInference(auth, games.pending);
    const shareAudience = incomplete ? [] : sharingPreview(people, rooms.rooms, query.measure);
    return friendsView({ people, measure, pills, query, units, today: toLocalDayKey(new Date(), cohort.timeZone),
      shareAudience, incomplete, departureNotice: cohort.departureNotice,
      challenge: friendChallenge(query.measure, games.tasks.get(memberId)?.get(query.measure)?.text) });
  } catch (error) {
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: "PROGRESS_FRIENDS_UNAVAILABLE", httpStatus: 503, retryable: true,
      message: "Friends progress is temporarily unavailable." });
  }
}

/** All exercise pills share one cohort, one game-series read and one award commit. */
export async function settleProgressFriends(auth: HostedNativeMemberAuth) {
  const db = getPrisma(), memberId = auth.member.id;
  await assertGameMemberAuthCurrentTx(auth, db);
  const cohort = await readFriendCohort(memberId);
  if (cohort.incomplete) return;
  const ids = cohort.people.map(person => person.memberId);
  if (!cohort.people.some(person => !person.me)) return;
  const games = await readFriendGameSeries(ids);
  if (games.incomplete) return;
  const current = await friendCohortIds(memberId, db);
  if (current.incomplete) return;
  const people = cohort.people.filter(person => current.ids.includes(person.memberId));
  if (games.pending.length === 0) await settleGameFriendAwards(auth, games, people, friendExerciseIds(games, memberId, ids));
  await assertGameMemberAuthCurrentTx(auth, db);
  scheduleFriendInference(auth, games.pending.filter(task => task.memberId !== memberId));
}

async function settleGameFriendAwards(auth: HostedNativeMemberAuth, games: FriendGameSeries, people: FriendSeries[], measures: string[]) {
  const memberId = auth.member.id;
  const candidates = measures.flatMap(measureId => friendPasses({ measureId,
    people: people.map(person => ({ ...person, daily: friendDaily(games.amounts.get(person.memberId) ?? [], measureId) })),
  }));
  await settleAwards(memberId, candidates, async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    for (const subject of [...new Set(candidates.map(candidate => candidate.subjectMemberId!))].sort()) await lockGamePair(tx, memberId, subject);
    const atCommit = await friendCohortIds(memberId, tx);
    if (atCommit.incomplete || people.some(person => !atCommit.ids.includes(person.memberId))) throw audienceChanged();
  });
}

function scheduleFriendInference(auth: HostedNativeMemberAuth, pending: FriendGameSeries["pending"]) {
  const memberId = auth.member.id;
  scheduleInference(pending, async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    const owners = [...new Set(pending.map(task => task.memberId))].sort();
    for (const owner of owners) if (owner !== memberId) await lockGamePair(tx, memberId, owner);
    const atCommit = await friendCohortIds(memberId, tx);
    if (atCommit.incomplete || owners.some(owner => !atCommit.ids.includes(owner))) throw audienceChanged();
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
  if (!["steps", "sleep"].includes(selected) && !mine.has(selected) && !games.incomplete && !games.pending.length) throw gameNotFound();
  const exercises = friendExerciseIds(games, memberId, ids);
  return [...exercises.map(id => games.measures.get(id)!),
    { id: "steps", label: "Steps", icon: "steps" }, { id: "sleep", label: "Sleep", icon: "sleep" }]
    .map(({ id, label, icon }) => ({ id, label, icon }));
}

function sharingPreview(people: FriendSeries[], rooms: FriendRoom[], measure: string): Friends["shareAudience"] {
  if (measure !== "steps" && measure !== "sleep" || !rooms.some(room => !room.shared.includes(measure as "steps" | "sleep"))) return [];
  return sharingAudience(people, rooms);
}

function sharingAudience(people: FriendSeries[], rooms: FriendRoom[]): Friends["shareAudience"] {
  return people.filter(person => rooms.some(room => room.otherMemberId === person.memberId))
    .map(({ memberId, firstName, avatarUrl }) => ({ memberId, firstName, avatarUrl }));
}

export async function setProgressFriendSharing(auth: HostedNativeMemberAuth, body: SetSharingBody, signal: AbortSignal) {
  try {
    const cohort = await readFriendCohort(auth.member.id);
    const rooms = await readFriendRooms(auth.member.id, cohort.people.filter(person => !person.me).map(person => person.memberId));
    if (cohort.incomplete || rooms.incomplete) throw hostedOnboardingError({ code: "PROGRESS_INCOMPLETE", httpStatus: 409,
      message: "The full sharing audience could not be loaded." });
    const audience = sharingAudience(cohort.people, rooms.rooms);
    await assertGameMemberAuthCurrentTx(auth, getPrisma());
    return await shareWithFriends({ auth, body, rooms: rooms.rooms, audience, signal });
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
