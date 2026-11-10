import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { QUERY_PROJECTION_SECTION_RELATIVE_PATHS } from "@murphai/runtime-state/node";
import * as core from "@murphai/core";
import * as query from "@murphai/query";
import * as timing from "@murphai/runtime-state/node/cli-timing";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { test, vi } from "vitest";
import {
  fingerprint, readGlobalProof, readSleepProof, reviseSleepFixture, seedSleepFixture, sleepNow, traceSleepRead,
} from "../bench/wearable-sleep-fixture.ts";

// This file belongs only to the runtime-candidate patch. Baseline proof never
// silently skips a required candidate assertion based on a measured speed.
function globalSnapshot(root: string) {
  return (["entities", "metrics"] as const).flatMap(section => {
    const file = path.join(root, QUERY_PROJECTION_SECTION_RELATIVE_PATHS[section]);
    return existsSync(file) ? [{ section, bytes: readFileSync(file) }] : [];
  });
}
function assertFocusedRebuild(phases: Record<string, number>) {
  for (const phase of ["query-rebuild", "query-source-read", "query-wearable-dataset", "query-wearable-summary", "query-publication"]) {
    assert.equal(phases[phase], 1, phase);
  }
  assert.equal(phases["query-metric-projection"] ?? 0, 0);
  assert.equal(phases["query-search-documents"] ?? 0, 0);
}

test("focused sleep publishes only wearables, preserves stale globals and reuses summaries on full promotion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-focused-sleep-"));
  const reference = await mkdtemp(path.join(os.tmpdir(), "murph-full-sleep-reference-"));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(sleepNow));
  const services = createIntegratedVaultServices();
  const days = 5;
  try {
    await seedSleepFixture(core, root, days);
    await seedSleepFixture(core, reference, days);
    await query.rebuildQueryProjection(reference);
    const cold = await traceSleepRead(timing, "wearables sleep list", () => readSleepProof(services, root, days));
    assertFocusedRebuild(cold.phases);
    assert.deepEqual(fingerprint(cold.value), fingerprint(await readSleepProof(services, reference, days)));
    assert.deepEqual(globalSnapshot(root), []);
    assert.equal((await query.getQueryProjectionStatus(root)).fresh, false);
    assert.equal((await query.getQueryProjectionStatus(root)).builtAt, null);
    const partial = globalSnapshot(root);
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const fresh = await traceSleepRead(timing, "wearables sleep list", () => readSleepProof(services, root, days));
      assert.equal(fresh.phases["query-rebuild"] ?? 0, 0);
      assert.deepEqual(fingerprint(fresh.value), fingerprint(cold.value));
      assert.deepEqual(globalSnapshot(root), partial);
    }
    async function promote() {
      const global = await traceSleepRead(timing, "wearables activity list", () => readGlobalProof(services, query, root, days));
      assert.equal(global.phases["query-metric-projection"], 1);
      assert.equal(global.phases["query-search-documents"], 1);
      // This composed read requests entities and metrics independently.
      assert.equal(global.phases["query-publication"], 2);
      assert.equal(global.phases["query-wearable-summary"] ?? 0, 0);
      assert.deepEqual(fingerprint(global.value), fingerprint(await readGlobalProof(services, query, reference, days)));
      assert.equal((await query.getQueryProjectionStatus(root)).fresh, true);
    }
    await promote();
    const full = globalSnapshot(root);
    const globalFirstSleep = await traceSleepRead(timing, "wearables sleep list", () => readSleepProof(services, root, days));
    assert.equal(globalFirstSleep.phases["query-rebuild"] ?? 0, 0);
    assert.deepEqual(globalSnapshot(root), full);
    for (const deleted of [false, true]) {
      const before = globalSnapshot(root);
      await reviseSleepFixture(core, root, days, deleted);
      await reviseSleepFixture(core, reference, days, deleted);
      await query.rebuildQueryProjection(reference);
      const stale = await traceSleepRead(timing, "wearables sleep list", () => readSleepProof(services, root, days, deleted ? undefined : 410));
      assertFocusedRebuild(stale.phases);
      assert.deepEqual(fingerprint(stale.value), fingerprint(await readSleepProof(services, reference, days)));
      assert.deepEqual(globalSnapshot(root), before, "Wearable refresh must not alter global rows or completion metadata");
      assert.equal((await query.getQueryProjectionStatus(root)).fresh, false);
      await promote();
    }
  } finally {
    vi.useRealTimers();
    await Promise.all([root, reference].map(vault => rm(vault, { recursive: true, force: true })));
  }
});
