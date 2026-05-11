import { uniqueStrings } from "./catalog.ts";

export const MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION =
  "murph.age.source-route-registry.v1" as const;

export type MurphAgeSourceRouteId =
  | "all-of-us-fitbit-labs-ehr"
  | "creles-transport-stress"
  | "haalsi-transport-stress"
  | "mhas-harmonized-aging"
  | "midus-biomarker-mortality"
  | "nhanes-activity-shadow-lmf"
  | "nhanes-bench0-lab-body"
  | "nhanes-iii-lmf-sanity"
  | "nhis-r399-outcome-anchor"
  | "nshap-integrated-aging"
  | "nsrr-mesa-sleep-autonomic"
  | "partner-aggregate-evaluator"
  | "uk-biobank-integrated"
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
    | "INVALID_BOUNDARY"
    | "INVALID_PRIORITY"
    | "INVALID_ROUTE_ID"
    | "INVALID_SCHEMA"
    | "PROHIBITED_TEXT"
    | "PRODUCT_AUTHORIZED";
  message: string;
  routeId?: string;
}

export interface MurphAgeSourceRouteRegistryValidationResult {
  issues: MurphAgeSourceRouteRegistryValidationIssue[];
  status: "invalid" | "valid";
}

type MurphAgeSourceRouteDefinition = Omit<
  MurphAgeSourceRoute,
  "artifactBoundary" | "productAuthorized" | "schemaVersion"
>;

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
    outcomeSignal: "linked-mortality",
    priorityRank: 20,
    routeId: "nhanes-activity-shadow-lmf",
    sourceFamily: "NHANES linked mortality",
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
      "older-adult survey transport feasibility",
      "function and chronic-condition residual diagnostics",
      "source overlap planning",
    ],
    blockedCurrentUses: [
      "treating harmonized survey proxies as biomarker validation",
      "product evidence",
      "private local path manifests",
    ],
    displayName: "Gateway Harmonized MHAS route",
    evidenceRole: "transport-stress",
    featureFamilies: ["clinical-history", "function", "survey-proxy"],
    layers: ["source-feasibility", "transport-validation"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Use as a survey/proxy transport lane only if endpoint and denominator labels are green.",
    outcomeSignal: "mortality-or-followup-candidate",
    priorityRank: 50,
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
    featureFamilies: ["autonomic", "clinical-history", "sleep"],
    layers: ["source-feasibility", "wearable-shadow-increment"],
    modelUseStatus: "metadata-only-candidate",
    nextAction: "Treat as institutional or partner aggregate route until access authority is explicit.",
    outcomeSignal: "clinical-event-linked",
    priorityRank: 60,
    routeId: "nsrr-mesa-sleep-autonomic",
    sourceFamily: "NSRR / MESA Sleep",
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
    outcomeSignal: "clinical-event-linked",
    priorityRank: 75,
    routeId: "uk-biobank-integrated",
    sourceFamily: "UK Biobank",
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

export function listMurphAgePrioritySourceRoutes(): MurphAgeSourceRoute[] {
  return MURPH_AGE_SOURCE_ROUTES
    .filter((route) =>
      route.activationStatus !== "historical-reference" && route.modelUseStatus !== "historical-reference"
    )
    .map(cloneMurphAgeSourceRoute);
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

function completeMurphAgeSourceRoute(route: MurphAgeSourceRouteDefinition): MurphAgeSourceRoute {
  return {
    ...route,
    allowedResearchUses: uniqueStrings(route.allowedResearchUses),
    artifactBoundary: { ...MURPH_AGE_SOURCE_ROUTE_ARTIFACT_BOUNDARY },
    blockedCurrentUses: uniqueStrings(route.blockedCurrentUses),
    featureFamilies: uniqueLiteralStrings(route.featureFamilies),
    layers: uniqueLiteralStrings(route.layers),
    productAuthorized: false,
    schemaVersion: MURPH_AGE_SOURCE_ROUTE_REGISTRY_SCHEMA_VERSION,
  };
}

function compareMurphAgeSourceRoutePriority(a: MurphAgeSourceRoute, b: MurphAgeSourceRoute): number {
  return a.priorityRank - b.priorityRank || a.routeId.localeCompare(b.routeId);
}

function cloneMurphAgeSourceRoute(route: MurphAgeSourceRoute): MurphAgeSourceRoute {
  return {
    ...route,
    allowedResearchUses: [...route.allowedResearchUses],
    artifactBoundary: { ...route.artifactBoundary },
    blockedCurrentUses: [...route.blockedCurrentUses],
    featureFamilies: [...route.featureFamilies],
    layers: [...route.layers],
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

function hasProhibitedRouteText(value: string): boolean {
  return /(?:https?:\/\/|www\.|file:\/\/)/iu.test(value)
    || /(?:^|\s)(?:~\/|\/(?:Users|private|tmp|var|Volumes|home)\/|[A-Za-z]:\\)/u.test(value)
    || /(?:api[_ -]?key|authorization|bearer|password|secret|token)\s*[:=]/iu.test(value)
    || /(?:abstract|codebook|questionnaire|table)\s*[:=]\s*\S/iu.test(value);
}
