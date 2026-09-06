import assert from "node:assert/strict";
import { test } from "vitest";

import { matchPersonalPatternDates } from "../src/personal-pattern-matching.ts";

const daysBetween = (left: string, right: string) =>
  Math.abs(Date.parse(left) - Date.parse(right)) / 86_400_000;

test("date matching maximizes pairs then minimizes distance across small exhaustive histories", () => {
  const dates = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10),
  );
  for (let history = 0; history < 3 ** dates.length; history += 1) {
    let remaining = history;
    const exposed: string[] = [];
    const controls: string[] = [];
    for (const date of dates) {
      const state = remaining % 3;
      remaining = Math.floor(remaining / 3);
      if (state === 1) exposed.push(date);
      if (state === 2) controls.push(date);
    }
    const possible: Array<{ count: number; distance: number }> = [];
    // Independent brute force checks all assignments, including crossing ones.
    function enumerate(index: number, available: string[], count: number, distance: number) {
      if (index === exposed.length) {
        possible.push({ count, distance });
        return;
      }
      enumerate(index + 1, available, count, distance);
      for (const control of available) {
        const gap = daysBetween(exposed[index], control);
        if (gap > 35) continue;
        enumerate(index + 1, available.filter((date) => date !== control), count + 1, distance + gap);
      }
    }
    enumerate(0, controls, 0, 0);
    possible.sort((a, b) => b.count - a.count || a.distance - b.distance);
    const matched = matchPersonalPatternDates(exposed, controls, 35);
    assert.equal(matched.size, possible[0].count);
    assert.equal([...matched].reduce((sum, [a, b]) => sum + daysBetween(a, b), 0), possible[0].distance);
    assert.equal(new Set(matched.values()).size, matched.size);
  }
});

test("date matching keeps weekday, distance, uniqueness, and deterministic tie boundaries", () => {
  const matched = matchPersonalPatternDates(
    ["2026-01-19", "2026-01-19", "2026-01-20"],
    ["2026-01-26", "2026-01-12", "2026-01-12", "2026-01-21", "2026-03-03"],
    35,
  );
  assert.deepEqual([...matched], [["2026-01-19", "2026-01-12"]]);
});
