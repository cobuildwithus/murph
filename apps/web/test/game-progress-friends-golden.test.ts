import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { friendsSchema } from "../src/lib/game/progress/contract";
import { friendsView, type FriendSeries } from "../src/lib/game/progress/friends";

const directory = path.join(import.meta.dirname, "fixtures/progress");
it.each(readdirSync(directory).filter(name => name.startsWith("friends-")))("renders BE0's %s from matching daily amounts", name => {
  const expected = friendsSchema.parse(JSON.parse(readFileSync(path.join(directory, name), "utf8")));
  const today = expected.chart.flatMap(line => line.points.map(([date]) => date)).sort().at(-1) ?? "2026-11-14";
  const people: FriendSeries[] = expected.rows.map(row => {
    const points = expected.chart.find(line => line.memberId === row.memberId)?.points;
    let previous = 0;
    const daily = row.private || row.invited ? null : points ? points.map(([date, amount]) => {
      const delta = amount - previous; previous = amount; return { date, amount: delta };
    }) : row.total?.value ? [{ date: today, amount: row.total.value }] : [];
    return { memberId: row.memberId, firstName: row.firstName, avatarUrl: row.avatarUrl,
      me: row.me, invited: row.invited, joinedOn: row.joinedOn, daily };
  });
  const pill = expected.pills.find(pill => pill.id === expected.pill)!;
  expect(friendsView({ people, measure: { ...pill, noun: pill.label.toLowerCase(),
    format: pill.id.endsWith(".seconds") || pill.id === "sleep" ? "duration" : "count" },
  pills: expected.pills, query: { measure: pill.id, range: expected.range }, today,
  shareAudience: expected.shareAudience, incomplete: false, departureNotice: expected.departureNotice })).toEqual(expected);
});
