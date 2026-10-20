import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/read-model.ts";
import { buildMetricProjection, buildWearableMetricEvidence, buildWearableMetricEvidenceFromBundle } from "../src/metrics/projection.ts";
import { parseJsonValue } from "../src/projection/schema.ts";
import {
  projectPublicWearableSummaryBundle,
  stringifyPublicWearableProjectionSummary,
} from "../src/projection/wearable-summary-public-json.ts";
import { buildWearableSummaryBundle } from "../src/wearables.ts";
import { dedupeExactMetricCandidates } from "../src/wearables/dedupe.ts";
import type { WearableMetricCandidate } from "../src/wearables/types.ts";

// Synthetic, deterministic inputs; identical runs can be bundled against each
// candidate revision. Output hashes include every field, order and provenance.
function makeCandidate(index: number, groups: number): WearableMetricCandidate {
  return {
    candidateId: `candidate-${index}`,
    date: "2026-04-01",
    provider: "oura",
    dataOrigin: null,
    externalRef: null,
    metric: "steps",
    value: index % groups,
    unit: "count",
    sourceFamily: "event",
    sourceKind: "observation",
    occurredAt: null,
    recordedAt: "2026-04-01T09:00:00Z",
    paths: [`ledger/events/day-${index % 30}.jsonl`],
    recordIds: [`record-${index}`],
    title: "Synthetic steps",
    activityType: null,
  };
}

function makeVault(days: number, copies: number) {
  const entities: CanonicalEntity[] = [];
  for (let day = 0; day < days; day += 1) {
    const date = new Date(Date.UTC(2025, 0, day + 1)).toISOString().slice(0, 10);
    for (const provider of ["oura", "whoop", "garmin"]) {
      for (let copy = 0; copy < copies; copy += 1) {
        const id = `evt_${day}_${provider}_${copy}`;
        const occurredAt = `${date}T09:00:00Z`;
        entities.push({
          entityId: id, primaryLookupId: id, lookupIds: [id], family: "event", recordClass: "ledger", kind: "observation",
          status: null, occurredAt, date, path: `ledger/events/${date}.jsonl`, title: "Synthetic steps", body: null,
          attributes: {
            id, kind: "observation", occurredAt, recordedAt: occurredAt, source: "device", metric: "steps", value: 5000 + day,
            unit: "count", observationGrain: "summary",
            externalRef: { system: provider, resourceType: "daily", resourceId: `${date}-${provider}`, facet: "steps" },
          },
          frontmatter: null, links: [], relatedIds: [], stream: null, experimentSlug: null, tags: [],
        });
      }
    }
  }
  return createVaultReadModel({ entities, metadata: null, vaultRoot: "/virtual/wearable-cpu" });
}

function measure(name: string, run: () => unknown) {
  const expected = run();
  const hash = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  const samples = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    globalThis.gc?.();
    const startCpu = process.cpuUsage();
    const start = performance.now();
    const result = run();
    const wallMs = performance.now() - start;
    const cpu = process.cpuUsage(startCpu);
    assert.deepEqual(result, expected);
    samples.push({ wallMs, cpuMs: (cpu.user + cpu.system) / 1000 });
  }
  console.log(JSON.stringify({ name, hash, samples }));
}

for (const [name, groups] of [["one-duplicate-group", 1], ["mixed-duplicate-groups", 80], ["unique-candidates", 8000]] as const) {
  const candidates = Array.from({ length: 8000 }, (_, index) => makeCandidate(index, groups));
  measure(name, () => dedupeExactMetricCandidates(candidates));
}
for (const [name, days, copies] of [["projection-duplicate-burst", 1, 2000], ["projection-duplicate-history", 90, 20], ["projection-unique-history", 365, 1]] as const) {
  const vault = makeVault(days, copies);
  const projection = buildMetricProjection(vault);
  assert.ok(projection.wearableMetricRows.some((row) => row.value !== null));
  // Metric-only construction must equal the full source-health-enabled bundle.
  assert.deepEqual(buildWearableMetricEvidence(vault), buildWearableMetricEvidenceFromBundle(buildWearableSummaryBundle(vault)));
  measure(name, () => buildMetricProjection(vault));
}

// Public projection versus its text round-trip control on one fixture:
// two warm pairs, then seven alternating measured pairs.
{
  const bundle = buildWearableSummaryBundle(makeVault(365, 1));
  const control = () => Object.fromEntries(Object.entries(bundle).map(([key, summaries]: [string, readonly unknown[]]) => [
    key,
    summaries.map((summary) => parseJsonValue<unknown>(stringifyPublicWearableProjectionSummary(summary), null))
      .filter((summary) => summary !== null),
  ]));
  const expected = control();
  const hash = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  const pairs = [];
  for (let pair = 0; pair < 9; pair += 1) {
    const sample = { control: 0, projection: 0 };
    for (const name of pair % 2 === 0 ? ["control", "projection"] as const : ["projection", "control"] as const) {
      globalThis.gc?.();
      const start = performance.now();
      const result = name === "control" ? control() : projectPublicWearableSummaryBundle(bundle);
      sample[name] = performance.now() - start;
      assert.deepStrictEqual(result, expected);
    }
    if (pair >= 2) pairs.push(sample);
  }
  console.log(JSON.stringify({ name: "public-projection-unique-history", hash, pairs }));
}
