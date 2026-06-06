import { beforeAll, describe, expect, it } from "vitest";

import {
  assertJunctionWearableBrowserVaultSummary,
  DEFAULT_JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_RELATIVE_PATH,
  JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS,
  normalizeJunctionProviderSlugForComparison,
  runJunctionWearableFixtureE2e,
  type JunctionWearableFixtureE2eResult,
} from "@murphai/vault-usecases/testing";

import {
  expectJunctionWearableBiomarkerExpectationsToMatchProduction,
} from "./helpers/junction-wearable-biomarker-contract.js";

let result: JunctionWearableFixtureE2eResult | null = null;

describe("hosted local Junction wearable fixture e2e", () => {
  beforeAll(async () => {
    result = await runJunctionWearableFixtureE2e({
      fixturePath: DEFAULT_JUNCTION_WEARABLE_HOSTED_REPLAY_FIXTURE_RELATIVE_PATH,
    });
  }, 600_000);

  it("uses only sanitized fixture data", () => {
    const scan = requireResult().privacyScan;

    expect(scan.riskyContextValueCount).toBe(0);
    expect(scan.riskyKeyValueCount).toBe(0);
    expect(scan.riskyValuePatternCounts).toEqual({
      accessTokenKeyword: 0,
      bearerLike: 0,
      email: 0,
      homePath: 0,
      jwtLike: 0,
      uuidLike: 0,
      whsecLike: 0,
    });
    expect(scan.pseudonymizedValues ?? 0).toBeGreaterThan(0);
    expect(scan.shiftedDates ?? 0).toBeGreaterThan(0);
  });

  it("replays the fixture through the real Junction importer into a vault", () => {
    const replay = requireResult().replay;

    expect(replay.importedSnapshots).toBeGreaterThan(0);
    expect(replay.vaultEntityCount).toBeGreaterThan(0);
  });

  it("covers Oura data from the fixture", () => {
    const coverage = requireProviderCoverage("oura");
    const sourceHealth = requireSourceHealth("oura");

    expect(coverage.targetPresent).toBe(true);
    expect(coverage.dayCount).toBeGreaterThanOrEqual(5);
    expect(coverage.resources).toContain("junction-summary-sleep");
    expect(coverage.resources).toContain("junction-timeseries-heartrate");
    expect(sourceHealth.sleepNights).toBeGreaterThan(0);
    expect(sourceHealth.selectedMetrics).toBeGreaterThan(0);
  });

  it("covers WHOOP data from the fixture", () => {
    const coverage = requireProviderCoverage("whoop_v2");
    const sourceHealth = requireSourceHealth("whoop_v2");

    expect(coverage.targetPresent).toBe(true);
    expect(coverage.dayCount).toBeGreaterThanOrEqual(7);
    expect(coverage.resources).toContain("junction-summary-activity");
    expect(coverage.resources).toContain("junction-summary-sleep");
    expect(coverage.resources).toContain("junction-summary-workouts");
    expect(sourceHealth.activityDays + sourceHealth.sleepNights + sourceHealth.recoveryDays)
      .toBeGreaterThan(0);
  });

  it("covers Garmin data from the fixture", () => {
    const coverage = requireProviderCoverage("garmin");
    const sourceHealth = requireSourceHealth("garmin");

    expect(coverage.targetPresent).toBe(true);
    expect(coverage.dayCount).toBeGreaterThanOrEqual(7);
    expect(coverage.rawArtifactCount).toBeGreaterThan(0);
    expect(coverage.resources).toEqual(expect.arrayContaining([
      "junction-summary-activity",
      "junction-summary-sleep",
      "junction-summary-workouts",
    ]));
    expect(sourceHealth.activityDays).toBeGreaterThan(0);
    expect(sourceHealth.selectedMetrics).toBeGreaterThan(0);
    expect(sourceHealth.sleepNights).toBeGreaterThanOrEqual(7);
  });

  it("projects imported wearable data into the /biomarkers browser-vault contract", () => {
    const e2e = requireResult();

    assertJunctionWearableBrowserVaultSummary({
      biomarkerPanels: e2e.biomarkerPanels,
      metrics: e2e.metrics,
      sourceHealth: e2e.sourceHealth,
    });
  });

  it("uses the production Health Commons biomarker panel inputs", async () => {
    await expectJunctionWearableBiomarkerExpectationsToMatchProduction(
      JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS,
    );
  });
});

function requireResult(): JunctionWearableFixtureE2eResult {
  if (!result) {
    throw new Error("Junction wearable fixture E2E did not run.");
  }
  return result;
}

function requireProviderCoverage(provider: string) {
  const coverage = requireResult().providerCoverage.find((entry) => entry.provider === provider);
  if (!coverage) {
    throw new Error(`Expected provider fixture coverage for ${provider}.`);
  }
  return coverage;
}

function findSourceHealth(provider: string) {
  return requireResult().sourceHealth.find(
    (entry) =>
      normalizeJunctionProviderSlugForComparison(entry.provider)
        === normalizeJunctionProviderSlugForComparison(provider),
  );
}

function requireSourceHealth(provider: string) {
  const sourceHealth = findSourceHealth(provider);
  if (!sourceHealth) {
    throw new Error(`Expected browser-vault source health for ${provider}.`);
  }
  return sourceHealth;
}
