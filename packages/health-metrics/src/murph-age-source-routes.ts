import { uniqueStrings } from "./catalog.ts";

export const MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION =
  "murph.age.source-route-registry.v2" as const;

export const MURPH_AGE_SOURCE_ROUTE_ORDINARY_SUBMITTER_AGE_BAND_FITS = [
  "not-ordinary-consumer",
  "older-adult-skewed",
  "partial-16-50",
  "primary-16-50",
] as const;

export const MURPH_AGE_NSRR_DATASET_REQUEST_SCHEMA_VERSION =
  "murph.age.nsrr-dataset-request.v1" as const;

export const MURPH_AGE_SOURCE_ROUTE_ORDINARY_SUBMITTER_INPUT_FAMILIES = [
  "age-sex",
  "autonomic",
  "blood-pressure",
  "bloodwork-labs",
  "body-composition",
  "clinical-history",
  "daily-activity",
  "function",
  "outcome-followup",
  "sleep",
] as const;

export type MurphAgeSourceRouteId =
  | "all-of-us-fitbit-labs-ehr"
  | "cardia-biomarker-activity"
  | "creles-transport-stress"
  | "framingham-activity-cvd"
  | "haalsi-transport-stress"
  | "hchs-sol-biomarker-activity"
  | "hunt-activity-sensor-biobank"
  | "lifelines-activelife-biobank"
  | "mhas-harmonized-aging"
  | "midus-biomarker-mortality"
  | "mipact-apple-watch-ehr"
  | "nako-accelerometer-biobank"
  | "nhefs-public-lab-vitals-mortality"
  | "nhanes-activity-shadow-lmf"
  | "nhanes-bench0-lab-body"
  | "nhanes-iii-lmf-sanity"
  | "nhis-r399-outcome-anchor"
  | "nshap-integrated-aging"
  | "nsrr-haassa-sleep-aging"
  | "nsrr-hchs-sol-sleep-actigraphy"
  | "nsrr-mesa-sleep-autonomic"
  | "nsrr-mros-sleep-aging"
  | "nsrr-shhs-sleep-heart-health"
  | "nsrr-sof-sleep-aging"
  | "nsrr-wsc-sleep-longitudinal"
  | "partner-aggregate-evaluator"
  | "project-baseline-sensor-clinical"
  | "uk-biobank-integrated"
  | "whi-opach-womens-health-activity"
  | "who-sage-south-africa-transport";

export type MurphAgeSourceRouteLayer =
  | "biomarker-increment"
  | "outcome-anchor"
  | "partner-aggregate-validation"
  | "source-feasibility"
  | "transport-validation"
  | "wearable-shadow-increment";

export type MurphAgeSourceRouteAccessMode =
  | "controlled-institutional"
  | "free-registered"
  | "human-admin-workbench"
  | "partner-run"
  | "public-use";

export type MurphAgeSourceRouteActivationStatus =
  | "active-frozen"
  | "admin-required"
  | "historical-reference"
  | "metadata-candidate"
  | "partner-required"
  | "terms-activation-required";

export type MurphAgeSourceRouteEvidenceRole =
  | "internal-anchor"
  | "partner-aggregate-validation"
  | "same-family-sanity"
  | "source-feasibility"
  | "transport-stress"
  | "true-external-candidate";

export type MurphAgeSourceRouteModelUseStatus =
  | "diagnostic-sidecar-candidate"
  | "frozen-research-anchor"
  | "historical-reference"
  | "metadata-only-candidate"
  | "partner-evaluator-candidate";

export type MurphAgeSourceRouteOutcomeSignal =
  | "clinical-event-linked"
  | "linked-mortality"
  | "mortality-or-followup-candidate"
  | "partner-declared"
  | "proxy-or-context-only"
  | "unknown-until-activated";

export type MurphAgeSourceRouteFeatureFamily =
  | "activity"
  | "autonomic"
  | "blood-pressure"
  | "body-composition"
  | "clinical-history"
  | "function"
  | "labs"
  | "sleep"
  | "survey-proxy";

export type MurphAgeSourceRouteOrdinarySubmitterAgeBandFit =
  typeof MURPH_AGE_SOURCE_ROUTE_ORDINARY_SUBMITTER_AGE_BAND_FITS[number];

export type MurphAgeSourceRouteOrdinarySubmitterInputFamily =
  typeof MURPH_AGE_SOURCE_ROUTE_ORDINARY_SUBMITTER_INPUT_FAMILIES[number];

export interface MurphAgeSourceRouteOrdinarySubmitterFit {
  ageBandFit: MurphAgeSourceRouteOrdinarySubmitterAgeBandFit;
  inputFamilies: MurphAgeSourceRouteOrdinarySubmitterInputFamily[];
  rank: number | null;
}

export const MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_SCHEMA_VERSION =
  "murph.age.ordinary-lab-wearable-autoresearch-source-priority.v1" as const;

export type MurphAgeOrdinaryLabWearableAutoresearchExecutionMode =
  | "free-registered-activation"
  | "human-admin-workbench"
  | "public-locked-benchmark";

const MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_EXECUTION_MODES = [
  "free-registered-activation",
  "human-admin-workbench",
  "public-locked-benchmark",
] as const satisfies readonly MurphAgeOrdinaryLabWearableAutoresearchExecutionMode[];

export type MurphAgeOrdinaryLabWearableAutoresearchRankReason =
  | "admin-heavy-high-fit"
  | "adult-lab-activity-transport"
  | "fastest-public-row-path"
  | "lab-activity-linked-outcome"
  | "older-adult-sex-specific-stress"
  | "partial-age-band-fit"
  | "registry-linked-biobank"
  | "sensor-rich-clinical-fit"
  | "sleep-autonomic-fit"
  | "young-adult-midlife-fit";

export interface MurphAgeOrdinaryLabWearableAutoresearchSourcePriority {
  accessMode: MurphAgeSourceRouteAccessMode;
  activationStatus: MurphAgeSourceRouteActivationStatus;
  blockedUntil: string[];
  executionMode: MurphAgeOrdinaryLabWearableAutoresearchExecutionMode;
  executionPriorityRank: number;
  inputFamilies: MurphAgeSourceRouteOrdinarySubmitterInputFamily[];
  nextAction: string;
  ordinarySubmitterAgeBandFit: MurphAgeSourceRouteOrdinarySubmitterAgeBandFit;
  ordinarySubmitterRank: number;
  productAuthorized: false;
  rankReasonIds: MurphAgeOrdinaryLabWearableAutoresearchRankReason[];
  reviewGptEscalation: "only-after-source-boundary-change-or-real-aggregate-delta";
  routeId: MurphAgeSourceRouteId;
  rowParsingAuthorized: false;
  schemaVersion: typeof MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_SCHEMA_VERSION;
  sourceTextStorageAllowed: false;
}

export interface MurphAgeSourceRouteArtifactBoundary {
  aggregateOutputsOnly: true;
  localPathStorageAllowed: false;
  modelParameterExportAllowed: false;
  participantLevelExportAllowed: false;
  predictionExportAllowed: false;
  productClaimAllowed: false;
  rowMaterializationAuthorized: false;
  rowValueExportAllowed: false;
  sourceTextStorageAllowed: false;
}

export interface MurphAgeSourceRoute {
  accessMode: MurphAgeSourceRouteAccessMode;
  activationStatus: MurphAgeSourceRouteActivationStatus;
  allowedResearchUses: string[];
  artifactBoundary: MurphAgeSourceRouteArtifactBoundary;
  blockedCurrentUses: string[];
  displayName: string;
  evidenceRole: MurphAgeSourceRouteEvidenceRole;
  featureFamilies: MurphAgeSourceRouteFeatureFamily[];
  layers: MurphAgeSourceRouteLayer[];
  modelUseStatus: MurphAgeSourceRouteModelUseStatus;
  nextAction: string;
  ordinarySubmitterFit: MurphAgeSourceRouteOrdinarySubmitterFit;
  outcomeSignal: MurphAgeSourceRouteOutcomeSignal;
  priorityRank: number;
  productAuthorized: false;
  routeId: MurphAgeSourceRouteId;
  schemaVersion: typeof MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION;
  sourceFamily: string;
}

export interface MurphAgeSourceRouteRegistryValidationIssue {
  code:
    | "DUPLICATE_ROUTE_ID"
    | "DUPLICATE_SOURCE_PRIORITY_RANK"
    | "INVALID_BOUNDARY"
    | "INVALID_PRIORITY"
    | "INVALID_ROUTE_ID"
    | "INVALID_SCHEMA"
    | "INVALID_SOURCE_PRIORITY"
    | "INVALID_SUBMITTER_FIT"
    | "PROHIBITED_TEXT"
    | "PRODUCT_AUTHORIZED";
  message: string;
  routeId?: string;
}

export interface MurphAgeSourceRouteRegistryValidationResult {
  issues: MurphAgeSourceRouteRegistryValidationIssue[];
  status: "invalid" | "valid";
}

export interface MurphAgeOrdinaryLabWearableAutoresearchSourcePriorityValidationResult {
  issues: MurphAgeSourceRouteRegistryValidationIssue[];
  status: "invalid" | "valid";
}

export type MurphAgeNsrrDatasetRequestId =
  | "haassa"
  | "hchs-sol"
  | "mesa-sleep"
  | "mros-sleep"
  | "shhs"
  | "sof-sleep"
  | "wsc";

export type MurphAgeNsrrDatasetRequestTier = "bonus" | "lean-first-five" | "primary";

export interface MurphAgeNsrrDatasetRequest {
  datasetId: MurphAgeNsrrDatasetRequestId;
  displayName: string;
  includeInLeanRequest: boolean;
  modelUnblockerRoles: string[];
  nextLocalCheckCommand: string;
  productAuthorized: false;
  recommendedDownloadTargets: string[];
  requestCheckboxLabel: string;
  requestPriorityRank: number;
  requestTier: MurphAgeNsrrDatasetRequestTier;
  rowParsingAuthorized: false;
  schemaVersion: typeof MURPH_AGE_NSRR_DATASET_REQUEST_SCHEMA_VERSION;
  sourceRouteId: MurphAgeSourceRouteId;
  whyRequest: string;
}

type MurphAgeNsrrDatasetRequestDefinition = {
  datasetId: MurphAgeNsrrDatasetRequestId;
  displayName: string;
  includeInLeanRequest: boolean;
  modelUnblockerRoles: string[];
  recommendedDownloadTargets: string[];
  requestCheckboxLabel: string;
  requestPriorityRank: number;
  requestTier: MurphAgeNsrrDatasetRequestTier;
  sourceRouteId: MurphAgeSourceRouteId;
  whyRequest: string;
};

type MurphAgeSourceRouteDefinition = Omit<
  MurphAgeSourceRoute,
  "artifactBoundary" | "ordinarySubmitterFit" | "productAuthorized" | "schemaVersion"
> & {
  ordinarySubmitterFit?: MurphAgeSourceRouteOrdinarySubmitterFit;
};

const MURPH_AGE_DEFAULT_ORDINARY_SUBMITTER_FIT = {
  ageBandFit: "not-ordinary-consumer",
  inputFamilies: [],
  rank: null,
} satisfies MurphAgeSourceRouteOrdinarySubmitterFit;

const MURPH_AGE_SOURCE_ROUTE_ARTIFACT_BOUNDARY = {
  aggregateOutputsOnly: true,
  localPathStorageAllowed: false,
  modelParameterExportAllowed: false,
  participantLevelExportAllowed: false,
  predictionExportAllowed: false,
  productClaimAllowed: false,
  rowMaterializationAuthorized: false,
  rowValueExportAllowed: false,
  sourceTextStorageAllowed: false,
} satisfies MurphAgeSourceRouteArtifactBoundary;

const MURPH_AGE_NSRR_DATASET_REQUEST_DEFINITIONS = [
  {
    datasetId: "mesa-sleep",
    displayName: "Multi-Ethnic Study of Atherosclerosis Sleep",
    includeInLeanRequest: true,
    modelUnblockerRoles: [
      "sleep-autonomic-plus-activity validation",
      "cardiovascular event and risk transport",
      "older-adult multi-ethnic calibration stress",
    ],
    recommendedDownloadTargets: ["mesa/datasets", "mesa/actigraphy"],
    requestCheckboxLabel: "Multi-Ethnic Study of Atherosclerosis",
    requestPriorityRank: 1,
    requestTier: "primary",
    sourceRouteId: "nsrr-mesa-sleep-autonomic",
    whyRequest:
      "Best first NSRR lane because it combines objective sleep or activity context with cardiovascular phenotype and event linkage needed for wearable residual validation.",
  },
  {
    datasetId: "hchs-sol",
    displayName: "Hispanic Community Health Study / Study of Latinos",
    includeInLeanRequest: true,
    modelUnblockerRoles: [
      "activity and sleep transport outside NHIS/NHANES",
      "metabolic and cardiometabolic generalization",
      "source-diversity stress test",
    ],
    recommendedDownloadTargets: ["hchs/datasets", "hchs/actigraphy"],
    requestCheckboxLabel: "Hispanic Community Health Study / Study of Latinos",
    requestPriorityRank: 2,
    requestTier: "primary",
    sourceRouteId: "nsrr-hchs-sol-sleep-actigraphy",
    whyRequest:
      "High-value external route for objective activity or sleep signals plus cardiometabolic context in a population not covered by the current frozen NHIS anchor.",
  },
  {
    datasetId: "shhs",
    displayName: "Sleep Heart Health Study",
    includeInLeanRequest: true,
    modelUnblockerRoles: [
      "sleep-autonomic endpoint validation",
      "sleep-disordered breathing risk stress",
      "cardiovascular outcome comparison",
    ],
    recommendedDownloadTargets: ["shhs/datasets"],
    requestCheckboxLabel: "Sleep Heart Health Study",
    requestPriorityRank: 3,
    requestTier: "primary",
    sourceRouteId: "nsrr-shhs-sleep-heart-health",
    whyRequest:
      "Strong sleep and cardiovascular outcome lane for testing whether sleep/autonomic features add calibrated signal instead of acting as context-only noise.",
  },
  {
    datasetId: "mros-sleep",
    displayName: "MrOS Sleep Study",
    includeInLeanRequest: true,
    modelUnblockerRoles: [
      "older-male aging stress",
      "sleep-autonomic transport",
      "late-life calibration check",
    ],
    recommendedDownloadTargets: ["mros/datasets"],
    requestCheckboxLabel: "MrOS Sleep Study",
    requestPriorityRank: 4,
    requestTier: "lean-first-five",
    sourceRouteId: "nsrr-mros-sleep-aging",
    whyRequest:
      "Useful sex-specific older-adult stress test for sleep/autonomic signals and calibration behavior in late-life risk settings.",
  },
  {
    datasetId: "sof-sleep",
    displayName: "Study of Osteoporotic Fractures",
    includeInLeanRequest: true,
    modelUnblockerRoles: [
      "older-female aging stress",
      "sleep and function transport",
      "late-life calibration check",
    ],
    recommendedDownloadTargets: ["sof/datasets"],
    requestCheckboxLabel: "Study of Osteoporotic Fractures",
    requestPriorityRank: 5,
    requestTier: "lean-first-five",
    sourceRouteId: "nsrr-sof-sleep-aging",
    whyRequest:
      "Complements MrOS with an older-female stress test so sleep/autonomic validation is not accidentally male-only.",
  },
  {
    datasetId: "wsc",
    displayName: "Wisconsin Sleep Cohort",
    includeInLeanRequest: false,
    modelUnblockerRoles: [
      "longitudinal sleep transport",
      "repeated sleep-study calibration stress",
      "fallback sleep endpoint lane",
    ],
    recommendedDownloadTargets: ["wsc/datasets"],
    requestCheckboxLabel: "Wisconsin Sleep Cohort",
    requestPriorityRank: 6,
    requestTier: "bonus",
    sourceRouteId: "nsrr-wsc-sleep-longitudinal",
    whyRequest:
      "Good broader sleep-cohort fallback after the first five routes, especially for repeated sleep-study and calibration stress questions.",
  },
  {
    datasetId: "haassa",
    displayName: "Honolulu-Asia Aging Study of Sleep Apnea",
    includeInLeanRequest: false,
    modelUnblockerRoles: [
      "older-adult sleep apnea stress",
      "single-demographic generalization check",
      "late-life cognition or function context",
    ],
    recommendedDownloadTargets: ["haassa/datasets"],
    requestCheckboxLabel: "Honolulu-Asia Aging Study of Sleep Apnea",
    requestPriorityRank: 7,
    requestTier: "bonus",
    sourceRouteId: "nsrr-haassa-sleep-aging",
    whyRequest:
      "Bonus route because it may require extra owner permission, but it is useful for late-life sleep apnea and generalization stress if accessible.",
  },
] satisfies MurphAgeNsrrDatasetRequestDefinition[];

const MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_DEFINITIONS = [
  {
    blockedUntil: [
      "locked public benchmark card",
      "aggregate-only receipt template",
    ],
    executionMode: "public-locked-benchmark",
    executionPriorityRank: 1,
    nextAction: "Design the locked public lab plus activity benchmark card before any NHANES row parsing.",
    rankReasonIds: [
      "fastest-public-row-path",
      "lab-activity-linked-outcome",
    ],
    routeId: "nhanes-activity-shadow-lmf",
  },
  {
    blockedUntil: [
      "human-admin workbench authority",
      "frozen aggregate evaluator boundary",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 2,
    nextAction: "Keep All of Us as the highest-fit consumer-like route for Fitbit, labs, EHR outcomes, and aggregate evaluator planning.",
    rankReasonIds: [
      "admin-heavy-high-fit",
      "lab-activity-linked-outcome",
    ],
    routeId: "all-of-us-fitbit-labs-ehr",
  },
  {
    blockedUntil: [
      "source activation labels",
      "MESA core lab and sleep joinability check",
      "aggregate output policy",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 8,
    nextAction: "Keep MESA/NSRR as the first sleep-autonomic support route after activity-first consumer and accelerometry routes return aggregate evidence.",
    rankReasonIds: [
      "sleep-autonomic-fit",
      "lab-activity-linked-outcome",
    ],
    routeId: "nsrr-mesa-sleep-autonomic",
  },
  {
    blockedUntil: [
      "human-admin workbench authority",
      "source-rights promotion review",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 5,
    nextAction: "Use UK Biobank as the high-powered wrist-accelerometry, biomarker, and outcome route for activity-shape priors and aggregate-only stress testing.",
    rankReasonIds: [
      "admin-heavy-high-fit",
      "partial-age-band-fit",
    ],
    routeId: "uk-biobank-integrated",
  },
  {
    blockedUntil: [
      "source activation labels",
      "aggregate receipt requirements",
    ],
    executionMode: "free-registered-activation",
    executionPriorityRank: 6,
    nextAction: "Fill CARDIA activation labels for lab, vitals, activity, follow-up, and aggregate export boundaries.",
    rankReasonIds: [
      "young-adult-midlife-fit",
      "lab-activity-linked-outcome",
    ],
    routeId: "cardia-biomarker-activity",
  },
  {
    blockedUntil: [
      "source activation labels",
      "aggregate receipt requirements",
    ],
    executionMode: "free-registered-activation",
    executionPriorityRank: 7,
    nextAction: "Fill HCHS/SOL activation labels for adult lab, activity, follow-up, and aggregate export boundaries.",
    rankReasonIds: [
      "adult-lab-activity-transport",
      "lab-activity-linked-outcome",
    ],
    routeId: "hchs-sol-biomarker-activity",
  },
  {
    blockedUntil: [
      "authorized data-holder collaboration",
      "aggregate output policy",
      "endpoint and denominator card",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 3,
    nextAction: "Pursue MIPACT as a partner or authorized-data-holder aggregate route for Apple Watch plus clinical outcomes.",
    rankReasonIds: [
      "admin-heavy-high-fit",
      "sensor-rich-clinical-fit",
    ],
    routeId: "mipact-apple-watch-ehr",
  },
  {
    blockedUntil: [
      "scientific access approval",
      "smartwatch and BP joinability check",
      "aggregate output policy",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 4,
    nextAction: "Scout Electronic Framingham as a smaller but high-value smartwatch, BP, and longitudinal phenotype transport route for the first activity residual pack.",
    rankReasonIds: [
      "partial-age-band-fit",
      "lab-activity-linked-outcome",
    ],
    routeId: "framingham-activity-cvd",
  },
  {
    blockedUntil: [
      "scientific access approval",
      "endpoint and denominator card",
      "aggregate output policy",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 9,
    nextAction: "Use WHI OPACH / Women's Health Study as an older-women supporting activity, labs, and outcome stress route with sex-specific calibration checks.",
    rankReasonIds: [
      "older-adult-sex-specific-stress",
      "lab-activity-linked-outcome",
    ],
    routeId: "whi-opach-womens-health-activity",
  },
  {
    blockedUntil: [
      "scientific access approval",
      "aggregate output policy",
      "endpoint and denominator card",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 10,
    nextAction: "Queue NAKO for an aggregate-runner request focused on accelerometry, labs, and cardiometabolic outcomes.",
    rankReasonIds: [
      "admin-heavy-high-fit",
      "registry-linked-biobank",
    ],
    routeId: "nako-accelerometer-biobank",
  },
  {
    blockedUntil: [
      "scientific access approval",
      "register-linkage permission",
      "aggregate output policy",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 11,
    nextAction: "Queue HUNT for an aggregate-runner request focused on activity sensors, biological material, and register-linked outcomes.",
    rankReasonIds: [
      "admin-heavy-high-fit",
      "registry-linked-biobank",
    ],
    routeId: "hunt-activity-sensor-biobank",
  },
  {
    blockedUntil: [
      "scientific access approval",
      "outcome linkage confirmation",
      "aggregate output policy",
    ],
    executionMode: "human-admin-workbench",
    executionPriorityRank: 12,
    nextAction: "Queue Lifelines ActiveLife for an aggregate-runner request focused on objective activity plus broad lab/body phenotyping.",
    rankReasonIds: [
      "admin-heavy-high-fit",
      "registry-linked-biobank",
    ],
    routeId: "lifelines-activelife-biobank",
  },
] as const satisfies readonly {
  blockedUntil: readonly string[];
  executionMode: MurphAgeOrdinaryLabWearableAutoresearchExecutionMode;
  executionPriorityRank: number;
  nextAction: string;
  rankReasonIds: readonly MurphAgeOrdinaryLabWearableAutoresearchRankReason[];
  routeId: MurphAgeSourceRouteId;
}[];

const MURPH_AGE_SOURCE_ROUTE_DEFINITIONS = [
  {
    accessMode: "public-use",
    activationStatus: "active-frozen",
    allowedResearchUses: [
      "frozen base-anchor comparison",
      "aggregate residual diagnostics",
      "future source-priority hypotheses",
    ],
    blockedCurrentUses: [
      "same-split tuning",
      "product promotion",
      "user-facing age display",
    ],
    displayName: "NHIS linked mortality R399 anchor",
    evidenceRole: "internal-anchor",
    featureFamilies: ["clinical-history", "survey-proxy"],
    layers: ["outcome-anchor"],
    modelUseStatus: "frozen-research-anchor",
    nextAction: "Keep frozen and use only aggregate residual diagnostics to choose the next external route.",
    outcomeSignal: "linked-mortality",
    priorityRank: 10,
    routeId: "nhis-r399-outcome-anchor",
    sourceFamily: "NHIS linked mortality",
  },
  {
    accessMode: "public-use",
    activationStatus: "metadata-candidate",
    allowedResearchUses: [
      "same-denominator activity shadow benchmark design",
      "wearable increment aggregate diagnostics",
      "lab/body plus activity plumbing checks",
    ],
    blockedCurrentUses: [
      "wearable score contribution",
      "product claims",
      "unlocked benchmark mutation after scores",
    ],
    displayName: "NHANES activity plus linked mortality",
    evidenceRole: "same-family-sanity",
    featureFamilies: ["activity", "blood-pressure", "body-composition", "labs"],
    layers: ["biomarker-increment", "wearable-shadow-increment"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Create a locked benchmark card before parsing rows or estimating a wearable shadow increment.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "daily-activity",
        "outcome-followup",
      ],
      rank: 8,
    },
    outcomeSignal: "linked-mortality",
    priorityRank: 20,
    routeId: "nhanes-activity-shadow-lmf",
    sourceFamily: "NHANES linked mortality",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "young-adult-to-midlife lab and activity aggregate receipt design",
      "lab/body plus activity age-band calibration stress",
      "consumer-submitter feature-family coverage stress",
    ],
    blockedCurrentUses: [
      "row parsing before activation",
      "treating questionnaire activity as consumer wearable validation",
      "score-bearing product use",
    ],
    displayName: "CARDIA biomarker and activity route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "blood-pressure", "body-composition", "clinical-history", "labs"],
    layers: ["source-feasibility", "biomarker-increment", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Fill activation labels and aggregate receipt requirements for young-adult-to-midlife lab, vitals, activity, and follow-up overlap before any benchmark card.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "daily-activity",
        "outcome-followup",
      ],
      rank: 1,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 21,
    routeId: "cardia-biomarker-activity",
    sourceFamily: "CARDIA BioLINCC",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "adult lab and activity aggregate receipt design",
      "lab/body plus activity transport feasibility",
      "consumer-submitter feature-family coverage stress",
    ],
    blockedCurrentUses: [
      "row parsing before activation",
      "treating cohort activity as consumer wearable validation",
      "score-bearing product use",
    ],
    displayName: "HCHS/SOL biomarker and activity route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "blood-pressure", "body-composition", "clinical-history", "labs"],
    layers: ["source-feasibility", "biomarker-increment", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Fill activation labels and aggregate receipt requirements for adult lab, vitals, activity, and follow-up overlap before any benchmark card.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "daily-activity",
        "outcome-followup",
      ],
      rank: 2,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 22,
    routeId: "hchs-sol-biomarker-activity",
    sourceFamily: "HCHS/SOL BioLINCC",
  },
  {
    accessMode: "partner-run",
    activationStatus: "partner-required",
    allowedResearchUses: [
      "frozen evaluator handoff",
      "suppressed aggregate receipt validation",
      "true-external model stress",
    ],
    blockedCurrentUses: [
      "receiving rows",
      "receiving predictions",
      "receiving coefficients",
    ],
    displayName: "Partner aggregate evaluator",
    evidenceRole: "partner-aggregate-validation",
    featureFamilies: ["activity", "autonomic", "blood-pressure", "body-composition", "labs", "sleep"],
    layers: ["partner-aggregate-validation", "transport-validation"],
    modelUseStatus: "partner-evaluator-candidate",
    nextAction: "Package a frozen evaluator and aggregate receipt schema before any partner run.",
    outcomeSignal: "partner-declared",
    priorityRank: 25,
    routeId: "partner-aggregate-evaluator",
    sourceFamily: "Partner-held clinical or cohort data",
  },
  {
    accessMode: "partner-run",
    activationStatus: "partner-required",
    allowedResearchUses: [
      "Apple Watch plus EHR aggregate-delta validation planning",
      "sensor-rich clinical outcome stress testing",
      "ordinary wearable feature-family transport checks",
    ],
    blockedCurrentUses: [
      "background access",
      "row-level data transfer",
      "wearable score contribution before aggregate validation",
    ],
    displayName: "MIPACT Apple Watch/EHR route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "autonomic", "blood-pressure", "clinical-history", "labs", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Find an authorized data holder or collaborator who can run the aggregate wearable/lab evaluator locally.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "autonomic",
        "blood-pressure",
        "bloodwork-labs",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
        "sleep",
      ],
      rank: 4,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 23,
    routeId: "mipact-apple-watch-ehr",
    sourceFamily: "MIPACT",
  },
  {
    accessMode: "controlled-institutional",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "accelerometry plus biosample aggregate receipt planning",
      "registry-linked cardiometabolic transport validation",
      "ordinary lab/activity feature-family stress",
    ],
    blockedCurrentUses: [
      "silent data access",
      "source-content storage",
      "score-bearing product use",
    ],
    displayName: "NAKO accelerometry biobank route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "blood-pressure", "body-composition", "clinical-history", "labs"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Request a scientific aggregate-runner path for accelerometry, labs, and linked clinical outcomes.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
      ],
      rank: 5,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 24,
    routeId: "nako-accelerometer-biobank",
    sourceFamily: "NAKO",
  },
  {
    accessMode: "controlled-institutional",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "activity sensor plus biological material aggregate receipt planning",
      "register-linked disease outcome transport validation",
      "ordinary lab/activity feature-family stress",
    ],
    blockedCurrentUses: [
      "silent data access",
      "register-linked row transfer",
      "score-bearing product use",
    ],
    displayName: "HUNT activity-sensor biobank route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "blood-pressure", "body-composition", "clinical-history", "labs"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Request a scientific aggregate-runner path for activity sensors, biological material, and register-linked outcomes.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
      ],
      rank: 6,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 26,
    routeId: "hunt-activity-sensor-biobank",
    sourceFamily: "HUNT",
  },
  {
    accessMode: "controlled-institutional",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "ActiveLife activity plus Lifelines lab/body aggregate receipt planning",
      "longitudinal population transport validation",
      "ordinary lab/activity feature-family stress",
    ],
    blockedCurrentUses: [
      "silent data access",
      "outcome linkage assumptions before source activation",
      "score-bearing product use",
    ],
    displayName: "Lifelines ActiveLife biobank route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "blood-pressure", "body-composition", "clinical-history", "function", "labs"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Confirm outcome linkage and aggregate export, then request an aggregate-runner path for activity and lab/body features.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
      ],
      rank: 7,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 27,
    routeId: "lifelines-activelife-biobank",
    sourceFamily: "Lifelines ActiveLife",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "biomarker mortality feasibility labels",
      "lab/body transport benchmark design",
      "aggregate-only source activation review",
    ],
    blockedCurrentUses: [
      "silent account-gated row access",
      "source text storage",
      "product evidence",
    ],
    displayName: "MIDUS biomarker and mortality route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["blood-pressure", "body-composition", "function", "labs", "survey-proxy"],
    layers: ["biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Record source activation labels for terms, joinability, endpoint, denominator, and aggregate export.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 30,
    routeId: "midus-biomarker-mortality",
    sourceFamily: "MIDUS / ICPSR",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "integrated aging cohort feasibility",
      "lab/body/social transport stress",
      "wearable-adjacent benchmark design if outcome fit is clear",
    ],
    blockedCurrentUses: [
      "row parsing before activation",
      "small-cell aggregate export",
      "user-facing validation claims",
    ],
    displayName: "NSHAP integrated aging route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["blood-pressure", "body-composition", "clinical-history", "function", "labs", "survey-proxy"],
    layers: ["biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Run metadata-only joinability/readiness labels before any benchmark card.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 35,
    routeId: "nshap-integrated-aging",
    sourceFamily: "NSHAP / ICPSR",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "older-adult external calibration stress",
      "non-US transport diagnostics",
      "aggregate-only benchmark design",
    ],
    blockedCurrentUses: [
      "feature fishing after aggregate results",
      "product promotion",
      "unsuppressed subgroup reports",
    ],
    displayName: "CRELES external transport route",
    evidenceRole: "transport-stress",
    featureFamilies: ["blood-pressure", "body-composition", "clinical-history", "function", "labs", "survey-proxy"],
    layers: ["transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Keep as a transport-stress lane with a predeclared benchmark card before execution.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 40,
    routeId: "creles-transport-stress",
    sourceFamily: "CRELES / ICPSR",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "population transport stress",
      "function and chronic-disease calibration diagnostics",
      "aggregate-only benchmark design",
    ],
    blockedCurrentUses: [
      "product validation claims",
      "row values in artifacts",
      "source-body storage",
    ],
    displayName: "HAALSI transport route",
    evidenceRole: "transport-stress",
    featureFamilies: ["blood-pressure", "body-composition", "clinical-history", "function", "labs", "survey-proxy"],
    layers: ["transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Fill source activation labels and compare endpoint/feature overlap with MIDUS and CRELES.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 45,
    routeId: "haalsi-transport-stress",
    sourceFamily: "HAALSI / ICPSR",
  },
  {
    accessMode: "public-use",
    activationStatus: "metadata-candidate",
    allowedResearchUses: [
      "lab/vitals mortality aggregate diagnostics",
      "source-specific lab and blood-pressure transport support",
      "aggregate-only arbitration for clinical-core candidates",
    ],
    blockedCurrentUses: [
      "score-bearing product use",
      "treating source-specific lift as cross-source validation",
      "row, prediction, or coefficient export",
    ],
    displayName: "NHEFS public lab/vitals mortality route",
    evidenceRole: "transport-stress",
    featureFamilies: ["blood-pressure", "body-composition", "clinical-history", "labs", "survey-proxy"],
    layers: ["biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Use aggregate support only as source-specific lab/vitals evidence until cross-source transport and wearable-outcome receipts land.",
    outcomeSignal: "linked-mortality",
    priorityRank: 46,
    routeId: "nhefs-public-lab-vitals-mortality",
    sourceFamily: "NHEFS public linked mortality",
  },
  {
    accessMode: "public-use",
    activationStatus: "metadata-candidate",
    allowedResearchUses: [
      "function and disability aggregate diagnostics",
      "lead diagnostic sidecar candidate tracking",
      "long-interval mortality transport stress",
    ],
    blockedCurrentUses: [
      "score-bearing product use",
      "treating long-interval follow-up as 10-year validation",
      "product evidence",
      "private local path manifests",
    ],
    displayName: "Gateway Harmonized MHAS route",
    evidenceRole: "transport-stress",
    featureFamilies: ["clinical-history", "function", "survey-proxy"],
    layers: ["source-feasibility", "transport-validation"],
    modelUseStatus: "diagnostic-sidecar-candidate",
    nextAction: "Track function/disability as the lead aggregate-only diagnostic sidecar candidate while keeping product display and score-bearing use blocked.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 28,
    routeId: "mhas-harmonized-aging",
    sourceFamily: "MHAS / Gateway to Global Aging",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "cross-country transport feasibility",
      "survey and biomarker overlap labels",
      "aggregate-only benchmark design",
    ],
    blockedCurrentUses: [
      "using licensed account status as product evidence",
      "codebook body storage",
      "row export",
    ],
    displayName: "WHO SAGE South Africa route",
    evidenceRole: "transport-stress",
    featureFamilies: ["blood-pressure", "body-composition", "clinical-history", "function", "survey-proxy"],
    layers: ["source-feasibility", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Record activation labels for terms, endpoint fit, and aggregate export permission.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 55,
    routeId: "who-sage-south-africa-transport",
    sourceFamily: "WHO SAGE",
  },
  {
    accessMode: "controlled-institutional",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "sensor-rich clinical feasibility scouting",
      "future partner aggregate receipt planning",
      "wearable feature-family method comparison",
    ],
    blockedCurrentUses: [
      "assuming public row access exists",
      "source-body storage",
      "score-bearing product use",
    ],
    displayName: "Project Baseline sensor/clinical route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "autonomic", "blood-pressure", "body-composition", "clinical-history", "labs", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Scout whether an authorized aggregate-runner or partner path exists before treating this as executable.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "autonomic",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
        "sleep",
      ],
      rank: 10,
    },
    outcomeSignal: "unknown-until-activated",
    priorityRank: 58,
    routeId: "project-baseline-sensor-clinical",
    sourceFamily: "Project Baseline",
  },
  {
    accessMode: "controlled-institutional",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "sleep and autonomic source strategy",
      "partner or institutional aggregate validation planning",
      "wearable-shadow benchmark design",
    ],
    blockedCurrentUses: [
      "silent controlled-data access",
      "row-level egress",
      "score-bearing sleep or autonomic increments",
    ],
    displayName: "NSRR / MESA sleep-autonomic route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["autonomic", "blood-pressure", "body-composition", "clinical-history", "labs", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Treat as institutional or partner aggregate route until MESA core clinical/lab plus NSRR sleep joinability is explicit.",
    ordinarySubmitterFit: {
      ageBandFit: "partial-16-50",
      inputFamilies: [
        "age-sex",
        "autonomic",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "outcome-followup",
        "sleep",
      ],
      rank: 12,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 60,
    routeId: "nsrr-mesa-sleep-autonomic",
    sourceFamily: "NSRR / MESA Sleep",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "sleep and cardiometabolic outcome feasibility",
      "sleep-autonomic aggregate receipt design",
      "wearable-shadow benchmark stress outside MESA",
    ],
    blockedCurrentUses: [
      "treating sleep cohort data as consumer wearable validation",
      "row-level export",
      "score-bearing sleep or autonomic increments",
    ],
    displayName: "NSRR SHHS sleep-heart-health route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["autonomic", "clinical-history", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Download derived covariate, sleep, and outcome tables, then fill the NSRR aggregate receipt only if all role families are present.",
    outcomeSignal: "clinical-event-linked",
    priorityRank: 61,
    routeId: "nsrr-shhs-sleep-heart-health",
    sourceFamily: "NSRR SHHS",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "objective activity and sleep transport feasibility",
      "sleep and autonomic aggregate receipt design",
      "wearable-shadow benchmark stress outside MESA",
    ],
    blockedCurrentUses: [
      "assuming actigraphy alone proves wearable validity",
      "row-level export",
      "score-bearing sleep or autonomic increments",
    ],
    displayName: "NSRR HCHS/SOL sleep-actigraphy route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "autonomic", "clinical-history", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Download derived covariate, actigraphy, sleep, and follow-up tables, then fill the NSRR aggregate receipt only if all role families are present.",
    outcomeSignal: "clinical-event-linked",
    priorityRank: 62,
    routeId: "nsrr-hchs-sol-sleep-actigraphy",
    sourceFamily: "NSRR HCHS/SOL",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "older-adult male sleep transport feasibility",
      "sleep-autonomic aggregate receipt stress",
      "fallback sleep-cohort validation if preferred routes are incomplete",
    ],
    blockedCurrentUses: [
      "assuming polysomnography alone proves consumer wearable validity",
      "row-level export",
      "score-bearing sleep or autonomic increments",
    ],
    displayName: "NSRR MrOS sleep-aging route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["autonomic", "clinical-history", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Download derived covariate, sleep, and follow-up tables, then fill the NSRR aggregate receipt only if all role families are present.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 63,
    routeId: "nsrr-mros-sleep-aging",
    sourceFamily: "NSRR MrOS",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "older-adult female sleep transport feasibility",
      "sleep-autonomic aggregate receipt stress",
      "fallback sleep-cohort validation if preferred routes are incomplete",
    ],
    blockedCurrentUses: [
      "assuming polysomnography alone proves consumer wearable validity",
      "row-level export",
      "score-bearing sleep or autonomic increments",
    ],
    displayName: "NSRR SOF sleep-aging route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["autonomic", "clinical-history", "function", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Download derived covariate, sleep, and follow-up tables, then fill the NSRR aggregate receipt only if all role families are present.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 64,
    routeId: "nsrr-sof-sleep-aging",
    sourceFamily: "NSRR SOF",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "longitudinal adult sleep transport feasibility",
      "repeated sleep-study calibration stress",
      "sleep-autonomic aggregate receipt design",
    ],
    blockedCurrentUses: [
      "assuming sleep cohort data proves consumer wearable validity",
      "row-level export",
      "score-bearing sleep or autonomic increments",
    ],
    displayName: "NSRR Wisconsin Sleep Cohort route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["autonomic", "clinical-history", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Download derived covariate, sleep, and follow-up tables, then fill the NSRR aggregate receipt only if all role families are present.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 65,
    routeId: "nsrr-wsc-sleep-longitudinal",
    sourceFamily: "NSRR Wisconsin Sleep Cohort",
  },
  {
    accessMode: "free-registered",
    activationStatus: "terms-activation-required",
    allowedResearchUses: [
      "older-adult male sleep apnea transport feasibility",
      "late-life sleep and cognition stress testing",
      "sleep-autonomic aggregate receipt design",
    ],
    blockedCurrentUses: [
      "assuming single-demographic sleep evidence generalizes to ordinary users",
      "row-level export",
      "score-bearing sleep or autonomic increments",
    ],
    displayName: "NSRR Honolulu-Asia Aging Study of Sleep Apnea route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["autonomic", "clinical-history", "function", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Download derived covariate, sleep, cognition or function, and follow-up tables, then fill the NSRR aggregate receipt only if all role families are present.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 66,
    routeId: "nsrr-haassa-sleep-aging",
    sourceFamily: "NSRR HAASSA",
  },
  {
    accessMode: "human-admin-workbench",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "Fitbit plus labs plus EHR architecture planning",
      "future workbench validation",
      "wearable-source method comparison",
    ],
    blockedCurrentUses: [
      "background access",
      "raw workbench export",
      "product-promotion evidence before source-rights review",
    ],
    displayName: "All of Us Fitbit/labs/EHR route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "autonomic", "blood-pressure", "body-composition", "clinical-history", "labs", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Keep as a workbench/human-admin route; define aggregate evaluator needs before access work.",
    ordinarySubmitterFit: {
      ageBandFit: "primary-16-50",
      inputFamilies: [
        "age-sex",
        "autonomic",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
        "sleep",
      ],
      rank: 3,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 70,
    routeId: "all-of-us-fitbit-labs-ehr",
    sourceFamily: "All of Us",
  },
  {
    accessMode: "human-admin-workbench",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "high-powered integrated validation planning",
      "lab/wearable feature-family stress",
      "partner aggregate feasibility",
    ],
    blockedCurrentUses: [
      "row-level download through Codex",
      "terms-bending data acquisition",
      "product evidence without source-rights review",
    ],
    displayName: "UK Biobank integrated route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "autonomic", "blood-pressure", "body-composition", "clinical-history", "labs", "sleep"],
    layers: ["source-feasibility", "transport-validation", "wearable-shadow-increment", "biomarker-increment"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Keep alive as a human-admin/workbench or partner-aggregate lane.",
    ordinarySubmitterFit: {
      ageBandFit: "partial-16-50",
      inputFamilies: [
        "age-sex",
        "autonomic",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
        "sleep",
      ],
      rank: 9,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 75,
    routeId: "uk-biobank-integrated",
    sourceFamily: "UK Biobank",
  },
  {
    accessMode: "controlled-institutional",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "cardiovascular outcome benchmark planning",
      "activity availability feasibility",
      "lab/CVD transport stress",
    ],
    blockedCurrentUses: [
      "assuming wearable/activity overlap before source activation",
      "silent controlled-data access",
      "score-bearing product use",
    ],
    displayName: "Electronic Framingham smartwatch/BP activity route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "autonomic", "blood-pressure", "body-composition", "clinical-history", "labs"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Confirm smartwatch, BP cuff, longitudinal phenotype, and aggregate export availability before using as a wearable transport route.",
    ordinarySubmitterFit: {
      ageBandFit: "partial-16-50",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "outcome-followup",
      ],
      rank: 11,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 77,
    routeId: "framingham-activity-cvd",
    sourceFamily: "Framingham Heart Study",
  },
  {
    accessMode: "controlled-institutional",
    activationStatus: "admin-required",
    allowedResearchUses: [
      "older-women objective activity and outcome stress testing",
      "sex-specific calibration diagnostics",
      "falls, frailty, CVD, and mortality aggregate receipt planning",
    ],
    blockedCurrentUses: [
      "generalizing older-women activity effects to ordinary users",
      "silent controlled-data access",
      "wearable score-bearing product use",
    ],
    displayName: "WHI OPACH / Women's Health Study activity route",
    evidenceRole: "true-external-candidate",
    featureFamilies: ["activity", "blood-pressure", "body-composition", "clinical-history", "function", "labs"],
    layers: ["source-feasibility", "wearable-shadow-increment", "biomarker-increment", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Treat as an older-women external stress route; request only aggregate receipts after endpoint and denominator cards are fixed.",
    ordinarySubmitterFit: {
      ageBandFit: "older-adult-skewed",
      inputFamilies: [
        "age-sex",
        "blood-pressure",
        "bloodwork-labs",
        "body-composition",
        "clinical-history",
        "daily-activity",
        "function",
        "outcome-followup",
      ],
      rank: 13,
    },
    outcomeSignal: "clinical-event-linked",
    priorityRank: 78,
    routeId: "whi-opach-womens-health-activity",
    sourceFamily: "WHI OPACH / Women's Health Study",
  },
  {
    accessMode: "public-use",
    activationStatus: "historical-reference",
    allowedResearchUses: [
      "same-family plumbing context",
      "lab/body feature reference",
      "historical sanity comparison",
    ],
    blockedCurrentUses: [
      "live anchor replacement",
      "true-external validation claims",
      "product evidence",
    ],
    displayName: "NHANES III linked mortality sanity route",
    evidenceRole: "same-family-sanity",
    featureFamilies: ["blood-pressure", "body-composition", "clinical-history", "labs"],
    layers: ["biomarker-increment", "source-feasibility"],
    modelUseStatus: "historical-reference",
    nextAction: "Use only as historical same-family context, not as a new optimization lane.",
    outcomeSignal: "linked-mortality",
    priorityRank: 80,
    routeId: "nhanes-iii-lmf-sanity",
    sourceFamily: "NHANES III linked mortality",
  },
  {
    accessMode: "public-use",
    activationStatus: "historical-reference",
    allowedResearchUses: [
      "historical internal lab/body reference",
      "feature plumbing context",
      "comparator vocabulary",
    ],
    blockedCurrentUses: [
      "current live anchor status",
      "external validation claims",
      "product promotion",
    ],
    displayName: "NHANES Bench-0 lab/body route",
    evidenceRole: "same-family-sanity",
    featureFamilies: ["blood-pressure", "body-composition", "labs"],
    layers: ["biomarker-increment", "source-feasibility"],
    modelUseStatus: "historical-reference",
    nextAction: "Keep as historical context for lab/body feature contracts.",
    outcomeSignal: "linked-mortality",
    priorityRank: 90,
    routeId: "nhanes-bench0-lab-body",
    sourceFamily: "NHANES Bench-0",
  },
] satisfies readonly MurphAgeSourceRouteDefinition[];

const MURPH_AGE_SOURCE_ROUTES = MURPH_AGE_SOURCE_ROUTE_DEFINITIONS
  .map(completeMurphAgeSourceRoute)
  .sort(compareMurphAgeSourceRoutePriority);

export function listMurphAgeSourceRoutes(): MurphAgeSourceRoute[] {
  return MURPH_AGE_SOURCE_ROUTES.map(cloneMurphAgeSourceRoute);
}

export function resolveMurphAgeSourceRoute(routeId: string): MurphAgeSourceRoute | null {
  const route = MURPH_AGE_SOURCE_ROUTES.find((candidate) => candidate.routeId === routeId) ?? null;
  return route ? cloneMurphAgeSourceRoute(route) : null;
}

export function listMurphAgeSourceRoutesByLayer(layer: MurphAgeSourceRouteLayer): MurphAgeSourceRoute[] {
  return MURPH_AGE_SOURCE_ROUTES
    .filter((route) => route.layers.includes(layer))
    .map(cloneMurphAgeSourceRoute);
}

export function listMurphAgeOrdinaryLabWearableSourceRoutes(): MurphAgeSourceRoute[] {
  return MURPH_AGE_SOURCE_ROUTES
    .filter((route) =>
      route.ordinarySubmitterFit.rank !== null
      && route.ordinarySubmitterFit.inputFamilies.includes("bloodwork-labs")
      && route.ordinarySubmitterFit.inputFamilies.some(isOrdinaryWearableLikeInputFamily)
    )
    .sort(compareMurphAgeSourceRouteOrdinarySubmitterFit)
    .map(cloneMurphAgeSourceRoute);
}

export function listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority():
  MurphAgeOrdinaryLabWearableAutoresearchSourcePriority[] {
  return MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_DEFINITIONS
    .map((definition) => {
      const route = MURPH_AGE_SOURCE_ROUTES.find((candidate) => candidate.routeId === definition.routeId);
      if (!route) {
        throw new Error(`Murph Age autoresearch source priority references an unknown route: ${definition.routeId}`);
      }
      if (
        route.ordinarySubmitterFit.rank === null
        || !route.ordinarySubmitterFit.inputFamilies.includes("bloodwork-labs")
        || !route.ordinarySubmitterFit.inputFamilies.some(isOrdinaryWearableLikeInputFamily)
      ) {
        throw new Error(`Murph Age autoresearch source priority references a non-ordinary lab/wearable route: ${route.routeId}`);
      }
      return {
        accessMode: route.accessMode,
        activationStatus: route.activationStatus,
        blockedUntil: [...definition.blockedUntil],
        executionMode: definition.executionMode,
        executionPriorityRank: definition.executionPriorityRank,
        inputFamilies: [...route.ordinarySubmitterFit.inputFamilies],
        nextAction: definition.nextAction,
        ordinarySubmitterAgeBandFit: route.ordinarySubmitterFit.ageBandFit,
        ordinarySubmitterRank: route.ordinarySubmitterFit.rank,
        productAuthorized: false as const,
        rankReasonIds: [...definition.rankReasonIds],
        reviewGptEscalation: "only-after-source-boundary-change-or-real-aggregate-delta" as const,
        routeId: route.routeId,
        rowParsingAuthorized: false as const,
        schemaVersion: MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_SCHEMA_VERSION,
        sourceTextStorageAllowed: false as const,
      };
    })
    .sort((a, b) => a.executionPriorityRank - b.executionPriorityRank || a.routeId.localeCompare(b.routeId));
}

export function listMurphAgePrioritySourceRoutes(): MurphAgeSourceRoute[] {
  return MURPH_AGE_SOURCE_ROUTES
    .filter((route) =>
      route.activationStatus !== "historical-reference" && route.modelUseStatus !== "historical-reference"
    )
    .map(cloneMurphAgeSourceRoute);
}

export function listMurphAgeNsrrDatasetRequests(): MurphAgeNsrrDatasetRequest[] {
  return MURPH_AGE_NSRR_DATASET_REQUEST_DEFINITIONS
    .map((request) => ({
      ...request,
      modelUnblockerRoles: [...request.modelUnblockerRoles],
      nextLocalCheckCommand: "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
      productAuthorized: false as const,
      recommendedDownloadTargets: [...request.recommendedDownloadTargets],
      rowParsingAuthorized: false as const,
      schemaVersion: MURPH_AGE_NSRR_DATASET_REQUEST_SCHEMA_VERSION,
    }))
    .sort((a, b) => a.requestPriorityRank - b.requestPriorityRank || a.datasetId.localeCompare(b.datasetId));
}

export function validateMurphAgeSourceRouteRegistry(
  routes: readonly MurphAgeSourceRoute[] = MURPH_AGE_SOURCE_ROUTES,
): MurphAgeSourceRouteRegistryValidationResult {
  const issues: MurphAgeSourceRouteRegistryValidationIssue[] = [];
  const seenRouteIds = new Set<string>();
  for (const route of routes) {
    if (route.schemaVersion !== MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION) {
      issues.push({
        code: "INVALID_SCHEMA",
        message: "Murph Age source route has an unsupported schema version.",
        routeId: route.routeId,
      });
    }
    if (!isSimpleRouteId(route.routeId)) {
      issues.push({
        code: "INVALID_ROUTE_ID",
        message: "Murph Age source route ids must be simple lowercase ids.",
        routeId: route.routeId,
      });
    }
    if (seenRouteIds.has(route.routeId)) {
      issues.push({
        code: "DUPLICATE_ROUTE_ID",
        message: "Murph Age source route ids must be unique.",
        routeId: route.routeId,
      });
    }
    seenRouteIds.add(route.routeId);
    if (!Number.isInteger(route.priorityRank) || route.priorityRank <= 0) {
      issues.push({
        code: "INVALID_PRIORITY",
        message: "Murph Age source route priority ranks must be positive integers.",
        routeId: route.routeId,
      });
    }
    if (!isValidOrdinarySubmitterFit(route.ordinarySubmitterFit)) {
      issues.push({
        code: "INVALID_SUBMITTER_FIT",
        message: "Murph Age source route ordinary submitter fit must use known input families and a positive rank or null.",
        routeId: route.routeId,
      });
    }
    if (route.productAuthorized !== false) {
      issues.push({
        code: "PRODUCT_AUTHORIZED",
        message: "Murph Age source routes cannot authorize product use.",
        routeId: route.routeId,
      });
    }
    if (!isMetadataOnlyBoundary(route.artifactBoundary)) {
      issues.push({
        code: "INVALID_BOUNDARY",
        message: "Murph Age source routes must stay metadata-only and aggregate-output-only.",
        routeId: route.routeId,
      });
    }
    const prohibitedTextFields = getProhibitedTextFields(route);
    if (prohibitedTextFields.length > 0) {
      issues.push({
        code: "PROHIBITED_TEXT",
        message: `Murph Age source route text cannot include URLs, local paths, credentials, or source excerpts: ${prohibitedTextFields.join(", ")}.`,
        routeId: route.routeId,
      });
    }
  }
  return {
    issues,
    status: issues.length === 0 ? "valid" : "invalid",
  };
}

export function validateMurphAgeOrdinaryLabWearableAutoresearchSourcePriority(
  priorities: readonly MurphAgeOrdinaryLabWearableAutoresearchSourcePriority[] =
    listMurphAgeOrdinaryLabWearableAutoresearchSourcePriority(),
): MurphAgeOrdinaryLabWearableAutoresearchSourcePriorityValidationResult {
  const issues: MurphAgeSourceRouteRegistryValidationIssue[] = [];
  const seenRanks = new Set<number>();
  for (const priority of priorities) {
    const route = resolveMurphAgeSourceRoute(priority.routeId);
    if (priority.schemaVersion !== MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_SOURCE_PRIORITY_SCHEMA_VERSION) {
      issues.push({
        code: "INVALID_SCHEMA",
        message: "Murph Age ordinary lab/wearable autoresearch source priority has an unsupported schema version.",
        routeId: priority.routeId,
      });
    }
    if (!isSimpleRouteId(priority.routeId) || !route) {
      issues.push({
        code: "INVALID_ROUTE_ID",
        message: "Murph Age ordinary lab/wearable autoresearch source priority route ids must reference registered routes.",
        routeId: priority.routeId,
      });
    }
    if (
      !MURPH_AGE_ORDINARY_LAB_WEARABLE_AUTORESEARCH_EXECUTION_MODES.includes(
        priority.executionMode as MurphAgeOrdinaryLabWearableAutoresearchExecutionMode,
      )
    ) {
      issues.push({
        code: "INVALID_SOURCE_PRIORITY",
        message: "Murph Age ordinary lab/wearable autoresearch source priority execution mode must be known.",
        routeId: priority.routeId,
      });
    }
    if (!Number.isInteger(priority.executionPriorityRank) || priority.executionPriorityRank <= 0) {
      issues.push({
        code: "INVALID_SOURCE_PRIORITY",
        message: "Murph Age ordinary lab/wearable autoresearch source priority ranks must be positive integers.",
        routeId: priority.routeId,
      });
    } else if (seenRanks.has(priority.executionPriorityRank)) {
      issues.push({
        code: "DUPLICATE_SOURCE_PRIORITY_RANK",
        message: "Murph Age ordinary lab/wearable autoresearch source priority ranks must be unique.",
        routeId: priority.routeId,
      });
    }
    seenRanks.add(priority.executionPriorityRank);
    if (
      !priority.inputFamilies.includes("bloodwork-labs")
      || !priority.inputFamilies.some(isOrdinaryWearableLikeInputFamily)
      || priority.ordinarySubmitterRank <= 0
      || route?.ordinarySubmitterFit.rank === null
      || route?.ordinarySubmitterFit.inputFamilies.includes("bloodwork-labs") !== true
      || route?.ordinarySubmitterFit.inputFamilies.some(isOrdinaryWearableLikeInputFamily) !== true
    ) {
      issues.push({
        code: "INVALID_SUBMITTER_FIT",
        message: "Murph Age ordinary lab/wearable autoresearch source priority must reference ordinary lab plus wearable routes.",
        routeId: priority.routeId,
      });
    }
    if (
      priority.productAuthorized !== false
      || priority.rowParsingAuthorized !== false
      || priority.sourceTextStorageAllowed !== false
      || priority.reviewGptEscalation !== "only-after-source-boundary-change-or-real-aggregate-delta"
    ) {
      issues.push({
        code: "PRODUCT_AUTHORIZED",
        message: "Murph Age ordinary lab/wearable autoresearch source priority must stay metadata-only and product-blocked.",
        routeId: priority.routeId,
      });
    }
    if (getProhibitedAutoresearchPriorityTextFields(priority).length > 0) {
      issues.push({
        code: "PROHIBITED_TEXT",
        message: "Murph Age ordinary lab/wearable autoresearch source priority text cannot include URLs, local paths, credentials, or source excerpts.",
        routeId: priority.routeId,
      });
    }
  }
  return {
    issues,
    status: issues.length === 0 ? "valid" : "invalid",
  };
}

function completeMurphAgeSourceRoute(route: MurphAgeSourceRouteDefinition): MurphAgeSourceRoute {
  return {
    ...route,
    allowedResearchUses: uniqueStrings(route.allowedResearchUses),
    artifactBoundary: { ...MURPH_AGE_SOURCE_ROUTE_ARTIFACT_BOUNDARY },
    blockedCurrentUses: uniqueStrings(route.blockedCurrentUses),
    featureFamilies: uniqueLiteralStrings(route.featureFamilies),
    layers: uniqueLiteralStrings(route.layers),
    ordinarySubmitterFit: completeMurphAgeSourceRouteOrdinarySubmitterFit(route.ordinarySubmitterFit),
    productAuthorized: false,
    schemaVersion: MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION,
  };
}

function completeMurphAgeSourceRouteOrdinarySubmitterFit(
  fit: MurphAgeSourceRouteOrdinarySubmitterFit | undefined,
): MurphAgeSourceRouteOrdinarySubmitterFit {
  const resolvedFit = fit ?? MURPH_AGE_DEFAULT_ORDINARY_SUBMITTER_FIT;
  return {
    ...resolvedFit,
    inputFamilies: uniqueLiteralStrings(resolvedFit.inputFamilies),
  };
}

function compareMurphAgeSourceRoutePriority(a: MurphAgeSourceRoute, b: MurphAgeSourceRoute): number {
  return a.priorityRank - b.priorityRank || a.routeId.localeCompare(b.routeId);
}

function compareMurphAgeSourceRouteOrdinarySubmitterFit(a: MurphAgeSourceRoute, b: MurphAgeSourceRoute): number {
  return (a.ordinarySubmitterFit.rank ?? Number.MAX_SAFE_INTEGER)
    - (b.ordinarySubmitterFit.rank ?? Number.MAX_SAFE_INTEGER)
    || compareMurphAgeSourceRoutePriority(a, b);
}

function cloneMurphAgeSourceRoute(route: MurphAgeSourceRoute): MurphAgeSourceRoute {
  return {
    ...route,
    allowedResearchUses: [...route.allowedResearchUses],
    artifactBoundary: { ...route.artifactBoundary },
    blockedCurrentUses: [...route.blockedCurrentUses],
    featureFamilies: [...route.featureFamilies],
    layers: [...route.layers],
    ordinarySubmitterFit: {
      ...route.ordinarySubmitterFit,
      inputFamilies: [...route.ordinarySubmitterFit.inputFamilies],
    },
  };
}

function isSimpleRouteId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function uniqueLiteralStrings<const T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isMetadataOnlyBoundary(boundary: MurphAgeSourceRouteArtifactBoundary): boolean {
  return boundary.aggregateOutputsOnly === true
    && boundary.localPathStorageAllowed === false
    && boundary.modelParameterExportAllowed === false
    && boundary.participantLevelExportAllowed === false
    && boundary.predictionExportAllowed === false
    && boundary.productClaimAllowed === false
    && boundary.rowMaterializationAuthorized === false
    && boundary.rowValueExportAllowed === false
    && boundary.sourceTextStorageAllowed === false;
}

function isValidOrdinarySubmitterFit(fit: MurphAgeSourceRouteOrdinarySubmitterFit): boolean {
  return MURPH_AGE_SOURCE_ROUTE_ORDINARY_SUBMITTER_AGE_BAND_FITS.includes(fit.ageBandFit)
    && fit.inputFamilies.every(isOrdinarySubmitterInputFamily)
    && (fit.rank === null || (Number.isInteger(fit.rank) && fit.rank > 0));
}

function isOrdinarySubmitterInputFamily(
  value: string,
): value is MurphAgeSourceRouteOrdinarySubmitterInputFamily {
  return (MURPH_AGE_SOURCE_ROUTE_ORDINARY_SUBMITTER_INPUT_FAMILIES as readonly string[]).includes(value);
}

function isOrdinaryWearableLikeInputFamily(
  value: MurphAgeSourceRouteOrdinarySubmitterInputFamily,
): boolean {
  return value === "autonomic" || value === "daily-activity" || value === "sleep";
}

function getProhibitedTextFields(route: MurphAgeSourceRoute): string[] {
  const fields = [
    ["displayName", route.displayName],
    ["sourceFamily", route.sourceFamily],
    ["nextAction", route.nextAction],
    ...route.allowedResearchUses.map((value, index) => [`allowedResearchUses[${index}]`, value] as const),
    ...route.blockedCurrentUses.map((value, index) => [`blockedCurrentUses[${index}]`, value] as const),
  ] as const;
  return fields
    .filter(([, value]) => hasProhibitedRouteText(value))
    .map(([fieldName]) => fieldName);
}

function getProhibitedAutoresearchPriorityTextFields(
  priority: MurphAgeOrdinaryLabWearableAutoresearchSourcePriority,
): string[] {
  const fields = [
    ["nextAction", priority.nextAction],
    ...priority.blockedUntil.map((value, index) => [`blockedUntil[${index}]`, value] as const),
  ] as const;
  return fields
    .filter(([, value]) => hasProhibitedRouteText(value))
    .map(([fieldName]) => fieldName);
}

function hasProhibitedRouteText(value: string): boolean {
  return /(?:https?:\/\/|www\.|file:\/\/)/iu.test(value)
    || /(?:^|\s)(?:~\/|\/(?:Users|private|tmp|var|Volumes|home)\/|[A-Za-z]:\\)/u.test(value)
    || /(?:api[_ -]?key|authorization|bearer|password|secret|token)\s*[:=]/iu.test(value)
    || /(?:abstract|codebook|questionnaire|table)\s*[:=]\s*\S/iu.test(value);
}
