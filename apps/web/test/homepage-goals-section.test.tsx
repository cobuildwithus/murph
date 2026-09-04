import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { GoalsSection } from "@/src/components/homepage/goals-section";
import {
  HOMEPAGE_GOAL_PERSONAS,
  resolveHomepageGoalPersonas,
} from "@/src/lib/goals/homepage-goal-personas";
import { listHealthCommonsGoalEntries } from "@/src/lib/health-commons/goal-projections";

test("every homepage goal persona resolves four distinct illustrated guides", () => {
  const personas = resolveHomepageGoalPersonas(listHealthCommonsGoalEntries());

  assert.equal(personas.length, HOMEPAGE_GOAL_PERSONAS.length);
  const seenHrefs = new Set<string>();
  for (const persona of personas) {
    assert.equal(persona.goals.length, 4, persona.label);
    for (const goal of persona.goals) {
      assert.ok(goal.illustrationSrc, `${goal.href} has no illustration`);
      assert.ok(!seenHrefs.has(goal.href), `${goal.href} repeats`);
      seenHrefs.add(goal.href);
    }
  }
});

test("GoalsSection completes the headline with persona goals and links to the library", () => {
  const entries = listHealthCommonsGoalEntries();
  const markup = renderToStaticMarkup(
    createElement(GoalsSection, {
      personas: resolveHomepageGoalPersonas(entries),
      totalGoalCount: entries.length,
    }),
  );

  assert.match(markup, /Hey Murph, help me…/);
  assert.match(
    markup,
    /Pick a goal\. Murph helps you get there faster, easier, and in a way that fits your life\./,
  );
  for (const persona of HOMEPAGE_GOAL_PERSONAS) {
    assert.match(markup, new RegExp(`>${persona.label}<`));
  }
  assert.match(markup, /href="\/goals\/sleep-better"/);
  assert.match(markup, />sleep better</);
  assert.match(markup, /design-assets\/goals\/sleep-better\.svg/);
  assert.match(markup, new RegExp(`Browse all ${entries.length} goals`));
  assert.match(markup, /href="\/goals"/);
  assert.doesNotMatch(markup, /dreams/iu);
});
