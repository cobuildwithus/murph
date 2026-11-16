import { addDaysToIsoDate } from "@murphai/contracts";
import type { ClientUnits } from "../../companion/client-info";
import type { Amount, Friends, FriendsQuery, Measure } from "./contract";
import type { Candidate } from "./registry";
import { formatAmount, formatNumber } from "./format";

export interface FriendSeries {
  memberId: string;
  firstName: string;
  avatarUrl: string | null;
  me: boolean;
  invited: boolean;
  joinedOn: string | null;
  /** Null is private or unavailable; it never participates in totals or ranks. */
  daily: { date: string; amount: number }[] | null;
}
export type FriendMeasure = Pick<Measure, "id" | "label" | "icon" | "format" | "noun">;

export function friendsView(input: {
  people: readonly FriendSeries[]; measure: FriendMeasure; pills: Friends["pills"];
  query: FriendsQuery; today: string; shareAudience: Friends["shareAudience"];
  incomplete: boolean; departureNotice: string | null;
  units: ClientUnits;
}): Friends {
  const { measure, query, today } = input;
  const from = query.range === "month" ? `${today.slice(0, 7)}-01`
    : query.range === "week" ? addDaysToIsoDate(today, -6) : "0000-01-01";
  const people = input.people.filter(person => !query.with || person.me || person.memberId === query.with);
  const series = people.map(person => {
    let total = 0;
    const points: [string, number][] = (person.daily ?? [])
      .filter(day => day.date >= from && day.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(day => [day.date, total += day.amount]);
    return { person, total, points };
  });
  const ranked = series.filter(({ person }) => person.daily !== null && !person.invited)
    .sort((a, b) => b.total - a.total || Number(b.person.me) - Number(a.person.me) || a.person.memberId.localeCompare(b.person.memberId));
  const rows: Friends["rows"] = [...ranked, ...series.filter(({ person }) => person.daily === null || person.invited)].map(({ person, total }) => {
    const visible = person.daily !== null && !person.invited;
    const identity = { memberId: person.memberId, firstName: person.firstName, avatarUrl: person.avatarUrl,
      me: person.me, invited: person.invited, joinedOn: person.joinedOn };
    return !visible && !person.invited ? { ...identity, private: true, rank: null, total: null }
      : { ...identity, private: false, rank: visible && ranked.length > 1 ? ranked.findIndex(row => row.total === total) + 1 : null,
        total: visible ? friendAmount(total, measure, input.units) : null };
  });
  const me = ranked.find(row => row.person.me);
  const ahead = me ? ranked.filter(row => row.total > me.total).at(-1) : undefined;
  const gap = ahead && me ? ahead.total - me.total : null;
  const chart = ranked.map(row => ({ memberId: row.person.memberId, points: row.points }));
  return { incomplete: input.incomplete, departureNotice: input.departureNotice,
    pills: input.pills, pill: measure.id, range: query.range, rows, chart,
    next: ahead && gap !== null ? { memberId: ahead.person.memberId,
      text: `${measure.format === "duration" && gap < 3600 ? `${formatNumber(gap / 60, "compact")} min` : friendAmount(gap, measure, input.units).text} to pass ${ahead.person.firstName}` } : null,
    shareAsk: (measure.id === "steps" || measure.id === "sleep") && input.shareAudience.length > 0,
    shareAudience: input.shareAudience };
}

export function friendAmount(value: number, measure: Pick<FriendMeasure, "id" | "format" | "noun">, units: ClientUnits): Amount {
  if (measure.format === "duration") return formatAmount(value, "seconds", "compact", units);
  if (measure.format === "distance") return formatAmount(value, "meters", "compact", units);
  return { value, text: formatNumber(value, "compact"), unit: measure.id.split(".").at(-1)! };
}

/** One all-time pass per friend and exercise; a later correction cannot revoke it. */
export function friendPasses(input: { measureId: string; people: readonly FriendSeries[] }): Candidate[] {
  if (input.measureId === "steps" || input.measureId === "sleep") return [];
  const me = input.people.find(person => person.me);
  if (!me?.daily) return [];
  const candidates: Candidate[] = [];
  for (const friend of input.people) {
    if (friend.me || friend.invited || friend.daily === null) continue;
    const mine = new Map(me.daily.map(day => [day.date, day.amount]));
    const theirs = new Map(friend.daily.map(day => [day.date, day.amount]));
    const dates = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
    let myTotal = 0, theirTotal = 0;
    for (const on of dates) {
      const wasBehind = myTotal <= theirTotal;
      myTotal += mine.get(on) ?? 0;
      theirTotal += theirs.get(on) ?? 0;
      if (wasBehind && myTotal > theirTotal) {
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
