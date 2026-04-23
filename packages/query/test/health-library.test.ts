import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { afterEach, test } from "vitest";

import {
  readHealthLibraryGraph,
  readHealthLibraryGraphWithIssues,
} from "../src/index.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const demoVaultRoot = path.join(repoRoot, "fixtures/demo-web-vault");
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

test("readHealthLibraryGraph loads the canonical RHR graph nodes", async () => {
  const graph = await readHealthLibraryGraph(demoVaultRoot);

  assert.ok(graph.nodes.length >= 15);
  assert.equal(graph.bySlug.get("resting-heart-rate")?.entityType, "biomarker");
  assert.equal(graph.bySlug.get("attia-zone2-4x45m")?.entityType, "protocol_variant");
  assert.equal(graph.bySlug.get("100-healthy-years")?.entityType, "mission");
});

test("readHealthLibraryGraphWithIssues tolerates malformed bank/library pages", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-health-library-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, "bank", "library"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, "bank", "library", "sleep-architecture.md"),
    [
      "---",
      "title: Sleep architecture",
      "slug: sleep-architecture",
      "entityType: biomarker",
      "---",
      "",
      "# Sleep architecture",
      "",
      "Stable reference page.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "broken.md"),
    [
      "---",
      "title: Broken",
      "slug: broken",
      "",
      "# Broken",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "blank-slug.md"),
    [
      "---",
      "title: Blank slug",
      'slug: ""',
      "entityType: biomarker",
      "---",
      "",
      "# Blank slug",
      "",
      "Parsed, but canonically invalid.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(vaultRoot, "bank", "library", "missing-entity-type.md"),
    [
      "---",
      "title: Missing entity type",
      "slug: missing-entity-type",
      "---",
      "",
      "# Missing entity type",
      "",
      "Parsed, but missing entityType.",
      "",
    ].join("\n"),
  );

  const result = await readHealthLibraryGraphWithIssues(vaultRoot);

  assert.equal(result.graph.bySlug.has("sleep-architecture"), true);
  assert.equal(result.issues.length, 3);
  assert.deepEqual(
    result.issues.map((issue) => ({
      field: issue.kind === "validation" ? issue.field : null,
      kind: issue.kind,
      parser: issue.parser,
      relativePath: issue.relativePath,
    })),
    [
      {
        field: "slug",
        kind: "validation",
        parser: "frontmatter",
        relativePath: "bank/library/blank-slug.md",
      },
      {
        field: null,
        kind: "parse",
        parser: "frontmatter",
        relativePath: "bank/library/broken.md",
      },
      {
        field: "entityType",
        kind: "validation",
        parser: "frontmatter",
        relativePath: "bank/library/missing-entity-type.md",
      },
    ],
  );
});

test("readHealthLibraryGraph rejects parsed bank/library pages with invalid canonical metadata", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-health-library-strict-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, "bank", "library"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, "bank", "library", "missing-slug.md"),
    [
      "---",
      "title: Missing slug",
      "entityType: biomarker",
      "---",
      "",
      "# Missing slug",
      "",
      "Parsed frontmatter, invalid canonical metadata.",
      "",
    ].join("\n"),
  );

  await assert.rejects(
    () => readHealthLibraryGraph(vaultRoot),
    /Failed to validate frontmatter at bank\/library\/missing-slug\.md: Health library page must declare a non-empty slug\./u,
  );
});

test("readHealthLibraryGraph rejects unsupported bank/library entity types", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-health-library-entity-type-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, "bank", "library"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, "bank", "library", "unsupported-entity-type.md"),
    [
      "---",
      "title: Unsupported entity type",
      "slug: unsupported-entity-type",
      "entityType: not-real",
      "---",
      "",
      "# Unsupported entity type",
      "",
      "Parsed frontmatter, invalid canonical metadata.",
      "",
    ].join("\n"),
  );

  await assert.rejects(
    () => readHealthLibraryGraph(vaultRoot),
    /Failed to validate frontmatter at bank\/library\/unsupported-entity-type\.md: Health library entityType "not-real" is not supported\./u,
  );
});
