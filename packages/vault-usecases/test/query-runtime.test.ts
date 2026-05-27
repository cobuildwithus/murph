import { describe, expect, it } from "vitest";
import * as sharedQuery from "@murphai/query";

import {
  loadQueryRuntime,
} from "../src/query-runtime.ts";
import {
  describeQueryLookupConstraint,
  inferQueryIdEntityKind,
  isQueryableQueryLookupId,
} from "../src/query-id-families.ts";

describe("query runtime compatibility surface", () => {
  it("keeps the local lookup helpers as thin aliases over the shared query owner", () => {
    const lookupIds = [
      "evt_01JABCDEF0123456789ABCDEF",
      "prot_01JABCDEF0123456789ABCDEF",
      "pack_01JABCDEF0123456789ABCDEF",
      "xfm_01JABCDEF0123456789ABCDEF",
    ];

    for (const lookupId of lookupIds) {
      expect(inferQueryIdEntityKind(lookupId)).toBe(sharedQuery.inferIdEntityKind(lookupId));
      expect(isQueryableQueryLookupId(lookupId)).toBe(sharedQuery.isQueryableLookupId(lookupId));
      expect(describeQueryLookupConstraint(lookupId)).toBe(
        sharedQuery.describeLookupConstraint(lookupId),
      );
    }
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
