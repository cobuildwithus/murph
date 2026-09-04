import { describe, expect, it } from "vitest";

import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";
import { selectRelatedGoals } from "@/src/lib/goals/goal-related";

function goal(
  routeId: string,
  parentRouteId: string | null = null,
): GoalIndexEntryModel {
  return {
    aliases: [],
    category: "sleep",
    goalPhrase: routeId.replaceAll("-", " "),
    key: `goal_template:${routeId}`,
    outcomeKind: "behavior",
    parentGoalKey: parentRouteId ? `goal_template:${parentRouteId}` : null,
    routeId,
    startPrompt: `Hey Murph, help me ${routeId.replaceAll("-", " ")}.`,
    summary: `Summary for ${routeId}.`,
    title: routeId,
  };
}

const CATEGORY = [
  goal("sleep-better"),
  goal("improve-deep-sleep", "sleep-better"),
  goal("fall-asleep-faster", "sleep-better"),
  goal("sleep-through-the-night", "sleep-better"),
  goal("fix-my-sleep-schedule"),
  goal("have-fewer-nightmares"),
  goal("recover-from-sleep-debt"),
  goal("adjust-to-daylight-saving-time"),
];

describe("selectRelatedGoals", () => {
  it("leads with the parent, then siblings, then featured roots, never itself", () => {
    const related = selectRelatedGoals(
      goal("improve-deep-sleep", "sleep-better"),
      CATEGORY,
      ["recover-from-sleep-debt", "sleep-better"],
    );

    expect(related.map((entry) => entry.routeId)).toEqual([
      "sleep-better",
      "fall-asleep-faster",
      "sleep-through-the-night",
      "recover-from-sleep-debt",
      "fix-my-sleep-schedule",
      "have-fewer-nightmares",
    ]);
  });

  it("lists children before other roots for a top-level goal", () => {
    const related = selectRelatedGoals(goal("sleep-better"), CATEGORY, [], 4);

    expect(related.map((entry) => entry.routeId)).toEqual([
      "improve-deep-sleep",
      "fall-asleep-faster",
      "sleep-through-the-night",
      "fix-my-sleep-schedule",
    ]);
  });

  it("returns nothing when the goal is alone in its category", () => {
    expect(selectRelatedGoals(goal("sleep-better"), [goal("sleep-better")])).toEqual([]);
  });
});
