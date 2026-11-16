import { expect, it } from "vitest";
import { friendAmount, friendPasses, friendsView, type FriendSeries } from "../src/lib/game/progress/friends";

const measure = { id: "pushups.reps", label: "Pushups", icon: "pushups", format: "count" as const, noun: "pushups" };
const person = (memberId: string, firstName: string, amount: number, me = false): FriendSeries => ({
  memberId, firstName, avatarUrl: null, me, invited: false, joinedOn: "2026-10-21",
  daily: [{ date: "2026-11-01", amount }],
});
const view = (people: FriendSeries[]) => friendsView({ units: "us", people, measure, pills: [measure],
  query: { measure: measure.id, range: "month" }, today: "2026-11-16", shareAudience: [], incomplete: false, departureNotice: null });

it("competition ranks ties 1, 2, 2, 4", () => {
  expect(view([person("sam", "Sam", 960), person("ava", "Ava", 900, true),
    person("leo", "Leo", 900), person("maya", "Maya", 420)]).rows.map(row => row.rank)).toEqual([1, 2, 2, 4]);
});

it("ranks the unrounded amount even when the displayed totals match", () => {
  const result = view([person("ava", "Ava", 100.1, true), person("leo", "Leo", 100.2)]);
  expect(result.rows.map(row => row.memberId)).toEqual(["leo", "ava"]);
  expect(result.rows.map(row => row.rank)).toEqual([1, 2]);
  expect(result.rows.map(row => row.total?.text)).toEqual(["100", "100"]);
});

it("a private friend has no rank, amount, line or gap", () => {
  const result = view([person("ava", "Ava", 900, true), { ...person("leo", "Leo", 99999), daily: null }]);
  expect(result.rows[1]).toMatchObject({ private: true, rank: null, total: null });
  expect(result.chart.map(line => line.memberId)).toEqual(["ava"]);
  expect(result.next).toBeNull();
  expect(friendPasses({ measureId: measure.id, people: [person("ava", "Ava", 900, true),
    { ...person("leo", "Leo", 1), daily: null }] })).toEqual([]);
});

it.each(["pushups.reps", "steps", "sleep"])("charts every ranked person for %s", id => {
  const people = [person("sam", "Sam", 120), person("maya", "Maya", 110), person("leo", "Leo", 100),
    person("ava", "Ava", 90, true), person("jordan", "Jordan", 80), person("priya", "Priya", 70)];
  const result = friendsView({ units: "us", people, measure: { ...measure, id }, pills: [], query: { measure: id, range: "month" },
    today: "2026-11-16", shareAudience: [], incomplete: false, departureNotice: null });
  expect(result.chart).toEqual(people.map(person => ({ memberId: person.memberId,
    points: [["2026-11-01", person.daily![0].amount]] })));
  expect(result.rows.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.incomplete).toBe(false);
});

it.each(["steps", "sleep"])("never settles friend awards from %s", measureId => {
  expect(friendPasses({ measureId, people: [person("ava", "Ava", 900, true), person("leo", "Leo", 700)] })).toEqual([]);
});

it("dates an all-time pass on the original crossing and emits it only once", () => {
  const me = { ...person("ava", "Ava", 100, true), daily: [
    { date: "2026-11-01", amount: 100 }, { date: "2026-11-03", amount: 200 }, { date: "2026-11-04", amount: 300 },
  ] };
  const result = friendPasses({ measureId: measure.id, people: [me, person("leo", "Leo", 200)] });
  expect(result).toEqual([expect.objectContaining({ key: "friend:pushups.reps:leo", kind: "friend",
    subjectMemberId: "leo", on: "2026-11-03", data: expect.objectContaining({ amount: 300, otherAmount: 200 }) })]);
});

it("filters the drawer's dates without changing the all-time award input", () => {
  const me = { ...person("ava", "Ava", 900, true), daily: [
    { date: "2026-10-30", amount: 1000 }, { date: "2026-11-01", amount: 900 }, { date: "2026-11-16", amount: 100 },
  ] };
  const people = [me, person("leo", "Leo", 700), person("sam", "Sam", 900)];
  const result = friendsView({ units: "us", people, measure, pills: [measure], query: { measure: measure.id, range: "week", with: "leo" },
    today: "2026-11-16", shareAudience: [], incomplete: false, departureNotice: null });
  expect(result.rows.map(row => [row.memberId, row.total?.value])).toEqual([["ava", 100], ["leo", 0]]);
  expect(result.chart).toEqual([{ memberId: "ava", points: [["2026-11-16", 100]] }, { memberId: "leo", points: [] }]);
  expect(friendPasses({ measureId: measure.id, people }).map(award => award.on)).toEqual(["2026-10-30", "2026-10-30"]);
});

it("formats route distance in miles while retaining canonical meters", () => {
  expect(friendAmount(3218.688, { id: "walk.meters", format: "distance", noun: "walked" }, "us"))
    .toEqual({ value: 3218.688, text: "2 mi", unit: "meters" });
});
