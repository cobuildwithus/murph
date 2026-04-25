import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
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

function createProtocolPage(input: {
  body?: string;
  confirmationPrompt?: string;
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
          purpose: "logistics",
          valueType: "enum",
          askPolicy: "ask_if_unknown",
          required: true,
          options: ["bike", "rower"],
        },
      ],
      planDefaults: {
        testPlanId: input.testPlanId ?? "wearable-cardio-fitness-49d",
        baselineDays: 7,
        interventionDays: 42,
      },
      logging: {
        sessionFields: ["modality"],
      },
      assistantPolicy: {
        askBeforeCreatingAutomations: true,
        missedLogFollowup: "opt_in_only",
        confirmationPrompt:
          input.confirmationPrompt ?? "Show the exact protocol revisions before starting.",
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
  body?: string;
  confirmationPrompt?: string;
  testPlanId?: string;
} = {}): HealthCommonsContentSet {
  return {
    artifactManifests: [],
    changes: [],
    evidenceAppraisals: [],
    pages: [createBiomarkerPage(), createProtocolPage(input)],
    redirects: [],
  };
}

describe("buildHealthCommonsCatalogFromContent", () => {
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
        confirmationPrompt: "Show the exact protocol revisions before starting.",
      }),
    );
    const secondCatalog = buildHealthCommonsCatalogFromContent(
      createContentSet({
        confirmationPrompt: "Show the protocol revisions, test plan, and reminder policy before starting.",
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

  it("rejects onboarding testPlan ids that are missing from the protocol", () => {
    expect(() =>
      buildHealthCommonsCatalogFromContent(
        createContentSet({
          testPlanId: "missing-test-plan",
        }),
      ),
    ).toThrow(/planDefaults\.testPlanId points to missing test plan missing-test-plan/);
  });
});
