import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GoalsPage from "../app/goals/page";
import { GoalBrowseCard } from "../src/components/goals/goal-browse-card";
import { getGoalCategoryVisual } from "../src/components/goals/goal-visual";
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

  it("covers every generated Goal with known category and outcome metadata", () => {
    const goals = listHealthCommonsGoalEntries();

    expect(goals.length).toBeGreaterThanOrEqual(250);
    for (const goal of goals) {
      expect(() => getGoalCategoryVisual(goal.category)).not.toThrow();
      expect(OUTCOME_KINDS).toContain(goal.outcomeKind);
    }
  });

  it("renders full-width search and one illustration per category, not repeated glyphs", async () => {
    const element = <GoalsPage />;
    const markup = renderToStaticMarkup(element);

    assert.match(markup, /data-goal-search="full-width"/u);
    assert.doesNotMatch(markup, /<form[^>]*(?:action=|method=)/u);
    assert.doesNotMatch(markup, /<input[^>]*name=/u);
    assert.equal(
      (markup.match(/data-goal-category-visual=/gu) ?? []).length,
      GOAL_CATEGORIES.length,
    );
    assert.doesNotMatch(markup, /data-goal-outcome-visual=/u);
    assert.equal((markup.match(/<li class="min-w-0">/gu) ?? []).length, 28);
    assert.match(markup, /sm:min-h-24/u);
    assert.match(markup, /min-h-20/u);
  });

  it("keeps each goal tile title-only and free of decorative icons", () => {
    const markup = renderToStaticMarkup(
      <GoalBrowseCard href="/goals/improve-deep-sleep" title="Improve My Deep Sleep" />,
    );

    assert.match(markup, />Improve My Deep Sleep</u);
    assert.doesNotMatch(markup, /<svg\b/u);
    assert.doesNotMatch(markup, /<p\b/u);
    assert.doesNotMatch(markup, /font-mono/u);
  });
});
