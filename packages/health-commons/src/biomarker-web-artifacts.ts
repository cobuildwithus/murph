import type {
  HealthCommonsBiomarkerCommunityOutcomeSummary,
  HealthCommonsBiomarkerExplainerCard,
  HealthCommonsBiomarkerPrivateMetricBinding,
  HealthCommonsBiomarkerProtocolCandidate,
  HealthCommonsBiomarkerProtocolExpectedDirection,
  HealthCommonsBiomarkerProtocolRelationship,
  HealthCommonsBiomarkerProtocolScoring,
  HealthCommonsBiomarkerTrendAggregation,
  HealthCommonsCatalogEntity,
  HealthCommonsClaim,
  HealthCommonsSource,
} from "@murphai/contracts";

export const HEALTH_COMMONS_WEB_BIOMARKER_SHELL_SCHEMA_VERSION =
  "murph.commons.web.biomarker-shell.v1" as const;
export const HEALTH_COMMONS_WEB_BIOMARKER_OVERVIEW_SCHEMA_VERSION =
  "murph.commons.web.biomarker-overview.v1" as const;
export const HEALTH_COMMONS_WEB_BIOMARKER_RESEARCH_SCHEMA_VERSION =
  "murph.commons.web.biomarker-research.v1" as const;

export type HealthCommonsWebBiomarkerProjectionKey =
  | "biomarker.shell"
  | "biomarker.overview"
  | "biomarker.research";

export type HealthCommonsWebBiomarkerRevisionRef = HealthCommonsCatalogEntity["revision"];

export interface HealthCommonsWebBiomarkerRoute {
  aliases: string[];
  entityType: "biomarker";
  routeId: string;
  slug: string;
}

export interface HealthCommonsWebBiomarkerTrendDefaults {
  aggregation: HealthCommonsBiomarkerTrendAggregation;
  comparisonWindowDays: number;
  latestWindowDays: number;
  minimumPoints: number;
}

export interface HealthCommonsWebBiomarkerAboutItem {
  body: string;
  iconKey: "howToMeasure" | "whatMovesIt" | "whyPeopleCare";
  title: string;
}

export interface HealthCommonsWebBiomarkerMeasurementModel {
  bestContext: string;
  confounders: string[];
  howToMeasure: string[];
}

export interface HealthCommonsWebBiomarkerSourceModel {
  citation: string | null;
  evidenceLabel: string;
  externalUrl: string | null;
  key: string;
  summary: string;
  title: string;
  typeLabel: string;
  year: number | null;
}

export interface HealthCommonsWebBiomarkerClaimModel {
  caveats: string[];
  claimId: string;
  sourceKeys: string[];
  sources: HealthCommonsWebBiomarkerSourceModel[];
  strength: HealthCommonsClaim["strength"];
  text: string;
  type: HealthCommonsClaim["type"];
}

export interface HealthCommonsWebBiomarkerProtocolRankingModel {
  burdenLabel: string;
  cautionLabel: string;
  category: string;
  confidence: "high" | "medium" | "low" | "unknown";
  description: string;
  durationLabel: string;
  evidenceLabel: string;
  expectedDirection: HealthCommonsBiomarkerProtocolExpectedDirection;
  expectedSignalLabel: string;
  explicitCandidateIndex: number | null;
  fitLabel: "High" | "Medium" | "Low" | "Unknown";
  href: string;
  isExplicitCandidate: boolean;
  key: string;
  mechanism: string;
  rankScore: number;
  relationship: HealthCommonsBiomarkerProtocolRelationship;
  scoring: HealthCommonsBiomarkerProtocolScoring;
  title: string;
}

export interface HealthCommonsWebBiomarkerShell {
  about: HealthCommonsWebBiomarkerAboutItem[];
  aliases: string[];
  catalogHash: string;
  categories: string[];
  key: string;
  pageRevisionId: string;
  revision: HealthCommonsWebBiomarkerRevisionRef;
  route: HealthCommonsWebBiomarkerRoute;
  routeId: string;
  schemaVersion: typeof HEALTH_COMMONS_WEB_BIOMARKER_SHELL_SCHEMA_VERSION;
  shortName: string;
  slug: string;
  summary: string;
  title: string;
  unit: string;
}

export interface HealthCommonsWebBiomarkerOverview {
  catalogHash: string;
  communityOutcomeSummary: HealthCommonsBiomarkerCommunityOutcomeSummary;
  key: string;
  pageRevisionId: string;
  privateMetricBindings: HealthCommonsBiomarkerPrivateMetricBinding[];
  protocolRankingFormula: string;
  protocolRankingVersion: string;
  protocolRankings: HealthCommonsWebBiomarkerProtocolRankingModel[];
  revision: HealthCommonsWebBiomarkerRevisionRef;
  route: HealthCommonsWebBiomarkerRoute;
  routeId: string;
  schemaVersion: typeof HEALTH_COMMONS_WEB_BIOMARKER_OVERVIEW_SCHEMA_VERSION;
  shortName: string;
  summary: string;
  slug: string;
  title: string;
  trendDefaults: HealthCommonsWebBiomarkerTrendDefaults;
  unit: string;
  valuePrecision: number;
}

export interface HealthCommonsWebBiomarkerResearch {
  body: string;
  catalogHash: string;
  claims: HealthCommonsWebBiomarkerClaimModel[];
  key: string;
  pageRevisionId: string;
  revision: HealthCommonsWebBiomarkerRevisionRef;
  route: HealthCommonsWebBiomarkerRoute;
  routeId: string;
  schemaVersion: typeof HEALTH_COMMONS_WEB_BIOMARKER_RESEARCH_SCHEMA_VERSION;
  shortName: string;
  slug: string;
  sourceHighlights: HealthCommonsWebBiomarkerSourceModel[];
  title: string;
}

export type HealthCommonsWebBiomarkerProjectionArtifact =
  | HealthCommonsWebBiomarkerOverview
  | HealthCommonsWebBiomarkerResearch
  | HealthCommonsWebBiomarkerShell;

export interface BuildHealthCommonsWebBiomarkerProjectionInput {
  biomarker: HealthCommonsCatalogEntity & { entityType: "biomarker" };
  catalogHash: string;
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  routeAliases: readonly string[];
  routeId: string;
  routeIdByEntityKey: ReadonlyMap<string, string>;
}

const DEFAULT_TREND_DEFAULTS: HealthCommonsWebBiomarkerTrendDefaults = {
  aggregation: "median",
  comparisonWindowDays: 30,
  latestWindowDays: 7,
  minimumPoints: 5,
};

type ProtocolBiomarkerRelationType =
  | "primary_biomarker"
  | "related_protocol"
  | "secondary_biomarker";

type BiomarkerAboutIconKey = HealthCommonsWebBiomarkerAboutItem["iconKey"];

const BIOMARKER_ABOUT_SLOTS: Array<{
  iconKey: BiomarkerAboutIconKey;
  normalizedTitles: readonly string[];
}> = [
  {
    iconKey: "whyPeopleCare",
    normalizedTitles: ["why people care", "why it matters"],
  },
  {
    iconKey: "howToMeasure",
    normalizedTitles: [
      "how to measure it",
      "how it's measured",
      "how its measured",
      "how to read it",
      "how to read a trend",
      "lab vs wearable",
    ],
  },
  {
    iconKey: "whatMovesIt",
    normalizedTitles: ["what can fool it", "what moves it"],
  },
];

const QUALITY_SCORE: Record<string, number> = {
  excellent: 5,
  reviewed: 4,
  stub: 1,
  usable: 3,
};

export function buildHealthCommonsWebBiomarkerShell(
  input: BuildHealthCommonsWebBiomarkerProjectionInput,
): HealthCommonsWebBiomarkerShell {
  const biomarkerSpec = input.biomarker.biomarker;

  return {
    about: buildBiomarkerAbout(
      biomarkerSpec?.explainerCards ?? fallbackExplainerCards(input.biomarker),
    ),
    aliases: input.biomarker.aliases ?? [],
    catalogHash: input.catalogHash,
    categories: input.biomarker.categories ?? [],
    key: input.biomarker.key,
    pageRevisionId: input.biomarker.revision.pageRevisionId,
    revision: input.biomarker.revision,
    route: biomarkerRoute(input),
    routeId: input.routeId,
    schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_SHELL_SCHEMA_VERSION,
    shortName: resolveHealthCommonsWebBiomarkerShortName(input.biomarker),
    slug: input.biomarker.slug,
    summary: input.biomarker.summary ?? summarizeBody(input.biomarker.body),
    title: biomarkerSpec?.displayName ?? input.biomarker.title,
    unit: biomarkerSpec?.unit ?? input.biomarker.unit ?? "value",
  };
}

export function buildHealthCommonsWebBiomarkerOverview(
  input: BuildHealthCommonsWebBiomarkerProjectionInput,
): HealthCommonsWebBiomarkerOverview {
  const biomarkerSpec = input.biomarker.biomarker;
  const protocolRanking = input.biomarker.protocolRanking;

  return {
    catalogHash: input.catalogHash,
    communityOutcomeSummary: input.biomarker.communityOutcomeSummary ?? {
      minimumCohortSize: 20,
      placeholder: "Community outcome summaries will appear once enough opted-in Murph runs are available.",
      state: "coming_soon",
    },
    key: input.biomarker.key,
    pageRevisionId: input.biomarker.revision.pageRevisionId,
    privateMetricBindings: biomarkerSpec?.privateMetricBindings ?? [],
    protocolRankingFormula: protocolRanking?.scoreFormula
      ?? "evidenceWeight * 3 + biomarkerRelevance * 3 + wearableMeasurability * 2 - burdenPenalty - safetyCautionPenalty + communityOutcomeConfidence",
    protocolRankingVersion: protocolRanking?.version ?? "deterministic-v0",
    protocolRankings: buildProtocolRankings(input),
    revision: input.biomarker.revision,
    route: biomarkerRoute(input),
    routeId: input.routeId,
    schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_OVERVIEW_SCHEMA_VERSION,
    shortName: resolveHealthCommonsWebBiomarkerShortName(input.biomarker),
    summary: input.biomarker.summary ?? summarizeBody(input.biomarker.body),
    slug: input.biomarker.slug,
    title: biomarkerSpec?.displayName ?? input.biomarker.title,
    trendDefaults: biomarkerSpec?.trendDefaults ?? DEFAULT_TREND_DEFAULTS,
    unit: biomarkerSpec?.unit ?? input.biomarker.unit ?? "value",
    valuePrecision: biomarkerSpec?.valuePrecision ?? 0,
  };
}

export function buildHealthCommonsWebBiomarkerResearch(
  input: BuildHealthCommonsWebBiomarkerProjectionInput,
): HealthCommonsWebBiomarkerResearch {
  const biomarkerSpec = input.biomarker.biomarker;

  return {
    body: input.biomarker.body,
    catalogHash: input.catalogHash,
    claims: buildBiomarkerClaims(input.biomarker, input.entitiesByKey),
    key: input.biomarker.key,
    pageRevisionId: input.biomarker.revision.pageRevisionId,
    revision: input.biomarker.revision,
    route: biomarkerRoute(input),
    routeId: input.routeId,
    schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_RESEARCH_SCHEMA_VERSION,
    shortName: resolveHealthCommonsWebBiomarkerShortName(input.biomarker),
    slug: input.biomarker.slug,
    sourceHighlights: buildBiomarkerSourceHighlights(input.biomarker, input.entitiesByKey),
    title: biomarkerSpec?.displayName ?? input.biomarker.title,
  };
}

export function resolveHealthCommonsWebBiomarkerShortName(
  biomarker: HealthCommonsCatalogEntity,
): string {
  return biomarker.biomarker?.shortName
    ?? biomarker.aliases?.[0]
    ?? biomarker.biomarker?.displayName
    ?? biomarker.title;
}

function biomarkerRoute(input: BuildHealthCommonsWebBiomarkerProjectionInput): HealthCommonsWebBiomarkerRoute {
  return {
    aliases: [...input.routeAliases],
    entityType: "biomarker",
    routeId: input.routeId,
    slug: input.biomarker.slug,
  };
}

function buildBiomarkerAbout(
  cards: readonly HealthCommonsBiomarkerExplainerCard[],
): HealthCommonsWebBiomarkerAboutItem[] {
  return BIOMARKER_ABOUT_SLOTS.flatMap((slot) => {
    const card = cards.find((candidate) =>
      slot.normalizedTitles.includes(normalizeAboutTitle(candidate.title))
    );

    if (!card) {
      return [];
    }

    return [{
      body: card.body,
      iconKey: slot.iconKey,
      title: card.title,
    }];
  });
}

function normalizeAboutTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function fallbackExplainerCards(biomarker: HealthCommonsCatalogEntity): HealthCommonsBiomarkerExplainerCard[] {
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

function buildBiomarkerClaims(
  biomarker: HealthCommonsCatalogEntity,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsWebBiomarkerClaimModel[] {
  return (biomarker.claims ?? []).map((claim) => ({
    caveats: claim.caveats ?? [],
    claimId: claim.claimId,
    sourceKeys: claim.sourceKeys ?? [],
    sources: resolveClaimSources(claim, entitiesByKey),
    strength: claim.strength,
    text: claim.text,
    type: claim.type,
  }));
}

function resolveClaimSources(
  claim: HealthCommonsClaim,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsWebBiomarkerSourceModel[] {
  return resolveClaimSourceEntities(claim, entitiesByKey).map(toBiomarkerSourceModel);
}

function resolveClaimSourceEntities(
  claim: HealthCommonsClaim,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsCatalogEntity[] {
  return (claim.sourceKeys ?? []).flatMap((sourceKey) => {
    const source = entitiesByKey.get(stripRevision(sourceKey));

    return source?.entityType === "source_artifact" ? [source] : [];
  });
}

function buildBiomarkerSourceHighlights(
  biomarker: HealthCommonsCatalogEntity,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsWebBiomarkerSourceModel[] {
  const claimSourceOrder = new Map<string, number>();
  let nextClaimSourceIndex = 0;
  for (const claim of biomarker.claims ?? []) {
    for (const sourceKey of claim.sourceKeys ?? []) {
      const normalizedSourceKey = stripRevision(sourceKey);
      if (!claimSourceOrder.has(normalizedSourceKey)) {
        claimSourceOrder.set(normalizedSourceKey, nextClaimSourceIndex);
        nextClaimSourceIndex += 1;
      }
    }
  }

  const citedSources = listRelatedEntities({
    entitiesByKey,
    entity: biomarker,
    entityTypes: ["source_artifact"],
    relationTypes: ["cites"],
  });
  const claimSources = (biomarker.claims ?? []).flatMap((claim) =>
    resolveClaimSourceEntities(claim, entitiesByKey)
  );

  return uniqueEntities([...claimSources, ...citedSources])
    .sort((left, right) => compareBiomarkerSourceEntities(left, right, claimSourceOrder))
    .map(toBiomarkerSourceModel);
}

function toBiomarkerSourceModel(sourceEntity: HealthCommonsCatalogEntity): HealthCommonsWebBiomarkerSourceModel {
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
  left: HealthCommonsCatalogEntity,
  right: HealthCommonsCatalogEntity,
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

function resolveBiomarkerSourceSummary(entity: HealthCommonsCatalogEntity): string {
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

function readEntityString(entity: HealthCommonsCatalogEntity, key: string): string | null {
  const value = (entity as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function buildProtocolRankings(
  input: BuildHealthCommonsWebBiomarkerProjectionInput,
): HealthCommonsWebBiomarkerProtocolRankingModel[] {
  const explicitCandidates = input.biomarker.protocolRanking?.candidates ?? [];
  const explicitCandidateByKey = new Map(
    explicitCandidates.map((candidate, index) => [
      stripRevision(candidate.protocolKey),
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
      routeIdByEntityKey: input.routeIdByEntityKey,
    }))
    .sort(compareProtocolRankings);
}

function resolveProtocolCandidates(
  input: BuildHealthCommonsWebBiomarkerProjectionInput,
): HealthCommonsCatalogEntity[] {
  const explicit = (input.biomarker.protocolRanking?.candidates ?? [])
    .flatMap((candidate) => {
      const protocol = input.entitiesByKey.get(stripRevision(candidate.protocolKey));
      return protocol?.entityType === "protocol_variant" ? [protocol] : [];
    });
  const direct = listRelatedEntities({
    entitiesByKey: input.entitiesByKey,
    entity: input.biomarker,
    entityTypes: ["protocol_variant"],
    relationTypes: ["related_protocol"],
  });
  const inverse = [...input.entitiesByKey.values()]
    .filter((entity) => entity.entityType === "protocol_variant")
    .filter((protocol) => protocol.status !== "deprecated")
    .filter((protocol) => hasProtocolBiomarkerRelation(protocol, input.biomarker.key));

  return uniqueEntities([...explicit, ...direct, ...inverse]);
}

function toProtocolRanking(input: {
  biomarker: HealthCommonsCatalogEntity;
  explicitCandidate: HealthCommonsBiomarkerProtocolCandidate | null;
  explicitCandidateIndex: number | null;
  protocol: HealthCommonsCatalogEntity;
  routeIdByEntityKey: ReadonlyMap<string, string>;
}): HealthCommonsWebBiomarkerProtocolRankingModel {
  const relationship = input.explicitCandidate?.relationship
    ?? inferProtocolRelationship(input.protocol, input.biomarker);
  const scoring = input.explicitCandidate?.scoring
    ?? fallbackProtocolScoring(input.protocol, relationship);
  const rankScore = scoreProtocol(scoring);
  const confidence = input.explicitCandidate?.display?.confidence ?? confidenceForScore(rankScore);

  return {
    burdenLabel: input.explicitCandidate?.display?.burdenLabel
      ?? labelForPenalty(scoring.burdenPenalty),
    cautionLabel: input.explicitCandidate?.display?.cautionLabel
      ?? labelForPenalty(scoring.safetyCautionPenalty),
    category: formatProtocolCategory(input.protocol),
    confidence,
    description: input.protocol.summary ?? summarizeBody(input.protocol.body),
    durationLabel: formatProtocolDurationLabel(input.protocol),
    evidenceLabel: formatEvidenceLabel(input.protocol.quality),
    expectedDirection: input.explicitCandidate?.expectedDirection
      ?? expectedDirectionForBiomarker(input.biomarker),
    expectedSignalLabel: expectedSignalLabelForDirection(
      input.explicitCandidate?.expectedDirection ?? expectedDirectionForBiomarker(input.biomarker),
      input.biomarker,
    ),
    explicitCandidateIndex: input.explicitCandidateIndex,
    fitLabel: fitLabelForConfidence(confidence),
    href: `/experiments/${toProtocolExperimentRouteId(input.protocol, input.routeIdByEntityKey)}`,
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
  left: HealthCommonsWebBiomarkerProtocolRankingModel,
  right: HealthCommonsWebBiomarkerProtocolRankingModel,
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
  protocol: HealthCommonsCatalogEntity,
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
  protocol: HealthCommonsCatalogEntity,
  biomarker: HealthCommonsCatalogEntity,
): HealthCommonsBiomarkerProtocolRelationship {
  const inverse = protocol.relations?.find((relation) =>
    stripRevision(relation.target) === biomarker.key && isProtocolBiomarkerRelationType(relation.type)
  );

  if (inverse?.type === "primary_biomarker" || inverse?.type === "secondary_biomarker") {
    return inverse.type;
  }

  const direct = biomarker.relations?.find((relation) =>
    relation.type === "related_protocol" && stripRevision(relation.target) === protocol.key
  );

  return direct ? "related_protocol" : "manual_candidate";
}

function hasProtocolBiomarkerRelation(protocol: HealthCommonsCatalogEntity, biomarkerKey: string): boolean {
  return protocol.relations?.some((relation) =>
    stripRevision(relation.target) === biomarkerKey
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

function protocolBurdenPenalty(protocol: HealthCommonsCatalogEntity): number {
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

function protocolSafetyPenalty(protocol: HealthCommonsCatalogEntity): number {
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

function fitLabelForConfidence(confidence: "high" | "medium" | "low" | "unknown"):
  "High" | "Medium" | "Low" | "Unknown" {
  switch (confidence) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "unknown":
      return "Unknown";
  }
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
  biomarker: HealthCommonsCatalogEntity,
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

function expectedSignalLabelForDirection(
  direction: HealthCommonsBiomarkerProtocolExpectedDirection,
  biomarker: HealthCommonsCatalogEntity,
): string {
  const shortName = resolveHealthCommonsWebBiomarkerShortName(biomarker);

  switch (direction) {
    case "up":
      return `Higher ${shortName}`;
    case "up_or_stable":
      return `Higher or stable ${shortName}`;
    case "down":
      return `Lower ${shortName}`;
    case "down_or_stable":
      return `Lower or stable ${shortName}`;
    case "stable":
      return `Stable ${shortName}`;
    case "mixed_or_contextual":
      return `Contextual ${shortName}`;
  }
}

function toProtocolExperimentRouteId(
  protocol: HealthCommonsCatalogEntity,
  routeIdByEntityKey: ReadonlyMap<string, string>,
): string {
  return routeIdByEntityKey.get(protocol.key) ?? toTrailingRouteId(protocol.slug);
}

function formatProtocolDurationLabel(protocol: HealthCommonsCatalogEntity): string {
  const days = protocol.testPlans?.[0]?.durationDays
    ?? protocol.protocol?.interventionSessionsTarget
    ?? 14;

  return days === 1 ? "1 day" : `${days} days`;
}

function formatEvidenceLabel(quality: string | undefined): string {
  switch (quality) {
    case "excellent":
      return "Excellent";
    case "reviewed":
      return "Reviewed";
    case "usable":
      return "Usable";
    case "stub":
      return "Early";
    case undefined:
      return "Mapped";
    default:
      return formatWords(quality);
  }
}

function formatProtocolCategory(protocol: HealthCommonsCatalogEntity): string {
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

function listRelatedEntities(input: {
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  entity: HealthCommonsCatalogEntity;
  entityTypes?: readonly string[];
  relationTypes?: readonly string[];
}): HealthCommonsCatalogEntity[] {
  const entityTypeSet = input.entityTypes ? new Set(input.entityTypes) : null;
  const relationTypeSet = input.relationTypes ? new Set(input.relationTypes) : null;

  return (input.entity.relations ?? []).flatMap((relation) => {
    if (relationTypeSet && !relationTypeSet.has(relation.type)) {
      return [];
    }

    const target = input.entitiesByKey.get(stripRevision(relation.target));
    if (!target) {
      return [];
    }

    if (entityTypeSet && !entityTypeSet.has(target.entityType)) {
      return [];
    }

    return [target];
  });
}

function uniqueEntities(entities: readonly HealthCommonsCatalogEntity[]): HealthCommonsCatalogEntity[] {
  const seen = new Set<string>();
  const unique: HealthCommonsCatalogEntity[] = [];

  for (const entity of entities) {
    if (seen.has(entity.key)) {
      continue;
    }

    seen.add(entity.key);
    unique.push(entity);
  }

  return unique;
}

function summarizeBody(body: string): string {
  const firstParagraph = body.split(/\n\s*\n/u).find((paragraph) => paragraph.trim().length > 0);
  return firstParagraph?.replace(/\s+/gu, " ").trim() ?? "Health Commons page.";
}

function toTrailingRouteId(slug: string): string {
  return slug.split("/").at(-1) ?? slug;
}

function formatSourceKind(value: string): string {
  return formatWords(value.replace(/_/gu, " "));
}

function formatWords(value: string): string {
  return value
    .split(/[-_\s/]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
}
