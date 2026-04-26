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
    expect(saunaProtocol).toMatchObject({
      experimentOnboarding: {
        adaptationPolicy: {
          measurementPlan: {
            requiredSignals: ["biomarker:resting-heart-rate"],
            testPlanId: "rhr-21d",
          },
          reusableSetup: {
            enabled: true,
          },
        },
        assistantPolicy: {
          missedLogFollowup: "opt_in_only",
        },
        planDefaults: {
          sessionsPerWeek: 3,
          testPlanId: "rhr-21d",
        },
        startIntent: {
          intentSummary: "Explore Finnish Dry Sauna",
        },
      },
    });
    expect(
      saunaProtocol?.experimentOnboarding?.setupSlots?.find((slot) => slot.id === "sauna_access"),
    ).toMatchObject({
      id: "sauna_access",
      target: {
        object: "experimentRun",
        field: "saunaAccess",
      },
    });
    expect(saunaProtocol?.revision.pageRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(saunaProtocol?.revision.runSpecRevisionId).toBe(
      "sha256:81b1501a47e2bd38b0207b9ad8c88fe99f43c180f8553b49ee8f97f5daa19de9",
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

    const redLightProtocol = catalog.entities.find(
      (entity) =>
        entity.key ===
        "protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed",
    );
    expect(redLightProtocol).toMatchObject({
      experimentOnboarding: {
        planDefaults: {
          testPlanId: "sol-proxy-21d",
        },
        startIntent: {
          intentSummary: "Explore Red-Light Glasses Before Bed",
        },
      },
      revision: {
        runSpecRevisionId:
          "sha256:902fe245b3dd316be97381ac0bf6b95adff85edebae8908a4323db1887638fb4",
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
