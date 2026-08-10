import { describe, expect, it } from "vitest";
import {
  LOOKUP_ID_FAMILY_REGISTRY,
  describeLookupIdConstraint,
  inferLookupIdEntityKind,
  isQueryableLookupId,
} from "@murphai/contracts";
import * as sharedQuery from "@murphai/query";

import {
  loadQueryRuntime,
} from "../src/query-runtime.ts";

describe("query runtime compatibility surface", () => {
  it("re-exports lookup classification from the contracts owner", () => {
    expect(sharedQuery.ID_FAMILY_REGISTRY).toBe(LOOKUP_ID_FAMILY_REGISTRY);
    expect(sharedQuery.inferIdEntityKind).toBe(inferLookupIdEntityKind);
    expect(sharedQuery.isQueryableLookupId).toBe(isQueryableLookupId);
    expect(sharedQuery.describeLookupConstraint).toBe(describeLookupIdConstraint);
  });

  it("loads the shared query runtime surface without a second local function layer", async () => {
    const runtime = await loadQueryRuntime();

    expect(runtime.analyzeExperimentOutcome).toBe(sharedQuery.analyzeExperimentOutcome);
    expect(runtime.buildExportPack).toBe(sharedQuery.buildExportPack);
    expect(runtime.buildTimeline).toBe(sharedQuery.buildTimeline);
    expect(runtime.listAssessments).toBe(sharedQuery.listAssessments);
    expect(runtime.listSupplements).toBe(sharedQuery.listSupplements);
    expect(runtime.listSupplementCompounds).toBe(sharedQuery.listSupplementCompounds);
    expect(runtime.listBloodTests).toBe(sharedQuery.listBloodTests);
    expect(runtime.showAssessment).toBe(sharedQuery.showAssessment);
    expect(runtime.showBloodTest).toBe(sharedQuery.showBloodTest);
    expect(runtime.searchVaultRuntime).toBe(sharedQuery.searchVaultRuntime);
    expect(runtime.summarizeWearableLatestRuntime).toBe(sharedQuery.summarizeWearableLatestRuntime);
    expect(runtime.summarizeWearableMetricLatestRuntime).toBe(
      sharedQuery.summarizeWearableMetricLatestRuntime,
    );
    expect(runtime.summarizeWearableMetricTrendRuntime).toBe(
      sharedQuery.summarizeWearableMetricTrendRuntime,
    );
    expect(runtime.summarizeWearableSleepRuntime).toBe(sharedQuery.summarizeWearableSleepRuntime);
    expect(runtime.summarizeWearableSleepPatternRuntime).toBe(sharedQuery.summarizeWearableSleepPatternRuntime);
    expect(runtime.buildPersonalPatternReportRuntime).toBe(
      sharedQuery.buildPersonalPatternReportRuntime,
    );
    expect(runtime.summarizeWearableActivityRuntime).toBe(sharedQuery.summarizeWearableActivityRuntime);
    expect(runtime.summarizeWearableBodyStateRuntime).toBe(sharedQuery.summarizeWearableBodyStateRuntime);
    expect(runtime.summarizeWearableDayRuntime).toBe(sharedQuery.summarizeWearableDayRuntime);
    expect(runtime.summarizeWearableRecoveryRuntime).toBe(sharedQuery.summarizeWearableRecoveryRuntime);
    expect(runtime.summarizeWearableSourceHealthRuntime).toBe(
      sharedQuery.summarizeWearableSourceHealthRuntime,
    );
    expect(runtime.explainWearableDriftRuntime).toBe(sharedQuery.explainWearableDriftRuntime);
    expect(runtime.showSupplement).toBe(sharedQuery.showSupplement);
    expect(runtime.showSupplementCompound).toBe(sharedQuery.showSupplementCompound);
    expect(runtime.summarizeExperimentProgress).toBe(sharedQuery.summarizeExperimentProgress);
  });
});
