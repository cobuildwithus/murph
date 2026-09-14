import assert from "node:assert/strict";
import { test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { readBrowserVaultReplicaSource } from "../src/browser-replica/source.ts";
import { createBrowserVaultReplica, parseBrowserVaultReplica } from "../src/browser.ts";
import { buildPersonalPatternReportRuntime, rebuildQueryProjection } from "../src/query-projection.ts";
import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/read-model.ts";
import { buildPersonalPatternReport } from "../src/personal-patterns.ts";
import { matchPersonalPatternControls } from "../src/personal-pattern-matching.ts";
import { patternAddDays as addDays, patternDayGap } from "../src/personal-pattern-evidence.ts";

function event(id: string, date: string, kind: string, attributes: Record<string, unknown>): CanonicalEntity {
  return { entityId: id, primaryLookupId: id, lookupIds: [id], family: "event", recordClass: "ledger",
    kind, status: null, occurredAt: `${date}T12:00:00Z`, date, path: `ledger/events/${id}.json`,
    title: null, body: null, attributes: { source: "device", externalRef: {
      system: "oura", resourceType: kind === "activity_session" ? "workouts" : "daily-summary", resourceId: id,
    }, ...attributes }, frontmatter: null, links: [], relatedIds: [], stream: null,
    experimentSlug: null, tags: [] };
}

function history(options: { effect?: number; coverage?: boolean; confounded?: boolean; quality?: boolean } = {}) {
  const start = "2026-03-01";
  const exposed = new Set(Array.from({ length: 8 }, (_, index) => addDays(start, 25 + index * 14)));
  const events: CanonicalEntity[] = [];
  for (let day = 0; day < 140; day += 1) {
    const date = addDays(start, day);
    if (exposed.has(date)) events.push(event(`session_${day}`, date, "activity_session", { activityType: "cycling" }));
    const nearExposure = [...exposed].some((exposure) => date < exposure && patternDayGap(date, exposure) <= 7);
    if (options.coverage !== false) events.push(event(`steps_${day}`, date, "observation", {
      metric: "steps", observationGrain: "summary", value: options.confounded && nearExposure ? 15_000 : 5_000, unit: "count",
    }));
    events.push(event(`hrv_${day}`, date, "observation", {
      metric: "hrv", observationGrain: "summary", unit: "ms",
      value: 50 + (exposed.has(addDays(date, -1)) ? options.effect ?? 15 : 0),
    }));
    if (options.quality) {
      for (const [metric, value, unit] of [["sleep-score", 75, "score"], ["sleep-efficiency", 90, "%"], ["total-sleep-minutes", 450, "min"]] as const) {
        events.push(event(`${metric}_${day}`, date, "observation", { metric, value, unit, observationGrain: "summary" }));
      }
    }
  }
  return { events, exposed, asOf: addDays(start, 139) };
}

function report(events: CanonicalEntity[], asOf: string) {
  return buildPersonalPatternReport(createVaultReadModel({ entities: events, vaultRoot: "test://comparable-patterns" }), { asOf });
}

test("covered repeated positive and negative associations survive the production report", () => {
  for (const effect of [15, -15]) {
    const fixture = history({ effect });
    const cell = report(fixture.events, fixture.asOf).cells.find((cell) => cell.outcomeId === "hrv");
    assert.ok(cell);
    assert.equal(cell.direction, effect > 0 ? "higher" : "lower");
    assert.equal(cell.grade, "B");
    assert.equal(cell.exposedMean, 50 + effect);
    assert.equal(cell.comparisonMean, 50);
    assert.equal(cell.deltaPercent, effect * 2);
    assert.equal(cell.comparisonDays, new Set(cell.comparisonDates).size);
    assert.equal(cell.exposedDays, new Set(cell.exposedDates).size);
  }
});

test("persisted Junction provenance gives runtime and Browser Vault the same qualified comparisons", async () => {
  for (const changedSource of [false, true]) {
    const fixture = history();
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-pattern-provenance-"));
    const events = fixture.events.map((entry) => ({
      ...entry.attributes,
      schemaVersion: "murph.event.v1",
      id: `evt_${entry.entityId}`,
      kind: entry.kind,
      dayKey: entry.date,
      occurredAt: entry.occurredAt,
      recordedAt: entry.occurredAt,
      title: "Synthetic comparison evidence",
      ...(entry.kind === "observation" ? { observationGrain: "daily-summary" } : {}),
      dataOrigin: {
        version: 1, aggregatorProvider: "junction", sourceProviderSlug: "oura", sourceType: "ring",
        sourceInstanceId: changedSource && entry.date! >= addDays(fixture.asOf, -21) ? "synthetic-ring-b" : "synthetic-ring-a",
      },
      externalRef: { system: "junction", resourceType: "junction-oura-summary", resourceId: entry.entityId },
    }));
    try {
      await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
      await writeFile(path.join(vaultRoot, "vault.json"), JSON.stringify({
        createdAt: "2026-03-01T00:00:00Z", formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC", title: "Synthetic source comparison", vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4P",
      }));
      await writeFile(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
        events.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      await rebuildQueryProjection(vaultRoot);
      const runtime = await buildPersonalPatternReportRuntime(vaultRoot, { asOf: fixture.asOf });
      const source = await readBrowserVaultReplicaSource(vaultRoot);
      const replica = await createBrowserVaultReplica({
        ...source, generatedAt: `${fixture.asOf}T12:00:00Z`, sourceBundleHash: "a".repeat(64),
      });
      const browser = parseBrowserVaultReplica(replica).personalPatterns;
      assert.ok(browser);
      assert.equal(source.vault.entities.length, events.length);
      assert.ok(replica.entities.every((entry) => entry.kind !== "observation"));
      const cell = browser.cells.find((entry) => entry.outcomeId === "hrv");
      assert.ok(cell);
      assert.equal(cell.direction, changedSource ? "flat" : "higher");
      assert.equal(cell.grade, changedSource ? null : "B");
      if (!changedSource) assert.ok(cell.comparisonDays >= 6);
      assert.deepEqual(runtime, browser);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  }
});

test("sleep-only coverage and strongly imbalanced prior activity cannot produce directions", () => {
  for (const options of [{ coverage: false }, { confounded: true }, { effect: 0 }]) {
    const fixture = history(options);
    assert.ok(report(fixture.events, fixture.asOf).cells.every((cell) => cell.direction === "flat"));
  }
});

test("old associations and one clustered episode do not become current findings", () => {
  const fixture = history();
  assert.ok(report(fixture.events, addDays(fixture.asOf, 35)).cells.every((cell) => cell.direction === "flat"));
  const clustered = fixture.events.map((entry) => entry.kind === "activity_session"
    ? { ...entry, tags: ["episode-training-camp"] } : entry);
  assert.ok(report(clustered, fixture.asOf).cells.every((cell) => cell.direction === "flat"));
});

test("source changes and missing baseline coverage cannot borrow older or unknown days", () => {
  const fixture = history();
  const cutoff = addDays(fixture.asOf, -21);
  const changed = fixture.events.map((entry) => entry.date! >= cutoff ? { ...entry, attributes: {
    ...entry.attributes, externalRef: { system: "garmin", resourceType: "daily-summary", resourceId: entry.entityId },
  } } : entry);
  assert.ok(report(changed, fixture.asOf).cells.every((cell) => cell.direction === "flat"));
  const gaps = fixture.events.filter((entry) => entry.attributes.metric !== "steps" || fixture.exposed.has(entry.date!));
  assert.equal(report(gaps, fixture.asOf).cells[0]?.comparisonDays, 0);
});

test("one sleep quality metric is chosen by coverage before inspecting factor effects", () => {
  const fixture = history({ quality: true });
  const primary = report(fixture.events, fixture.asOf);
  assert.ok(primary.outcomes.some((outcome) => outcome.id === "sleep-score"));
  assert.ok(!primary.outcomes.some((outcome) => outcome.id === "sleep-efficiency"));
  const sparseScore = fixture.events.filter((entry) => entry.attributes.metric !== "sleep-score"
    || fixture.exposed.has(addDays(entry.date!, -1)));
  const fallback = report(sparseScore, fixture.asOf);
  assert.ok(!fallback.outcomes.some((outcome) => outcome.id === "sleep-score"));
  assert.ok(fallback.outcomes.some((outcome) => outcome.id === "sleep-efficiency"));
});

test("drawer means weight episodes and their controls while counts remain distinct dates", () => {
  const events: CanonicalEntity[] = [];
  for (const [date, value, episode] of [["2026-01-05", 70, "trip"], ["2026-01-08", 90, "trip"], ["2026-02-03", 100, "other"]] as const) {
    const note = event(`note_${date}`, date, "note", { source: "manual", noteType: "journal-factor" });
    note.tags = ["key-context", "happened", `episode-${episode}`];
    events.push(note, event(`outcome_${date}`, addDays(date, 1), "observation", {
      metric: "hrv", value, unit: "ms", observationGrain: "summary",
    }));
  }
  for (const [date, value] of [["2026-01-12", 10], ["2026-01-19", 30], ["2026-01-26", 50], ["2026-01-15", 70], ["2026-02-10", 80]] as const) {
    events.push(event(`control_${date}`, addDays(date, 1), "observation", {
      metric: "hrv", value, unit: "ms", observationGrain: "summary",
    }));
  }
  const cell = report(events, "2026-02-15").cells[0];
  assert.equal(cell.exposedMean, 90);
  assert.equal(cell.comparisonMean, 65);
  assert.ok(Math.abs(cell.deltaPercent! - 100 * (90 - 65) / 65) < 1e-10);
  assert.equal(cell.exposedDays, 3);
  assert.equal(cell.comparisonDays, 5);
});

test("multiple controls give first slots priority and can rearrange covariate-dependent matches", () => {
  const dates = Array.from({ length: 6 }, (_, i) => addDays("2026-01-05", i * 7));
  const [a, b, c, d, e, f] = dates;
  const cost = (exposed: string, control: string) => exposed === b && control !== c ? null : patternDayGap(exposed, control);
  const matched = matchPersonalPatternControls([a, b], [c, d, e, f], cost);
  assert.deepEqual(matched.get(b), [c]);
  assert.deepEqual(matched.get(a), [d, e, f]);
  assert.deepEqual(matchPersonalPatternControls([b, a], [f, e, d, c], cost), matched);
});

test("the full report screens correlated null searches across repeated annual windows", { timeout: 120_000 }, () => {
  const metrics = [
    ["hrv", 50, "ms"], ["resting-heart-rate", 60, "bpm"],
    ["recovery-score", 70, "score"], ["readiness-score", 70, "score"],
    ["respiratory-rate", 15, "breaths/min"], ["spo2", 97, "%"],
  ] as const;
  let historiesWithDirection = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const events: CanonicalEntity[] = [];
    let previous = 0;
    for (let day = 0; day < 484; day += 1) {
      const date = addDays("2025-01-01", day);
      // Shared serially correlated noise and calendar drift across outcomes.
      previous = previous * 0.7 + (random() - 0.5) * 4;
      for (const [metric, baseline, unit] of metrics) {
        events.push(event(`${metric}_${day}`, date, "observation", {
          metric, unit, observationGrain: "summary", value: baseline + previous + Math.sin(day / 25),
        }));
      }
      for (let factor = 0; factor < 15; factor += 1) {
        if (random() > 0.15 + (day % 7 === factor % 7 ? 0.15 : 0)) continue;
        const note = event(`factor_${factor}_${day}`, date, "note", {
          source: "manual", noteType: "journal-factor", note: "Synthetic context",
        });
        note.tags = [`key-context-${factor}`, "happened"];
        events.push(note);
      }
    }
    const vault = createVaultReadModel({ entities: events, vaultRoot: "test://pattern-calibration" });
    let directional = false;
    for (let window = 0; window < 13; window += 1) {
      const result = buildPersonalPatternReport(vault, { asOf: addDays("2025-01-01", 119 + window * 28) });
      assert.equal(result.outcomes.length * result.factors.length, 90);
      directional ||= result.cells.some((cell) => cell.direction !== "flat");
    }
    if (directional) historiesWithDirection += 1;
    if (seed === 12) {
      const asOf = addDays("2025-01-01", 483);
      const injectedDates = new Set(Array.from({ length: 11 }, (_, i) => addDays(asOf, -110 + i * 10)));
      const injected = events.filter((entry) => !entry.tags.includes("key-context-0")).map((entry) => {
        if (entry.attributes.metric !== "hrv" || !injectedDates.has(addDays(entry.date!, -1))) return entry;
        return { ...entry, attributes: { ...entry.attributes, value: Number(entry.attributes.value) + 30 } };
      });
      for (const date of injectedDates) {
        const note = event(`injected_${date}`, date, "note", { source: "manual", noteType: "journal-factor" });
        note.tags = ["key-context-0", "happened"];
        injected.push(note);
      }
      const result = report(injected, asOf);
      assert.equal(result.outcomes.length * result.factors.length, 90);
      assert.equal(result.cells.find((cell) => cell.factorId === "context-0" && cell.outcomeId === "hrv")?.direction, "higher");
    }
  }
  assert.ok(historiesWithDirection <= 1, `${historiesWithDirection}/12 null histories produced a direction`);
  console.info(`Pattern calibration: ${historiesWithDirection}/12 null histories produced a direction across 156 reports; injected association detected among 90 comparisons.`);
});
