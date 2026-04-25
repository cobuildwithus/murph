import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const buildHealthCommonsCatalogMock = vi.hoisted(() => vi.fn());
const buildHealthCommonsSourceIndexMock = vi.hoisted(() =>
  vi.fn((catalog: { catalogHash: string }) => ({
    schemaVersion: "murph.commons.source-index.v1",
    generatedFromCatalogHash: catalog.catalogHash,
    sources: [],
    identityLookup: [
      {
        identityKey: "pmid:1",
        sourceKeys: ["source_artifact:pmid-1"],
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

import { writeHealthCommonsGeneratedArtifacts } from "../src/build.ts";

function createCatalog(catalogHash: string) {
  return {
    artifactManifests: [],
    catalogHash,
    changes: [],
    entities: [],
    evidenceAppraisals: [],
    redirects: [],
    schemaVersion: "murph.commons.catalog.v1",
  };
}

describe("@murphai/health-commons build determinism", () => {
  beforeEach(() => {
    buildHealthCommonsCatalogMock.mockReset();
    buildHealthCommonsSourceArtifactIndexMock.mockClear();
    buildHealthCommonsSourceIndexMock.mockClear();
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
      "Health Commons generated artifacts are nondeterministic: catalog.json, catalog.hash, source-index.json, source-artifact-index.json.",
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
    expect(buildHealthCommonsSourceIndexMock).toHaveBeenCalledTimes(1);
    expect(buildHealthCommonsSourceArtifactIndexMock).toHaveBeenCalledTimes(1);
  });
});

async function pathFromTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
