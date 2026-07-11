import assert from "node:assert/strict";

import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  deriveCategoryNote,
  evaluateIndicatorTarget,
  overallGrade,
} from "../app/(dashboard)/environment/category-notes";
import {
  MOCK_HABITAT_VALUES,
  resolveHabitatScene,
} from "../app/(dashboard)/environment/home-model";

test("Habitat grades use the extended evaluators and keep informational facts neutral", () => {
  assert.equal(evaluateIndicatorTarget("night_temp_c", 20), true);
  assert.equal(evaluateIndicatorTarget("night_temp_c", 24), false);
  assert.equal(evaluateIndicatorTarget("humidity_known", "measured"), true);
  assert.equal(
    evaluateIndicatorTarget("standing_desk", "adjustable_used"),
    true,
  );
  assert.equal(evaluateIndicatorTarget("screen_at_eye_level", true), true);
  assert.equal(evaluateIndicatorTarget("light_therapy_lamp", true), null);

  const light = deriveCategoryNote(
    { id: "light", title: "Light", aspectIds: ["lighting"] },
    {
      lighting: {
        evening_light: "warm_dim",
        morning_light_access: "outdoor_routine",
        daytime_light: "by_window",
        light_therapy_lamp: true,
      },
    },
  );

  assert.deepEqual(light.grade, {
    letter: "A",
    pct: 100,
    met: 3,
    graded: 3,
  });
  assert.equal(
    light.rows.find((row) => row.indicatorId === "light_therapy_lamp")?.met,
    null,
  );
});

test("Habitat fact rows fold sub-facts, sort unmet facts first, and preserve coverage", () => {
  const scene = resolveHabitatScene(MOCK_HABITAT_VALUES);
  const sleepCategory = scene.categories.find(({ id }) => id === "sleep");
  assert.ok(sleepCategory);

  const sleep = deriveCategoryNote(sleepCategory, MOCK_HABITAT_VALUES);
  assert.equal(sleep.known, 13);
  assert.equal(sleep.total, 15);
  assert.equal(sleep.rows[0]?.indicatorId, "co2_typical_ppm");
  assert.equal(sleep.rows[0]?.detail, "Measured with Aranet");
  assert.equal(
    sleep.rows.some(({ indicatorId }) => indicatorId === "co2_meter"),
    false,
  );
  assert.deepEqual(sleep.unknownLabels, ["Mattress age"]);
  assert.deepEqual(sleep.skippedLabels, ["Noise countermeasures"]);
  assert.equal(
    sleep.rows.find(({ indicatorId }) => indicatorId === "bedding_overheating")
      ?.target,
    null,
  );
  assert.deepEqual(sleep.grade, {
    letter: "C",
    pct: 67,
    met: 6,
    graded: 9,
  });

  const recoveryCategory = scene.categories.find(({ id }) => id === "recovery");
  assert.ok(recoveryCategory);
  const recovery = deriveCategoryNote(recoveryCategory, MOCK_HABITAT_VALUES);
  assert.equal(
    recovery.rows.find(({ indicatorId }) => indicatorId === "sauna_access")
      ?.value,
    "home · dry",
  );
  assert.equal(
    recovery.rows.find(({ indicatorId }) => indicatorId === "sauna_access")
      ?.target,
    null,
  );
  assert.equal(
    recovery.rows.some(({ indicatorId }) => indicatorId === "sauna_type"),
    false,
  );
  assert.deepEqual(recovery.skippedLabels, ["Red light model"]);

  const workspaceCategory = scene.categories.find(
    ({ id }) => id === "workspace",
  );
  assert.ok(workspaceCategory);
  const workspace = deriveCategoryNote(workspaceCategory, MOCK_HABITAT_VALUES);
  assert.equal(
    workspace.rows.find(
      ({ indicatorId }) => indicatorId === "external_keyboard",
    )?.target,
    null,
  );

  const notes = scene.categories.map((category) =>
    deriveCategoryNote(category, MOCK_HABITAT_VALUES),
  );
  assert.deepEqual(overallGrade(notes), {
    letter: "B",
    pct: 75,
    met: 18,
    graded: 24,
  });
});

test("a category with only informational facts has no grade or target text", () => {
  const water = deriveCategoryNote(
    { id: "water", title: "Water", aspectIds: ["water"] },
    { water: { drinking_water: "filtered" } },
  );

  assert.deepEqual(water.grade, {
    letter: null,
    pct: null,
    met: 0,
    graded: 0,
  });
  assert.equal(water.rows[0]?.target, null);
});

test("EnvironmentPage presents one grade, coverage, context, and five compact categories", async () => {
  const { default: EnvironmentPage } = await import(
    "../app/(dashboard)/environment/page"
  );

  const markup = renderToStaticMarkup(<EnvironmentPage />);
  const { document } = parseHTML(markup);

  assert.match(markup, />Environment grade</);
  const gradeGlyph = document.querySelector(
    'section[aria-labelledby="environment-grade-title"] span[aria-hidden="true"]',
  );
  assert.equal(gradeGlyph?.textContent, "B");
  assert.equal(
    gradeGlyph?.parentElement?.querySelector(".sr-only")?.textContent,
    "Grade B, 75 percent",
  );
  assert.match(markup, />Murph knows 43 of 49</);
  assert.match(markup, /aria-label="Current home context"/);
  assert.match(markup, />Location</);
  assert.match(markup, />Weather</);
  assert.match(markup, />Nights</);
  assert.match(markup, />Outdoor air</);
  assert.match(markup, />Pets</);

  for (const category of [
    "Sleep",
    "Air &amp; water",
    "Light",
    "Recovery &amp; devices",
    "Workspace",
  ]) {
    assert.match(markup, new RegExp(`>${category}<`));
    assert.match(markup, new RegExp(`aria-label="${category} coverage"`));
  }

  for (const removedCopy of [
    "Overall picture",
    "Within target",
    "Still missing",
    "Target score",
    "Other facts &amp; gaps",
    "Visual summary",
    "Room setup",
    "Equipment &amp; access",
    "Training",
    "Health devices",
  ]) {
    assert.doesNotMatch(markup, new RegExp(`>${removedCopy}<`));
  }
  assert.doesNotMatch(markup, />Known</);
  assert.doesNotMatch(markup, />Next</);

  const categoryArticles = Array.from(document.querySelectorAll("article"));
  assert.equal(categoryArticles.length, 5);

  for (const article of categoryArticles) {
    const details = article.firstElementChild;
    assert.equal(details?.tagName, "DETAILS");
    assert.equal(details?.hasAttribute("open"), false);
    assert.equal(details?.querySelectorAll("details").length, 0);

    const summary = details?.firstElementChild;
    assert.equal(summary?.tagName, "SUMMARY");
    assert.ok(summary?.querySelector("img"));
    assert.ok(summary?.querySelector('[role="progressbar"]'));

    const headingId = article.getAttribute("aria-labelledby");
    assert.ok(headingId);
    assert.equal(
      summary?.querySelector('[role="heading"][aria-level="2"]')?.id,
      headingId,
    );
  }

  assert.equal(
    document.querySelectorAll('section[aria-label$="illustrated setup"]')
      .length,
    2,
  );
  assert.equal(
    document.querySelectorAll('section[aria-label$="equipment and access"]')
      .length,
    3,
  );
  assert.equal(document.querySelectorAll('[role="progressbar"]').length, 6);

  const sleepFacts = document.querySelector(
    'section[aria-label="Sleep facts"]',
  );
  assert.match(
    sleepFacts?.querySelector("li")?.textContent ?? "",
    /Typical night CO2/,
  );
  const sleepRows = Array.from(sleepFacts?.querySelectorAll("li") ?? []);
  const mattressAgeRow = sleepRows.find((row) =>
    row.textContent.includes("Mattress age"),
  );
  const noiseCountermeasuresRow = sleepRows.find((row) =>
    row.textContent.includes("Noise countermeasures"),
  );
  assert.match(mattressAgeRow?.textContent ?? "", /not known yet/);
  assert.match(noiseCountermeasuresRow?.textContent ?? "", /skipped/);
  assert.match(sleepFacts?.textContent ?? "", /Target/);
  assert.doesNotMatch(sleepFacts?.textContent ?? "", /target 18-22°C/);
  assert.doesNotMatch(sleepFacts?.textContent ?? "", /[✓✗•]/);
  assert.match(sleepFacts?.textContent ?? "", /within target/);
  assert.match(sleepFacts?.textContent ?? "", /needs attention/);
  assert.match(sleepFacts?.textContent ?? "", /known/);
});
