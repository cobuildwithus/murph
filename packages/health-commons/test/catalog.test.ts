import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("health commons catalog", () => {
  it("builds a deterministic catalog with protocol revisions and artifact manifests", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });

    expect(catalog.schemaVersion).toBe("murph.commons.catalog.v1");
    expect(catalog.catalogHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(catalog.entities.map((entity) => entity.key)).toContain(
      "protocol_variant:sauna/finnish-dry/murph-standard-3x-week",
    );

    const saunaProtocol = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:sauna/finnish-dry/murph-standard-3x-week",
    );
    expect(saunaProtocol?.revision.pageRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(saunaProtocol?.revision.runSpecRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(saunaProtocol?.revision.recipeHash).toMatch(/^sha256:[a-f0-9]{64}$/u);

    expect(catalog.artifactManifests[0]?.artifacts[0]).toMatchObject({
      artifactId: "art_pmid_25705824_pdf",
      storage: "cloudflare-r2",
      redistributable: false,
    });
  });
});
