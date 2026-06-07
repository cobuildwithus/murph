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
  getGeneratedExerciseCatalogReader,
  loadGeneratedExerciseCatalog,
} from "../src/runtime.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPaths = [
  path.join(packageRoot, "content", "seed", "at-home-exercise-stretch.csv"),
  path.join(packageRoot, "content", "seed", "at-home-exercise-stretch-addon-500.csv"),
  path.join(packageRoot, "content", "seed", "at-home-exercise-strength-addon-250.csv"),
];

describe("exercise-library runtime", () => {
  it("builds the seed catalog into compact generated artifacts", async () => {
    const catalog = await readSeedCatalog(seedPaths);
    expect(catalog.items).toHaveLength(1750);
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
    expect(catalog.items.find((item) => item.id === "EX751")).toMatchObject({
      name: "Dumbbell Goblet Squat",
      steps: [
        "Stand with feet about shoulder-width apart and hold one dumbbell vertically at chest height.",
        "Brace your trunk, sit your hips back, and bend your knees until you reach a comfortable squat depth.",
        "Press through your whole foot to stand tall without letting the dumbbell pull you forward.",
        "Reset your position before the next rep, or keep the same position if you are holding for time.",
      ],
      tips: [
        "Keep the dumbbell close to your chest, knees tracking over toes, and ribs stacked over hips.",
        "Keep the movement controlled, breathe steadily, and stop or regress the exercise if you feel sharp pain or lose form.",
      ],
    });

    const artifacts = buildArtifacts(catalog);
    expect(artifacts.index.items[0]).not.toHaveProperty("steps");
    expect(artifacts.index.items[0]).not.toHaveProperty("sourceIds");
    expect(artifacts.details.items[0]?.tips.length).toBeGreaterThan(0);
    expect(artifacts.details.items[0]?.sourceIds.length).toBeGreaterThan(0);
    expect(artifacts.details.sources).toEqual(catalog.sources);
    expect(artifacts.facets.facets.kinds).toEqual(["exercise", "stretch"]);
    expect(artifacts.facets.facets.equipment).toContain("none");
    expect(findCaseInsensitiveDuplicates(artifacts.facets.facets.targets)).toEqual([]);
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

  it("loads the generated runtime catalog with the strength addon rows", () => {
    const reader = getGeneratedExerciseCatalogReader();
    expect(reader.listExercises({ limit: 1 }).total).toBe(1750);

    const firstAddon = reader.findByLookup("EX751");
    expect(firstAddon.kind).toBe("found");
    if (firstAddon.kind === "found") {
      expect(firstAddon.item.name).toBe("Dumbbell Goblet Squat");
      expect(firstAddon.item.kind).toBe("exercise");
      expect(reader.sourcesForItem(firstAddon.item).length).toBeGreaterThan(0);
    }

    const lastAddon = reader.findByLookup("EX1000");
    expect(lastAddon.kind).toBe("found");
    if (lastAddon.kind === "found") {
      expect(lastAddon.item.name).toBe("Seated Dumbbell Knee Tuck");
      expect(lastAddon.item.steps.length).toBeGreaterThan(0);
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

    await writeFile(
      path.join(generatedRoot, "exercise-facets.json"),
      (await readFile(path.join(generatedRoot, "exercise-facets.json"), "utf8"))
        .replace("murph.exercise-facets.v1", "murph.exercise-facets.invalid"),
      "utf8",
    );
    expect(() => loadGeneratedExerciseCatalog({
      detailsPath: path.join(generatedRoot, "exercise-details.json"),
      facetsPath: path.join(generatedRoot, "exercise-facets.json"),
      indexPath,
    })).toThrow("Unexpected exercise facets schema version.");
  });

  it("rejects malformed seed inputs before artifacts are written", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-exercise-seed-errors-"));
    await expect(readSeedCatalog([])).rejects.toThrow("no source CSV files");

    const badHeaderPath = path.join(tempRoot, "bad-header.csv");
    await writeFile(badHeaderPath, "Library,ID,Name\nExercise,EX_BAD,Bad\n", "utf8");
    await expect(readSeedCatalog([badHeaderPath])).rejects.toThrow("Unexpected exercise seed headers");

    const duplicatePath = path.join(tempRoot, "duplicate.csv");
    await writeFile(
      duplicatePath,
      [
        seedHeader(),
        seedRow({ id: "EX_DUP", name: "Duplicate A" }),
        seedRow({ id: "EX_DUP", name: "Duplicate B" }),
        "",
      ].join("\n"),
      "utf8",
    );
    await expect(readSeedCatalog([duplicatePath])).rejects.toThrow("Duplicate exercise id EX_DUP");

    const badUrlPath = path.join(tempRoot, "bad-url.csv");
    await writeFile(
      badUrlPath,
      [seedHeader(), seedRow({ id: "EX_BAD_URL", sourceUrls: "http://example.com" }), ""].join("\n"),
      "utf8",
    );
    await expect(readSeedCatalog([badUrlPath])).rejects.toThrow("non-HTTPS source URL");
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

function findCaseInsensitiveDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }
  return [...duplicates].sort();
}

function seedHeader(): string {
  return [
    "Library",
    "ID",
    "Name",
    "Category",
    "Target Area",
    "Level",
    "Equipment",
    "Position",
    "Modality",
    "Commonness Tier",
    "Short Description",
    "Source URL(s)",
    "Steps",
    "Best Practices",
  ].join(",");
}

function seedRow(input: {
  id: string;
  name?: string;
  sourceUrls?: string;
}): string {
  return [
    "Exercise",
    input.id,
    input.name ?? "Test Exercise",
    "Strength",
    "hips",
    "Beginner",
    "None",
    "Standing",
    "Strength",
    "Common",
    "A short test exercise description.",
    input.sourceUrls ?? "https://example.com/source",
    "1) Set up. 2) Move with control.",
    "1) Keep it easy.",
  ].map(csvField).join(",");
}

function csvField(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, "\"\"")}"` : value;
}
