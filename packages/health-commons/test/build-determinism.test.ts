import { describe, expect, it, vi } from "vitest";

const buildHealthCommonsCatalogMock = vi.hoisted(() => vi.fn());

vi.mock("../src/catalog.ts", () => ({
  buildHealthCommonsCatalog: buildHealthCommonsCatalogMock,
}));

import { writeHealthCommonsGeneratedArtifacts } from "../src/build.ts";

function createCatalog(catalogHash: string) {
  return {
    artifactManifests: [],
    catalogHash,
    changes: [],
    entities: [],
    redirects: [],
    schemaVersion: "murph.commons.catalog.v1",
  };
}

describe("@murphai/health-commons build determinism", () => {
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
      "Health Commons generated artifacts are nondeterministic: catalog.json, catalog.hash.",
    );

    expect(buildHealthCommonsCatalogMock).toHaveBeenCalledTimes(2);
  });
});
