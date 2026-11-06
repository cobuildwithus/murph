import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { CliTiming } from "@murphai/runtime-state/cli-timing";
import { startCliPhase, timeCliDispatch, withCliTiming } from "@murphai/runtime-state/node/cli-timing";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { buildMetricProjection, type MetricProjection } from "../src/metrics/projection.ts";
import { createVaultReadModel } from "../src/read-model.ts";

// Instrumentation mechanism benchmark on dense, deterministic, multi-provider
// synthetic history. It compares the default call, the rebuild's observer with
// no active timing scope, and enabled in-memory timing on the same fixture.
// Every sample must equal the complete default result. No timing threshold.
function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

const DAYS = boundedInteger("MURPH_METRIC_DENSE_BENCH_DAYS", 365, 7, 1095);
const SAMPLES_PER_DAY = boundedInteger("MURPH_METRIC_DENSE_BENCH_SAMPLES_PER_DAY", 96, 0, 1440);
const ROUNDS = boundedInteger("MURPH_METRIC_DENSE_BENCH_ROUNDS", 5, 1, 20);
const PROVIDERS = ["oura", "whoop", "garmin"] as const;
const DAILY_METRICS = [
  ["sleep_score", "%", "sleep"],
  ["respiratory_rate", "breaths/min", "sleep"],
  ["hrv", "ms", "recovery"],
  ["resting_heart_rate", "bpm", "recovery"],
  ["spo2", "%", "recovery"],
  ["recovery_score", "%", "recovery"],
  ["steps", "count", "daily-summary"],
  ["active_calories", "kcal", "daily-summary"],
  ["distance", "km", "daily-summary"],
  ["floors_climbed", "count", "daily-summary"],
  ["vo2_max", "mL/kg/min", "daily-summary"],
  ["weight", "kg", "body"],
] as const;

function entity(
  id: string, kind: string, family: CanonicalEntity["family"], date: string, occurredAt: string,
  attributes: Record<string, unknown>,
): CanonicalEntity {
  return {
    entityId: id, primaryLookupId: id, lookupIds: [id], family, recordClass: family === "sample" ? "sample" : "ledger",
    kind, status: null, occurredAt, date, path: `ledger/${family}s/${date.slice(0, 7)}.jsonl`, title: null, body: null,
    attributes: { id, kind, occurredAt, ...attributes }, frontmatter: null, links: [], relatedIds: [], stream: null,
    experimentSlug: null, tags: [],
  };
}

function makeEntities(): CanonicalEntity[] {
  const entities: CanonicalEntity[] = [];
  for (let day = 0; day < DAYS; day += 1) {
    const date = new Date(Date.UTC(2025, 0, day + 1)).toISOString().slice(0, 10);
    PROVIDERS.forEach((provider, offset) => {
      const shifted = day + offset * 5;
      const dataOrigin = { sourceProviderSlug: provider, sourceInstanceId: `device-${provider}`, sourceType: "sensor" };
      const endAt = `${date}T11:00:00.000Z`;
      const startAt = new Date(Date.parse(endAt) - (400 + (shifted % 9) * 10) * 60_000).toISOString();
      entities.push(entity(`evt_sleep_${provider}_${day}`, "sleep_session", "event", date, startAt, {
        dayKey: date, durationMinutes: 400 + (shifted % 9) * 10, endAt, startAt, sleepType: "main_sleep",
        source: "device", recordedAt: endAt, dataOrigin,
        externalRef: { system: provider, resourceType: "sleep", resourceId: `sleep-${provider}-${date}` },
      }));
      DAILY_METRICS.forEach(([metric, unit, resourceType], metricIndex) => {
        const occurredAt = `${date}T12:00:00.000Z`;
        entities.push(entity(`evt_${metric}_${provider}_${day}`, "observation", "event", date, occurredAt, {
          dayKey: date, metric, unit, value: 40 + ((shifted * 37 + metricIndex * 11) % 50),
          observationGrain: "daily-summary", source: "device", recordedAt: `${date}T12:05:00.000Z`, dataOrigin,
          externalRef: { system: provider, resourceType, resourceId: `${metric}-${provider}-${date}` },
        }));
      });
      for (let sample = 0; sample < SAMPLES_PER_DAY; sample += 1) {
        const recordedAt = new Date(Date.parse(`${date}T00:00:00.000Z`) + sample * (86_400_000 / SAMPLES_PER_DAY))
          .toISOString();
        entities.push(entity(`smp_hr_${provider}_${day}_${sample}`, "metric_sample", "sample", date, recordedAt, {
          dayKey: date, metric: "heart_rate", unit: "bpm", value: 55 + ((sample * 7 + shifted) % 60),
          quality: "derived", source: "device", recordedAt, dataOrigin,
          externalRef: { system: provider, resourceType: "heartrate", resourceId: `hr-${provider}-${date}-${sample}` },
        }));
      }
    });
  }
  return entities;
}

type Variant = "default" | "inactive-observer" | "enabled-timing";
const VARIANTS: readonly Variant[] = ["default", "inactive-observer", "enabled-timing"];

const entities = makeEntities();
const vault = createVaultReadModel({ entities, metadata: null, vaultRoot: "/virtual/metric-projection-dense" });
let report: CliTiming | null = null;

async function run(variant: Variant): Promise<MetricProjection> {
  if (variant === "default") return buildMetricProjection(vault);
  // Outside a timing scope startCliPhase is the production no-op.
  if (variant === "inactive-observer") return buildMetricProjection(vault, { startStep: startCliPhase });
  let result!: MetricProjection;
  await withCliTiming(() => timeCliDispatch("query projection rebuild", async () => {
    result = buildMetricProjection(vault, { startStep: startCliPhase });
  }), (value) => { report = value; });
  return result;
}

const expected = await run("default");
const hash = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
assert.ok(expected.wearableMetricRows.length > 0);
assert.ok(expected.metricPoints.some((point) => point.source.kind === "metric-sample"));
console.log(JSON.stringify({
  fixture: "metric-projection-dense-v1", days: DAYS, providers: PROVIDERS.length, samplesPerDay: SAMPLES_PER_DAY,
  entities: entities.length, wearableMetricRows: expected.wearableMetricRows.length,
  metricPoints: expected.metricPoints.length, hash,
}));

const samples = Object.fromEntries(VARIANTS.map((variant) => [variant, { wallMs: [] as number[], cpuMs: [] as number[] }]));
// Round -1 warms every variant. Each round rotates the variant order.
for (let round = -1; round < ROUNDS; round += 1) {
  const offset = ((round % VARIANTS.length) + VARIANTS.length) % VARIANTS.length;
  for (const variant of [...VARIANTS.slice(offset), ...VARIANTS.slice(0, offset)]) {
    globalThis.gc?.();
    const startCpu = process.cpuUsage();
    const start = performance.now();
    const result = await run(variant);
    const wallMs = performance.now() - start;
    const used = process.cpuUsage(startCpu);
    assert.deepEqual(result, expected);
    if (round < 0) continue;
    samples[variant]!.wallMs.push(Number(wallMs.toFixed(1)));
    samples[variant]!.cpuMs.push(Number(((used.user + used.system) / 1000).toFixed(1)));
  }
}

const median = (values: number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
for (const variant of VARIANTS) {
  const { wallMs, cpuMs } = samples[variant]!;
  console.log(JSON.stringify({ variant, rounds: ROUNDS, wallMs, cpuMs, wallMedianMs: median(wallMs), cpuMedianMs: median(cpuMs) }));
}
const timing = report as CliTiming | null;
assert.ok(timing);
assert.equal(timing.droppedSpans, 0);
// Last enabled sample only: nested spans, not an additive partition.
console.log(JSON.stringify({ enabledPhases: timing.commands[0]!.phases
  .filter((phase) => phase.phase.startsWith("query-metric-"))
  .map((phase) => ({ phase: phase.phase, ms: phase.sumUs / 1000 })) }));
