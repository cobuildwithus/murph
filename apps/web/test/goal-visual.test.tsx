import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/goals/public-murph-line", () => ({
  resolvePublicMurphLinePhoneNumber: async () => "+15550100001",
}));

import GoalsPage from "../app/goals/page";
import { GoalBrowseCard } from "../src/components/goals/goal-browse-card";
import { GoalCategoryBrowse } from "../src/components/goals/goal-category-browse";
import {
  getGoalCategoryVisual,
  GoalCategoryArtwork,
  GoalHeroArtwork,
} from "../src/components/goals/goal-visual";
import {
  getGoalCategory,
  GOAL_CATEGORIES,
} from "../src/lib/goals/goal-categories";
import { GOAL_DIRECTORY_SECTION_DEFINITIONS } from "../src/lib/goals/goal-directory-sections";
import { GOAL_ILLUSTRATION_ROUTE_IDS } from "../src/lib/goals/goal-illustrations.generated";
import { resolveGoalIllustrationSrc } from "../src/lib/goals/goal-illustrations";
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

  it("renders category artwork with its original colors softly muted", () => {
    const markup = renderToStaticMarkup(
      <GoalCategoryArtwork category="cardio" />,
    );

    assert.match(markup, /<img\b/u);
    assert.match(markup, /design-assets\/patterns\/running\.svg/u);
    assert.match(markup, /opacity-60/u);
    assert.match(markup, /saturate-50/u);
    assert.doesNotMatch(markup, /data-goal-category-mask/u);
  });

  it("uses goal-specific hero art before falling back to category art", () => {
    const specific = renderToStaticMarkup(
      <GoalHeroArtwork category="cardio" routeId="run-ironman" />,
    );
    assert.match(specific, /data-goal-hero-visual="run-ironman"/u);
    assert.match(specific, /design-assets\/goals\/run-ironman\.svg/u);
    assert.doesNotMatch(specific, /data-goal-category-visual/u);

    const fallback = renderToStaticMarkup(
      <GoalHeroArtwork category="cardio" routeId="missing-artwork" />,
    );
    assert.match(fallback, /data-goal-category-visual="cardio"/u);
    assert.doesNotMatch(fallback, /data-goal-hero-visual/u);
  });

  it("gives every public goal a checked-in goal-specific illustration", () => {
    const goals = listHealthCommonsGoalEntries();
    const routeIds = goals.map((goal) => goal.routeId).sort();

    expect(goals).toHaveLength(252);
    expect([...GOAL_ILLUSTRATION_ROUTE_IDS].sort()).toEqual(routeIds);
    for (const goal of goals) {
      const illustration = resolveGoalIllustrationSrc(goal.routeId);

      expect(() => getGoalCategoryVisual(goal.category)).not.toThrow();
      expect(OUTCOME_KINDS).toContain(goal.outcomeKind);
      expect(illustration).toBe(`/design-assets/goals/${goal.routeId}.svg`);
      expect(existsSync(new URL(`../public${illustration}`, import.meta.url))).toBe(
        true,
      );
    }
  });

  it("assigns every public goal exactly once to a section of at most 12 cards", () => {
    const goals = listHealthCommonsGoalEntries();

    for (const category of GOAL_CATEGORIES) {
      const categoryRouteIds = goals
        .filter((goal) => goal.category === category.slug)
        .map((goal) => goal.routeId)
        .sort();
      const sections = GOAL_DIRECTORY_SECTION_DEFINITIONS[category.slug];
      const assignedRouteIds = sections
        .flatMap((section) => section.routeIds)
        .sort();

      expect(sections.every((section) => section.routeIds.length > 0)).toBe(true);
      expect(sections.every((section) => section.routeIds.length <= 12)).toBe(true);
      expect(new Set(assignedRouteIds).size).toBe(assignedRouteIds.length);
      expect(assignedRouteIds).toEqual(categoryRouteIds);
    }
  });

  it("places every public cardio goal into one non-linked directory section", () => {
    const category = getGoalCategory("cardio");
    assert.ok(category);
    const goals = listHealthCommonsGoalEntries().filter(
      (goal) => goal.category === "cardio",
    );
    const markup = renderToStaticMarkup(
      <GoalCategoryBrowse category={category} goals={goals} />,
    );

    expect(goals).toHaveLength(39);
    expect(markup.match(/data-goal-directory-section=/gu)).toHaveLength(6);
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(39);
    expect(markup).not.toContain("More cardio goals");
    for (const heading of [
      "Cardio fitness",
      "Running",
      "Cycling",
      "Swimming and rowing",
      "Triathlon and long-distance endurance",
      "Everyday movement and team sports",
    ]) {
      expect(markup).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`, "u"));
    }
  });

  it("turns Sleep Better into a card under a plain Sleep quality heading", () => {
    const category = getGoalCategory("sleep");
    assert.ok(category);
    const goals = listHealthCommonsGoalEntries().filter(
      (goal) => goal.category === "sleep",
    );
    const markup = renderToStaticMarkup(
      <GoalCategoryBrowse category={category} goals={goals} />,
    );
    const qualitySection = markup.match(
      /<section\b[^>]*data-goal-directory-section="quality"[^>]*>[\s\S]*?<\/section>/u,
    )?.[0];
    assert.ok(qualitySection);
    const qualityHeading = qualitySection.match(/<h2[^>]*>[\s\S]*?<\/h2>/u)?.[0];
    assert.ok(qualityHeading);

    expect(goals).toHaveLength(35);
    expect(markup.match(/data-goal-directory-section=/gu)).toHaveLength(5);
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(35);
    expect(qualitySection).toMatch(/<h2[^>]*>Sleep quality<\/h2>/u);
    expect(qualitySection).toContain('href="/goals/sleep-better"');
    expect(qualitySection.match(/href="\/goals\/sleep-better"/gu))
      .toHaveLength(1);
    expect(qualityHeading).not.toContain("<a");
    expect(qualitySection).toContain("lg:grid-cols-3");
    expect(qualitySection).not.toContain("xl:grid-cols-4");
  });

  it("places every life-stage goal into one meaningful plain section", () => {
    const category = getGoalCategory("life-stages");
    assert.ok(category);
    const goals = listHealthCommonsGoalEntries().filter(
      (goal) => goal.category === "life-stages",
    );
    const markup = renderToStaticMarkup(
      <GoalCategoryBrowse category={category} goals={goals} />,
    );

    expect(goals).toHaveLength(30);
    expect(markup.match(/data-goal-directory-section=/gu)).toHaveLength(6);
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(30);
    expect(markup).not.toContain("More life-stage goals");
    for (const heading of [
      "Healthy aging",
      "Fertility and reproductive health",
      "Pregnancy wellbeing",
      "Postpartum recovery",
      "Menopause health",
      "Period and pelvic health",
    ]) {
      expect(markup).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`, "u"));
    }
  });

  it("renders full-width search and one illustration per category, not repeated glyphs", async () => {
    const element = await GoalsPage();
    const markup = renderToStaticMarkup(element);

    assert.match(markup, /aria-label="Start with Murph in Messages"/u);
    assert.match(markup, /href="sms:\+15550100001\?body=/u);
    assert.doesNotMatch(markup, /t\.me\//u);

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

  it("keeps each goal tile to a title and its own illustration, free of decorative icons", () => {
    const markup = renderToStaticMarkup(
      <GoalBrowseCard href="/goals/improve-deep-sleep" title="Improve My Deep Sleep" />,
    );

    assert.match(markup, />Improve My Deep Sleep</u);
    assert.doesNotMatch(markup, /<svg\b/u);
    assert.doesNotMatch(markup, /<img\b/u);
    assert.doesNotMatch(markup, /<p\b/u);
    assert.doesNotMatch(markup, /font-mono/u);

    const illustrated = renderToStaticMarkup(
      <GoalBrowseCard
        href="/goals/reduce-bloating"
        illustrationSrc="/design-assets/goals/reduce-bloating.svg"
        title="Reduce Bloating"
      />,
    );

    assert.match(illustrated, /<img[^>]*data-goal-illustration/u);
    assert.match(illustrated, /design-assets\/goals\/reduce-bloating\.svg/u);
    assert.doesNotMatch(illustrated, /<svg\b/u);
  });
});
