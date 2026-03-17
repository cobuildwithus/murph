import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import {
  readBiomarkerLibraryPage,
  readHealthLibraryGraph,
} from "../src/index.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const demoVaultRoot = path.join(repoRoot, "fixtures/demo-web-vault");

test("readHealthLibraryGraph loads the canonical RHR graph nodes", async () => {
  const graph = await readHealthLibraryGraph(demoVaultRoot);

  assert.ok(graph.nodes.length >= 15);
  assert.equal(graph.bySlug.get("resting-heart-rate")?.entityType, "biomarker");
  assert.equal(graph.bySlug.get("attia-zone2-4x45m")?.entityType, "protocol_variant");
  assert.equal(graph.bySlug.get("100-healthy-years")?.entityType, "mission");
});

test("readBiomarkerLibraryPage resolves RHR content, live goals, and active run context", async () => {
  const page = await readBiomarkerLibraryPage(demoVaultRoot, "resting-heart-rate");

  assert.ok(page);
  assert.equal(page?.title, "Resting Heart Rate");
  assert.equal(page?.defaultMeasurementContext?.slug, "nighttime-lowest-wearable");
  assert.equal(page?.referenceSets.length, 3);
  assert.equal(page?.protocols[0]?.slug, "attia-zone2-4x45m");
  assert.equal(page?.activeGoals[0]?.id, "goal_rhr_01");
  assert.equal(page?.activeExperiments[0]?.slug, "zone2-rhr-reset");
  assert.equal(page?.activeExperiments[0]?.protocol?.title, "Zone 2 · 4 x 45 min");
  assert.equal(page?.personalStats.latestValue, 55);
  assert.equal(page?.personalStats.baseline7, 56.9);
});
