import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createBrowserVaultReplica } from "../src/browser-replica/build.ts";
import { createVaultReadModel } from "../src/read-model.ts";
import { isDefaultProjectedQueryEntity } from "../src/query-visibility.ts";
import { buildMetricProjection } from "../src/metrics/projection.ts";
import * as patterns from "../src/personal-patterns.ts";
import * as wearables from "../src/wearables.ts";
import * as candidates from "../src/wearables/candidates.ts";

const generatedAt = "2026-04-20T12:00:00.000Z";
function fixture(filtered: boolean) {
  const entities: CanonicalEntity[] = Array.from({ length: 18 }, (_, index) => {
    const id = `evt_synthetic_${index}`; const date = `2026-04-${String(index + 1).padStart(2, "0")}`;
    return { entityId: id, primaryLookupId: id, lookupIds: [id], family: "event", recordClass: "ledger",
      kind: "observation", status: null, occurredAt: `${date}T08:00:00Z`, date,
      path: "ledger/events/2026/2026-04.jsonl", title: "Synthetic steps", body: null,
      attributes: { metric: "steps", value: 8000 + index, unit: "count", source: "device",
        recordedAt: `${date}T09:00:00Z`, timeZone: "UTC", ...(index % 2 ? { canonicalFact: true } : {}),
        externalRef: { system: "oura", resourceType: "daily", resourceId: id } },
      frontmatter: null, links: [], relatedIds: [], stream: null, experimentSlug: null, tags: [] };
  });
  const vault = createVaultReadModel({ vaultRoot: "browser://synthetic-reuse", metadata: { timezone: "UTC" },
    entities: filtered ? entities.filter(isDefaultProjectedQueryEntity) : entities });
  return { vault, metricPoints: buildMetricProjection(vault).metricPoints, generatedAt, sourceBundleHash: "a".repeat(64) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); for (const nested of Object.values(value)) freeze(nested);
  }
  return value;
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

for (const filtered of [false, true]) {
  test(`replica reuses only equivalent bundles and matches independent old derivations (filtered=${filtered})`, async () => {
    const input = fixture(filtered); const before = JSON.stringify(input); freeze(input);
    const defaultVault = createVaultReadModel({ ...input.vault, entities: input.vault.entities.filter(isDefaultProjectedQueryEntity) });
    const build = wearables.buildWearableSummaryBundle;
    const selectHealth = wearables.summarizeWearableSourceHealthFromBundle;
    const selectAssistant = wearables.buildWearableAssistantSummaryFromBundle;
    const selectPatterns = patterns.buildPersonalPatternReportFromWearableBundleAndMetricPoints;
    const bundles = vi.spyOn(wearables, "buildWearableSummaryBundle").mockImplementation((...args) => freeze(build(...args)));
    const collected = vi.spyOn(candidates, "collectWearableDataset");
    const health = vi.spyOn(wearables, "summarizeWearableSourceHealthFromBundle");
    const assistant = vi.spyOn(wearables, "buildWearableAssistantSummaryFromBundle");
    const personal = vi.spyOn(patterns, "buildPersonalPatternReportFromWearableBundleAndMetricPoints");
    const replica = await createBrowserVaultReplica(input);
    assert.equal(bundles.mock.calls.length, filtered ? 1 : 2);
    assert.equal(collected.mock.calls.length, filtered ? 1 : 2);
    const defaultBundle = health.mock.calls[0]![0];
    assert.equal(assistant.mock.calls[0]![0], defaultBundle);
    assert.equal(personal.mock.calls[0]![0], input.vault);
    assert.equal(personal.mock.calls[0]![1] === defaultBundle, filtered);
    assert.equal(JSON.stringify(input), before);
    vi.restoreAllMocks();
    // Independent old inputs for the three consumers; reuse the unchanged
    // replica renderer/hash instead of copying an entire alternative builder.
    vi.spyOn(wearables, "summarizeWearableSourceHealthFromBundle")
      .mockImplementation((_bundle, filters) => selectHealth(build(defaultVault), filters));
    vi.spyOn(wearables, "buildWearableAssistantSummaryFromBundle")
      .mockImplementation((_bundle, filters) => selectAssistant(build(defaultVault), filters));
    vi.spyOn(patterns, "buildPersonalPatternReportFromWearableBundleAndMetricPoints")
      .mockImplementation((vault, _bundle, points, options) => selectPatterns(vault, build(vault), points, options));
    const reference = await createBrowserVaultReplica(input);
    assert.equal(JSON.stringify(replica), JSON.stringify(reference));
    assert.equal(replica.source.dataVersion, reference.source.dataVersion);
    assert.equal(JSON.stringify(input), before);
    const summary = selectAssistant(build(defaultVault));
    assert.deepEqual(replica.assistantSummary, { highlights: summary.highlights, latestDate: summary.latestDate });
  });
}

test("assistant wrapper preserves provider/date/range metadata and the full summary contract", () => {
  const { vault } = fixture(false);
  for (const filters of [{}, { providers: ["oura", "oura"] }, { providers: ["missing"] },
    { date: "2026-04-03" }, { from: "2026-04-02", to: "2026-04-12", providers: ["oura"] }]) {
    const bundle = freeze(wearables.buildWearableSummaryBundleFromDataset(candidates.collectWearableDataset(vault, filters)));
    const before = JSON.stringify(bundle);
    assert.deepEqual(wearables.buildWearableAssistantSummary(vault, filters), wearables.buildWearableAssistantSummaryFromBundle(bundle, filters));
    assert.equal(JSON.stringify(bundle), before);
  }
});

for (const checkpoint of [0, 1, 2, 3, 4]) {
  test(`replica still observes cancellation at existing checkpoint ${checkpoint}`, async () => {
    const input = fixture(true);
    const controller = new AbortController(); const reason = new Error("synthetic cancellation");
    const originalTimer = globalThis.setTimeout;
    let scheduled = 0;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, ms, ...args) => {
      const timer = originalTimer(callback, ms, ...args);
      // Abort at the actual scheduling boundary, not after a fake timer drain
      // which can run several of the zero-delay continuations at once.
      if (++scheduled === checkpoint) controller.abort(reason);
      return timer;
    });
    const assistant = vi.spyOn(wearables, "buildWearableAssistantSummaryFromBundle");
    if (checkpoint === 0) controller.abort(reason);
    await assert.rejects(createBrowserVaultReplica({ ...input, signal: controller.signal }), error => error === reason);
    assert.equal(scheduled, checkpoint);
    assert.equal(assistant.mock.calls.length, 0);
  });
}
