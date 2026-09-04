import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { GoalsSection } from "@/src/components/homepage/goals-section";
import { AuthContext } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { resolveGoalContactOption } from "@/src/lib/goals/goal-contact";
import { resolveGoalIllustrationSrc } from "@/src/lib/goals/goal-illustrations";
import { createGoalSearchItem } from "@/src/lib/goals/goal-search";
import {
  DEFAULT_HOMEPAGE_GOAL_PERSONA_ID,
  HOMEPAGE_GOAL_PERSONAS,
  resolveHomepageGoalPersonas,
} from "@/src/lib/goals/homepage-goal-personas";
import { listHealthCommonsGoalEntries } from "@/src/lib/health-commons/goal-projections";

function startOptionFor(messengerChannel: "imessage" | "telegram") {
  return resolveGoalContactOption({
    murphPhoneNumber: "+15555550100",
    preferredKind: messengerChannel === "telegram" ? "telegram" : "text",
    startPrompt: "Hey Murph, I have a goal in mind.",
    textAvailable: true,
  });
}

function renderSection(input: {
  authenticated?: boolean;
  messengerChannel: "imessage" | "telegram";
}) {
  const entries = listHealthCommonsGoalEntries();
  const section = createElement(GoalsSection, {
    goals: entries.map((goal) => ({
      ...createGoalSearchItem(goal),
      illustrationSrc: resolveGoalIllustrationSrc(goal.routeId),
    })),
    personas: resolveHomepageGoalPersonas(entries),
    startOption: startOptionFor(input.messengerChannel),
    totalGoalCount: entries.length,
  });
  const markup = renderToStaticMarkup(
    input.authenticated
      ? createElement(
          AuthContext.Provider,
          {
            value: {
              authenticated: true,
              authenticationStatus: "ready",
              openAuthDialog: () => {},
              prepareAuth: () => {},
              shared: true,
            },
          },
          section,
        )
      : section,
  );
  return { entries, markup };
}

test("every homepage goal persona resolves four distinct illustrated guides", () => {
  const personas = resolveHomepageGoalPersonas(listHealthCommonsGoalEntries());

  assert.equal(personas.length, HOMEPAGE_GOAL_PERSONAS.length);
  assert.ok(personas.some((persona) => persona.id === DEFAULT_HOMEPAGE_GOAL_PERSONA_ID));
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

test("GoalsSection opens on Live long and texts Murph the goal for anonymous visitors", () => {
  const { entries, markup } = renderSection({ messengerChannel: "imessage" });

  assert.match(markup, /Hey Murph, help me…/);
  assert.match(markup, /data-goal-composer-placeholder[^>]*>sleep better</);
  assert.match(markup, /aria-pressed="true"[^>]*>Live long</);
  for (const persona of HOMEPAGE_GOAL_PERSONAS.filter((persona) =>
    persona.id !== DEFAULT_HOMEPAGE_GOAL_PERSONA_ID)) {
    assert.match(markup, new RegExp(`aria-pressed="false"[^>]*>${persona.label}<`));
  }
  assert.match(markup, new RegExp(`href="/goals"[^>]*>All ${entries.length} goals<`));
  assert.match(
    markup,
    /data-goal-composer-send[^>]*href="sms:\+15555550100\?body=Hey%20Murph%2C%20I%20have%20a%20goal%20in%20mind\."/,
  );
  assert.match(
    markup,
    /href="sms:\+15555550100\?body=Hey%20Murph%2C%20help%20me%20stay%20independent%20as%20I%20age"/,
  );
  assert.match(markup, />stay independent as I age</);
  assert.doesNotMatch(markup, /href="\/goals\/[a-z]/);
  assert.doesNotMatch(markup, /dreams/iu);
});

test("GoalsSection routes anonymous visitors to Telegram where that is the default messenger", () => {
  const { markup } = renderSection({ messengerChannel: "telegram" });

  assert.match(
    markup,
    /data-goal-composer-send[^>]*href="https:\/\/t\.me\/withmurph_bot\?text=Hey(?:\+|%20)Murph/,
  );
  assert.match(markup, /data-goal-composer-send[^>]*target="_blank"/);
  assert.match(markup, /href="https:\/\/t\.me\/withmurph_bot\?text=Hey(?:\+|%20)Murph(?:\+|%20)*[^"]*stay/);
});

test("GoalsSection sends members to the guide, whose CTA resolves their own line", () => {
  const { markup } = renderSection({ authenticated: true, messengerChannel: "imessage" });

  assert.match(markup, /data-goal-composer-send[^>]*href="\/home"/);
  assert.match(markup, /href="\/goals\/stay-independent-as-i-age"/);
  assert.doesNotMatch(markup, /href="sms:/);
});
