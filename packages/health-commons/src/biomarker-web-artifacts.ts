import type {
  HealthCommonsBiomarkerCommunityOutcomeSummary,
  HealthCommonsBiomarkerExplainerCard,
  HealthCommonsBiomarkerPrivateMetricBinding,
  HealthCommonsBiomarkerReferenceGuidance,
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
  referenceGuidance: HealthCommonsBiomarkerReferenceGuidance | null;
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

export function resolveHealthCommonsWebBiomarkerMetricFields(
  biomarker: HealthCommonsCatalogEntity,
): Pick<HealthCommonsWebBiomarkerOverview, "privateMetricBindings" | "valuePrecision"> {
  return {
    privateMetricBindings: biomarker.biomarker?.privateMetricBindings ?? [],
    valuePrecision: biomarker.biomarker?.valuePrecision ?? 0,
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
    ...resolveHealthCommonsWebBiomarkerMetricFields(input.biomarker),
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
    referenceGuidance: input.biomarker.referenceGuidance ?? null,
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
