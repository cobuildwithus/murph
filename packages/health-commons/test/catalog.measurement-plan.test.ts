import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  type HealthCommonsPageFrontmatter,
} from "@murphai/contracts";

import { buildHealthCommonsCatalogFromContent } from "../src/catalog.ts";
import type { HealthCommonsContentSet, HealthCommonsSourcePage } from "../src/load.ts";

function createBiomarkerPage(): HealthCommonsSourcePage {
  const frontmatter: HealthCommonsPageFrontmatter = {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "biomarker",
    key: "biomarker:estimated-vo2max",
    slug: "biomarkers/estimated-vo2max",
    title: "Estimated VO2max",
  };

  return {
    body: "A wearable cardio fitness estimate.",
    frontmatter,
    rawFrontmatter: null,
    relativePath: "biomarkers/estimated-vo2max.md",
  };
}

function createMeasurementMethodPage(): HealthCommonsSourcePage {
  const frontmatter: HealthCommonsPageFrontmatter = {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "measurement_method",
    key: "measurement_method:cardio/wearable-vo2max-estimate",
    slug: "measurement-methods/cardio/wearable-vo2max-estimate",
    title: "Wearable VO2max Estimate",
    measurementMethod: {
      tier: "consumer_device",
      modalities: ["wearable"],
      measuredBiomarkerKeys: ["biomarker:estimated-vo2max"],
      outputs: [
        {
          outputId: "wearable_vo2max_estimate",
          label: "Wearable VO2max estimate",
          valueType: "number",
          unit: "ml/kg/min",
          mapsToBiomarkerKey: "biomarker:estimated-vo2max",
          direction: "higher_is_better",
        },
      ],
      procedure: {
        summary: "Use the same wearable's cardio fitness estimate.",
        steps: ["Use the same wearable model and app account across the run."],
      },
    },
  };

  return {
    body: "A consumer wearable VO2max estimate method.",
    frontmatter,
    rawFrontmatter: null,
    relativePath: "measurement-methods/cardio/wearable-vo2max-estimate.md",
  };
}

function createProtocolPage(
  measurementPlan: NonNullable<HealthCommonsPageFrontmatter["measurementPlan"]>,
): HealthCommonsSourcePage {
  const frontmatter: HealthCommonsPageFrontmatter = {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "protocol_variant",
    key: "protocol_variant:norwegian-4x4/norwegian-4x4",
    slug: "protocols/norwegian-4x4/norwegian-4x4",
    title: "Norwegian 4x4 Intervals",
    summary: "A simple interval protocol.",
    lineage: {
      relationship: "root",
      rationale: "Test fixture.",
    },
    attribution: {
      ownerType: "murph",
    },
    protocol: {
      doseSignature: "4 intervals",
      steps: ["Warm up.", "Run intervals."],
      safetyNotes: ["Stop for chest pain."],
    },
    safety: {
      cautionLevel: "high",
      stopIf: ["Chest pain"],
    },
    testPlans: [
      {
        planId: "wearable-cardio-fitness-49d",
        durationDays: 49,
        baselineDays: 14,
        interventionDays: 35,
        primaryBiomarkerKey: "biomarker:estimated-vo2max",
      },
    ],
    measurementPlan,
  };

  return {
    body: "Protocol body.",
    frontmatter,
    rawFrontmatter: null,
    relativePath: "protocols/norwegian-4x4/norwegian-4x4.md",
  };
}

function createContentSet(
  measurementPlan: NonNullable<HealthCommonsPageFrontmatter["measurementPlan"]>,
): HealthCommonsContentSet {
  return {
    artifactManifests: [],
    changes: [],
    evidenceAppraisals: [],
    pages: [
      createBiomarkerPage(),
      createMeasurementMethodPage(),
      createProtocolPage(measurementPlan),
    ],
    redirects: [],
  };
}

describe("Health Commons measurement plan revisions", () => {
  it("changes runSpecRevisionId without changing recipeHash when measurement paths change", () => {
    const createMeasurementPlan = (
      label: string,
    ): NonNullable<HealthCommonsPageFrontmatter["measurementPlan"]> => ({
      schemaVersion: "murph.commons.measurement-plan.v1",
      defaultPathId: "wearable-vo2max-estimate",
      paths: [
        {
          pathId: "wearable-vo2max-estimate",
          label,
          tier: "consumer_device",
          required: true,
          methodKeys: ["measurement_method:cardio/wearable-vo2max-estimate"],
          outcomeKeys: ["biomarker:estimated-vo2max"],
        },
      ],
    });

    const firstCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet(createMeasurementPlan("Default wearable VO2max estimate")),
    );
    const secondCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet(createMeasurementPlan("Default same-device wearable VO2max estimate")),
    );

    const firstRevision = firstCatalog.entities.find(
      (entity) => entity.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    )?.revision;
    const secondRevision = secondCatalog.entities.find(
      (entity) => entity.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    )?.revision;

    expect(firstRevision?.runSpecRevisionId).toBeTruthy();
    expect(secondRevision?.runSpecRevisionId).toBeTruthy();
    expect(secondRevision?.runSpecRevisionId).not.toEqual(firstRevision?.runSpecRevisionId);
    expect(firstRevision?.recipeHash).toBeTruthy();
    expect(secondRevision?.recipeHash).toEqual(firstRevision?.recipeHash);
  });
});
