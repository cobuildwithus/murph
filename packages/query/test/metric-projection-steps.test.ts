import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test, vi } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import * as metricPoints from "../src/metrics/index.ts";
import { buildMetricProjection, type MetricProjectionStep } from "../src/metrics/projection.ts";
import { createVaultReadModel } from "../src/read-model.ts";
import * as sampleSummaries from "../src/summaries.ts";

afterEach(() => { vi.restoreAllMocks(); });

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const steps = ["query-metric-samples", "query-metric-evidence", "query-metric-extract", "query-metric-precedence"];

function entity(id: string, kind: string, family: "event" | "sample", date: string, attributes: Record<string, unknown>): CanonicalEntity {
  const occurredAt = `${date}T12:00:00.000Z`;
  return {
    entityId: id, primaryLookupId: id, lookupIds: [id], family, recordClass: family === "sample" ? "sample" : "ledger",
    kind, status: null, occurredAt, date, path: `ledger/${family}s/${date.slice(0, 7)}.jsonl`, title: null, body: null,
    attributes: { id, kind, occurredAt, dayKey: date, source: "device", recordedAt: occurredAt, ...attributes },
    frontmatter: null, links: [], relatedIds: [], stream: family === "sample" ? "heart_rate" : null,
    experimentSlug: null, tags: [],
  };
}

// Synthetic multi-provider state that populates every projection output.
function syntheticVault() {
  const entities: CanonicalEntity[] = [];
  for (const date of ["2026-05-01", "2026-05-02", "2026-05-03"]) {
    for (const provider of ["oura", "garmin"]) {
      const externalRef = (resourceType: string, suffix: string) =>
        ({ system: provider, resourceType, resourceId: `${provider}-${suffix}-${date}` });
      entities.push(entity(`evt_steps_${provider}_${date}`, "observation", "event", date, {
        metric: "steps", unit: "count", value: provider === "oura" ? 7100 : 8000,
        observationGrain: "daily-summary", externalRef: externalRef("daily", "steps"),
      }));
      entities.push(entity(`evt_hrv_${provider}_${date}`, "observation", "event", date, {
        metric: "hrv", unit: "ms", value: 50, externalRef: externalRef("recovery", "hrv"),
      }));
      for (let sample = 0; sample < 4; sample += 1) {
        entities.push(entity(`smp_hr_${provider}_${date}_${sample}`, "metric_sample", "sample", date, {
          metric: "heart_rate", unit: "bpm", value: 55 + sample, quality: "derived",
          externalRef: externalRef("heartrate", String(sample)),
        }));
      }
    }
  }
  return createVaultReadModel({ entities, metadata: null, vaultRoot: "/virtual/metric-projection-steps" });
}

test("observed projection is complete-output identical and brackets each fixed step", () => {
  const vault = syntheticVault();
  const disabled = buildMetricProjection(vault);
  assert.ok(disabled.dailySampleSummaries.length > 0);
  assert.ok(disabled.wearableMetricRows.length > 0);
  assert.ok(disabled.metricPoints.length > 0);

  const log: string[] = [];
  const summarize = sampleSummaries.summarizeDailySamples;
  vi.spyOn(sampleSummaries, "summarizeDailySamples").mockImplementation((...args) => {
    log.push("run:samples");
    return summarize(...args);
  });
  const extract = metricPoints.extractMetricPoints;
  vi.spyOn(metricPoints, "extractMetricPoints").mockImplementation((...args) => {
    log.push("run:extract");
    return extract(...args);
  });
  const startStep = (step: MetricProjectionStep) => {
    log.push(`start:${step}`);
    return () => { log.push(`end:${step}`); };
  };
  assert.deepEqual(buildMetricProjection(vault, { startStep }), disabled);
  assert.deepEqual(log, [
    "start:query-metric-samples", "run:samples", "end:query-metric-samples",
    "start:query-metric-evidence", "end:query-metric-evidence",
    "start:query-metric-extract", "run:extract", "end:query-metric-extract",
    "start:query-metric-precedence", "end:query-metric-precedence",
  ]);
});

test("observer failures never change projection output", () => {
  const vault = syntheticVault();
  const disabled = buildMetricProjection(vault);
  assert.deepEqual(buildMetricProjection(vault, { startStep: () => { throw new Error("observer start"); } }), disabled);
  assert.deepEqual(buildMetricProjection(vault, { startStep: () => () => { throw new Error("observer end"); } }), disabled);
});

test("a throwing step ends its span and preserves the original error identity", () => {
  const failure = new Error("synthetic extraction failure");
  vi.spyOn(metricPoints, "extractMetricPoints").mockImplementation(() => { throw failure; });
  const ended: string[] = [];
  const startStep = (step: MetricProjectionStep) => () => {
    ended.push(step);
    throw new Error("observer end must not replace the original error");
  };
  assert.throws(() => buildMetricProjection(syntheticVault(), { startStep }), error => error === failure);
  assert.deepEqual(ended, steps.slice(0, 3));
});

test("the shared projection owner's import graph stays free of Node builtins and Node timing", async () => {
  const visited = new Set<string>();
  const pending = [path.join(packageDir, "src/metrics/projection.ts")];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, "utf8");
    for (const [, specifier] of source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      assert.ok(specifier);
      const owner = path.relative(packageDir, current);
      assert.doesNotMatch(specifier, /^node:/u, `${owner} imports ${specifier}`);
      assert.doesNotMatch(specifier, /^@murphai\/runtime-state/u, `${owner} imports ${specifier}`);
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        pending.push(path.resolve(path.dirname(current), specifier));
      }
    }
  }
  assert.ok(visited.size > 1);
});
