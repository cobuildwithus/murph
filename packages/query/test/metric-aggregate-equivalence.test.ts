import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { extractMetricPoints, extractMetricPointsFromCanonicalEntities, extractMetricPointsFromMetricRows,
  extractMetricPointsFromSampleSummaries, type MetricPoint, type MetricRowEvidence,
  type SampleSummaryMetricEvidence } from "../src/metrics/index.ts";

type Input = Parameters<typeof extractMetricPoints>[0];
// Test-only old-composition oracle. Identity, rather than the hashed id, is the
// dedupe key; payload is last-wins and Map insertion order is first-wins.
function finish(points: MetricPoint[]) {
  const unique = new Map<string, MetricPoint>();
  for (const p of points) unique.set(JSON.stringify([p.metricKey, p.observedAt, p.effectiveDate, p.grain,
    p.statistic, p.source.family, p.source.kind, p.source.recordId, p.source.resultIndex, p.source.path,
    p.comparator ?? "", p.canonicalValue ?? p.value ?? p.textValue ?? null, p.canonicalUnit ?? p.unit ?? null]), p);
  return [...unique.values()].sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return b.effectiveDate.localeCompare(a.effectiveDate);
    if (a.observedAt !== b.observedAt) return b.observedAt.localeCompare(a.observedAt);
    return a.id.localeCompare(b.id);
  });
}
function oldComposition(input: Input) {
  return finish([...extractMetricPointsFromMetricRows(input.metricRows ?? []),
    ...extractMetricPointsFromSampleSummaries(input.sampleSummaries ?? []),
    ...extractMetricPointsFromCanonicalEntities(input.vault?.entities ?? [])]);
}
function onePassProposal(input: Input) {
  // Singleton public producers construct the same raw points without changing
  // production exports or copying any metric construction/normalization logic.
  return finish([...(input.metricRows ?? []).flatMap(row => extractMetricPointsFromMetricRows([row])),
    ...(input.sampleSummaries ?? []).flatMap(row => extractMetricPointsFromSampleSummaries([row])),
    ...(input.vault?.entities ?? []).flatMap(row => extractMetricPointsFromCanonicalEntities([row]))]);
}
function row(date: string, value: number, id = "synthetic"): MetricRowEvidence {
  return { date, value, metricKey: "glucose", unit: "mg/dL", recordIds: [id],
    confidence: "high", sourceKind: "wearable-summary", sourceLabel: "Synthetic" };
}
function sample(date: string, value: number): SampleSummaryMetricEvidence {
  return { date, averageValue: value, stream: "glucose", unit: "mg/dL", firstSampleAt: null,
    lastSampleAt: null, numericSampleCount: 3, sampleCount: 3 };
}

test("canonical mixed producers, duplicate payloads and sparse input match the old composition", () => {
  let state = 123456;
  const random = (n: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 2 ** 32 * n); };
  for (let fixture = 0; fixture < 1000; fixture++) {
    const rows = Array.from({ length: 32 }, (_, i) => row(`2026-01-${String(1 + random(9)).padStart(2, "0")}`, 80 + random(9), `synthetic-${i % 4}`));
    const input: Input = { metricRows: [...rows, ...rows.slice(0, 6).map(r => ({ ...r, sourceLabel: "Last payload", rawRefs: ["synthetic-ref"] }))],
      sampleSummaries: rows.slice(0, 8).map(r => sample(r.date, r.value!)) };
    input.vault = { entities: [{
      entityId: "evt_synthetic_measurement", primaryLookupId: "evt_synthetic_measurement", lookupIds: ["evt_synthetic_measurement"],
      family: "event", recordClass: "ledger", kind: "measurement", date: "2026-01-03", occurredAt: "2026-01-03T12:00:00Z",
      status: null, path: "ledger/events/2026/2026-01.jsonl", title: "Synthetic glucose", body: null,
      attributes: { measurements: [{ metric: "glucose", value: 90, unit: "mg/dL" }], source: "manual" },
      frontmatter: null, links: [], relatedIds: [], stream: null, experimentSlug: null, tags: [],
    }] };
    input.vault.entities = [...input.vault.entities, { ...input.vault.entities[0]!, attributes: { ...input.vault.entities[0]!.attributes, source: "import", rawRefs: ["synthetic-raw"] } }];
    const before = JSON.stringify(input);
    assert.ok(extractMetricPoints(input).some(point => point.source.kind === "measurement"));
    assert.deepEqual(extractMetricPoints(input), oldComposition(input));
    assert.deepEqual(onePassProposal(input), oldComposition(input));
    assert.equal(JSON.stringify(input), before);
  }
  assert.deepEqual(extractMetricPoints({}), []);
  assert.deepEqual(extractMetricPoints({ metricRows: [{ ...row("2026-01-01", 1), value: null }] }), []);
}, 30_000);

test("colliding ids preserve stable ties and distinct identities with last-wins payloads", () => {
  // Deterministically force equal hashes for equal-length identities. Do not
  // replace the production hash or use hashed ids as a test dedupe shortcut.
  const bigint = vi.spyOn(globalThis, "BigInt").mockReturnValue(0n);
  try {
    const a = row("2026-01-01", 81, "a"); const b = row("2026-01-01", 81, "b");
    const input = { metricRows: [b, a, { ...b, sourceLabel: "Last payload" }] };
    const result = extractMetricPoints(input);
    assert.equal(result[0]?.id, result[1]?.id);
    assert.deepEqual(result.map(p => p.source.recordId), ["b", "a"]);
    assert.equal(result[0]?.provenance.sourceLabel, "Last payload");
    assert.deepEqual(onePassProposal(input), oldComposition(input));
  } finally { bigint.mockRestore(); }
});

test("accepted noncanonical cross-producer dates prevent deleting the intermediate sorts", () => {
  // Both exported evidence interfaces accept these strings without validation.
  // Canonically equivalent Unicode strings collate equally but are not ===;
  // the existing comparator returns before its id tie-break in that case.
  assert.equal("\u00e9".localeCompare("e\u0301"), 0);
  const input: Input = { metricRows: [row("b", 3, "r2")], sampleSummaries: [
    sample("\u00e9", 18), sample("\u00e9", 27), sample("e\u0301", 32),
    sample("a", 19), sample("a", 22), sample("\u00e9", 4),
  ] };
  const original = extractMetricPoints(input);
  assert.deepEqual(original, oldComposition(input));
  assert.notDeepEqual(onePassProposal(input), original);
});
