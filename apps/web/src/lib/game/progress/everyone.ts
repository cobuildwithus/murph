import "server-only";
import type { Prisma } from "@prisma/client";
import { toLocalDayKey } from "@murphai/contracts";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import type { ClientUnits } from "../../companion/client-info";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { getPrisma } from "../../prisma";
import { isHiddenBy, readGameBlocks } from "../blocks";
import { openGameTexts } from "../crypto";
import { assertGameMemberAuthCurrentTx } from "../http/auth";
import { gameNotFound } from "../http/errors";
import { gameMediaUrl } from "../views";
import type { Friends, FriendsQuery } from "./contract";
import { friendMeasure, readFriendGameSeries } from "./friend-games";
import { friendPills } from "./friend-pills";
import { friendDaily, friendRangeStart, friendsView, isEveryoneMeasure, orderFriends, type FriendSeries } from "./friends";
import { ProgressReadTiming } from "./read-timing";

type Db = Pick<Prisma.TransactionClient, "gameProfile" | "gameBlock">;
const COHORT_PAGE = 500;

function notJoined() {
  return hostedOnboardingError({ code: "EVERYONE_NOT_JOINED", httpStatus: 403,
    message: "Join Everyone to see this board." });
}

/** Public membership facts only; each page bounds the profile and block reads. */
export async function everyoneCohortIds(memberId: string, db: Db, signal?: AbortSignal, subjects?: readonly string[]) {
  signal?.throwIfAborted();
  const own = await db.gameProfile.findUnique({ where: { memberId },
    select: { everyoneJoinedAt: true, timeZone: true, member: { select: { suspendedAt: true } } } });
  signal?.throwIfAborted();
  if (!own?.everyoneJoinedAt || own.member.suspendedAt) throw notJoined();
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await db.gameProfile.findMany({
      where: { everyoneJoinedAt: { not: null }, member: { suspendedAt: null },
        memberId: { ...(subjects && { in: [...subjects] }), ...(after && { gt: after }) } },
      select: { memberId: true }, orderBy: { memberId: "asc" }, take: COHORT_PAGE,
    });
    signal?.throwIfAborted();
    const blocks = await readGameBlocks(db, memberId, page.map(profile => profile.memberId));
    signal?.throwIfAborted();
    ids.push(...page.filter(profile => !isHiddenBy(blocks, profile.memberId)).map(profile => profile.memberId));
    if (page.length < COHORT_PAGE) break;
    after = page.at(-1)!.memberId;
  }
  // A leave between the own-profile read and the page must not yield a board without its viewer.
  if (!ids.includes(memberId)) throw notJoined();
  return { ids, timeZone: own.timeZone };
}

/** Read-only month board. Only the positional neighbours' identities are opened. */
export async function readProgressEveryone(auth: HostedNativeMemberAuth, query: FriendsQuery, signal: AbortSignal,
  units: ClientUnits, timing = new ProgressReadTiming()): Promise<Friends> {
  if (!isEveryoneMeasure(query.measure)) throw gameNotFound();
  try {
    const db = getPrisma(), memberId = auth.member.id;
    const cohort = await timing.measure("cohort", () => everyoneCohortIds(memberId, db, signal));
    timing.counts.friends = cohort.ids.length - 1;
    const today = toLocalDayKey(new Date(), cohort.timeZone);
    const games = await timing.measure("gameSeries", () => readFriendGameSeries(cohort.ids, timing,
      { viewer: memberId, period: { from: friendRangeStart("month", today), to: today } }, signal));
    const people: FriendSeries[] = cohort.ids.map(id => ({ memberId: id, firstName: "", avatarUrl: null,
      me: id === memberId, joinedOn: null, daily: friendDaily(games.amounts.get(id) ?? [], query.measure) }));
    const { ranked } = orderFriends(people, query.measure, query, today);
    const position = ranked.findIndex(row => row.person.me);
    const neighbours = ranked.slice(Math.max(0, position - 3), position + 4);
    const chartIds = new Set(ranked.slice(Math.max(0, position - 3), position + 1).map(row => row.person.memberId));
    const selectedIds = neighbours.map(row => row.person.memberId);
    const profiles = await timing.measure("profile", () => db.gameProfile.findMany({
      where: { memberId: { in: selectedIds }, everyoneJoinedAt: { not: null }, member: { suspendedAt: null } },
      select: { memberId: true, firstNameEncrypted: true, photoKey: true }, take: selectedIds.length,
    }));
    signal.throwIfAborted();
    const names = await timing.measure("profile", () => openGameTexts(profiles.map(profile => ({
      memberId: profile.memberId, table: "game_profile" as const, rowId: profile.memberId,
      field: "first_name", value: profile.firstNameEncrypted,
    })), signal));
    const current = await timing.measure("cohort", () => everyoneCohortIds(memberId, db, signal, selectedIds));
    const currentIds = new Set(current.ids);
    const identities = new Map(profiles.map((profile, index) => [profile.memberId, {
      firstName: names[index]!, avatarUrl: profile.photoKey ? gameMediaUrl(profile.photoKey) : null,
    }]));
    const visible = neighbours.flatMap(({ person }) => {
      const identity = identities.get(person.memberId);
      return currentIds.has(person.memberId) && identity ? [{ ...person, ...identity }] : [];
    });
    // A profile removed during the identity read cannot remove the viewer silently.
    if (!visible.some(person => person.me)) throw notJoined();
    await timing.measure("auth", () => assertGameMemberAuthCurrentTx(auth, db));
    signal.throwIfAborted();
    const pills = friendPills(games, memberId, [memberId], query.measure, false);
    return timing.measure("render", (): Friends => {
      const view = friendsView({ people: visible, measure: friendMeasure(query.measure), pills, query, today, units,
        everyoneJoined: true, shareAudience: [], departureNotice: null, challenge: null });
      return { scope: "everyone", everyoneJoined: true, incomplete: view.incomplete,
        pills: view.pills, pill: view.pill, range: "month",
        rows: view.rows.map(row => ({ memberId: row.memberId, firstName: row.firstName, avatarUrl: row.avatarUrl,
          me: row.me, invited: false, joinedOn: null, private: false, rank: null, total: row.total })),
        chart: view.chart.filter(line => chartIds.has(line.memberId)),
        shareAsk: false, shareAudience: [], departureNotice: null, challenge: null };
    });
  } catch (error) {
    signal.throwIfAborted();
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: "PROGRESS_FRIENDS_UNAVAILABLE", httpStatus: 503, retryable: true,
      message: "Everyone progress is temporarily unavailable." });
  }
}
