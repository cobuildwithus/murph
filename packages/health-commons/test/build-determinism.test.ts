import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const buildHealthCommonsCatalogMock = vi.hoisted(() => vi.fn());
const generatedRootRenameControl = vi.hoisted(() => ({
  beforeReleaseDelayedTargetMove: null as (() => Promise<void>) | null,
  delayFirstTargetMove: false,
  delayedTargetMoves: 0,
  releaseDelayedTargetMove: null as (() => void) | null,
  targetRoot: "",
}));
const buildHealthCommonsSourceIndexMock = vi.hoisted(() =>
  vi.fn((catalog: { catalogHash: string }) => ({
    schemaVersion: "murph.commons.source-index.v1",
    generatedFromCatalogHash: catalog.catalogHash,
    sources: [],
    identityLookup: [
      {
        identityKey: "pmid:1",
        sourceKeys: ["source_artifact:pmid-1"],
        canonicalSourceKey: "source_artifact:pmid-1",
      },
    ],
    duplicateIdentities: [],
  })),
);
const buildHealthCommonsSourceArtifactIndexMock = vi.hoisted(() =>
  vi.fn((catalog: { catalogHash: string }) => ({
    schemaVersion: "murph.commons.source-artifact-index.v1",
    generatedFromCatalogHash: catalog.catalogHash,
    artifacts: [],
    sources: [],
  })),
);

vi.mock("../src/catalog.ts", () => ({
  buildHealthCommonsCatalog: buildHealthCommonsCatalogMock,
  buildHealthCommonsSourceArtifactIndex: buildHealthCommonsSourceArtifactIndexMock,
  buildHealthCommonsSourceIndex: buildHealthCommonsSourceIndexMock,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (oldPath: string, newPath: string): Promise<void> => {
      await actual.rename(oldPath, newPath);
      if (
        generatedRootRenameControl.delayFirstTargetMove
        && oldPath === generatedRootRenameControl.targetRoot
        && generatedRootRenameControl.delayedTargetMoves === 0
      ) {
        generatedRootRenameControl.delayedTargetMoves += 1;
        await new Promise<void>((resolve) => {
          generatedRootRenameControl.releaseDelayedTargetMove = resolve;
        });
      } else if (
        generatedRootRenameControl.delayFirstTargetMove
        && newPath === generatedRootRenameControl.targetRoot
      ) {
        await generatedRootRenameControl.beforeReleaseDelayedTargetMove?.();
        generatedRootRenameControl.releaseDelayedTargetMove?.();
        generatedRootRenameControl.releaseDelayedTargetMove = null;
      }
    },
  };
});

import { writeHealthCommonsGeneratedArtifacts } from "../src/build.ts";
import { buildHealthCommonsWebGeneratedArtifacts } from "../src/web-artifacts.ts";

function createCatalog(catalogHash: string) {
  return {
    artifactManifests: [],
    catalogHash,
    changes: [],
    entities: [],
    evidenceAppraisals: [],
    redirects: [],
    schemaVersion: "murph.commons.catalog.v1" as const,
  };
}

describe("@murphai/health-commons build determinism", () => {
  beforeEach(() => {
    buildHealthCommonsCatalogMock.mockReset();
    buildHealthCommonsSourceArtifactIndexMock.mockClear();
    buildHealthCommonsSourceIndexMock.mockClear();
    generatedRootRenameControl.beforeReleaseDelayedTargetMove = null;
    generatedRootRenameControl.delayFirstTargetMove = false;
    generatedRootRenameControl.delayedTargetMoves = 0;
    generatedRootRenameControl.releaseDelayedTargetMove = null;
    generatedRootRenameControl.targetRoot = "";
  });

  it("rejects check mode when two successive builds diverge", async () => {
    buildHealthCommonsCatalogMock
      .mockResolvedValueOnce(createCatalog("sha256:first"))
      .mockResolvedValueOnce(createCatalog("sha256:second"));

    await expect(
      writeHealthCommonsGeneratedArtifacts({
        check: true,
        contentRoot: "health-commons-content",
        generatedRoot: "health-commons-generated",
      }),
    ).rejects.toThrow(
      "Health Commons generated artifacts are nondeterministic: catalog.hash, biomarker-desired-directions.json, source-index.json, source-artifact-index.json, web/routes/index.json, web/browse/goals.json.",
    );

    expect(buildHealthCommonsCatalogMock).toHaveBeenCalledTimes(2);
  });

  it("writes generated source lookup artifacts", async () => {
    const generatedRoot = await pathFromTempDir("health-commons-generated-");
    buildHealthCommonsCatalogMock.mockResolvedValueOnce(createCatalog("sha256:first"));

    await writeHealthCommonsGeneratedArtifacts({
      check: false,
      contentRoot: "health-commons-content",
      generatedRoot,
    });

    await expect(readFile(path.join(generatedRoot, "source-index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.source-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "source-identities.ndjson"), "utf8")).resolves.toContain(
      '"identityKey":"pmid:1"',
    );
    await expect(readFile(path.join(generatedRoot, "source-artifact-index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.source-artifact-index.v1"',
    );
    await expect(
      readFile(
        path.join(generatedRoot, "biomarker-desired-directions.json"),
        "utf8",
      ),
    ).resolves.toContain(
      '"schemaVersion": "murph.commons.biomarker-desired-directions.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "web/routes/index.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.route-index.v1"',
    );
    await expect(readFile(path.join(generatedRoot, "web/browse/biomarkers.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(generatedRoot, "web/browse/goals.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "murph.commons.web.goal-index.v2"',
    );
    expect(buildHealthCommonsSourceIndexMock).toHaveBeenCalledTimes(1);
    expect(buildHealthCommonsSourceArtifactIndexMock).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate generated web route ids before writing route indexes", () => {
    expect(() => buildHealthCommonsWebGeneratedArtifacts({
      ...createCatalog("sha256:first"),
      entities: ["a", "b"].map((id) => ({
        schemaVersion: "murph.commons.page.v1" as const,
        entityType: "measurement_method" as const,
        key: `measurement_method:${id}`,
        slug: `measurement-methods/${id}`,
        title: `Measurement method ${id}`,
        body: "Synthetic measurement method.",
        relativePath: `measurement-methods/${id}.md`,
        revision: { pageRevisionId: `sha256:${"1".repeat(64)}` },
      })),
      redirects: [
        { from: "measurement_method:legacy/shared", to: "measurement_method:a" },
        { from: "measurement_method:other/shared", to: "measurement_method:b" },
      ],
    })).toThrow("Duplicate Health Commons web route id generated for measurement_method:shared");
  });

  it("replaces stale generated files with the exact current file set", async () => {
    const generatedRoot = await pathFromTempDir("health-commons-generated-");
    buildHealthCommonsCatalogMock.mockResolvedValueOnce(createCatalog("sha256:first"));

    try {
      await mkdir(path.join(generatedRoot, "web", "stale"), { recursive: true });
      await writeFile(path.join(generatedRoot, "obsolete.json"), "{}\n", "utf8");
      await writeFile(path.join(generatedRoot, "web", "stale", "old.json"), "{}\n", "utf8");

      await writeHealthCommonsGeneratedArtifacts({
        check: false,
        contentRoot: "health-commons-content",
        generatedRoot,
      });

      await expect(readFile(path.join(generatedRoot, "catalog.hash"), "utf8"))
        .resolves.toBe("sha256:first\n");
      await expect(readFile(path.join(generatedRoot, "catalog.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(generatedRoot, "obsolete.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(generatedRoot, "web", "stale", "old.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(generatedRoot, { recursive: true, force: true });
    }
  });

  it("lets concurrent writers publish the same complete generated tree", async () => {
    const testRoot = await pathFromTempDir("health-commons-concurrent-generated-");
    const generatedRoot = path.join(testRoot, "generated");
    buildHealthCommonsCatalogMock.mockResolvedValue(createCatalog("sha256:first"));

    try {
      await writeHealthCommonsGeneratedArtifacts({
        check: false,
        contentRoot: "health-commons-content",
        generatedRoot,
      });

      generatedRootRenameControl.delayFirstTargetMove = true;
      generatedRootRenameControl.targetRoot = generatedRoot;

      await expect(Promise.all([
        writeHealthCommonsGeneratedArtifacts({
          check: false,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
        writeHealthCommonsGeneratedArtifacts({
          check: false,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
      ])).resolves.toEqual([undefined, undefined]);

      await expect(readFile(path.join(generatedRoot, "catalog.hash"), "utf8"))
        .resolves.toBe("sha256:first\n");
      await expect(readdir(testRoot)).resolves.toEqual(["generated"]);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("rejects a changed non-hash tree and preserves the concurrent winner", async () => {
    const testRoot = await pathFromTempDir("health-commons-mismatched-generated-");
    const generatedRoot = path.join(testRoot, "generated");
    buildHealthCommonsCatalogMock.mockResolvedValue(createCatalog("sha256:first"));
    let winningTree: Map<string, RawGeneratedTreeEntry> | null = null;

    try {
      await writeHealthCommonsGeneratedArtifacts({
        check: false,
        contentRoot: "health-commons-content",
        generatedRoot,
      });

      generatedRootRenameControl.delayFirstTargetMove = true;
      generatedRootRenameControl.targetRoot = generatedRoot;
      generatedRootRenameControl.beforeReleaseDelayedTargetMove = async () => {
        await writeFile(path.join(generatedRoot, "source-index.json"), "{\"winner\":true}\n", "utf8");
        await mkdir(path.join(generatedRoot, "winner-only"), { recursive: true });
        await writeFile(path.join(generatedRoot, "winner-only", "artifact.bin"), Buffer.from([0x00, 0xff]));
        winningTree = await readRawGeneratedTree(generatedRoot);
      };

      const outcomes = await Promise.allSettled([
        writeHealthCommonsGeneratedArtifacts({
          check: false,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
        writeHealthCommonsGeneratedArtifacts({
          check: false,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      if (!winningTree) {
        throw new Error("Concurrent winner was not captured.");
      }
      await expect(readRawGeneratedTree(generatedRoot)).resolves.toEqual(winningTree);
      await expect(readdir(testRoot)).resolves.toEqual(["generated"]);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("rejects a concurrent generated tree with different bytes", async () => {
    const testRoot = await pathFromTempDir("health-commons-byte-mismatch-generated-");
    const generatedRoot = path.join(testRoot, "generated");
    buildHealthCommonsCatalogMock.mockResolvedValue(createCatalog("�"));

    try {
      await writeHealthCommonsGeneratedArtifacts({
        check: false,
        contentRoot: "health-commons-content",
        generatedRoot,
      });

      generatedRootRenameControl.delayFirstTargetMove = true;
      generatedRootRenameControl.targetRoot = generatedRoot;
      generatedRootRenameControl.beforeReleaseDelayedTargetMove = async () => {
        await writeFile(path.join(generatedRoot, "catalog.hash"), Buffer.from([0xff, 0x0a]));
      };

      const outcomes = await Promise.allSettled([
        writeHealthCommonsGeneratedArtifacts({
          check: false,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
        writeHealthCommonsGeneratedArtifacts({
          check: false,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      await expect(readdir(testRoot)).resolves.toEqual(["generated"]);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("rejects check mode when generated files are stale", async () => {
    const generatedRoot = await pathFromTempDir("health-commons-generated-");
    buildHealthCommonsCatalogMock
      .mockResolvedValueOnce(createCatalog("sha256:first"))
      .mockResolvedValueOnce(createCatalog("sha256:first"));

    try {
      await mkdir(generatedRoot, { recursive: true });
      await writeFile(path.join(generatedRoot, "source-index.json"), "{}\n", "utf8");
      await writeFile(path.join(generatedRoot, "catalog.json"), "{}\n", "utf8");
      await writeFile(path.join(generatedRoot, "obsolete.json"), "{}\n", "utf8");

      await expect(
        writeHealthCommonsGeneratedArtifacts({
          check: true,
          contentRoot: "health-commons-content",
          generatedRoot,
        }),
      ).rejects.toThrow("Health Commons generated artifacts are out of date");
    } finally {
      await rm(generatedRoot, { recursive: true, force: true });
    }
  });
});

async function pathFromTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

type RawGeneratedTreeEntry =
  | { kind: "directory" }
  | { bytes: Buffer; kind: "file" };

async function readRawGeneratedTree(root: string): Promise<Map<string, RawGeneratedTreeEntry>> {
  const entries = new Map<string, RawGeneratedTreeEntry>();

  async function collect(relativeDir: string): Promise<void> {
    const children = await readdir(path.join(root, relativeDir), { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const relativePath = relativeDir ? path.posix.join(relativeDir, child.name) : child.name;
      if (child.isDirectory()) {
        entries.set(relativePath, { kind: "directory" });
        await collect(relativePath);
        continue;
      }
      if (!child.isFile()) {
        throw new Error("Unsupported entry in generated test tree.");
      }
      entries.set(relativePath, {
        bytes: await readFile(path.join(root, relativePath)),
        kind: "file",
      });
    }
  }

  await collect("");
  return entries;
}
