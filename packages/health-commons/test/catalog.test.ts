import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("health commons catalog", () => {
  it("builds a deterministic catalog with revisions and artifact manifests", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });

    expect(catalog.schemaVersion).toBe("murph.commons.catalog.v1");
    expect(catalog.catalogHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(catalog.entities.some((entity) => entity.entityType === "protocol_variant")).toBe(false);
    expect(catalog.entities.some((entity) => entity.entityType === "experiment_family")).toBe(false);

    const restingHeartRate = catalog.entities.find(
      (entity) => entity.key === "biomarker:resting-heart-rate",
    );
    expect(restingHeartRate?.revision.pageRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const catalogEntityKeys = new Set(catalog.entities.map((entity) => entity.key));
    for (const sourceKey of restingHeartRate?.claims?.flatMap((claim) => claim.sourceKeys ?? []) ?? []) {
      expect(catalogEntityKeys).toContain(sourceKey);
    }

    expect(catalog.redirects).toContainEqual(
      expect.objectContaining({
        from: "goal_template:build-aerobic-base",
        to: "goal_template:improve-cardio-endurance",
      }),
    );

    const artifacts = catalog.artifactManifests.flatMap((manifest) => manifest.artifacts);
    expect(artifacts.find((artifact) => artifact.artifactId === "art_pmid_28633297_pdf")).toMatchObject({
      storage: "cloudflare-r2",
      redistributable: false,
      rightsStatus: "permission_required",
      objectKey: "commons/research/sauna/pmid-28633297/source.pdf",
      localPath: "research-artifacts/sauna/pmid-28633297.pdf",
    });
  });
});
