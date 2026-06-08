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
    expect(artifacts.index.items[0]).not.toHaveProperty("images");
    expect(artifacts.details.items[0]?.tips.length).toBeGreaterThan(0);
    expect(artifacts.details.items[0]?.sourceIds.length).toBeGreaterThan(0);
    expect(artifacts.details.items.find((item) => item.slug === "stretch-cat-cow")?.images).toEqual([
      expect.objectContaining({
        step: "Tabletop setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/889a5f43-1d35-4eae-a98e-7ae69e96a800/public",
      }),
      expect.objectContaining({
        step: "Cow position",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/47b67d0b-af6a-4700-62ed-c0b912662c00/public",
      }),
      expect.objectContaining({
        step: "Cat position",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/7f90ecd5-5f6b-4ddf-5997-c1d5893e0300/public",
      }),
      expect.objectContaining({
        step: "Slow flow",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/8d1a1b7c-6780-4345-b5e6-bffb32ec5a00/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "bird-dog")?.images).toEqual([
      expect.objectContaining({
        step: "Tabletop setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/79a37dfb-073c-4b11-4698-de12aaf81b00/public",
      }),
      expect.objectContaining({
        step: "Reach side A",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/77a9a44d-5c51-4f6b-66f1-678b58793400/public",
      }),
      expect.objectContaining({
        step: "Reach side B",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/a8dc06cf-82b5-43e0-2d7d-1be450eadd00/public",
      }),
      expect.objectContaining({
        step: "Form check",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/ab24a93b-6a01-4a4e-5c61-43b746baff00/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "glute-bridge")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/e80eb41a-b096-4310-6671-6e583878da00/public",
      }),
      expect.objectContaining({
        step: "Lift and hold",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/268d71c2-fd86-47e1-7c4c-665e0afcfe00/public",
      }),
      expect.objectContaining({
        step: "Form check",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/738a6903-71cd-40e1-1465-dac718c09400/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "glute-bridge-hold")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/400dca32-e29f-4155-2265-739fb8f08200/public",
      }),
      expect.objectContaining({
        step: "Hold",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/7d5e432f-98a0-433c-5acb-08ec1d0bf400/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "glute-bridge-march")?.images).toEqual([
      expect.objectContaining({
        step: "Bridge hold",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/d7e51f40-1d55-4301-3ac2-2e6ea1076300/public",
      }),
      expect.objectContaining({
        step: "Near knee lift",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/29fce266-0d6d-4cd5-2310-898d42561200/public",
      }),
      expect.objectContaining({
        step: "Far knee lift",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/b7d05f24-5dcc-4353-6e90-e107a0a81c00/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "single-leg-glute-bridge")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/c9ce65b7-15b6-4201-25e1-296ee35b4a00/public",
      }),
      expect.objectContaining({
        step: "Single-leg bridge",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/4dd164b5-b742-453f-b95d-00def001fb00/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "wall-sit")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/fea942e2-e3fa-4272-2dff-327c82cb8700/public",
      }),
      expect.objectContaining({
        step: "Hold",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/84fc6b2d-a4bc-4206-23b1-342f730d3200/public",
      }),
      expect.objectContaining({
        step: "Form check",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/c68fe1c7-c87b-411d-a6f3-6190b705ff00/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "bodyweight-squat")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/b07d650b-2f8b-41b2-c315-63bc169be200/public",
      }),
      expect.objectContaining({
        step: "Bottom position",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/54fe4a6f-b80b-4e86-646a-7082b8ba8600/public",
      }),
      expect.objectContaining({
        step: "Form check",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/68adb210-af29-457d-cce1-1103ca2ea400/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "chair-squat")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/20def0d6-d5c5-432f-c414-d28e8ecd5400/public",
      }),
      expect.objectContaining({
        step: "Chair tap",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/ee04ec9d-9164-4f47-9de2-514488500a00/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "sit-to-stand")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/49719035-3eed-4cf9-2628-3cfb59bdb600/public",
      }),
      expect.objectContaining({
        step: "Rise",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/c5af575e-62b4-4b09-d265-f6468e86b900/public",
      }),
      expect.objectContaining({
        step: "Finish",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/d4dced10-7694-4d27-697f-25d550e11000/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "reverse-lunge")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/f7ca31a2-b0a7-4ad8-1ec3-2b80de73ec00/public",
      }),
      expect.objectContaining({
        step: "Step back",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/2e04eb1f-1488-4a2a-47df-50ee06d03500/public",
      }),
      expect.objectContaining({
        step: "Return",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/5360888f-5a0f-4535-e1c9-8a9d5d32d300/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "incline-push-up")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/c3da8032-4832-459f-1613-88104dd11400/public",
      }),
      expect.objectContaining({
        step: "Lower",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/233a1260-824e-4ef8-7922-72ae0c982600/public",
      }),
      expect.objectContaining({
        step: "Press",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/2576f54c-d229-4dd6-e72e-95650d976900/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "wall-push-up")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/18415a8b-f19e-46a3-70ea-398d10678500/public",
      }),
      expect.objectContaining({
        step: "Lower",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/aac956f3-e656-43ce-b6cb-8f03ff21f700/public",
      }),
      expect.objectContaining({
        step: "Press",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/3d0b1200-fb74-4f59-6b2e-28e0b33f4400/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "standing-calf-raise")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/7e28abd3-9089-4612-0d87-325a5afad200/public",
      }),
      expect.objectContaining({
        step: "Lift",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/8519b35a-f5fb-483b-f2c9-1aaafba39300/public",
      }),
      expect.objectContaining({
        step: "Lower",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/a48ab2c8-54fb-4218-ba91-9a7701c40100/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "calf-raise-hold")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/cb506987-c45e-4aff-167b-7d83920fd500/public",
      }),
      expect.objectContaining({
        step: "Hold",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/e3f43c31-5766-4c2c-c68b-4e6ee5b17300/public",
      }),
    ]);
    expect(artifacts.details.items.find((item) => item.slug === "tibialis-raise")?.images).toEqual([
      expect.objectContaining({
        step: "Setup",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/439efe55-c1f8-4058-8269-5d3b6644f200/public",
      }),
      expect.objectContaining({
        step: "Toes lift",
        url: "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/d20ff83a-ea86-46c3-d867-2b5bd0222a00/public",
      }),
    ]);
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

    const badImageUrlPath = path.join(tempRoot, "bad-image-url.csv");
    await writeFile(
      badImageUrlPath,
      [
        seedHeader(),
        seedRow({
          id: "EX_BAD_IMAGE_URL",
          images: "Setup | Setup image | http://example.com/setup.png",
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    await expect(readSeedCatalog([badImageUrlPath])).rejects.toThrow("non-HTTPS image URL");
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
    "Images",
  ].join(",");
}

function seedRow(input: {
  id: string;
  images?: string;
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
    input.images ?? "",
  ].map(csvField).join(",");
}

function csvField(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, "\"\"")}"` : value;
}
