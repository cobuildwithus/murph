import assert from "node:assert/strict";

import { test } from "vitest";

import {
  MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_SCHEMA_VERSION,
  listMurphAgeWearableActivityBenchmarkCards,
  validateMurphAgeWearableActivityBenchmarkCard,
} from "@murphai/health-metrics/murph-age";

test("locks the NHANES activity wearable shadow benchmark card before local adapter execution", () => {
  const cards = listMurphAgeWearableActivityBenchmarkCards();
  assert.equal(cards.length, 2);
  const rawCard = cards[0];
  if (!rawCard) throw new Error("Expected NHANES activity benchmark card.");
  const card = JSON.parse(JSON.stringify(rawCard)) as Record<string, unknown>;

  assert.equal(card.schemaVersion, MURPH_AGE_WEARABLE_ACTIVITY_BENCHMARK_CARD_SCHEMA_VERSION);
  assert.equal(card.benchmarkId, "nhanes_2003_06_hip_activity_lmf_v1");
  assert.equal(card.accelerometryProtocol, "nhanes-2003-2006-hip-am7164-waking-7d");
  assert.equal(cards[1]?.benchmarkId, "nhanes_2011_14_wrist_activity_lmf_v1");
  assert.equal(cards[1]?.accelerometryProtocol, "nhanes-2011-2014-wrist-gt3x-plus-24h-7d");
  assert.equal(card.benchmarkStatus, "locked-card-ready-for-local-adapter");
  assert.equal(card.architecturePattern, "anchor-plus-wearable-residual-shadow");
  assert.equal(card.sourceRouteId, "nhanes-activity-shadow-lmf");
  assert.equal(card.evidenceClass, "public-same-family-shadow-benchmark");
  assert.equal(card.evidenceTierIfExecuted, "same-family-sanity");
  assert.equal(card.measurementMethod, "research-actigraphy");
  assert.deepEqual(card.denominatorPolicy, {
    adultAgeRangeYears: {
      max: 79,
      min: 40,
    },
    eligibleLinkedMortalityRequired: true,
    labBodyAnchorDenominatorRequired: true,
    objectiveActivityWindowRequired: true,
    publicUseRowsOnly: true,
    sameDenominatorRequired: true,
  });
  assert.deepEqual(card.endpoint, {
    endpointFamily: "all-cause-mortality",
    endpointFrozenBeforeScoring: true,
    horizonYears: 10,
    indexDateRule: "feature-window-end-before-risk-window",
    outcomeAscertainment: "death-registry",
    outcomeLinked: true,
    washoutDays: 365,
  });
  assert.deepEqual(card.featureFamilies, [
    "activity-volume",
    "intensity-pattern",
    "sedentary-time",
    "wearable-coverage-quality",
  ]);
  assert.deepEqual(card.transformIds, [
    "coverage-quality-control",
    "activity-volume-after-lab-body-anchor",
    "sedentary-time-after-coverage-control",
    "intensity-pattern-after-age-sex",
  ]);
  assert.deepEqual((card.modelLadder as Array<Record<string, unknown>>).map((step) => step.modelId), [
    "m0-anchor-only",
    "m1-anchor-plus-lab-body-bp",
    "m2-coverage-device-ehr-density-control",
    "m3-wearable-residual",
    "m4-wearable-plus-coverage",
    "m5-residualized-wearable-after-controls",
  ]);

  const selectionPolicy = card.selectionPolicy as Record<string, unknown>;
  assert.equal(selectionPolicy.calibrationFirst, true);
  assert.equal(selectionPolicy.discriminationOnlySelectionAllowed, false);
  assert.equal(selectionPolicy.properScoresRequired, true);
  assert.equal(selectionPolicy.sameDenominatorComparisonsRequired, true);
  assert.equal(selectionPolicy.testSetMutationAuthorized, false);

  const splitPolicy = card.splitPolicy as Record<string, unknown>;
  assert.equal(splitPolicy.aggregateSplitCountsExportOnly, true);
  assert.equal(splitPolicy.participantIdsExportAllowed, false);
  assert.equal(splitPolicy.splitMembershipExportAllowed, false);

  assert.equal(card.productAuthorized, false);
  assert.equal(card.scoreBearing, false);
  assert.equal(card.scoreContributionAuthorized, false);
  assert.equal(card.rowParsingAuthorized, false);
  assert.deepEqual(card.outputBoundary, {
    aggregateOnly: true,
    coefficientsExportAllowed: false,
    localArtifactPathExportAllowed: false,
    modelParametersExportAllowed: false,
    participantIdentifiersExportAllowed: false,
    participantLevelExportAllowed: false,
    predictionsExportAllowed: false,
    productDisplayExportAllowed: false,
    rowValuesExportAllowed: false,
    sourceTextExportAllowed: false,
    splitMembershipExportAllowed: false,
  });
  assert.equal(validateMurphAgeWearableActivityBenchmarkCard(rawCard).status, "valid");
  assert.deepEqual(validateMurphAgeWearableActivityBenchmarkCard(rawCard).warnings, []);
  assert.equal(validateMurphAgeWearableActivityBenchmarkCard(cards[1]).status, "valid");

  const encodedCard = JSON.stringify(card);
  for (const forbidden of [
    "\"coefficients\":",
    "\"localPath\":",
    "\"participantIds\":",
    "\"predictions\":",
    "\"rowValues\":",
    "\"sourceText\":",
    "\"splitMembership\":[",
  ]) {
    assert.equal(encodedCard.includes(forbidden), false, forbidden);
  }

  const invalidCard = JSON.parse(JSON.stringify(rawCard)) as Record<string, unknown>;
  invalidCard.endpoint = {
    ...(invalidCard.endpoint as Record<string, unknown>),
    horizonYears: "bad",
  };
  invalidCard.featureFamilies = ["activity-volume"];
  invalidCard.accelerometryProtocol = "nhanes-2011-2014-wrist-gt3x-plus-24h-7d";
  invalidCard.outputBoundary = {
    ...(invalidCard.outputBoundary as Record<string, unknown>),
    participantIdentifiersExportAllowed: true,
    rowValuesExportAllowed: true,
  };
  invalidCard.participantIds = ["synthetic-participant"];
  invalidCard.productAuthorized = true;
  invalidCard.rowParsingAuthorized = true;
  invalidCard.sourceRouteId = "cardia-biomarker-activity";
  invalidCard.splitPolicy = {
    ...(invalidCard.splitPolicy as Record<string, unknown>),
    splitMembershipExportAllowed: true,
  };
  const invalidValidation = validateMurphAgeWearableActivityBenchmarkCard(invalidCard);
  assert.equal(invalidValidation.status, "invalid");
  for (const expected of [
    "must remain research-only",
    "must target the NHANES activity shadow source route",
    "output boundary must block rows",
    "accelerometry protocol must match",
    "featureFamilies must match",
    "split policy splitMembershipExportAllowed",
    "unsupported field participantIds",
  ]) {
    assert.equal(
      invalidValidation.warnings.some((warning) => warning.message.includes(expected)),
      true,
      expected,
    );
  }
});
