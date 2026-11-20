import { addDaysToIsoDate } from "@murphai/contracts";
import type { ClientUnits } from "../../companion/client-info";
import type { Amount, Friends, FriendsQuery, Measure } from "./contract";
import type { Candidate } from "./registry";
import { formatAmount, formatNumber } from "./format";
import { HEALTH_RECS } from "./health";

export interface FriendSeries {
  memberId: string;
  firstName: string;
  avatarUrl: string | null;
  me: boolean;
  joinedOn: string | null;
  /** Null is private or unavailable; it never participates in totals or ranks. */
  daily: { date: string; amount: number }[] | null;
}
export type FriendMeasure = Pick<Measure, "id" | "label" | "icon" | "format" | "noun">;

export function friendRangeStart(range: FriendsQuery["range"], today: string) {
  return range === "month" ? `${today.slice(0, 7)}-01`
    : range === "week" ? addDaysToIsoDate(today, -6) : "0000-01-01";
}

export function friendsView(input: {
  people: readonly FriendSeries[]; measure: FriendMeasure; pills: Friends["pills"];
  query: FriendsQuery; today: string; shareAudience: Friends["shareAudience"];
  incomplete: boolean; departureNotice: string | null;
  units: ClientUnits; challenge: Friends["challenge"];
}): Friends {
  const { measure, query, today } = input;
  const from = friendRangeStart(query.range, today);
  const people = input.people.filter(person => !query.with || person.me || person.memberId === query.with);
  const health = measure.id === "steps" || measure.id === "sleep";
  const series = people.map(person => {
    let total = 0;
    const points: [string, number][] = (person.daily ?? [])
      .filter(day => day.date >= from && day.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(day => [day.date, total += day.amount]);
    return { person, total, points, ranked: person.daily !== null && (!health || points.length > 0) };
  });
  const ranked = series.filter(row => row.ranked)
    .sort((a, b) => b.total - a.total || Number(b.person.me) - Number(a.person.me) || a.person.memberId.localeCompare(b.person.memberId));
  // A friend who keeps this number private isn't on the board; your own row always is.
  const unranked = series.filter(row => !row.ranked && (row.person.me || row.person.daily !== null));
  const rows: Friends["rows"] = [...ranked, ...unranked].map(({ person, total, ranked: hasTotal }) => {
    const identity = { memberId: person.memberId, firstName: person.firstName, avatarUrl: person.avatarUrl,
      me: person.me, invited: false, joinedOn: person.joinedOn };
    return person.daily === null ? { ...identity, private: true, rank: null, total: null }
      : { ...identity, private: false, rank: hasTotal && ranked.length > 1 ? ranked.findIndex(row => row.total === total) + 1 : null,
        total: hasTotal ? friendAmount(total, measure, input.units) : null };
  });
  const chart = ranked.map(row => ({ memberId: row.person.memberId, points: row.points }));
  return { incomplete: input.incomplete, departureNotice: input.departureNotice,
    pills: input.pills, pill: measure.id, range: query.range, rows, chart,
    shareAsk: health && input.shareAudience.length > 0,
    shareAudience: input.shareAudience, challenge: input.challenge };
}

/** Steps and sleep suggest what Health does; an exercise, your own last task on it. */
export function friendChallenge(measureId: string, lastTask: string | undefined): Friends["challenge"] {
  if (measureId === "steps") return { task: "10,000 steps every day", category: "move" };
  if (measureId === "sleep") return { task: HEALTH_RECS.sleep[0]!.task, category: "calm" };
  if (!lastTask) return null;
  const name = measureId.split(".")[0];
  return { task: lastTask, category: name === "walk" || name === "run" ? "move"
    : ["meditation", "stretching", "yoga"].includes(name) ? "calm" : "strength" };
}

export function friendAmount(value: number, measure: Pick<FriendMeasure, "id" | "format" | "noun">, units: ClientUnits): Amount {
  if (measure.format === "duration") return formatAmount(value, "seconds", "compact", units);
  if (measure.format === "distance") return formatAmount(value, "meters", "compact", units);
  return { value, text: formatNumber(value, "compact"), unit: measure.id.split(".").at(-1)! };
}

/** Days a friend must have done an exercise before passing them in it counts. */
export const FRIEND_PASS_MIN_DAYS = 3;

/** One all-time pass per friend and exercise; a later correction cannot revoke it.
 * Passing someone who'd barely done it isn't a pass: they need FRIEND_PASS_MIN_DAYS
 * days of it by then, or it waits for the next time you pass them. */
export function friendPasses(input: { measureId: string; people: readonly FriendSeries[] }): Candidate[] {
  if (input.measureId === "steps" || input.measureId === "sleep") return [];
  const me = input.people.find(person => person.me);
  if (!me?.daily) return [];
  const candidates: Candidate[] = [];
  for (const friend of input.people) {
    if (friend.me || friend.daily === null) continue;
    const mine = new Map(me.daily.map(day => [day.date, day.amount]));
    const theirs = new Map(friend.daily.map(day => [day.date, day.amount]));
    const dates = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
    let myTotal = 0, theirTotal = 0, theirDays = 0;
    for (const on of dates) {
      const wasBehind = myTotal <= theirTotal;
      myTotal += mine.get(on) ?? 0;
      theirTotal += theirs.get(on) ?? 0;
      if ((theirs.get(on) ?? 0) > 0) theirDays += 1;
      if (wasBehind && myTotal > theirTotal && theirDays >= FRIEND_PASS_MIN_DAYS) {
        candidates.push({ key: `friend:${input.measureId}:${friend.memberId}`, kind: "friend",
          measureId: input.measureId, subjectMemberId: friend.memberId, on,
          data: { title: `Passed ${friend.firstName}`, face: { member: { memberId: friend.memberId,
            firstName: friend.firstName, avatarUrl: friend.avatarUrl } }, detail: "all-time total", page: "friends", evaluator: 1,
            amount: myTotal, otherAmount: theirTotal } });
        break;
      }
    }
  }
  return candidates;
}
