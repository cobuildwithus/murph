import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
  HEALTH_COMMONS_CHANGE_SCHEMA_VERSION,
  HEALTH_COMMONS_EVIDENCE_APPRAISAL_SCHEMA_VERSION,
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
  HEALTH_COMMONS_MEASUREMENT_PLAN_SCHEMA_VERSION,
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  HEALTH_COMMONS_SOURCE_ARTIFACT_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_SOURCE_INDEX_SCHEMA_VERSION,
  healthCommonsArtifactManifestSchema,
  healthCommonsArtifactPointerSchema,
  healthCommonsCatalogEntitySchema,
  healthCommonsCatalogSchema,
  healthCommonsChangeRecordSchema,
  healthCommonsClaimSchema,
  healthCommonsEvidenceAppraisalSchema,
  healthCommonsPageFrontmatterSchema,
  healthCommonsRedirectsFileSchema,
  healthCommonsSourceArtifactIndexSchema,
  healthCommonsSourceIdentitySchema,
  healthCommonsSourceIndexSchema,
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

const validEvidenceAppraisal = {
  schemaVersion: HEALTH_COMMONS_EVIDENCE_APPRAISAL_SCHEMA_VERSION,
  key: "evidence_appraisal:pmid-29849692:dry-sauna",
  sourceKey: "source_artifact:pmid-29849692",
  targetKey: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  targetKind: "protocol_variant",
  groupId: "dry-sauna-evidence",
  stance: "supports",
  scope: "direct_protocol",
  result: "positive",
  endpointKeys: ["biomarker:resting-heart-rate"],
  findingKeys: ["finding:pmid-29849692/heat-exposure"],
  headline: "Sauna exposure was associated with improved vascular markers.",
  implication: "The source can support a dry-sauna evidence group.",
  displayPriority: 10,
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
  preferredRouteId: "norwegian-4x4",
  sortRank: 20,
  attribution: {
    ownerType: "murph",
  },
  protocol: {
    doseSignature: "2x/week",
    logFields: ["completed intervals"],
    sessionFieldIds: ["completed_intervals"],
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
  expectedSignalDescriptions: [
    {
      biomarkerKey: "biomarker:estimated-vo2max",
      description: "Wearable cardio-fitness may move when interval fidelity and recovery are good.",
      expected: "up_or_stable",
      expectedDirection: "up_or_stable",
    },
  ],
  experimentOnboarding: {
    schemaVersion: HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
    startIntent: {
      displayPrompt: "Hey Murph, I want to explore doing Norwegian 4x4 intervals.",
      intentSummary: "Explore Norwegian 4x4 Intervals",
    },
    safetyScreen: {
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
        question: "Which modality will you use?",
        target: {
          object: "experimentRun",
          field: "modality",
        },
        options: ["bike", "rower"],
      },
    ],
    planDefaults: {
      testPlanId: "wearable-cardio-fitness-49d",
      firstSessionGuidance: "Start with a conservative first interval session.",
    },
  },
} as const;

const validBiomarkerPage = {
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
        source: "metric",
        metricKey: "resting-heart-rate",
        role: "primary",
        unit: "bpm",
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
  communityOutcomeSummary: {
    state: "coming_soon",
    minimumCohortSize: 20,
    placeholder: "Coming soon.",
  },
} as const;

const validMeasurementMethodPage = {
  schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  entityType: "measurement_method",
  key: "measurement_method:skin/home-standardized-photo-roi-analysis",
  slug: "measurement-methods/skin/home-standardized-photo-roi-analysis",
  title: "Home Standardized Photo ROI Analysis",
  measurementMethod: {
    shortName: "Home ROI photo analysis",
    tier: "optional_home",
    modalities: ["standardized_photo", "image_analysis"],
    measuredBiomarkerKeys: ["biomarker:periocular-wrinkle-score"],
    outputs: [
      {
        outputId: "wrinkle_line_length_or_area",
        label: "Wrinkle ROI line length / area",
        valueType: "number",
        unit: "normalized line length or percent ROI",
        mapsToBiomarkerKey: "biomarker:periocular-wrinkle-score",
        direction: "lower_or_stable",
      },
    ],
    procedure: {
      summary: "Analyze the same photo region across repeated standardized photos.",
      materials: ["same phone camera", "stable lighting"],
      steps: ["Capture a standardized photo.", "Analyze the same ROI with fixed settings."],
    },
    privacy: {
      containsIdentifiableImages: true,
      localOnlyRecommended: true,
    },
    burden: {
      userBurden: "moderate",
      costTier: "free",
    },
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
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validSourceArtifactPage,
        relations: [
          {
            type: "registry_for",
            target: "source_artifact:pmid-29849692",
          },
          {
            type: "publication_for",
            target: "source_artifact:nct-example",
          },
        ],
        sourceIdentity: {
          identityKind: "scholarly_work",
          canonicalIdBasis: "pmid",
          identifiers: {
            pmid: "29849692",
            doi: "10.1000/example",
          },
          canonicalUrl: "https://pubmed.ncbi.nlm.nih.gov/29849692/",
          identityAliases: ["pubmed:29849692"],
        },
        sourceFindings: [
          {
            findingId: "finding:pmid-29849692/heat-exposure",
            extractedFromArtifactId: "art_pmid_29849692_pdf",
            sourceRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            extractionRevisionId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            findingKind: "intervention_result",
            summary: "Reusable source finding.",
            evidenceUse: ["efficacy"],
          },
        ],
      }),
    ).toMatchObject({
      success: true,
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
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validProtocolVariantPageWithOnboarding,
        protocol: {
          ...validProtocolVariantPageWithOnboarding.protocol,
          sessionFieldIds: ["completed intervals"],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validProtocolVariantPageWithOnboarding,
        protocol: {
          ...validProtocolVariantPageWithOnboarding.protocol,
          sessionFieldIds: [],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validProtocolVariantPageWithOnboarding,
        protocol: {
          ...validProtocolVariantPageWithOnboarding.protocol,
          sessionFieldIds: ["completed_intervals", "completed_intervals"],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(
        healthCommonsPageFrontmatterSchema,
        validBiomarkerPage,
      ),
    ).toEqual({
      success: true,
      data: validBiomarkerPage,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, validMeasurementMethodPage),
    ).toEqual({
      success: true,
      data: validMeasurementMethodPage,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validProtocolVariantPageWithOnboarding,
        measurementPlan: {
          schemaVersion: HEALTH_COMMONS_MEASUREMENT_PLAN_SCHEMA_VERSION,
          defaultPathId: "home-photo-score",
          paths: [
            {
              pathId: "home-photo-score",
              label: "Default home photo score",
              tier: "default_home",
              required: true,
              methodKeys: ["measurement_method:skin/home-standardized-photo-roi-analysis"],
              outcomeKeys: ["biomarker:periocular-wrinkle-score"],
              safetyOutcomeKeys: ["biomarker:skin-tolerability-symptoms"],
            },
          ],
        },
      }),
    ).toMatchObject({
      success: true,
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
        evidenceAppraisals: [validEvidenceAppraisal],
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
        evidenceAppraisals: [validEvidenceAppraisal],
      },
    });
    expect(safeParseContract(healthCommonsEvidenceAppraisalSchema, validEvidenceAppraisal)).toEqual({
      success: true,
      data: validEvidenceAppraisal,
    });
    expect(
      safeParseContract(healthCommonsSourceIndexSchema, {
        schemaVersion: HEALTH_COMMONS_SOURCE_INDEX_SCHEMA_VERSION,
        generatedFromCatalogHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        sources: [
          {
            sourceKey: "source_artifact:pmid-29849692",
            relativePath: "sources/pmid-29849692.md",
            title: "PMID 29849692",
            sourceKind: "web_page",
            identityKind: "scholarly_work",
            canonicalIdBasis: "pmid",
            identifiers: {
              pmid: "29849692",
              doi: "10.1000/example",
            },
            canonicalUrl: "https://pubmed.ncbi.nlm.nih.gov/29849692/",
            sourceUrl: "https://example.com/pmid-29849692",
            identityAliases: ["pubmed:29849692"],
            identityKeys: ["pmid:29849692"],
            artifactIds: ["art_pmid_29849692_pdf"],
            findingIds: ["finding:pmid-29849692/heat-exposure"],
            metadataFetchedAt: null,
            extractionStatus: "findings_available",
            sourceRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        ],
        identityLookup: [
          {
            identityKey: "pmid:29849692",
            sourceKeys: ["source_artifact:pmid-29849692"],
            canonicalSourceKey: "source_artifact:pmid-29849692",
          },
        ],
        duplicateIdentities: [],
      }),
    ).toMatchObject({
      success: true,
    });
    expect(
      safeParseContract(healthCommonsSourceArtifactIndexSchema, {
        schemaVersion: HEALTH_COMMONS_SOURCE_ARTIFACT_INDEX_SCHEMA_VERSION,
        generatedFromCatalogHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        artifacts: [
          {
            ...validArtifactPointer,
            manifestKey: "source_artifact:pmid-29849692/research-artifacts",
            sourceKey: "source_artifact:pmid-29849692",
          },
        ],
        sources: [
          {
            sourceKey: "source_artifact:pmid-29849692",
            artifactIds: ["art_pmid_29849692_pdf"],
          },
        ],
      }),
    ).toMatchObject({
      success: true,
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
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validProtocolVariantPageWithOnboarding,
        mechanismChain: [
          {
            label: "Session",
            content: "Repeat the protocol dose under stable conditions.",
          },
        ],
      }),
    ).toMatchObject({
      success: true,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validSourceArtifactPage,
        mechanismChain: [
          {
            label: "Session",
            content: "This field belongs on protocol_variant pages only.",
          },
        ],
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
              purpose: "logistics",
              valueType: "enum",
              askPolicy: "ask_if_unknown",
              required: true,
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
        ...validBiomarkerPage,
        biomarker: {
          ...validBiomarkerPage.biomarker,
          privateMetricBindings: [
            {
              source: "metric",
              metricKey: "whoop.score.resting_heart_rate",
              unit: "bpm",
            },
          ],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validBiomarkerPage,
        biomarker: {
          ...validBiomarkerPage.biomarker,
          privateMetricBindings: [
            {
              source: "metric",
              metricKey: "sleepEfficiency",
              unit: "%",
            },
          ],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validMeasurementMethodPage,
        measurementMethod: undefined,
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validMeasurementMethodPage,
        measurementMethod: {
          ...validMeasurementMethodPage.measurementMethod,
          privacy: undefined,
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validBiomarkerPage,
        measurementMethod: validMeasurementMethodPage.measurementMethod,
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validMeasurementMethodPage,
        measurementPlan: {
          schemaVersion: HEALTH_COMMONS_MEASUREMENT_PLAN_SCHEMA_VERSION,
          defaultPathId: "missing-path",
          paths: [
            {
              pathId: "home-photo-score",
              label: "Default home photo score",
              tier: "default_home",
              required: true,
              methodKeys: ["measurement_method:skin/home-standardized-photo-roi-analysis"],
            },
          ],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validBiomarkerPage,
        sourceIdentity: {
          identityKind: "scholarly_work",
          canonicalIdBasis: "pmid",
          identifiers: {
            pmid: "29849692",
          },
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validSourceArtifactPage,
        canonicalMetadata: {
          canonicalUrl: "https://example.com/legacy",
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validSourceArtifactPage,
        protocolEvidence: [
          {
            protocolKey: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
            groupId: "dry-sauna-evidence",
            stance: "supports",
            scope: "direct_protocol",
            result: "positive",
            headline: "Legacy source-local appraisal.",
            implication: "This should now live in evidence-appraisal JSONL.",
          },
        ],
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validBiomarkerPage,
        protocolRanking: {
          version: "deterministic-v0",
          scoreFormula: "legacy hand-authored candidate ranking",
          candidates: [],
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsSourceIdentitySchema, {
        identityKind: "scholarly_work",
        canonicalIdBasis: "doi",
        identifiers: {
          pmid: "29849692",
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsSourceIdentitySchema, {
        identityKind: "scholarly_work",
        canonicalIdBasis: "title_hash",
        identifiers: {
          doi: "10.1000/example",
        },
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsSourceIdentitySchema, {
        identityKind: "scholarly_work",
        canonicalIdBasis: "title_hash",
        identifiers: {
          titleHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    ).toMatchObject({
      success: true,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validSourceArtifactPage,
        sourceFindings: [
          {
            findingId: "finding:pmid-29849692/empty",
            findingKind: "context",
          },
        ],
      }),
    ).toMatchObject({
      success: false,
    });
  });
});
