import assert from "node:assert/strict";
import { test } from "vitest";

import { buildCandidateExactKey, dedupeExactMetricCandidates } from "../src/wearables/dedupe.ts";
import { latestIsoTimestamp, uniqueStrings } from "../src/wearables/shared.ts";
import type { WearableMetricCandidate } from "../src/wearables/types.ts";

function candidate(index: number): WearableMetricCandidate {
  return {
    candidateId: `candidate-${index}`,
    date: "2026-04-01",
    provider: "junction",
    dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: "oura", originConfidence: "high" },
    externalRef: null,
    metric: "steps",
    value: 1000,
    unit: "count",
    sourceFamily: "event",
    sourceKind: "observation",
    occurredAt: null,
    recordedAt: null,
    paths: [`path-${index}`],
    recordIds: [`record-${index}`],
    title: `Title ${index}`,
    activityType: null,
  };
}

test("duplicate provenance preserves first identity, insertion order, blanks policy and input isolation", () => {
  const first = { ...candidate(0), paths: ["", " a ", " a ", "b"], recordIds: [" ", "r", "r"] };
  const unique = { ...candidate(1), value: 2000, paths: ["", "u", "u"], recordIds: ["", "q", "q"] };
  const second = { ...candidate(2), paths: ["b", "c", " a ", "\t"], recordIds: ["s", "r"], recordedAt: "2026-04-01T09:00:00Z" };
  const third = { ...candidate(3), paths: ["d", "a"], recordIds: ["t", "s"], recordedAt: "2026-04-01T08:00:00Z" };
  const inputs = [first, unique, second, third];
  const original = structuredClone(inputs);
  const result = dedupeExactMetricCandidates(inputs);
  assert.equal(result.exactDuplicateCount, 2);
  assert.deepEqual(result.candidates, [
    { ...first, paths: [" a ", "b", "c", "d", "a"], recordIds: ["r", "s", "t"], recordedAt: second.recordedAt },
    unique,
  ]);
  assert.deepEqual(inputs, original);
  for (const output of result.candidates) {
    assert.notEqual(output, inputs.find((input) => input.candidateId === output.candidateId));
    output.paths.push("output-only");
    output.recordIds.push("output-only");
  }
  assert.deepEqual(inputs, original);
});

test("interleaved duplicate groups match whole-group provenance and timestamp reduction", () => {
  const inputs = Array.from({ length: 600 }, (_, index) => ({
    ...candidate(index),
    value: index % 3 === 0 ? 1000.00001 : 1000.00002,
    provider: index % 7 === 0 ? "oura" : "junction",
    dataOrigin: {
      version: 1 as const,
      aggregatorProvider: "junction" as const,
      sourceProviderSlug: index % 5 === 0 ? "whoop" : "oura",
      sourceInstanceId: `source-${index % 2}`,
      normalizerVersion: `v${index % 3}`,
      originConfidence: "high" as const,
    },
    paths: ["", `path-${index % 11}`, ` path-${index % 7} `, "\t"],
    recordIds: [`record-${index}`, `shared-${index % 4}`],
    recordedAt: [null, "", " ", "2026-04-01T09:00:00Z", "2026-04-01T08:00:00Z"][index % 5]!,
  }));
  const groups = new Map<string, WearableMetricCandidate[]>();
  for (const input of inputs) {
    const key = buildCandidateExactKey(input);
    const group = groups.get(key) ?? [];
    group.push(input);
    groups.set(key, group);
  }
  const expected = [...groups.values()].map((group) => ({
    ...group[0]!,
    paths: uniqueStrings(group.flatMap((input) => input.paths)),
    recordIds: uniqueStrings(group.flatMap((input) => input.recordIds)),
    recordedAt: latestIsoTimestamp(group.map((input) => input.recordedAt)),
  }));
  assert.deepEqual(dedupeExactMetricCandidates(inputs), {
    candidates: expected,
    exactDuplicateCount: inputs.length - groups.size,
  });
  assert.deepEqual(dedupeExactMetricCandidates([]), { candidates: [], exactDuplicateCount: 0 });
});
