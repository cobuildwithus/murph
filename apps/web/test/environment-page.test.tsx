import assert from "node:assert/strict";

import { test } from "vitest";

import {
  deriveCategoryNote,
  evaluateIndicatorTarget,
  overallGrade,
} from "../app/(dashboard)/environment/category-notes";
import {
  type HabitatValues,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "../app/(dashboard)/environment/home-model";

test("environment grades conditions and habits, not access to equipment", () => {
  assert.equal(evaluateIndicatorTarget("night_temp_c", 20), true);
  assert.equal(evaluateIndicatorTarget("night_temp_c", 24), false);
  assert.equal(evaluateIndicatorTarget("screen_at_eye_level", true), true);

  for (const [indicatorId, value] of [
    ["humidity_known", "measured"],
    ["standing_desk", "adjustable_used"],
    ["sauna_access", "home"],
    ["red_light", "panel_owned"],
    ["light_therapy_lamp", true],
  ] as const) {
    assert.equal(evaluateIndicatorTarget(indicatorId, value), null);
  }
});

test("a fair grade waits until at least half of eligible conditions are known", () => {
  const sleep = deriveCategoryNote(
    {
      aspectIds: ["sleep-environment"],
      id: "sleep",
      title: "Sleep",
    },
    {
      "sleep-environment": {
        darkness: "blackout",
        night_temp_c: 20,
        night_noise: "quiet",
      },
    },
  );

  assert.deepEqual(sleep.grade, {
    eligible: 8,
    graded: 3,
    letter: null,
    met: 3,
    pct: null,
  });
});

test("declined conditions are visible but cannot suppress a fair grade or coverage", () => {
  const values: HabitatValues = {
    "sleep-environment": {
      bedding_overheating: "declined",
      co2_typical_ppm: "declined",
      darkness: "blackout",
      mattress_satisfaction: "declined",
      night_noise: "quiet",
      night_temp_c: 20,
      phone_by_bed: "declined",
      tv_in_bedroom: "declined",
    },
  };
  const scene = resolveHabitatScene(values);
  const sleepCategory = scene.categories.find(
    (category) => category.id === "sleep",
  );
  assert.ok(sleepCategory);
  const sleep = deriveCategoryNote(sleepCategory, values);

  assert.deepEqual(sleep.grade, {
    eligible: 3,
    graded: 3,
    letter: "A",
    met: 3,
    pct: 100,
  });
  assert.equal(sleep.skippedFacts.length, 5);
  assert.equal(sleep.known, 3);
  assert.equal(sleep.total, 5);
  assert.equal(sleepCategory.known, 3);
  assert.equal(sleepCategory.total, 5);
  assert.equal(
    resolveEnvironmentCoverage(scene, values).total,
    scene.total + 2,
  );
});

test("optional equipment cannot lower the environment grade", () => {
  const values: HabitatValues = {
    "home-air": {
      damp_or_mold: "none",
      smoke_sources: "none",
    },
    lighting: {
      daytime_light: "by_window",
      evening_light: "warm_dim",
      light_therapy_lamp: false,
      morning_light_access: "outdoor_routine",
    },
    "recovery-access": {
      cold_exposure: "none",
      red_light: "none",
      sauna_access: "none",
    },
    "sleep-environment": {
      bedding_overheating: "never",
      co2_typical_ppm: 780,
      darkness: "blackout",
      mattress_satisfaction: "good",
      night_noise: "quiet",
      night_temp_c: 20,
      phone_by_bed: false,
      tv_in_bedroom: false,
    },
    workspace: {
      breaks: "systematic",
      chair: "ordinary",
      external_keyboard: false,
      screen_at_eye_level: true,
      standing_desk: "fixed",
      wrist_complaints: false,
    },
  };
  const scene = resolveHabitatScene(values);
  const notes = scene.categories.map((category) =>
    deriveCategoryNote(category, values),
  );

  assert.deepEqual(overallGrade(notes), {
    eligible: 16,
    graded: 16,
    letter: "A",
    met: 16,
    pct: 100,
  });
  const recovery = notes.find((note) => note.id === "recovery");
  assert.ok(recovery);
  assert.equal(recovery.grade.letter, null);
  assert.ok(
    recovery.rows.every((row) => row.met === null && row.target === null),
  );
});

test("folded facts stay visible when their parent fact is unknown", () => {
  const sleep = deriveCategoryNote(
    {
      aspectIds: ["sleep-environment"],
      id: "sleep",
      title: "Sleep",
    },
    {
      "sleep-environment": {
        mattress_age_years: 4,
      },
    },
  );

  assert.equal(
    sleep.rows.find((row) => row.indicatorId === "mattress_age_years")?.value,
    "4 years",
  );
  assert.ok(
    sleep.unknownFacts.some(
      (fact) => fact.indicatorId === "mattress_satisfaction",
    ),
  );
});

test("a category with only informational facts has no grade or target text", () => {
  const water = deriveCategoryNote(
    { aspectIds: ["water"], id: "water", title: "Water" },
    { water: { drinking_water: "filtered" } },
  );

  assert.deepEqual(water.grade, {
    eligible: 0,
    graded: 0,
    letter: null,
    met: 0,
    pct: null,
  });
  assert.equal(water.rows[0]?.target, null);
  assert.equal(water.known, 0);
  assert.equal(water.total, 0);
});
