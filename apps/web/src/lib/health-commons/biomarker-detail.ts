import type {
  HealthCommonsBiomarkerCommunityOutcomeSummary,
  HealthCommonsBiomarkerExplainerCard,
  HealthCommonsBiomarkerMetricDomain,
  HealthCommonsBiomarkerPrivateMetricBinding,
  HealthCommonsBiomarkerProtocolCandidate,
  HealthCommonsBiomarkerProtocolExpectedDirection,
  HealthCommonsBiomarkerProtocolRelationship,
  HealthCommonsBiomarkerProtocolScoring,
  HealthCommonsBiomarkerTrendAggregation,
  HealthCommonsClaim,
  HealthCommonsInterpretationFrame,
  HealthCommonsSource,
} from "@murphai/contracts/health-commons";

import {
  healthCommonsCatalog,
  type HealthCommonsCatalogReader,
  type HealthCommonsEntity,
} from "./catalog";

const FINNISH_SAUNA_PROTOCOL_KEY = "protocol_variant:dry-sauna/murph-finnish-standard-3x-week";
const FINNISH_SAUNA_ROUTE_ID = "finnish-sauna";

const STATUS_LABELS: Record<string, string> = {
  community: "Community",
  deprecated: "Deprecated",
  draft: "Draft",
  "field-testing": "Field testing",
  reviewed: "Reviewed",
};

const QUALITY_LABELS: Record<string, string> = {
  excellent: "Excellent",
  reviewed: "Reviewed",
  stub: "Stub",
  usable: "Usable",
};

const QUALITY_SCORE: Record<string, number> = {
  excellent: 5,
  reviewed: 4,
  stub: 1,
  usable: 3,
};

const DEFAULT_TREND_DEFAULTS: BiomarkerTrendDefaults = {
  aggregation: "median",
  comparisonWindowDays: 30,
  latestWindowDays: 7,
  minimumPoints: 5,
};

type ProtocolBiomarkerRelationType =
  | "primary_biomarker"
  | "related_protocol"
  | "secondary_biomarker";

export interface BiomarkerTrendDefaults {
  aggregation: HealthCommonsBiomarkerTrendAggregation;
  comparisonWindowDays: number;
  latestWindowDays: number;
  minimumPoints: number;
}

export interface BiomarkerMeasurementModel {
  bestContext: string;
  confounders: string[];
  howToMeasure: string[];
}

export interface BiomarkerSourceModel {
  citation: string | null;
  evidenceLabel: string;
  externalUrl: string | null;
  key: string;
  summary: string;
  title: string;
  typeLabel: string;
  year: number | null;
}

export interface BiomarkerClaimModel {
  caveats: string[];
  claimId: string;
  sourceKeys: string[];
  sources: BiomarkerSourceModel[];
  strength: HealthCommonsClaim["strength"];
  text: string;
  type: HealthCommonsClaim["type"];
}

export interface BiomarkerProtocolRankingModel {
  burdenLabel: string;
  cautionLabel: string;
  category: string;
  confidence: "high" | "medium" | "low" | "unknown";
  description: string;
  explicitCandidateIndex: number | null;
  expectedDirection: HealthCommonsBiomarkerProtocolExpectedDirection;
  href: string;
  isExplicitCandidate: boolean;
  key: string;
  mechanism: string;
  rankScore: number;
  relationship: HealthCommonsBiomarkerProtocolRelationship;
  scoring: HealthCommonsBiomarkerProtocolScoring;
  title: string;
}

export interface BiomarkerPageModel {
  aliases: string[];
  body: string;
  catalogHash: string;
  categories: string[];
  claims: BiomarkerClaimModel[];
  communityOutcomeSummary: HealthCommonsBiomarkerCommunityOutcomeSummary;
  explainerCards: HealthCommonsBiomarkerExplainerCard[];
  interpretationFrame: HealthCommonsInterpretationFrame;
  key: string;
  measurement: BiomarkerMeasurementModel;
  measurementContexts: string[];
  pageRevisionId: string;
  privateMetricBindings: HealthCommonsBiomarkerPrivateMetricBinding[];
  protocolRankingFormula: string;
  protocolRankingVersion: string;
  protocolRankings: BiomarkerProtocolRankingModel[];
  qualityLabel: string;
  routeId: string;
  shortName: string;
  slug: string;
  sourceHighlights: BiomarkerSourceModel[];
  statusLabel: string;
  summary: string;
  title: string;
  trendDefaults: BiomarkerTrendDefaults;
  unit: string;
  valuePrecision: number;
}

export function listHealthCommonsBiomarkerRoutes(
  catalog: HealthCommonsCatalogReader = healthCommonsCatalog,
): string[] {
  return catalog
    .listByEntityType("biomarker")
    .filter(isPublishedBiomarker)
    .map((entity) => toTrailingRouteId(entity.slug))
    .sort();
}

export function resolveHealthCommonsBiomarkerDetail(
  biomarkerId: string,
  catalog: HealthCommonsCatalogReader = healthCommonsCatalog,
): BiomarkerPageModel | null {
  const biomarker = catalog.findByRouteId({
    entityType: "biomarker",
    routeId: normalizeRouteId(biomarkerId),
  });

  if (!biomarker || biomarker.entityType !== "biomarker") {
    return null;
  }

  if (!isPublishedBiomarker(biomarker)) {
    return null;
  }

  return toBiomarkerPageModel(biomarker, catalog);
}

export function isBrowserVaultMetricBinding(
  binding: HealthCommonsBiomarkerPrivateMetricBinding,
): binding is HealthCommonsBiomarkerPrivateMetricBinding & {
  domain: HealthCommonsBiomarkerMetricDomain;
  metric: string;
  source: "browser_vault_metric";
} {
  return binding.source === "browser_vault_metric"
    && typeof binding.domain === "string"
    && typeof binding.metric === "string";
}

function toBiomarkerPageModel(
  biomarker: HealthCommonsEntity,
  catalog: HealthCommonsCatalogReader,
): BiomarkerPageModel {
  const biomarkerSpec = biomarker.biomarker;
  const protocolRanking = biomarker.protocolRanking;

  return {
    aliases: biomarker.aliases ?? [],
    body: biomarker.body,
    catalogHash: catalog.catalogHash,
    categories: biomarker.categories ?? [],
    claims: buildBiomarkerClaims(biomarker, catalog),
    communityOutcomeSummary: biomarker.communityOutcomeSummary ?? {
      minimumCohortSize: 20,
      placeholder: "Community outcome summaries will appear once enough opted-in Murph runs are available.",
      state: "coming_soon",
    },
    explainerCards: biomarkerSpec?.explainerCards ?? fallbackExplainerCards(biomarker),
    interpretationFrame: biomarker.interpretationFrame ?? {
      caveat: "Compare this biomarker against your own baseline and keep obvious confounders visible.",
      principle: "Trend beats a single value.",
    },
    key: biomarker.key,
    measurement: {
      bestContext: biomarkerSpec?.measurement?.bestContext
        ?? "Use the most consistent available measurement context.",
      confounders: biomarkerSpec?.measurement?.confounders ?? [],
      howToMeasure: biomarkerSpec?.measurement?.howToMeasure ?? [
        "Use the same device or method when comparing before and after windows.",
        "Prefer window averages over one-off readings.",
      ],
    },
    measurementContexts: biomarker.measurementContexts ?? [],
    pageRevisionId: biomarker.revision.pageRevisionId,
    privateMetricBindings: biomarkerSpec?.privateMetricBindings ?? [],
    protocolRankingFormula: protocolRanking?.scoreFormula
      ?? "evidenceWeight * 3 + biomarkerRelevance * 3 + wearableMeasurability * 2 - burdenPenalty - safetyCautionPenalty + communityOutcomeConfidence",
    protocolRankingVersion: protocolRanking?.version ?? "deterministic-v0",
    protocolRankings: buildProtocolRankings({ biomarker, catalog }),
    qualityLabel: formatQualityLabel(biomarker.quality),
    routeId: toTrailingRouteId(biomarker.slug),
    shortName: biomarkerSpec?.shortName ?? biomarker.aliases?.[0] ?? biomarker.title,
    slug: biomarker.slug,
    sourceHighlights: buildBiomarkerSourceHighlights(biomarker, catalog),
    statusLabel: formatStatusLabel(biomarker.status),
    summary: biomarker.summary ?? summarizeBody(biomarker.body),
    title: biomarkerSpec?.displayName ?? biomarker.title,
    trendDefaults: biomarkerSpec?.trendDefaults ?? DEFAULT_TREND_DEFAULTS,
    unit: biomarkerSpec?.unit ?? biomarker.unit ?? "value",
    valuePrecision: biomarkerSpec?.valuePrecision ?? 0,
  };
}

function isPublishedBiomarker(entity: HealthCommonsEntity): boolean {
  return entity.entityType === "biomarker"
    && entity.status !== "deprecated"
    && (entity.biomarker?.explainerCards?.length ?? 0) > 0
    && (entity.biomarker?.measurement?.howToMeasure?.length ?? 0) > 0
    && (entity.protocolRanking?.candidates?.length ?? 0) > 0
    && entity.communityOutcomeSummary != null
    && (entity.biomarker?.privateMetricBindings?.some(isBrowserVaultMetricBinding) ?? false);
}

function buildBiomarkerClaims(
  biomarker: HealthCommonsEntity,
  catalog: HealthCommonsCatalogReader,
): BiomarkerClaimModel[] {
  return (biomarker.claims ?? []).map((claim) => ({
    caveats: claim.caveats ?? [],
    claimId: claim.claimId,
    sourceKeys: claim.sourceKeys ?? [],
    sources: resolveClaimSources(claim, catalog),
    strength: claim.strength,
    text: claim.text,
    type: claim.type,
  }));
}

function buildBiomarkerSourceHighlights(
  biomarker: HealthCommonsEntity,
  catalog: HealthCommonsCatalogReader,
): BiomarkerSourceModel[] {
  const claimSourceOrder = new Map<string, number>();
  let nextClaimSourceIndex = 0;
  for (const claim of biomarker.claims ?? []) {
    for (const sourceKey of claim.sourceKeys ?? []) {
      if (!claimSourceOrder.has(sourceKey)) {
        claimSourceOrder.set(sourceKey, nextClaimSourceIndex);
        nextClaimSourceIndex += 1;
      }
    }
  }

  const citedSources = catalog.listRelated({
    entity: biomarker,
    entityTypes: ["source_artifact"],
    relationTypes: ["cites"],
  });
  const claimSources = (biomarker.claims ?? []).flatMap((claim) =>
    resolveClaimSourceEntities(claim, catalog)
  );

  return uniqueEntities([...claimSources, ...citedSources])
    .sort((left, right) => compareBiomarkerSourceEntities(left, right, claimSourceOrder))
    .map(toBiomarkerSourceModel);
}

function resolveClaimSources(
  claim: HealthCommonsClaim,
  catalog: HealthCommonsCatalogReader,
): BiomarkerSourceModel[] {
  return resolveClaimSourceEntities(claim, catalog).map(toBiomarkerSourceModel);
}

function resolveClaimSourceEntities(
  claim: HealthCommonsClaim,
  catalog: HealthCommonsCatalogReader,
): HealthCommonsEntity[] {
  return (claim.sourceKeys ?? []).flatMap((sourceKey) => {
    const source = catalog.findByKey(sourceKey);

    return source?.entityType === "source_artifact" ? [source] : [];
  });
}

function toBiomarkerSourceModel(sourceEntity: HealthCommonsEntity): BiomarkerSourceModel {
  const source: HealthCommonsSource | undefined = sourceEntity.source;

  return {
    citation: source?.citation ?? null,
    evidenceLabel: sourceEntity.researchEvidence?.designLabel
      ?? formatSourceKind(source?.kind ?? sourceEntity.entityType),
    externalUrl: source?.url ?? null,
    key: sourceEntity.key,
    summary: resolveBiomarkerSourceSummary(sourceEntity),
    title: source?.title ?? sourceEntity.title,
    typeLabel: formatSourceKind(source?.kind ?? sourceEntity.entityType),
    year: source?.year ?? null,
  };
}

function compareBiomarkerSourceEntities(
  left: HealthCommonsEntity,
  right: HealthCommonsEntity,
  claimSourceOrder: ReadonlyMap<string, number>,
): number {
  const leftClaimOrder = claimSourceOrder.get(left.key);
  const rightClaimOrder = claimSourceOrder.get(right.key);

  if (leftClaimOrder !== rightClaimOrder) {
    if (leftClaimOrder === undefined) {
      return 1;
    }

    if (rightClaimOrder === undefined) {
      return -1;
    }

    return leftClaimOrder - rightClaimOrder;
  }

  const leftYear = left.source?.year ?? 0;
  const rightYear = right.source?.year ?? 0;

  if (leftYear !== rightYear) {
    return rightYear - leftYear;
  }

  return left.title.localeCompare(right.title);
}

function formatSourceKind(value: string): string {
  return formatWords(value.replace(/_/gu, " "));
}

function readEntityString(entity: HealthCommonsEntity, key: string): string | null {
  const value = (entity as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function resolveBiomarkerSourceSummary(entity: HealthCommonsEntity): string {
  const murphTakeaway = readEntityString(entity, "murphTakeaway");
  if (murphTakeaway) {
    return murphTakeaway;
  }

  const whyItMatters = readEntityString(entity, "whyItMatters");
  if (whyItMatters) {
    return whyItMatters;
  }

  if (typeof entity.summary === "string" && entity.summary.trim().length > 0) {
    return entity.summary;
  }

  return summarizeBody(entity.body);
}

function buildProtocolRankings(input: {
  biomarker: HealthCommonsEntity;
  catalog: HealthCommonsCatalogReader;
}): BiomarkerProtocolRankingModel[] {
  const explicitCandidates = input.biomarker.protocolRanking?.candidates ?? [];
  const explicitCandidateByKey = new Map(
    explicitCandidates.map((candidate, index) => [
      candidate.protocolKey,
      { candidate, index },
    ]),
  );
  const protocols = resolveProtocolCandidates(input);

  return protocols
    .map((protocol) => toProtocolRanking({
      biomarker: input.biomarker,
      explicitCandidate: explicitCandidateByKey.get(protocol.key)?.candidate ?? null,
      explicitCandidateIndex: explicitCandidateByKey.get(protocol.key)?.index ?? null,
      protocol,
    }))
    .sort(compareProtocolRankings);
}

function resolveProtocolCandidates(input: {
  biomarker: HealthCommonsEntity;
  catalog: HealthCommonsCatalogReader;
}): HealthCommonsEntity[] {
  const explicit = (input.biomarker.protocolRanking?.candidates ?? [])
    .flatMap((candidate) => {
      const protocol = input.catalog.findByKey(candidate.protocolKey);
      return protocol?.entityType === "protocol_variant" ? [protocol] : [];
    });
  const direct = input.catalog.listRelated({
    entity: input.biomarker,
    entityTypes: ["protocol_variant"],
    relationTypes: ["related_protocol"],
  });
  const inverse = input.catalog
    .listByEntityType("protocol_variant")
    .filter((protocol) => protocol.status !== "deprecated")
    .filter((protocol) => hasProtocolBiomarkerRelation(protocol, input.biomarker.key));

  return uniqueEntities([...explicit, ...direct, ...inverse]);
}

function toProtocolRanking(input: {
  biomarker: HealthCommonsEntity;
  explicitCandidate: HealthCommonsBiomarkerProtocolCandidate | null;
  explicitCandidateIndex: number | null;
  protocol: HealthCommonsEntity;
}): BiomarkerProtocolRankingModel {
  const relationship = input.explicitCandidate?.relationship
    ?? inferProtocolRelationship(input.protocol, input.biomarker);
  const scoring = input.explicitCandidate?.scoring
    ?? fallbackProtocolScoring(input.protocol, relationship);
  const rankScore = scoreProtocol(scoring);

  return {
    burdenLabel: input.explicitCandidate?.display?.burdenLabel
      ?? labelForPenalty(scoring.burdenPenalty),
    cautionLabel: input.explicitCandidate?.display?.cautionLabel
      ?? labelForPenalty(scoring.safetyCautionPenalty),
    category: formatProtocolCategory(input.protocol),
    confidence: input.explicitCandidate?.display?.confidence ?? confidenceForScore(rankScore),
    description: input.protocol.summary ?? summarizeBody(input.protocol.body),
    explicitCandidateIndex: input.explicitCandidateIndex,
    expectedDirection: input.explicitCandidate?.expectedDirection
      ?? expectedDirectionForBiomarker(input.biomarker),
    href: `/experiments/${toProtocolExperimentRouteId(input.protocol)}`,
    isExplicitCandidate: input.explicitCandidate !== null,
    key: input.protocol.key,
    mechanism: input.explicitCandidate?.mechanism
      ?? `${input.protocol.title} is linked to ${input.biomarker.title} in Health Commons. Use the protocol page for dosing, caveats, and expected measurement windows.`,
    rankScore,
    relationship,
    scoring,
    title: input.protocol.title,
  };
}

function scoreProtocol(scoring: HealthCommonsBiomarkerProtocolScoring): number {
  return scoring.evidenceWeight * 3
    + scoring.biomarkerRelevance * 3
    + scoring.wearableMeasurability * 2
    - scoring.burdenPenalty
    - scoring.safetyCautionPenalty
    + (scoring.communityOutcomeConfidence ?? 0);
}

function compareProtocolRankings(
  left: BiomarkerProtocolRankingModel,
  right: BiomarkerProtocolRankingModel,
): number {
  if (left.isExplicitCandidate !== right.isExplicitCandidate) {
    return left.isExplicitCandidate ? -1 : 1;
  }

  if (
    left.isExplicitCandidate
    && right.isExplicitCandidate
    && left.explicitCandidateIndex !== right.explicitCandidateIndex
  ) {
    return (left.explicitCandidateIndex ?? Number.MAX_SAFE_INTEGER)
      - (right.explicitCandidateIndex ?? Number.MAX_SAFE_INTEGER);
  }

  const scoreDelta = right.rankScore - left.rankScore;
  return scoreDelta === 0 ? left.title.localeCompare(right.title) : scoreDelta;
}

function fallbackProtocolScoring(
  protocol: HealthCommonsEntity,
  relationship: HealthCommonsBiomarkerProtocolRelationship,
): HealthCommonsBiomarkerProtocolScoring {
  return {
    biomarkerRelevance: relevanceForRelationship(relationship),
    burdenPenalty: protocolBurdenPenalty(protocol),
    evidenceWeight: QUALITY_SCORE[protocol.quality ?? ""] ?? 2,
    safetyCautionPenalty: protocolSafetyPenalty(protocol),
    wearableMeasurability: 4,
  };
}

function inferProtocolRelationship(
  protocol: HealthCommonsEntity,
  biomarker: HealthCommonsEntity,
): HealthCommonsBiomarkerProtocolRelationship {
  const inverse = protocol.relations?.find((relation) =>
    relation.target === biomarker.key && isProtocolBiomarkerRelationType(relation.type)
  );

  if (inverse?.type === "primary_biomarker" || inverse?.type === "secondary_biomarker") {
    return inverse.type;
  }

  const direct = biomarker.relations?.find((relation) =>
    relation.type === "related_protocol" && relation.target === protocol.key
  );

  return direct ? "related_protocol" : "manual_candidate";
}

function hasProtocolBiomarkerRelation(protocol: HealthCommonsEntity, biomarkerKey: string): boolean {
  return protocol.relations?.some((relation) =>
    relation.target === biomarkerKey
      && (relation.type === "primary_biomarker" || relation.type === "secondary_biomarker")
  ) ?? false;
}

function isProtocolBiomarkerRelationType(value: string): value is ProtocolBiomarkerRelationType {
  return value === "primary_biomarker"
    || value === "related_protocol"
    || value === "secondary_biomarker";
}

function relevanceForRelationship(relationship: HealthCommonsBiomarkerProtocolRelationship): number {
  switch (relationship) {
    case "primary_biomarker":
      return 5;
    case "secondary_biomarker":
      return 3;
    case "related_protocol":
      return 2;
    case "manual_candidate":
      return 1;
  }
}

function protocolBurdenPenalty(protocol: HealthCommonsEntity): number {
  const sessionsPerWeek = protocol.protocol?.frequency?.sessionsPerWeek ?? 0;
  const durationMax = protocol.protocol?.durationMinutes?.max ?? 0;

  if (sessionsPerWeek >= 5 || durationMax >= 90) {
    return 4;
  }

  if (sessionsPerWeek >= 3 || durationMax >= 45) {
    return 3;
  }

  if (sessionsPerWeek >= 2 || durationMax >= 20) {
    return 2;
  }

  return 1;
}

function protocolSafetyPenalty(protocol: HealthCommonsEntity): number {
  switch (protocol.safety?.cautionLevel) {
    case "high":
      return 4;
    case "moderate":
      return 2;
    case "low":
      return 1;
    case "unknown":
    case undefined:
      return 3;
  }
}

function confidenceForScore(score: number): "high" | "medium" | "low" | "unknown" {
  if (score >= 32) {
    return "high";
  }

  if (score >= 24) {
    return "medium";
  }

  if (score >= 14) {
    return "low";
  }

  return "unknown";
}

function labelForPenalty(value: number): string {
  if (value >= 4) {
    return "High";
  }

  if (value >= 2) {
    return "Moderate";
  }

  return "Low";
}

function expectedDirectionForBiomarker(
  biomarker: HealthCommonsEntity,
): HealthCommonsBiomarkerProtocolExpectedDirection {
  switch (biomarker.biomarker?.direction?.desired) {
    case "higher":
      return "up";
    case "higher_or_stable":
      return "up_or_stable";
    case "lower":
      return "down";
    case "lower_or_stable":
      return "down_or_stable";
    case "stable":
      return "stable";
    case "mixed_or_contextual":
    case undefined:
      return "mixed_or_contextual";
  }
}

function toProtocolExperimentRouteId(protocol: HealthCommonsEntity): string {
  if (protocol.key === FINNISH_SAUNA_PROTOCOL_KEY) {
    return FINNISH_SAUNA_ROUTE_ID;
  }

  return toTrailingRouteId(protocol.slug);
}

function formatProtocolCategory(protocol: HealthCommonsEntity): string {
  const categories = protocol.categories ?? [];

  if (categories.includes("exercise") || categories.includes("hiit") || categories.includes("vo2max")) {
    return "Exercise";
  }

  if (categories.includes("sleep") || categories.includes("circadian")) {
    return "Sleep";
  }

  if (categories.includes("recovery") || categories.includes("passive-heat")) {
    return "Recovery";
  }

  return formatWords(categories[0] ?? protocol.entityType);
}

function uniqueEntities(entities: readonly HealthCommonsEntity[]): HealthCommonsEntity[] {
  const seen = new Set<string>();
  const unique: HealthCommonsEntity[] = [];

  for (const entity of entities) {
    if (seen.has(entity.key)) {
      continue;
    }

    seen.add(entity.key);
    unique.push(entity);
  }

  return unique;
}

function formatStatusLabel(status: string | undefined): string {
  return status ? STATUS_LABELS[status] ?? formatWords(status) : "Draft";
}

function formatQualityLabel(quality: string | undefined): string {
  return quality ? QUALITY_LABELS[quality] ?? formatWords(quality) : "Usable";
}

function fallbackExplainerCards(biomarker: HealthCommonsEntity): HealthCommonsBiomarkerExplainerCard[] {
  return [
    {
      body: biomarker.summary ?? summarizeBody(biomarker.body),
      title: "What it is",
    },
    {
      body: "Compare your own baseline and intervention windows before treating a single value as meaningful.",
      title: "How to read it",
    },
  ];
}

function summarizeBody(body: string): string {
  const firstParagraph = body.split(/\n\s*\n/u).find((paragraph) => paragraph.trim().length > 0);
  return firstParagraph?.replace(/\s+/gu, " ").trim() ?? "Health Commons page.";
}

function toTrailingRouteId(slug: string): string {
  return slug.split("/").at(-1) ?? slug;
}

function normalizeRouteId(value: string): string {
  return decodeURIComponent(value).trim().replace(/^\/+|\/+$/gu, "");
}

function formatWords(value: string): string {
  return value
    .split(/[-_\s/]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
