import { describe, expect, it } from "vitest";

import {
  searchGoalItems,
  type GoalSearchItem,
} from "../src/lib/goals/goal-search";

function goal(input: {
  goalPhrase?: string;
  routeId: string;
  searchText?: string;
  title: string;
}): GoalSearchItem {
  return {
    goalPhrase: input.goalPhrase ?? input.title.toLowerCase(),
    key: `goal_template:${input.routeId}`,
    routeId: input.routeId,
    searchText: input.searchText ?? input.title.toLowerCase(),
    title: input.title,
  };
}

describe("goal search", () => {
  it("ranks direct title matches ahead of aliases and summaries", () => {
    const direct = goal({
      routeId: "improve-deep-sleep",
      title: "Improve My Deep Sleep",
    });
    const indirect = goal({
      routeId: "sleep-better",
      searchText: "sleep better improve my deep sleep restorative rest",
      title: "Sleep Better",
    });

    expect(searchGoalItems([indirect, direct], "improve my deep sleep"))
      .toEqual([direct, indirect]);
  });

  it("matches word prefixes without matching inside unrelated words", () => {
    const running = goal({
      routeId: "start-running",
      searchText: "start running beginner run",
      title: "Start Running",
    });
    const routine = goal({
      routeId: "build-morning-routine",
      searchText: "build a morning routine",
      title: "Build a Morning Routine",
    });

    expect(searchGoalItems([routine, running], "run")).toEqual([running]);
  });

  it("treats subscript digits and plain digits as the same query", () => {
    const vo2 = goal({
      routeId: "improve-vo2-max",
      title: "Improve My VO₂ Max",
    });

    expect(searchGoalItems([vo2], "vo2")).toEqual([vo2]);
  });
});
