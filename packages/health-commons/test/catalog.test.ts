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
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    const saunaProtocol = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(saunaProtocol?.revision.pageRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(saunaProtocol?.revision.runSpecRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(saunaProtocol?.revision.recipeHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const protocolRelationTargets = saunaProtocol?.relations?.map((relation) => relation.target) ?? [];
    expect(protocolRelationTargets).toContain(
      "experiment_family:dry-sauna",
    );
    const protocolClaimSources = saunaProtocol?.claims?.flatMap((claim) => claim.sourceKeys ?? []) ?? [];
    for (const sourceKey of protocolClaimSources) {
      expect(protocolRelationTargets).toContain(sourceKey);
    }

    expect(catalog.entities.map((entity) => entity.key)).toContain("experiment_family:infrared-sauna");
    expect(catalog.redirects).toContainEqual(
      expect.objectContaining({
        from: "experiment_family:sauna/finnish-dry",
        to: "experiment_family:dry-sauna",
      }),
    );

    expect(catalog.redirects).toContainEqual(
      expect.objectContaining({
        from: "protocol_variant:sauna/finnish-dry/murph-standard-3x-week",
        to: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      }),
    );

    expect(catalog.redirects).toContainEqual(
      expect.objectContaining({
        from: "protocol_variant:sauna/finnish-dry/bryan-johnson-blueprint",
        to: "protocol_variant:dry-sauna/bryan-johnson-blueprint",
      }),
    );

    const artifacts = catalog.artifactManifests.flatMap((manifest) => manifest.artifacts);
    expect(artifacts.find((artifact) => artifact.artifactId === "art_pmid_25705824_pdf")).toMatchObject({
      storage: "cloudflare-r2",
      redistributable: false,
      rightsStatus: "permission_required",
      objectKey: "commons/research/sauna/pmid-25705824/source.pdf",
      localPath: "research-artifacts/sauna/pmid-25705824.pdf",
    });
  });
});
