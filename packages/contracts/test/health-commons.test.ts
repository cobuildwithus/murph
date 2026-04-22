import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
  HEALTH_COMMONS_CHANGE_SCHEMA_VERSION,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  healthCommonsArtifactManifestSchema,
  healthCommonsArtifactPointerSchema,
  healthCommonsCatalogEntitySchema,
  healthCommonsCatalogSchema,
  healthCommonsChangeRecordSchema,
  healthCommonsClaimSchema,
  healthCommonsPageFrontmatterSchema,
  healthCommonsRedirectsFileSchema,
  isHealthCommonsEntityType,
} from "../src/health-commons.ts";
import { safeParseContract } from "../src/validate.ts";

const validArtifactPointer = {
  artifactId: "art_pmid_29849692_pdf",
  kind: "pdf",
  storage: "cloudflare-r2",
  objectKey: "commons/research/sauna/pmid-29849692/source.pdf",
  localPath: "research-artifacts/sauna/pmid-29849692.pdf",
  rightsStatus: "permission_required",
  redistributable: false,
} as const;

const validSourceArtifactPage = {
  schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  entityType: "source_artifact",
  key: "source_artifact:pmid-29849692",
  slug: "sources/pmid-29849692",
  title: "PMID 29849692",
  source: {
    kind: "web_page",
    url: "https://example.com/pmid-29849692",
  },
  artifacts: [validArtifactPointer],
} as const;

const validCatalogEntity = {
  ...validSourceArtifactPage,
  body: "Source body",
  relativePath: "content/sources/pmid-29849692.md",
  revision: {
    pageRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runSpecRevisionId: null,
    recipeHash: null,
  },
} as const;

const validProtocolVariantPageWithOnboarding = {
  schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  entityType: "protocol_variant",
  key: "protocol_variant:norwegian-4x4/norwegian-4x4",
  slug: "protocols/norwegian-4x4/norwegian-4x4",
  title: "Norwegian 4x4",
  lineage: {
    relationship: "root",
  },
  attribution: {
    ownerType: "murph",
  },
  protocol: {
    doseSignature: "2x/week",
  },
  safety: {
    cautionLevel: "high",
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
  experimentOnboarding: {
    schemaVersion: HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
    startIntent: {
      displayPrompt: "Hey Murph, I want to explore doing Norwegian 4x4 intervals.",
      intentSummary: "Explore Norwegian 4x4 Intervals",
    },
    safetyScreen: {
      cautionLevel: "high",
      mode: "ask_compact_then_expand_if_positive",
      dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start",
      mustAsk: [
        {
          id: "cardiovascular_red_flags",
          prompt: "known cardiovascular disease or chest pain with exertion",
        },
      ],
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
      testPlanId: "wearable-cardio-fitness-49d",
      baselineDays: 7,
      interventionDays: 42,
      sessionsPerWeek: 2,
      targetSessions: 12,
      minimumUsefulSessions: 8,
    },
    logging: {
      sessionFields: ["modality", "interval_peak_hrs"],
    },
    assistantPolicy: {
      askBeforeCreatingAutomations: true,
      missedLogFollowup: "opt_in_only",
    },
  },
} as const;

const validBiomarkerPageWithRanking = {
  schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  entityType: "biomarker",
  key: "biomarker:resting-heart-rate",
  slug: "biomarkers/resting-heart-rate",
  title: "Resting Heart Rate",
  unit: "bpm",
  measurementContexts: [
    "overnight_wearable",
  ],
  biomarker: {
    shortName: "RHR",
    displayName: "Resting Heart Rate",
    unit: "bpm",
    valuePrecision: 0,
    direction: {
      desired: "lower_or_stable",
      label: "Lower or stable is usually better.",
    },
    privateMetricBindings: [
      {
        source: "browser_vault_metric",
        domain: "recovery",
        metric: "restingHeartRate",
        unit: "bpm",
        preferred: true,
      },
    ],
    trendDefaults: {
      latestWindowDays: 7,
      comparisonWindowDays: 30,
      minimumPoints: 5,
      aggregation: "median",
    },
    explainerCards: [
      {
        title: "What it is",
        body: "A resting pulse trend.",
      },
    ],
    measurement: {
      bestContext: "Overnight wearable readings.",
      howToMeasure: [
        "Use the same device.",
      ],
      confounders: [
        "illness",
      ],
    },
  },
  protocolRanking: {
    version: "deterministic-v0",
    scoreFormula: "evidenceWeight * 3",
    candidates: [
      {
        protocolKey: "protocol_variant:norwegian-4x4/norwegian-4x4",
        expectedDirection: "down",
        mechanism: "Aerobic training can lower resting heart rate over time.",
        relationship: "primary_biomarker",
        scoring: {
          evidenceWeight: 5,
          biomarkerRelevance: 5,
          wearableMeasurability: 5,
          burdenPenalty: 4,
          safetyCautionPenalty: 3,
        },
      },
    ],
  },
  communityOutcomeSummary: {
    state: "coming_soon",
    minimumCohortSize: 20,
    placeholder: "Coming soon.",
  },
} as const;

describe("@murphai/contracts health commons schemas", () => {
  it("accepts the source-artifact page and manifest shapes used by Health Commons", () => {
    expect(safeParseContract(healthCommonsArtifactPointerSchema, validArtifactPointer)).toEqual({
      success: true,
      data: validArtifactPointer,
    });
    expect(
      safeParseContract(healthCommonsArtifactManifestSchema, {
        schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        manifestKey: "source_artifact:pmid-29849692/research-artifacts",
        artifacts: [validArtifactPointer],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        manifestKey: "source_artifact:pmid-29849692/research-artifacts",
        artifacts: [validArtifactPointer],
      },
    });
    expect(safeParseContract(healthCommonsPageFrontmatterSchema, validSourceArtifactPage)).toEqual({
      success: true,
      data: validSourceArtifactPage,
    });
    expect(
      safeParseContract(
        healthCommonsPageFrontmatterSchema,
        validProtocolVariantPageWithOnboarding,
      ),
    ).toEqual({
      success: true,
      data: validProtocolVariantPageWithOnboarding,
    });
    expect(
      safeParseContract(
        healthCommonsPageFrontmatterSchema,
        validBiomarkerPageWithRanking,
      ),
    ).toEqual({
      success: true,
      data: validBiomarkerPageWithRanking,
    });
    expect(safeParseContract(healthCommonsCatalogEntitySchema, validCatalogEntity)).toEqual({
      success: true,
      data: validCatalogEntity,
    });
    expect(
      safeParseContract(healthCommonsCatalogSchema, {
        schemaVersion: HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
        catalogHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        entities: [validCatalogEntity],
        redirects: [],
        changes: [],
        artifactManifests: [
          {
            schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
            manifestKey: "source_artifact:pmid-29849692/research-artifacts",
            artifacts: [validArtifactPointer],
          },
        ],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
        catalogHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        entities: [validCatalogEntity],
        redirects: [],
        changes: [],
        artifactManifests: [
          {
            schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
            manifestKey: "source_artifact:pmid-29849692/research-artifacts",
            artifacts: [validArtifactPointer],
          },
        ],
      },
    });
    expect(
      safeParseContract(healthCommonsRedirectsFileSchema, {
        schemaVersion: "murph.commons.redirects.v1",
        redirects: [
          {
            from: "experiment_family:sauna/finnish-dry",
            to: "experiment_family:dry-sauna",
          },
        ],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: "murph.commons.redirects.v1",
        redirects: [
          {
            from: "experiment_family:sauna/finnish-dry",
            to: "experiment_family:dry-sauna",
          },
        ],
      },
    });
    expect(
      safeParseContract(healthCommonsChangeRecordSchema, {
        schemaVersion: HEALTH_COMMONS_CHANGE_SCHEMA_VERSION,
        changeId: "pmid-29849692-artifact-update",
        entityKey: "source_artifact:pmid-29849692",
        changeType: "artifact_change",
        minor: false,
        editSummary: "Add the source artifact manifest entry.",
        sourceKeys: ["source_artifact:pmid-29849692"],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: HEALTH_COMMONS_CHANGE_SCHEMA_VERSION,
        changeId: "pmid-29849692-artifact-update",
        entityKey: "source_artifact:pmid-29849692",
        changeType: "artifact_change",
        minor: false,
        editSummary: "Add the source artifact manifest entry.",
        sourceKeys: ["source_artifact:pmid-29849692"],
      },
    });
    expect(isHealthCommonsEntityType("source_artifact")).toBe(true);
    expect(isHealthCommonsEntityType("not-an-entity")).toBe(false);
  });

  it("rejects the guarded source-artifact and artifact policy branches", () => {
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validSourceArtifactPage,
        source: undefined,
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
        entityType: "protocol_variant",
        key: "protocol_variant:dry-sauna/example",
        slug: "protocols/dry-sauna/example",
        title: "Example protocol",
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
        entityType: "disambiguation",
        key: "disambiguation:example",
        slug: "disambiguation/example",
        title: "Example disambiguation",
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsArtifactPointerSchema, {
        ...validArtifactPointer,
        objectKey: undefined,
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsArtifactPointerSchema, {
        ...validArtifactPointer,
        redistributable: true,
        rightsStatus: "not_redistributable",
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsClaimSchema, {
        claimId: "example-claim",
        type: "mechanistic",
        text: "Example claim text",
        strength: "low",
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validProtocolVariantPageWithOnboarding,
        experimentOnboarding: {
          ...validProtocolVariantPageWithOnboarding.experimentOnboarding,
          setupSlots: [
            {
              ...validProtocolVariantPageWithOnboarding.experimentOnboarding.setupSlots[0],
              options: undefined,
            },
          ],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validProtocolVariantPageWithOnboarding,
        experimentOnboarding: {
          ...validProtocolVariantPageWithOnboarding.experimentOnboarding,
          setupSlots: [
            validProtocolVariantPageWithOnboarding.experimentOnboarding.setupSlots[0],
            validProtocolVariantPageWithOnboarding.experimentOnboarding.setupSlots[0],
          ],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validBiomarkerPageWithRanking,
        biomarker: undefined,
      }),
    ).toMatchObject({
      success: false,
    });
  });
});
