import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, test } from "vitest";

import {
  readHealthLibraryGraph,
  readHealthLibraryGraphWithIssues,
} from "../src/index.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map(async (vaultRoot) => {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }),
  );
});

test("readHealthLibraryGraph rejects duplicate library slugs and keys", async () => {
  const duplicateSlugVault = await mkdtemp(path.join(tmpdir(), "murph-health-library-"));
  const duplicateKeyVault = await mkdtemp(path.join(tmpdir(), "murph-health-library-"));
  createdVaultRoots.push(duplicateSlugVault, duplicateKeyVault);

  await mkdir(path.join(duplicateSlugVault, "bank", "library"), {
    recursive: true,
  });
  await writeFile(
    path.join(duplicateSlugVault, "bank", "library", "sleep-a.md"),
    [
      "---",
      "title: Sleep architecture A",
      "slug: sleep-architecture",
      "entityType: biomarker",
      "key: biomarker:sleep-architecture-a",
      "---",
      "",
      "First owner.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(duplicateSlugVault, "bank", "library", "sleep-b.md"),
    [
      "---",
      "title: Sleep architecture B",
      "slug: sleep-architecture",
      "entityType: biomarker",
      "key: biomarker:sleep-architecture-b",
      "---",
      "",
      "Second owner.",
      "",
    ].join("\n"),
  );

  await mkdir(path.join(duplicateKeyVault, "bank", "library"), {
    recursive: true,
  });
  await writeFile(
    path.join(duplicateKeyVault, "bank", "library", "magnesium.md"),
    [
      "---",
      "title: Magnesium",
      "slug: magnesium",
      "entityType: biomarker",
      "key: shared-key",
      "---",
      "",
      "Magnesium note.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(duplicateKeyVault, "bank", "library", "glycine.md"),
    [
      "---",
      "title: Glycine",
      "slug: glycine",
      "entityType: biomarker",
      "key: shared-key",
      "---",
      "",
      "Glycine note.",
      "",
    ].join("\n"),
  );

  await assert.rejects(
    () => readHealthLibraryGraph(duplicateSlugVault),
    /Duplicate health library slug "sleep-architecture"/u,
  );
  await assert.rejects(
    () => readHealthLibraryGraph(duplicateKeyVault),
    /Duplicate health library key "shared-key"/u,
  );
});

test("readHealthLibraryGraphWithIssues emits duplicate issues and omits ambiguous lookup entries", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-health-library-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, "bank", "library"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, "bank", "library", "sleep-a.md"),
    [
      "---",
      "title: Sleep architecture A",
      "slug: sleep-architecture",
      "entityType: biomarker",
      "key: biomarker:sleep-architecture-a",
      "---",
      "",
      "First owner.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "sleep-b.md"),
    [
      "---",
      "title: Sleep architecture B",
      "slug: sleep-architecture",
      "entityType: biomarker",
      "key: biomarker:sleep-architecture-b",
      "---",
      "",
      "Second owner.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "magnesium.md"),
    [
      "---",
      "title: Magnesium",
      "slug: magnesium",
      "entityType: biomarker",
      "key: shared-key",
      "---",
      "",
      "Magnesium note.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "glycine.md"),
    [
      "---",
      "title: Glycine",
      "slug: glycine",
      "entityType: biomarker",
      "key: shared-key",
      "---",
      "",
      "Glycine note.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "hydration.md"),
    [
      "---",
      "title: Hydration",
      "slug: hydration",
      "entityType: biomarker",
      "---",
      "",
      "Hydration note.",
      "",
    ].join("\n"),
  );

  const result = await readHealthLibraryGraphWithIssues(vaultRoot);

  assert.equal(result.graph.nodes.length, 5);
  assert.equal(result.graph.bySlug.has("sleep-architecture"), false);
  assert.equal(result.graph.byKey.has("shared-key"), false);
  assert.equal(result.graph.bySlug.get("hydration")?.title, "Hydration");
  assert.equal(result.graph.bySlug.get("magnesium")?.title, "Magnesium");
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.kind === "validation" &&
        issue.field === "slug" &&
        issue.reason.includes('Duplicate health library slug "sleep-architecture"'),
    ),
    true,
  );
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.kind === "validation" &&
        issue.field === "key" &&
        issue.reason.includes('Duplicate health library key "shared-key"'),
    ),
    true,
  );
});
