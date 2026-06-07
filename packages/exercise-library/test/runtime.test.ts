import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildArtifacts,
  readSeedCatalog,
  writeExerciseGeneratedArtifacts,
} from "../src/build.js";
import {
  createExerciseCatalogReader,
  loadGeneratedExerciseCatalog,
} from "../src/runtime.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPaths = [
  path.join(packageRoot, "content", "seed", "at-home-exercise-stretch.csv"),
  path.join(packageRoot, "content", "seed", "at-home-exercise-stretch-addon-500.csv"),
];

describe("exercise-library runtime", () => {
  it("builds the seed catalog into compact generated artifacts", async () => {
    const catalog = await readSeedCatalog(seedPaths);
    expect(catalog.items).toHaveLength(1500);
    expect(catalog.sources.length).toBeGreaterThan(0);
    const items = catalog.items;
    expect(items[0]).toMatchObject({
      id: "EX001",
      name: "Bodyweight Squat",
      slug: "bodyweight-squat",
      steps: expect.arrayContaining([
        "Stand with feet about shoulder-width apart and toes slightly turned out if comfortable.",
      ]),
    });

    const artifacts = buildArtifacts(catalog);
    expect(artifacts.index.items[0]).not.toHaveProperty("steps");
    expect(artifacts.index.items[0]).not.toHaveProperty("sourceIds");
    expect(artifacts.details.items[0]?.tips.length).toBeGreaterThan(0);
    expect(artifacts.details.items[0]?.sourceIds.length).toBeGreaterThan(0);
    expect(artifacts.details.sources).toEqual(catalog.sources);
    expect(artifacts.facets.facets.kinds).toEqual(["exercise", "stretch"]);
    expect(artifacts.facets.facets.equipment).toContain("none");
  });

  it("lists, filters, searches, and resolves exact lookups", async () => {
    const catalog = await readSeedCatalog(seedPaths);
    const reader = createExerciseCatalogReader(buildArtifacts(catalog));

    expect(reader.facets().targets).toContain("hips");
    const squatMatches = reader.listExercises({
      equipment: ["none"],
      kind: ["exercise"],
      limit: 5,
      query: "bodyweight squat",
    });
    expect(squatMatches.total).toBeGreaterThanOrEqual(squatMatches.items.length);
    expect(squatMatches.items).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "EX001",
      name: "Bodyweight Squat",
    })]));

    const stretch = reader.listExercises({
      kind: ["stretch"],
      target: ["hips"],
      limit: 1,
    }).items[0];
    expect(stretch?.kind).toBe("stretch");

    const lookup = reader.findByLookup("EX001");
    expect(lookup.kind).toBe("found");
    if (lookup.kind === "found") {
      expect(lookup.item.steps.length).toBeGreaterThan(0);
      expect(reader.sourcesForItem(lookup.item).length).toBeGreaterThan(0);
    }
  });

  it("returns ambiguity for duplicate exact names after id and slug lookup", async () => {
    const catalog = await readSeedCatalog([seedPaths[0]!]);
    const { items } = catalog;
    const reader = createExerciseCatalogReader(buildArtifacts(catalog));
    const duplicateName = findDuplicateName(items);
    expect(duplicateName).toBeTruthy();

    const lookup = reader.findByLookup(duplicateName);
    expect(lookup.kind).toBe("ambiguous");
    if (lookup.kind === "ambiguous") {
      expect(lookup.matches.length).toBeGreaterThan(1);
    }
  });

  it("checks generated artifacts for drift", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-exercise-library-"));
    const generatedRoot = path.join(tempRoot, "generated");
    await writeExerciseGeneratedArtifacts({
      check: false,
      generatedRoot,
      seedPaths,
    });
    await writeExerciseGeneratedArtifacts({
      check: true,
      generatedRoot,
      seedPaths,
    });

    const artifacts = loadGeneratedExerciseCatalog({
      detailsPath: path.join(generatedRoot, "exercise-details.json"),
      facetsPath: path.join(generatedRoot, "exercise-facets.json"),
      indexPath: path.join(generatedRoot, "exercise-index.json"),
    });
    expect(artifacts.index.catalogHash).toEqual(artifacts.details.catalogHash);

    const indexPath = path.join(generatedRoot, "exercise-index.json");
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${await readFile(indexPath, "utf8")}\n`, "utf8");
    await expect(writeExerciseGeneratedArtifacts({
      check: true,
      generatedRoot,
      seedPaths,
    })).rejects.toThrow(/out of date/u);
  });
});

function findDuplicateName(items: readonly { name: string }[]): string {
  const names = new Map<string, number>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  return [...names.entries()].find(([, count]) => count > 1)?.[0] ?? "";
}
