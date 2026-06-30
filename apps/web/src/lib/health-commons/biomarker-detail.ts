import type {
  HealthCommonsBiomarkerCommunityOutcomeSummary,
  HealthCommonsBiomarkerExplainerCard,
  HealthCommonsBiomarkerPrivateMetricBinding,
  HealthCommonsBiomarkerProtocolExpectedDirection,
  HealthCommonsBiomarkerTrendAggregation,
  HealthCommonsClaim,
  HealthCommonsExpectedSignalDescription,
  HealthCommonsExpectedSignalEstimate,
  HealthCommonsInterpretationFrame,
  HealthCommonsSource,
} from "@murphai/contracts";
import {
  createHealthCommonsRouteBundleReader,
  loadGeneratedHealthCommonsWebRouteBundle,
  type HealthCommonsCatalogReader,
  type HealthCommonsEntity,
} from "@murphai/health-commons/runtime";
import { getGeneratedBiomarkerIndex } from "./generated-biomarker-artifacts";
import {
  cleanHealthCommonsUserFacingCopy,
  cleanHealthCommonsUserFacingCopyList,
  cleanOptionalHealthCommonsUserFacingCopy,
} from "./user-facing-copy";

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

const BIOMARKER_ROUTE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "deep-sleep": "deep-sleep-minutes",
  hrv: "hrv-rmssd",
  rem: "rem-sleep-minutes",
  rhr: "resting-heart-rate",
});

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

export type BiomarkerAboutIconKey = "howToMeasure" | "whatMovesIt" | "whyPeopleCare";

export interface BiomarkerAboutItemModel {
  body: string;
  iconKey: BiomarkerAboutIconKey;
  title: string;
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
  description: string;
  durationLabel: string;
  evidenceLabel: string;
  expectedDirection: HealthCommonsBiomarkerProtocolExpectedDirection;
  expectedSignalLabel: string;
  fitLabel: string;
  href: string;
  key: string;
  mechanism: string;
  title: string;
}

interface ScoredBiomarkerProtocolRankingModel {
  model: BiomarkerProtocolRankingModel;
  rankScore: number;
}

export interface BiomarkerPageModel {
  aliases: string[];
  about: BiomarkerAboutItemModel[];
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
  catalog?: HealthCommonsCatalogReader,
): string[] {
  if (!catalog) {
    return getGeneratedBiomarkerIndex()
      .biomarkers
      .filter((entry) => entry.published)
      .map((entry) => entry.routeId)
      .sort();
  }

  return catalog
    .listByEntityType("biomarker")
    .filter((entity) => isPublishedBiomarker(entity, catalog))
    .map((entity) => toTrailingRouteId(entity.slug))
    .sort();
}

export function resolveHealthCommonsBiomarkerDetail(
  biomarkerId: string,
  catalog?: HealthCommonsCatalogReader,
): BiomarkerPageModel | null {
  const routeId = resolveBiomarkerRouteId(biomarkerId);

  if (!catalog) {
    const bundle = loadGeneratedHealthCommonsWebRouteBundle({
      entityType: "biomarker",
      routeId,
    });
    if (!bundle) {
      return null;
    }
    const reader = createHealthCommonsRouteBundleReader(bundle);
    const biomarker = reader.findByKey(bundle.primaryKey);

    if (!isPublishedBiomarker(biomarker, reader)) {
      return null;
    }

    return toBiomarkerPageModel(biomarker, reader);
  }

  const biomarker = catalog.findByRouteId({
    entityType: "biomarker",
    routeId,
  });

  if (!biomarker || biomarker.entityType !== "biomarker") {
    return null;
  }

  if (!isPublishedBiomarker(biomarker, catalog)) {
    return null;
  }

  return toBiomarkerPageModel(biomarker, catalog);
}

function resolveBiomarkerRouteId(biomarkerId: string): string {
  const normalized = normalizeRouteId(biomarkerId);
  return BIOMARKER_ROUTE_ALIASES[normalized] ?? normalized;
}

function toBiomarkerPageModel(
  biomarker: HealthCommonsEntity,
  catalog: HealthCommonsCatalogReader,
): BiomarkerPageModel {
  const biomarkerSpec = biomarker.biomarker;

  return {
    aliases: biomarker.aliases ?? [],
    about: buildBiomarkerAbout(biomarkerSpec?.explainerCards ?? []),
    body: cleanHealthCommonsUserFacingCopy(biomarker.body),
    catalogHash: catalog.catalogHash,
    categories: biomarker.categories ?? [],
    claims: buildBiomarkerClaims(biomarker, catalog),
    communityOutcomeSummary: cleanCommunityOutcomeSummary(biomarker.communityOutcomeSummary ?? {
      minimumCohortSize: 20,
      placeholder: "Community outcome summaries will appear once enough opted-in Murph runs are available.",
      state: "coming_soon",
    }),
    explainerCards: cleanExplainerCards(
      biomarkerSpec?.explainerCards ?? fallbackExplainerCards(biomarker),
    ),
    interpretationFrame: cleanInterpretationFrame(biomarker.interpretationFrame ?? {
      caveat: "Compare this biomarker against your own baseline and keep obvious confounders visible.",
      principle: "Trend beats a single value.",
    }),
    key: biomarker.key,
    measurement: {
      bestContext: cleanHealthCommonsUserFacingCopy(biomarkerSpec?.measurement?.bestContext
        ?? "Use the most consistent available measurement context.",
      ),
      confounders: cleanHealthCommonsUserFacingCopyList(
        biomarkerSpec?.measurement?.confounders ?? [],
      ),
      howToMeasure: cleanHealthCommonsUserFacingCopyList(biomarkerSpec?.measurement?.howToMeasure ?? [
        "Use the same device or method when comparing before and after windows.",
        "Prefer window averages over one-off readings.",
      ]),
    },
    measurementContexts: cleanHealthCommonsUserFacingCopyList(biomarker.measurementContexts ?? []),
    pageRevisionId: biomarker.revision.pageRevisionId,
    privateMetricBindings: biomarkerSpec?.privateMetricBindings ?? [],
    protocolRankings: buildProtocolRankings({ biomarker, catalog }),
    qualityLabel: formatQualityLabel(biomarker.quality),
    routeId: toTrailingRouteId(biomarker.slug),
    shortName: cleanHealthCommonsUserFacingCopy(
      biomarkerSpec?.shortName ?? biomarker.aliases?.[0] ?? biomarker.title,
    ),
    slug: biomarker.slug,
    sourceHighlights: buildBiomarkerSourceHighlights(biomarker, catalog),
    statusLabel: formatStatusLabel(biomarker.status),
    summary: cleanHealthCommonsUserFacingCopy(biomarker.summary ?? summarizeBody(biomarker.body)),
    title: cleanHealthCommonsUserFacingCopy(biomarkerSpec?.displayName ?? biomarker.title),
    trendDefaults: biomarkerSpec?.trendDefaults ?? DEFAULT_TREND_DEFAULTS,
    unit: biomarkerSpec?.unit ?? biomarker.unit ?? "value",
    valuePrecision: biomarkerSpec?.valuePrecision ?? 0,
  };
}

function isPublishedBiomarker(
  entity: HealthCommonsEntity | null,
  catalog: HealthCommonsCatalogReader,
): entity is HealthCommonsEntity & { entityType: "biomarker" } {
  return entity?.entityType === "biomarker"
    && entity.status !== "deprecated"
    && entity.hidden !== true
    && hasCompleteBiomarkerAbout(entity)
    && (entity.biomarker?.measurement?.howToMeasure?.length ?? 0) > 0
    && hasProtocolExpectedSignalCandidate(catalog, entity.key)
    && entity.communityOutcomeSummary != null;
}

function buildBiomarkerClaims(
  biomarker: HealthCommonsEntity,
  catalog: HealthCommonsCatalogReader,
): BiomarkerClaimModel[] {
  return (biomarker.claims ?? []).map((claim) => ({
    claimId: claim.claimId,
    sourceKeys: claim.sourceKeys ?? [],
    sources: resolveClaimSources(claim, catalog),
    strength: claim.strength,
    caveats: cleanHealthCommonsUserFacingCopyList(claim.caveats ?? []),
    text: cleanHealthCommonsUserFacingCopy(claim.text),
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
    summary: cleanHealthCommonsUserFacingCopy(resolveBiomarkerSourceSummary(sourceEntity)),
    title: cleanHealthCommonsUserFacingCopy(source?.title ?? sourceEntity.title),
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
  return resolveProtocolCandidates(input)
    .map((candidate) => toProtocolRanking({
      biomarker: input.biomarker,
      protocol: candidate.protocol,
      signal: candidate.signal,
    }))
    .sort(compareProtocolRankings)
    .map((ranking) => ranking.model);
}

function resolveProtocolCandidates(input: {
  biomarker: HealthCommonsEntity;
  catalog: HealthCommonsCatalogReader;
}): Array<{ protocol: HealthCommonsEntity; signal: HealthCommonsExpectedSignalDescription }> {
  return input.catalog
    .listByEntityType("protocol_variant")
    .filter(isRankableProtocolVariant)
    .flatMap((protocol) => {
      const signal = findExpectedSignalForBiomarker(protocol, input.biomarker.key);
      return signal ? [{ protocol, signal }] : [];
    });
}

function toProtocolRanking(input: {
  biomarker: HealthCommonsEntity;
  protocol: HealthCommonsEntity;
  signal: HealthCommonsExpectedSignalDescription;
}): ScoredBiomarkerProtocolRankingModel {
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
      description: cleanHealthCommonsUserFacingCopy(
        input.protocol.summary ?? summarizeBody(input.protocol.body),
      ),
      durationLabel: input.signal.estimatedChange?.window ?? "—",
      evidenceLabel: evidenceLabelForSignal(input.signal, input.protocol),
      expectedDirection,
      expectedSignalLabel: formatExpectedSignalLabel(input.signal, expectedDirection),
      fitLabel: fitLabelForScore(rankScore),
      href: `/experiments/${toProtocolExperimentRouteId(input.protocol)}`,
      key: input.protocol.key,
      mechanism: cleanHealthCommonsUserFacingCopy(input.signal.description),
      title: cleanHealthCommonsUserFacingCopy(input.protocol.title),
    },
  };
}

function cleanExplainerCards(
  cards: readonly HealthCommonsBiomarkerExplainerCard[],
): HealthCommonsBiomarkerExplainerCard[] {
  return cards.map((card) => ({
    ...card,
    body: cleanHealthCommonsUserFacingCopy(card.body),
    title: cleanHealthCommonsUserFacingCopy(card.title),
  }));
}

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

function buildBiomarkerAbout(
  cards: readonly HealthCommonsBiomarkerExplainerCard[],
): BiomarkerAboutItemModel[] {
  return BIOMARKER_ABOUT_SLOTS.flatMap((slot) => {
    const card = cards.find((candidate) =>
      slot.normalizedTitles.includes(normalizeAboutTitle(candidate.title))
    );

    if (!card) {
      return [];
    }

    return [{
      body: cleanHealthCommonsUserFacingCopy(card.body),
      iconKey: slot.iconKey,
      title: cleanHealthCommonsUserFacingCopy(card.title),
    }];
  });
}

function normalizeAboutTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function hasCompleteBiomarkerAbout(entity: HealthCommonsEntity): boolean {
  return buildBiomarkerAbout(entity.biomarker?.explainerCards ?? []).length ===
    BIOMARKER_ABOUT_SLOTS.length;
}

function cleanInterpretationFrame(
  frame: HealthCommonsInterpretationFrame,
): HealthCommonsInterpretationFrame {
  return {
    caveat: cleanHealthCommonsUserFacingCopy(frame.caveat),
    principle: cleanHealthCommonsUserFacingCopy(frame.principle),
  };
}

function cleanCommunityOutcomeSummary(
  summary: HealthCommonsBiomarkerCommunityOutcomeSummary,
): HealthCommonsBiomarkerCommunityOutcomeSummary {
  const placeholder = cleanOptionalHealthCommonsUserFacingCopy(summary.placeholder);

  return {
    ...summary,
    ...(placeholder ? { placeholder } : {}),
  };
}

function compareProtocolRankings(
  left: ScoredBiomarkerProtocolRankingModel,
  right: ScoredBiomarkerProtocolRankingModel,
): number {
  const scoreDelta = right.rankScore - left.rankScore;
  return scoreDelta === 0 ? left.model.title.localeCompare(right.model.title) : scoreDelta;
}

function isRankableProtocolVariant(protocol: HealthCommonsEntity): boolean {
  return protocol.entityType === "protocol_variant"
    && protocol.status !== "deprecated"
    && protocol.hidden !== true;
}

function hasProtocolExpectedSignalCandidate(
  catalog: HealthCommonsCatalogReader,
  biomarkerKey: string,
): boolean {
  return catalog
    .listByEntityType("protocol_variant")
    .filter(isRankableProtocolVariant)
    .some((protocol) => findExpectedSignalForBiomarker(protocol, biomarkerKey) !== null);
}

function findExpectedSignalForBiomarker(
  protocol: HealthCommonsEntity,
  biomarkerKey: string,
): HealthCommonsExpectedSignalDescription | null {
  return protocol.expectedSignalDescriptions?.find((signal) =>
    signal.biomarkerKey === biomarkerKey
  ) ?? null;
}

function scoreProtocolCandidate(input: {
  biomarker: HealthCommonsEntity;
  protocol: HealthCommonsEntity;
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

function testPlanBiomarkerScore(protocol: HealthCommonsEntity, biomarkerKey: string): number {
  let score = 0;

  for (const plan of protocol.testPlans ?? []) {
    if (plan.primaryBiomarkerKey === biomarkerKey) {
      score = Math.max(score, 10);
    }
    if ((plan.secondaryBiomarkerKeys ?? []).includes(biomarkerKey)) {
      score = Math.max(score, 5);
    }
    if ((plan.safetyOutcomeKeys ?? []).includes(biomarkerKey)) {
      score = Math.max(score, 2);
    }
  }

  return score;
}

function relationBiomarkerScore(protocol: HealthCommonsEntity, biomarkerKey: string): number {
  let score = 0;

  for (const relation of protocol.relations ?? []) {
    if (relation.target !== biomarkerKey) {
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
  protocol: HealthCommonsEntity,
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

function fitLabelForScore(score: number): string {
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

function formatExpectedSignalLabel(
  signal: HealthCommonsExpectedSignalDescription,
  direction: HealthCommonsBiomarkerProtocolExpectedDirection,
): string {
  return signal.displayValue
    ?? formatEstimatedChangeRange(signal.estimatedChange, signal)
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

function labelForPenalty(value: number): string {
  if (value >= 4) {
    return "High";
  }

  if (value >= 2) {
    return "Moderate";
  }

  return "Low";
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
  return protocol.preferredRouteId ?? toTrailingRouteId(protocol.slug);
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
