import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  HABITAT_CATALOG,
  type HabitatIndicatorDefinition,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

import {
  deriveCategoryNote,
  evaluateIndicatorTarget,
  overallGrade,
} from "../app/(dashboard)/environment/category-notes";
import { EnvironmentHero } from "../app/(dashboard)/environment/environment-components";
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
    redFlags: 0,
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
    redFlags: 0,
  });
  assert.equal(sleep.skippedFacts.length, 5);
  assert.equal(sleep.known, 3);
  assert.equal(sleep.total, 3);
  assert.equal(sleepCategory.known, 3);
  assert.equal(sleepCategory.total, 3);
  assert.deepEqual(resolveEnvironmentCoverage(scene), {
    coverage: Math.round((100 * scene.known) / scene.total),
    known: scene.known,
    total: scene.total,
  });
});

const TARGET_ENVIRONMENT_VALUES: HabitatValues = {
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

test("optional equipment cannot lower the environment grade", () => {
  const values = TARGET_ENVIRONMENT_VALUES;
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
    redFlags: 0,
  });
  const recovery = notes.find((note) => note.id === "recovery");
  assert.ok(recovery);
  assert.equal(recovery.grade.letter, null);
  assert.ok(
    recovery.rows.every((row) => row.met === null && row.target === null),
  );
});

test("an optional-only category still shows useful topics without grading them", () => {
  const recovery = deriveCategoryNote(
    {
      aspectIds: ["recovery-access", "health-devices"],
      id: "recovery",
      title: "Recovery & devices",
    },
    {},
  );

  assert.equal(recovery.grade.letter, null);
  assert.equal(recovery.total, 0);
  assert.deepEqual(
    recovery.optionalFacts.map((fact) => fact.indicatorId),
    [
      "sauna_access",
      "cold_exposure",
      "red_light",
      "scale",
      "bp_cuff",
      "thermometer",
      "pulse_oximeter",
    ],
  );
});

test("mixed categories also expose optional learning topics without grading them", () => {
  const workspace = deriveCategoryNote(
    {
      aspectIds: ["workspace"],
      id: "workspace",
      title: "Workspace",
    },
    {},
  );

  assert.equal(workspace.total, 3);
  assert.equal(workspace.grade.letter, null);
  assert.ok(
    workspace.optionalFacts.some((fact) => fact.indicatorId === "work_mode"),
  );
  assert.ok(
    workspace.optionalFacts.some(
      (fact) => fact.indicatorId === "standing_desk",
    ),
  );
});

test("urgent exposures cap an otherwise strong grade at E", () => {
  for (const [indicatorId, value, expectedMet, expectedPct] of [
    ["damp_or_mold", "visible_mold", 15, 94],
    ["smoke_sources", "smoking", 15, 94],
    ["radon_tested", "tested_high", 16, 100],
  ] as const) {
    const values: HabitatValues = {
      ...TARGET_ENVIRONMENT_VALUES,
      "home-air": {
        ...TARGET_ENVIRONMENT_VALUES["home-air"],
        [indicatorId]: value,
      },
    };
    const scene = resolveHabitatScene(values);
    const grade = overallGrade(
      scene.categories.map((category) => deriveCategoryNote(category, values)),
    );

    assert.deepEqual(grade, {
      eligible: 16,
      graded: 16,
      letter: "E",
      met: expectedMet,
      pct: expectedPct,
      redFlags: 1,
    });
  }
});

test("radon testing is neutral unless a high result is known", () => {
  for (const value of [undefined, "declined", "not_tested"] as const) {
    const values: HabitatValues = {
      ...TARGET_ENVIRONMENT_VALUES,
      "home-air": {
        ...TARGET_ENVIRONMENT_VALUES["home-air"],
        ...(value === undefined ? {} : { radon_tested: value }),
      },
    };
    const scene = resolveHabitatScene(values);
    const grade = overallGrade(
      scene.categories.map((category) => deriveCategoryNote(category, values)),
    );

    assert.equal(grade.letter, "A");
    assert.equal(grade.redFlags, 0);
  }
});

test("the hero explains urgent grade caps without requiring a dialog", () => {
  const strongValues: HabitatValues = {
    ...TARGET_ENVIRONMENT_VALUES,
    "home-air": {
      ...TARGET_ENVIRONMENT_VALUES["home-air"],
      damp_or_mold: "visible_mold",
    },
  };
  const strongScene = resolveHabitatScene(strongValues);
  const strongNotes = strongScene.categories.map((category) =>
    deriveCategoryNote(category, strongValues),
  );
  const strongMarkup = renderEnvironmentHero(
    strongScene,
    overallGrade(strongNotes),
    strongNotes,
  );

  assert.match(strongMarkup, />94%/);
  assert.match(strongMarkup, /Murph knows 16 of 16 conditions/);
  assert.match(strongMarkup, /1 urgent issue caps the grade at E/);

  const sparseValues: HabitatValues = {
    "home-air": { damp_or_mold: "visible_mold" },
  };
  const sparseScene = resolveHabitatScene(sparseValues);
  const sparseNotes = sparseScene.categories.map((category) =>
    deriveCategoryNote(category, sparseValues),
  );
  const sparseMarkup = renderEnvironmentHero(
    sparseScene,
    overallGrade(sparseNotes),
    sparseNotes,
  );

  assert.match(sparseMarkup, /Not enough information for a fair grade/);
  assert.match(sparseMarkup, /1 urgent issue needs attention now/);
});

test("every catalog condition that is not informational has a target evaluator", () => {
  for (const aspect of HABITAT_CATALOG.aspects) {
    for (const indicator of aspect.indicators) {
      if (indicator.informational) continue;
      assert.notEqual(
        evaluateIndicatorTarget(indicator.id, sampleIndicatorValue(indicator)),
        null,
        `${aspect.id}.${indicator.id} must be evaluated or marked informational`,
      );
    }
  }
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
    redFlags: 0,
  });
  assert.equal(water.rows[0]?.target, null);
  assert.equal(water.known, 0);
  assert.equal(water.total, 0);
});

function sampleIndicatorValue(
  indicator: HabitatIndicatorDefinition,
): HabitatIndicatorValue {
  switch (indicator.valueType.kind) {
    case "boolean":
      return true;
    case "enum":
      return indicator.valueType.values[0] ?? null;
    case "number":
      return indicator.valueType.min ?? 0;
    case "text":
      return "known";
  }
}

function renderEnvironmentHero(
  scene: ReturnType<typeof resolveHabitatScene>,
  grade: ReturnType<typeof overallGrade>,
  notes: ReturnType<typeof deriveCategoryNote>[],
): string {
  return renderToStaticMarkup(
    createElement(EnvironmentHero, {
      context: {
        areaType: "Apartment",
        location: "Warsaw",
        nights: "Cool",
        outdoorAir: "Good",
        weather: "Clear",
      },
      grade,
      known: scene.known,
      notes,
      total: scene.total,
    }),
  );
}
