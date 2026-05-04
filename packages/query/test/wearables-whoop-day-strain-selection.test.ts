import assert from "node:assert/strict";

import { test } from "vitest";

import { resolveMetric } from "../src/wearables/selection.ts";
import type { WearableExternalRef, WearableMetricCandidate } from "../src/wearables/types.ts";

function makeExternalRef(overrides: Partial<WearableExternalRef> = {}): WearableExternalRef {
  return {
    facet: null,
    resourceId: null,
    resourceType: null,
    system: null,
    version: null,
    ...overrides,
  };
}

function makeWhoopDayStrainCandidate(overrides: {
  candidateId: string;
  occurredAt: string;
  recordedAt: string;
  resourceId: string;
  value: number;
}): WearableMetricCandidate {
  return {
    candidateId: overrides.candidateId,
    date: "2026-05-03",
    externalRef: makeExternalRef({
      facet: "day-strain",
      resourceId: overrides.resourceId,
      resourceType: "cycle",
      system: "whoop",
    }),
    metric: "dayStrain",
    occurredAt: overrides.occurredAt,
    paths: [`/virtual/${overrides.resourceId}.jsonl`],
    provider: "whoop",
    recordedAt: overrides.recordedAt,
    recordIds: [overrides.resourceId],
    sourceFamily: "event",
    sourceKind: "observation:day-strain",
    title: "WHOOP day strain",
    unit: "whoop_strain",
    value: overrides.value,
  };
}

test("WHOOP day strain prefers the highest same-day cycle over a newer lower fragment", () => {
  const resolved = resolveMetric("dayStrain", [
    makeWhoopDayStrainCandidate({
      candidateId: "whoop:cycle:synthetic-earlier-high:day-strain",
      occurredAt: "2026-05-03T05:00:00.000Z",
      recordedAt: "2026-05-03T14:00:00.000Z",
      resourceId: "synthetic-earlier-high",
      value: 14.489366,
    }),
    makeWhoopDayStrainCandidate({
      candidateId: "whoop:cycle:synthetic-representative-highest:day-strain",
      occurredAt: "2026-05-04T03:00:00.000Z",
      recordedAt: "2026-05-04T08:00:00.000Z",
      resourceId: "synthetic-representative-highest",
      value: 16.944273,
    }),
    makeWhoopDayStrainCandidate({
      candidateId: "whoop:cycle:synthetic-newer-lower:day-strain",
      occurredAt: "2026-05-04T03:00:00.000Z",
      recordedAt: "2026-05-04T12:00:00.000Z",
      resourceId: "synthetic-newer-lower",
      value: 4.133967,
    }),
  ], { metricFamily: "activity" });

  assert.equal(resolved.selection.value, 16.944273);
  assert.equal(resolved.selection.recordedAt, "2026-05-04T08:00:00.000Z");
  assert.equal(resolved.candidates[0]?.candidateId, "whoop:cycle:synthetic-representative-highest:day-strain");
  assert.equal(
    resolved.confidence.reasons.some((reason) => reason.includes("WHOOP day-strain cycle policy")),
    true,
  );
  const policyReason = resolved.confidence.reasons.find((reason) =>
    reason.includes("WHOOP day-strain cycle policy")
  ) ?? "";
  assert.equal(policyReason.includes("3 cycle candidates"), true);
  assert.equal(policyReason.includes("14.489366"), false);
  assert.equal(policyReason.includes("4.133967"), false);
});
