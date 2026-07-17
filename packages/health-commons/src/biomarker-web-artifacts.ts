import type {
  HealthCommonsBiomarkerCommunityOutcomeSummary,
  HealthCommonsBiomarkerExplainerCard,
  HealthCommonsBiomarkerPrivateMetricBinding,
  HealthCommonsBiomarkerProtocolExpectedDirection,
  HealthCommonsBiomarkerTrendAggregation,
  HealthCommonsCatalogEntity,
  HealthCommonsClaim,
  HealthCommonsExpectedSignalDescription,
  HealthCommonsExpectedSignalEstimate,
  HealthCommonsSource,
  StoredMedia,
} from "@murphai/contracts";

import { isRunnableProtocolStatus } from "./protocol-publishing.ts";

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
  description: string;
  durationLabel: string;
  evidenceLabel: string;
  expectedDirection: HealthCommonsBiomarkerProtocolExpectedDirection;
  expectedSignalLabel: string;
  fitLabel: "Context" | "Exploratory" | "Good" | "Strong";
  href: string;
  image: string | null;
  key: string;
  mechanism: string;
  title: string;
}

interface ScoredHealthCommonsWebBiomarkerProtocolRankingModel {
  model: HealthCommonsWebBiomarkerProtocolRankingModel;
  rankScore: number;
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

type BiomarkerAboutIconKey = HealthCommonsWebBiomarkerAboutItem["iconKey"];

const BIOMARKER_ABOUT_SLOTS: Array<{
  iconKey: BiomarkerAboutIconKey;
  normalizedTitles: readonly string[];
}> = [
  {
    iconKey: "whyPeopleCare",
    normalizedTitles: ["why murph uses it", "why people care", "why it matters"],
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
    protocolRankingFormula: "signalProminence + testPlanBiomarker + relationBiomarker + signalEvidence + estimatedChangeClarity + quality - burdenPenalty - safetyCautionPenalty",
    protocolRankingVersion: "expected-signal-v1",
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
    externalUrl: safeExternalHttpUrl(source?.url),
    key: sourceEntity.key,
    summary: resolveBiomarkerSourceSummary(sourceEntity),
    title: source?.title ?? sourceEntity.title,
    typeLabel: formatSourceKind(source?.kind ?? sourceEntity.entityType),
    year: source?.year ?? null,
  };
}

function safeExternalHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
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
  return resolveProtocolCandidates(input)
    .map((candidate) => toProtocolRanking({
      biomarker: input.biomarker,
      protocol: candidate.protocol,
      routeIdByEntityKey: input.routeIdByEntityKey,
      signal: candidate.signal,
    }))
    .sort(compareProtocolRankings)
    .map((ranking) => ranking.model);
}

function resolveProtocolCandidates(
  input: BuildHealthCommonsWebBiomarkerProjectionInput,
): Array<{ protocol: HealthCommonsCatalogEntity; signal: HealthCommonsExpectedSignalDescription }> {
  return [...input.entitiesByKey.values()]
    .filter((entity) => entity.entityType === "protocol_variant")
    .filter(isRankableProtocolVariant)
    .flatMap((protocol) => {
      const signal = findExpectedSignalForBiomarker(protocol, input.biomarker.key);
      return signal ? [{ protocol, signal }] : [];
    });
}

function toProtocolRanking(input: {
  biomarker: HealthCommonsCatalogEntity;
  protocol: HealthCommonsCatalogEntity;
  routeIdByEntityKey: ReadonlyMap<string, string>;
  signal: HealthCommonsExpectedSignalDescription;
}): ScoredHealthCommonsWebBiomarkerProtocolRankingModel {
  const burdenPenalty = protocolBurdenPenalty(input.protocol);
  const safetyPenalty = protocolSafetyPenalty(input.protocol);
  const expectedDirection = input.signal.expectedDirection
    ?? expectedDirectionForBiomarker(input.biomarker);
  const rankScore = scoreProtocolCandidate({
    biomarker: input.biomarker,
    protocol: input.protocol,
    signal: input.signal,
  });

  return {
    rankScore,
    model: {
      burdenLabel: labelForPenalty(burdenPenalty),
      cautionLabel: labelForPenalty(safetyPenalty),
      category: formatProtocolCategory(input.protocol),
      description: input.protocol.summary ?? summarizeBody(input.protocol.body),
      durationLabel: input.signal.estimatedChange?.window ?? "--",
      evidenceLabel: evidenceLabelForSignal(input.signal, input.protocol),
      expectedDirection,
      expectedSignalLabel: formatExpectedSignalLabel(input.signal, expectedDirection),
      fitLabel: fitLabelForScore(rankScore),
      href: `/experiments/${toProtocolExperimentRouteId(input.protocol, input.routeIdByEntityKey)}`,
      image: resolveProtocolPageImage(input.protocol),
      key: input.protocol.key,
      mechanism: input.signal.description,
      title: input.protocol.title,
    },
  };
}

function compareProtocolRankings(
  left: ScoredHealthCommonsWebBiomarkerProtocolRankingModel,
  right: ScoredHealthCommonsWebBiomarkerProtocolRankingModel,
): number {
  const scoreDelta = right.rankScore - left.rankScore;
  return scoreDelta === 0 ? left.model.title.localeCompare(right.model.title) : scoreDelta;
}

function isRankableProtocolVariant(protocol: HealthCommonsCatalogEntity): boolean {
  return protocol.entityType === "protocol_variant"
    && isRunnableProtocolStatus(protocol.status)
    && protocol.hidden !== true;
}

function findExpectedSignalForBiomarker(
  protocol: HealthCommonsCatalogEntity,
  biomarkerKey: string,
): HealthCommonsExpectedSignalDescription | null {
  return protocol.expectedSignalDescriptions?.find((signal) =>
    stripRevision(signal.biomarkerKey) === biomarkerKey
  ) ?? null;
}

function scoreProtocolCandidate(input: {
  biomarker: HealthCommonsCatalogEntity;
  protocol: HealthCommonsCatalogEntity;
  signal: HealthCommonsExpectedSignalDescription;
}): number {
  return signalProminenceScore(input.signal)
    + testPlanBiomarkerScore(input.protocol, input.biomarker.key)
    + relationBiomarkerScore(input.protocol, input.biomarker.key)
    + signalEvidenceScore(input.signal)
    + estimatedChangeClarityScore(input.signal.estimatedChange)
    + (QUALITY_SCORE[input.protocol.quality ?? ""] ?? 2)
    - protocolBurdenPenalty(input.protocol)
    - protocolSafetyPenalty(input.protocol);
}

function signalProminenceScore(signal: HealthCommonsExpectedSignalDescription): number {
  return signal.protocolProminence === "focus" ? 12 : 4;
}

function testPlanBiomarkerScore(protocol: HealthCommonsCatalogEntity, biomarkerKey: string): number {
  let score = 0;

  for (const plan of protocol.testPlans ?? []) {
    if (stripRevision(plan.primaryBiomarkerKey) === biomarkerKey) {
      score = Math.max(score, 10);
    }
    if ((plan.secondaryBiomarkerKeys ?? []).some((key) => stripRevision(key) === biomarkerKey)) {
      score = Math.max(score, 5);
    }
    if ((plan.safetyOutcomeKeys ?? []).some((key) => stripRevision(key) === biomarkerKey)) {
      score = Math.max(score, 2);
    }
  }

  return score;
}

function relationBiomarkerScore(protocol: HealthCommonsCatalogEntity, biomarkerKey: string): number {
  let score = 0;

  for (const relation of protocol.relations ?? []) {
    if (stripRevision(relation.target) !== biomarkerKey) {
      continue;
    }

    if (relation.type === "primary_biomarker") {
      score = Math.max(score, 6);
    } else if (relation.type === "secondary_biomarker") {
      score = Math.max(score, 3);
    } else if (relation.type === "related_protocol") {
      score = Math.max(score, 1);
    }
  }

  return score;
}

function signalEvidenceScore(signal: HealthCommonsExpectedSignalDescription): number {
  switch (signal.estimatedChange?.confidence) {
    case "high":
      return 8;
    case "moderate":
      return 6;
    case "mixed":
      return 4;
    case "low":
      return 3;
    case undefined:
      return 2;
  }
}

function estimatedChangeClarityScore(
  estimate: HealthCommonsExpectedSignalEstimate | undefined,
): number {
  if (!estimate) {
    return 0;
  }

  return estimate.kind === "mixed_or_contextual" ? 0 : 3;
}

function evidenceLabelForSignal(
  signal: HealthCommonsExpectedSignalDescription,
  protocol: HealthCommonsCatalogEntity,
): string {
  switch (signal.estimatedChange?.confidence) {
    case "high":
      return "High";
    case "moderate":
      return "Moderate";
    case "mixed":
      return "Variable";
    case "low":
      return "Low";
    case undefined:
      return evidenceLabelForQuality(protocol.quality);
  }
}

function evidenceLabelForQuality(quality: string | undefined): string {
  switch (quality) {
    case "excellent":
      return "High";
    case "reviewed":
      return "Moderate";
    case "usable":
      return "Low";
    case "stub":
    case undefined:
      return "Unknown";
    default:
      return "Unknown";
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

function fitLabelForScore(score: number): "Context" | "Exploratory" | "Good" | "Strong" {
  if (score >= 32) {
    return "Strong";
  }

  if (score >= 24) {
    return "Good";
  }

  if (score >= 16) {
    return "Context";
  }

  return "Exploratory";
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

function formatExpectedSignalLabel(
  signal: HealthCommonsExpectedSignalDescription,
  direction: HealthCommonsBiomarkerProtocolExpectedDirection,
): string {
  return formatEstimatedChangeRange(signal.estimatedChange, signal)
    ?? normalizeExpectedSignalLabel(signal.expected)
    ?? formatExpectedDirection(direction);
}

function formatEstimatedChangeRange(
  estimate: HealthCommonsExpectedSignalEstimate | undefined,
  signal: HealthCommonsExpectedSignalDescription,
): string | null {
  if (!estimate) {
    return null;
  }

  if (estimate.kind === "mixed_or_contextual") {
    return normalizeExpectedSignalLabel(signal.expected) ?? "Context-dependent";
  }

  const low = formatSignedNumber(estimate.low);
  const high = formatSignedNumber(estimate.high);
  const unit = estimate.kind === "relative_percent" ? "%" : ` ${estimate.unit}`;

  return estimate.low === estimate.high
    ? `${low}${unit}`
    : `${low} to ${high}${unit}`;
}

function normalizeExpectedSignalLabel(expected: string | undefined): string | null {
  switch (expected) {
    case "down":
    case "down_or_stable":
      return "Could trend lower";
    case "up":
    case "up_or_stable":
      return "Could improve";
    case "mixed_or_contextual":
      return "Possible change";
    case "stable":
      return "Should stay stable";
    case undefined:
      return null;
    default:
      return expected;
  }
}

function formatExpectedDirection(
  direction: HealthCommonsBiomarkerProtocolExpectedDirection,
): string {
  switch (direction) {
    case "down":
    case "down_or_stable":
      return "lower";
    case "up":
    case "up_or_stable":
      return "higher";
    case "stable":
      return "stable";
    case "mixed_or_contextual":
      return "varied";
  }
}

function toProtocolExperimentRouteId(
  protocol: HealthCommonsCatalogEntity,
  routeIdByEntityKey: ReadonlyMap<string, string>,
): string {
  return routeIdByEntityKey.get(protocol.key) ?? toTrailingRouteId(protocol.slug);
}

function resolveProtocolPageImage(protocol: HealthCommonsCatalogEntity): string | null {
  const imageEntry = readProtocolMedia(protocol).find(isProtocolImageMedia);

  if (!imageEntry) {
    return null;
  }

  return imageEntry.relativePath.startsWith("/")
    ? imageEntry.relativePath
    : `/${imageEntry.relativePath}`;
}

function readProtocolMedia(protocol: HealthCommonsCatalogEntity): StoredMedia[] {
  const protocolRecord = protocol as Record<string, unknown>;
  const media = protocolRecord["media"];

  if (!Array.isArray(media)) {
    return [];
  }

  return media.filter(isStoredMediaEntry);
}

function isStoredMediaEntry(value: unknown): value is StoredMedia {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  const relativePath = record["relativePath"];
  const caption = record["caption"];

  if (
    kind !== "photo" &&
    kind !== "video" &&
    kind !== "gif" &&
    kind !== "image" &&
    kind !== "other"
  ) {
    return false;
  }

  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return false;
  }

  if (
    record["mediaType"] !== undefined &&
    (typeof record["mediaType"] !== "string" || record["mediaType"].length === 0)
  ) {
    return false;
  }

  return caption === undefined || typeof caption === "string";
}

function isProtocolImageMedia(media: StoredMedia): boolean {
  return (
    media.kind === "photo" ||
    media.kind === "image" ||
    media.mediaType?.startsWith("image/") === true
  );
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

function formatSignedNumber(value: number): string {
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }

  return formatNumber(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toString();
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
