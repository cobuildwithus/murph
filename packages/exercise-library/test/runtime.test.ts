import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildArtifacts,
  readSeedItems,
  writeExerciseGeneratedArtifacts,
} from "../src/build.js";
import {
  createExerciseCatalogReader,
  loadGeneratedExerciseCatalog,
} from "../src/runtime.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = path.join(packageRoot, "content", "seed", "at-home-exercise-stretch.csv");

describe("exercise-library runtime", () => {
  it("builds the seed catalog into compact generated artifacts", async () => {
    const items = await readSeedItems(seedPath);
    expect(items).toHaveLength(1000);
    expect(items[0]).toMatchObject({
      id: "EX001",
      name: "Bodyweight Squat",
      slug: "bodyweight-squat",
      steps: expect.arrayContaining([
        "Stand with feet about shoulder-width apart and toes slightly turned out if comfortable.",
      ]),
    });

    const artifacts = buildArtifacts(items);
    expect(artifacts.index.items[0]).not.toHaveProperty("steps");
    expect(artifacts.details.items[0]?.tips.length).toBeGreaterThan(0);
    expect(artifacts.facets.facets.kinds).toEqual(["exercise", "stretch"]);
  });

  it("lists, filters, searches, and resolves exact lookups", async () => {
    const items = await readSeedItems(seedPath);
    const reader = createExerciseCatalogReader(buildArtifacts(items));

    expect(reader.facets().targets).toContain("hips");
    expect(reader.listExercises({
      equipment: ["none"],
      kind: ["exercise"],
      limit: 5,
      query: "bodyweight squat",
    })).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "EX001",
      name: "Bodyweight Squat",
    })]));

    const stretch = reader.listExercises({
      kind: ["stretch"],
      target: ["hips"],
      limit: 1,
    })[0];
    expect(stretch?.kind).toBe("stretch");

    const lookup = reader.findByLookup("EX001");
    expect(lookup.kind).toBe("found");
    if (lookup.kind === "found") {
      expect(lookup.item.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns ambiguity for duplicate exact names after id and slug lookup", async () => {
    const items = await readSeedItems(seedPath);
    const reader = createExerciseCatalogReader(buildArtifacts(items));
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
      seedPath,
    });
    await writeExerciseGeneratedArtifacts({
      check: true,
      generatedRoot,
      seedPath,
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
      seedPath,
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
