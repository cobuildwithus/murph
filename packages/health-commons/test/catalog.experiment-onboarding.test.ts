import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  type HealthCommonsExperimentOnboarding,
  type HealthCommonsPageFrontmatter,
} from "@murphai/contracts";

import { buildHealthCommonsCatalog, buildHealthCommonsCatalogFromContent } from "../src/catalog.ts";
import type { HealthCommonsContentSet, HealthCommonsSourcePage } from "../src/load.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

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

function createProtocolPage(input: {
  adaptationPolicy?: HealthCommonsExperimentOnboarding["adaptationPolicy"];
  body?: string;
  firstSessionGuidance?: string;
  measurementPlan?: NonNullable<HealthCommonsPageFrontmatter["measurementPlan"]>;
  testPlanId?: string;
} = {}): HealthCommonsSourcePage {
  const frontmatter: HealthCommonsPageFrontmatter = {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "protocol_variant",
    key: "protocol_variant:norwegian-4x4/norwegian-4x4",
    slug: "protocols/norwegian-4x4/norwegian-4x4",
    title: "Norwegian 4x4 Intervals",
    summary: "A simple interval protocol.",
    lineage: {
      relationship: "root",
      rationale: "Test protocol.",
    },
    attribution: {
      ownerType: "murph",
    },
    protocol: {
      doseSignature: "2x/week · 4 x 4 min intervals",
      steps: ["Warm up", "Do the intervals", "Cool down"],
    },
    testPlans: [
      {
        planId: "wearable-cardio-fitness-49d",
        durationDays: 49,
        baselineDays: 7,
        interventionDays: 42,
        primaryBiomarkerKey: "biomarker:estimated-vo2max",
      },
    ],
    safety: {
      cautionLevel: "high",
      stopIf: ["Chest pain"],
    },
    ...(input.measurementPlan === undefined
      ? {}
      : { measurementPlan: input.measurementPlan }),
    experimentOnboarding: {
      schemaVersion: HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
      startIntent: {
        displayPrompt: "Hey Murph, I want to explore doing Norwegian 4x4 intervals.",
        intentSummary: "Explore Norwegian 4x4 Intervals",
      },
      setupSlots: [
        {
          id: "modality",
          label: "Modality",
          question: "Which modality will you use?",
          options: ["bike", "rower"],
          target: {
            object: "experimentRun",
            field: "modality",
          },
        },
      ],
      ...(input.adaptationPolicy === undefined
        ? {}
        : { adaptationPolicy: input.adaptationPolicy }),
      planDefaults: {
        testPlanId: input.testPlanId ?? "wearable-cardio-fitness-49d",
        firstSessionGuidance:
          input.firstSessionGuidance ?? "Start with a conservative first interval session.",
      },
    },
  };

  return {
    body: input.body ?? "Test protocol body.",
    frontmatter,
    rawFrontmatter: null,
    relativePath: "protocols/norwegian-4x4/norwegian-4x4.md",
  };
}

function createContentSet(input: {
  adaptationPolicy?: HealthCommonsExperimentOnboarding["adaptationPolicy"];
  body?: string;
  firstSessionGuidance?: string;
  measurementPlan?: NonNullable<HealthCommonsPageFrontmatter["measurementPlan"]>;
  testPlanId?: string;
} = {}): HealthCommonsContentSet {
  return {
    artifactManifests: [],
    changes: [],
    evidenceAppraisals: [],
    pages: [
      createBiomarkerPage(),
      ...(input.measurementPlan === undefined ? [] : [createMeasurementMethodPage()]),
      createProtocolPage(input),
    ],
    redirects: [],
  };
}

describe("buildHealthCommonsCatalogFromContent", () => {
  it("keeps psyllium lab defaults out of daily LDL-C run-in windows", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });
    const protocol = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol",
    );

    expect(protocol).toBeDefined();
    expect(protocol?.testPlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planId: "lipid-panel-12-week",
          baselineDays: 0,
          durationDays: 84,
          interventionDays: 84,
        }),
        expect.objectContaining({
          planId: "lipid-panel-8-week-minimum",
          baselineDays: 0,
          durationDays: 56,
          interventionDays: 56,
        }),
      ]),
    );
    expect(protocol?.experimentOnboarding?.planDefaults).toEqual(expect.objectContaining({
      testPlanId: "lipid-panel-12-week",
    }));
    expect(protocol?.experimentOnboarding?.planDefaults).not.toHaveProperty("baselineDays");
    expect(protocol?.experimentOnboarding?.planDefaults).not.toHaveProperty("interventionDays");
  });

  it("changes pageRevisionId without changing runSpecRevisionId for narrative-only edits", () => {
    const firstCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        body: "Test protocol body.",
      }),
    );
    const secondCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        body: "Reworded protocol body without changing the runnable contract.",
      }),
    );

    const firstRevision = firstCatalog.entities.find(
      (entity) => entity.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    )?.revision;
    const secondRevision = secondCatalog.entities.find(
      (entity) => entity.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    )?.revision;

    expect(firstRevision?.pageRevisionId).toBeTruthy();
    expect(secondRevision?.pageRevisionId).toBeTruthy();
    expect(secondRevision?.pageRevisionId).not.toEqual(firstRevision?.pageRevisionId);
    expect(firstRevision?.runSpecRevisionId).toBeTruthy();
    expect(secondRevision?.runSpecRevisionId).toEqual(firstRevision?.runSpecRevisionId);
  });

  it("changes runSpecRevisionId when onboarding semantics change", () => {
    const firstCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        firstSessionGuidance: "Start with a conservative first interval session.",
      }),
    );
    const secondCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        firstSessionGuidance: "Start with a conservative bike or rower interval session.",
      }),
    );

    const firstRevision = firstCatalog.entities.find(
      (entity) => entity.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    )?.revision.runSpecRevisionId;
    const secondRevision = secondCatalog.entities.find(
      (entity) => entity.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    )?.revision.runSpecRevisionId;

    expect(firstRevision).toBeTruthy();
    expect(secondRevision).toBeTruthy();
    expect(secondRevision).not.toEqual(firstRevision);
  });

  it("changes runSpecRevisionId without changing recipeHash when adaptation policy changes", () => {
    const createAdaptationPolicy = (
      guidance: string,
    ): NonNullable<HealthCommonsExperimentOnboarding["adaptationPolicy"]> => ({
      fields: [
        {
          id: "modality",
          label: "Modality",
          target: {
            object: "protocol",
            field: "effectiveSpec.modality",
          },
          sourceSlotIds: ["modality"],
          requiredForRunSpec: true,
          protocolReusable: true,
          guidance,
        },
      ],
      reusableSetup: {
        enabled: true,
        target: {
          object: "protocol",
          field: "setupSnapshot",
        },
        sourceSlotIds: ["modality"],
      },
    });
    const firstCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        adaptationPolicy: createAdaptationPolicy(
          "Use the profile only when the modality still matches.",
        ),
      }),
    );
    const secondCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        adaptationPolicy: createAdaptationPolicy(
          "Use the profile only when modality and schedule still match.",
        ),
      }),
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

  it("changes runSpecRevisionId without changing recipeHash when measurement plan changes", () => {
    const createMeasurementPlan = (
      label: string,
    ): NonNullable<HealthCommonsPageFrontmatter["measurementPlan"]> => ({
      schemaVersion: "murph.commons.measurement-plan.v1",
      defaultPathId: "wearable-vo2max",
      paths: [
        {
          pathId: "wearable-vo2max",
          label,
          tier: "consumer_device",
          required: true,
          methodKeys: ["measurement_method:cardio/wearable-vo2max-estimate"],
          outcomeKeys: ["biomarker:estimated-vo2max"],
        },
      ],
    });
    const firstCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        measurementPlan: createMeasurementPlan("Default wearable VO2max estimate"),
      }),
    );
    const secondCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        measurementPlan: createMeasurementPlan("Default same-device wearable VO2max estimate"),
      }),
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

  it("rejects onboarding testPlan ids that are missing from the protocol", () => {
    expect(() =>
      buildHealthCommonsCatalogFromContent(
        createContentSet({
          testPlanId: "missing-test-plan",
        }),
      ),
    ).toThrow(/planDefaults\.testPlanId points to missing test plan missing-test-plan/);
  });

  it("rejects adaptation policy references that do not resolve inside the protocol page", () => {
    const validAdaptationPolicy: NonNullable<HealthCommonsExperimentOnboarding["adaptationPolicy"]> = {
      fields: [
        {
          id: "modality",
          label: "Modality",
          target: {
            object: "protocol",
            field: "effectiveSpec.modality",
          },
          sourceSlotIds: ["modality"],
        },
      ],
      measurementPlan: {
        testPlanId: "wearable-cardio-fitness-49d",
        requiredSignals: ["biomarker:estimated-vo2max"],
      },
      reusableSetup: {
        enabled: true,
        sourceSlotIds: ["modality"],
      },
    };

    expect(() =>
      buildHealthCommonsCatalogFromContent(
        createContentSet({
          adaptationPolicy: {
            ...validAdaptationPolicy,
            fields: [
              {
                ...validAdaptationPolicy.fields[0],
                sourceSlotIds: ["missing_slot"],
              },
            ],
          },
        }),
      ),
    ).toThrow(/sourceSlotIds points to missing setup slot missing_slot/);

    expect(() =>
      buildHealthCommonsCatalogFromContent(
        createContentSet({
          adaptationPolicy: {
            ...validAdaptationPolicy,
            measurementPlan: {
              ...validAdaptationPolicy.measurementPlan,
              testPlanId: "missing-test-plan",
            },
          },
        }),
      ),
    ).toThrow(/adaptationPolicy\.measurementPlan\.testPlanId points to missing test plan missing-test-plan/);

    expect(() =>
      buildHealthCommonsCatalogFromContent(
        createContentSet({
          adaptationPolicy: {
            ...validAdaptationPolicy,
            measurementPlan: {
              ...validAdaptationPolicy.measurementPlan,
              requiredSignals: ["biomarker:missing"],
            },
          },
        }),
      ),
    ).toThrow(/adaptationPolicy\.measurementPlan\.requiredSignals points to missing health commons target biomarker:missing/);
  });
});
