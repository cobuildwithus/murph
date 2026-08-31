import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GoalsPage from "../app/goals/page";
import {
  GoalOutcomeMark,
  getGoalCategoryVisual,
} from "../src/components/goals/goal-visual";
import { GOAL_CATEGORIES } from "../src/lib/goals/goal-categories";
import type { GoalOutcomeKind } from "../src/lib/goals/goal-models";
import { listHealthCommonsGoalEntries } from "../src/lib/health-commons/goal-projections";

const OUTCOME_KINDS: readonly GoalOutcomeKind[] = [
  "behavior",
  "biomarker",
  "capacity",
  "event",
  "function",
  "skill",
  "symptom",
];

describe("Goal visual system", () => {
  it("maps every category to a distinct checked-in illustration", () => {
    const artwork = GOAL_CATEGORIES.map((category) => {
      const visual = getGoalCategoryVisual(category.slug);
      const asset = new URL(`../public${visual.artwork}`, import.meta.url);

      expect(existsSync(asset)).toBe(true);
      return visual.artwork;
    });

    expect(new Set(artwork).size).toBe(GOAL_CATEGORIES.length);
  });

  it("covers every generated Goal with a category treatment and outcome glyph", () => {
    const goals = listHealthCommonsGoalEntries();

    expect(goals.length).toBeGreaterThanOrEqual(250);
    for (const goal of goals) {
      expect(() => getGoalCategoryVisual(goal.category)).not.toThrow();
      expect(OUTCOME_KINDS).toContain(goal.outcomeKind);
    }

    const markup = OUTCOME_KINDS.map((outcomeKind) =>
      renderToStaticMarkup(
        <GoalOutcomeMark category="sleep" outcomeKind={outcomeKind} />,
      )
    ).join("");
    for (const outcomeKind of OUTCOME_KINDS) {
      assert.match(markup, new RegExp(`data-goal-outcome-visual="${outcomeKind}"`));
    }
    assert.equal(
      (
        markup.match(
          /<span aria-hidden="true"[^>]*data-goal-outcome-visual=/gu,
        ) ?? []
      ).length,
      OUTCOME_KINDS.length,
    );
  });

  it("renders the large full-width search and a visual on every featured card", async () => {
    const element = await GoalsPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(element);

    assert.match(markup, /data-goal-search="full-width"/u);
    assert.equal(
      (markup.match(/data-goal-category-visual=/gu) ?? []).length,
      GOAL_CATEGORIES.length,
    );
    assert.equal((markup.match(/data-goal-outcome-visual=/gu) ?? []).length, 28);
    assert.equal((markup.match(/<li class="min-w-0">/gu) ?? []).length, 28);
    assert.match(markup, /sm:min-h-\[17rem\]/u);
    assert.match(markup, /min-h-\[8\.75rem\]/u);
  });
});
