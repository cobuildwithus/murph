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
    expect(saunaProtocol?.revision.runSpecRevisionId).toBe(
      "sha256:e794e9986abf5ad0fbfab3d84bb2bd2ef15c7730366ecee5d09b1366d9e7db62",
    );
    expect(saunaProtocol?.revision.recipeHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const protocolRelationTargets = saunaProtocol?.relations?.map((relation) => relation.target) ?? [];
    expect(protocolRelationTargets).toContain(
      "experiment_family:dry-sauna",
    );
    const protocolClaimSources = saunaProtocol?.claims?.flatMap((claim) => claim.sourceKeys ?? []) ?? [];
    const catalogEntityKeys = new Set(catalog.entities.map((entity) => entity.key));
    for (const sourceKey of protocolClaimSources) {
      expect(catalogEntityKeys).toContain(sourceKey);
    }

    expect(catalog.entities.map((entity) => entity.key)).toContain("experiment_family:infrared-sauna");

    const norwegianProtocol = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    );
    expect(norwegianProtocol).toMatchObject({
      experimentOnboarding: {
        planDefaults: {
          testPlanId: "wearable-cardio-fitness-49d",
        },
        startIntent: {
          intentSummary: "Explore Norwegian 4x4 Intervals",
        },
      },
      revision: {
        runSpecRevisionId:
          "sha256:141c35d7b0af6e614b59aa9cb031a39f0580ffc283c066ac04dd0d1a2db789db",
      },
    });

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
