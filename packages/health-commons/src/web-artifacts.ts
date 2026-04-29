import type {
  HealthCommonsCatalog,
  HealthCommonsCatalogEntity,
  HealthCommonsEntityType,
  HealthCommonsEvidenceAppraisal,
  HealthCommonsRedirect,
  HealthCommonsRelation,
} from "@murphai/contracts";

export const HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION =
  "murph.commons.web.route-index.v1" as const;
export const HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION =
  "murph.commons.web.route-bundle.v1" as const;
export const HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION =
  "murph.commons.web.experiment-index.v1" as const;
export const HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION =
  "murph.commons.web.biomarker-index.v1" as const;

const SOURCE_SNIPPET_FINDING_MAX_LENGTH = 1_000;
const ROUTE_BUNDLE_REVERSE_RELATION_TYPES = new Set<string>([
  "alias_of",
  "child_family",
  "contraindicates",
  "default_measurement_method",
  "measures",
  "measurement_upgrade",
  "optional_measurement_method",
  "parent_family",
  "primary_biomarker",
  "related_protocol",
  "secondary_biomarker",
  "safety_outcome",
]);

export interface HealthCommonsWebRouteIndexEntry {
  aliases: string[];
  bundlePath: string;
  entityType: HealthCommonsEntityType;
  key: string;
  routeId: string;
  slug: string;
}

export interface HealthCommonsWebRouteIndex {
  catalogHash: string;
  routes: HealthCommonsWebRouteIndexEntry[];
  schemaVersion: typeof HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsWebRevisionRef {
  pageRevisionId: string;
  recipeHash?: string | null;
  runSpecRevisionId?: string | null;
}

export interface HealthCommonsWebReverseRelation {
  relation: HealthCommonsRelation;
  sourceKey: string;
}

export interface HealthCommonsWebSourceSnippet {
  citation?: string | null;
  finding?: string | null;
  key: string;
  title: string;
  url?: string | null;
  year?: number | null;
}

export interface HealthCommonsWebRouteBundle {
  catalogHash: string;
  entitiesByKey: Record<string, HealthCommonsCatalogEntity>;
  evidenceAppraisals: HealthCommonsEvidenceAppraisal[];
  primaryKey: string;
  redirects: HealthCommonsRedirect[];
  reverseEdges: HealthCommonsWebReverseRelation[];
  revisionManifest: Record<string, HealthCommonsWebRevisionRef>;
  route: {
    aliases: string[];
    entityType: HealthCommonsEntityType;
    routeId: string;
    slug: string;
  };
  schemaVersion: typeof HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION;
  sourceSnippets: Record<string, HealthCommonsWebSourceSnippet>;
}

export interface HealthCommonsWebExperimentIndexEntry {
  aliases: string[];
  baselineDays: number;
  bundlePath: string;
  categories: string[];
  category: string;
  description: string;
  durationDays: number;
  evidenceLabel: string;
  evidenceLevel: number;
  hidden: boolean;
  image: string | null;
  key: string;
  quality: string | null;
  revision: HealthCommonsWebRevisionRef;
  routeId: string;
  slug: string;
  status: string | null;
  studyCount: number;
  summary: string | null;
  title: string;
}

export interface HealthCommonsWebExperimentIndex {
  catalogHash: string;
  experiments: HealthCommonsWebExperimentIndexEntry[];
  schemaVersion: typeof HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsWebBiomarkerIndexEntry {
  aliases: string[];
  bundlePath: string;
  categories: string[];
  hidden: boolean;
  key: string;
  published: boolean;
  quality: string | null;
  revision: HealthCommonsWebRevisionRef;
  routeId: string;
  slug: string;
  status: string | null;
  summary: string | null;
  title: string;
  unit: string | null;
}

export interface HealthCommonsWebBiomarkerIndex {
  biomarkers: HealthCommonsWebBiomarkerIndexEntry[];
  catalogHash: string;
  schemaVersion: typeof HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsWebGeneratedArtifacts {
  biomarkerIndex: HealthCommonsWebBiomarkerIndex;
  experimentIndex: HealthCommonsWebExperimentIndex;
  routeBundles: Map<string, HealthCommonsWebRouteBundle>;
  routeIndex: HealthCommonsWebRouteIndex;
}

const WEB_BUNDLE_ENTITY_TYPES = new Set<HealthCommonsEntityType>([
  "biomarker",
  "measurement_method",
  "protocol_variant",
]);

export function buildHealthCommonsWebGeneratedArtifacts(
  catalog: HealthCommonsCatalog,
): HealthCommonsWebGeneratedArtifacts {
  const entitiesByKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const redirectsByTarget = new Map<string, HealthCommonsRedirect[]>();

  for (const redirect of catalog.redirects) {
    const target = resolveRedirectTarget(redirect.to, catalog.redirects);
    const existing = redirectsByTarget.get(target) ?? [];
    existing.push(redirect);
    redirectsByTarget.set(target, existing);
  }

  const routeBundles = new Map<string, HealthCommonsWebRouteBundle>();
  const routeEntries: HealthCommonsWebRouteIndexEntry[] = [];
  const routeEntryKeys = new Map<string, HealthCommonsWebRouteIndexEntry>();

  for (const entity of catalog.entities) {
    if (!WEB_BUNDLE_ENTITY_TYPES.has(entity.entityType)) {
      continue;
    }

    const routeIds = buildEntityRouteIds(entity, redirectsByTarget.get(entity.key) ?? []);
    const routeId = selectPrimaryRouteId(entity, routeIds);
    const bundlePath = bundlePathForEntity(entity.entityType, routeId);
    const aliases = routeIds.filter((candidate) => candidate !== routeId);
    if (routeBundles.has(bundlePath)) {
      throw new Error(`Duplicate Health Commons web bundle path generated for ${bundlePath}.`);
    }
    const bundle = buildRouteBundle({
      catalog,
      entitiesByKey,
      primary: entity,
      redirects: catalog.redirects,
      routeAliases: aliases,
      routeId,
    });

    routeBundles.set(bundlePath, bundle);
    for (const alias of routeIds) {
      const entry = {
        aliases,
        bundlePath,
        entityType: entity.entityType,
        key: entity.key,
        routeId: alias,
        slug: entity.slug,
      };
      const routeEntryKey = `${entry.entityType}:${entry.routeId}`;
      const existing = routeEntryKeys.get(routeEntryKey);
      if (existing) {
        throw new Error(
          `Duplicate Health Commons web route id generated for ${routeEntryKey}: ${existing.key} (${existing.bundlePath}) and ${entry.key} (${entry.bundlePath}).`,
        );
      }

      routeEntryKeys.set(routeEntryKey, entry);
      routeEntries.push(entry);
    }
  }

  routeEntries.sort(compareRouteEntries);

  return {
    biomarkerIndex: {
      biomarkers: [...routeBundles.values()]
        .filter((bundle) => bundle.route.entityType === "biomarker")
        .flatMap((bundle) => {
          const entity = entitiesByKey.get(bundle.primaryKey);
          if (!entity) {
            return [];
          }
          return [{
            aliases: bundle.route.aliases,
            bundlePath: bundlePathForEntity(bundle.route.entityType, bundle.route.routeId),
            categories: entity.categories ?? [],
            hidden: entity.hidden === true,
            key: entity.key,
            published: isPublishedBiomarkerIndexEntity(entity),
            quality: entity.quality ?? null,
            revision: revisionRefForEntity(entity),
            routeId: bundle.route.routeId,
            slug: entity.slug,
            status: entity.status ?? null,
            summary: entity.summary ?? null,
            title: entity.biomarker?.displayName ?? entity.title,
            unit: entity.biomarker?.unit ?? entity.unit ?? null,
          }];
        })
        .sort((left, right) => left.title.localeCompare(right.title)),
      catalogHash: catalog.catalogHash,
      schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
    },
    experimentIndex: {
      catalogHash: catalog.catalogHash,
      experiments: [...routeBundles.values()]
        .filter((bundle) => bundle.route.entityType === "protocol_variant")
        .flatMap((bundle) => {
          const entity = entitiesByKey.get(bundle.primaryKey);
          if (!entity) {
            return [];
          }
          return [{
            aliases: bundle.route.aliases,
            baselineDays: entity.testPlans?.[0]?.baselineDays ?? 0,
            bundlePath: bundlePathForEntity(bundle.route.entityType, bundle.route.routeId),
            categories: entity.categories ?? [],
            category: formatProtocolCategory(entity),
            description: entity.summary ?? summarizeBody(entity.body),
            durationDays: entity.testPlans?.[0]?.durationDays ?? protocolSpecDurationDays(entity),
            evidenceLabel: formatEvidenceLabel(entity),
            evidenceLevel: qualityToEvidenceLevel(entity.quality ?? null),
            hidden: entity.hidden === true,
            image: resolveProtocolPageImage(entity),
            key: entity.key,
            quality: entity.quality ?? null,
            revision: revisionRefForEntity(entity),
            routeId: bundle.route.routeId,
            slug: entity.slug,
            status: entity.status ?? null,
            studyCount: countRouteBundleStudySources(bundle, entitiesByKey),
            summary: entity.summary ?? null,
            title: entity.title,
          }];
        })
        .sort((left, right) => left.title.localeCompare(right.title)),
      schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION,
    },
    routeBundles,
    routeIndex: {
      catalogHash: catalog.catalogHash,
      routes: routeEntries,
      schemaVersion: HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
    },
  };
}

function buildRouteBundle(input: {
  catalog: HealthCommonsCatalog;
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  primary: HealthCommonsCatalogEntity;
  redirects: readonly HealthCommonsRedirect[];
  routeAliases: readonly string[];
  routeId: string;
}): HealthCommonsWebRouteBundle {
  const closureKeys = collectRouteClosureKeys(input.primary, input.catalog, input.entitiesByKey);
  const reverseEdges = collectRouteReverseEdges(input.catalog, new Set([input.primary.key]));
  for (const edge of reverseEdges) {
    const sourceKey = stripRevision(edge.sourceKey);
    if (input.entitiesByKey.has(sourceKey)) {
      closureKeys.add(sourceKey);
    }
  }
  const entities = [...closureKeys]
    .flatMap((key) => {
      const entity = input.entitiesByKey.get(key);
      return entity ? [entity] : [];
    })
    .sort((left, right) => left.key.localeCompare(right.key));
  const entitiesByKey = Object.fromEntries(
    entities.map((entity) => [
      entity.key,
      prepareEntityForWebBundle(entity, { primary: entity.key === input.primary.key }),
    ]),
  );
  const evidenceAppraisals = input.catalog.evidenceAppraisals
    .filter((appraisal) =>
      stripRevision(appraisal.targetKey) === input.primary.key ||
      (
        closureKeys.has(stripRevision(appraisal.sourceKey)) &&
        closureKeys.has(stripRevision(appraisal.targetKey))
      )
    )
    .sort((left, right) => left.key.localeCompare(right.key));
  const redirects = input.redirects
    .filter((redirect) =>
      closureKeys.has(stripRevision(redirect.from)) ||
      closureKeys.has(stripRevision(redirect.to)) ||
      resolveRedirectTarget(redirect.to, input.redirects) === input.primary.key
    )
    .sort((left, right) => left.from.localeCompare(right.from));

  return {
    catalogHash: input.catalog.catalogHash,
    entitiesByKey,
    evidenceAppraisals,
    primaryKey: input.primary.key,
    redirects,
    reverseEdges,
    revisionManifest: Object.fromEntries(
      entities.map((entity) => [entity.key, revisionRefForEntity(entity)]),
    ),
    route: {
      aliases: [...input.routeAliases],
      entityType: input.primary.entityType,
      routeId: input.routeId,
      slug: input.primary.slug,
    },
    schemaVersion: HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION,
    sourceSnippets: Object.fromEntries(
      entities
        .filter((entity) => entity.entityType === "source_artifact")
        .map((entity) => [entity.key, sourceSnippetForEntity(entity)]),
    ),
  };
}

function collectRouteReverseEdges(
  catalog: HealthCommonsCatalog,
  targetKeys: ReadonlySet<string>,
): HealthCommonsWebReverseRelation[] {
  return catalog.entities
    .flatMap((entity) =>
      (entity.relations ?? [])
        .filter((relation) =>
          ROUTE_BUNDLE_REVERSE_RELATION_TYPES.has(relation.type) &&
          targetKeys.has(stripRevision(relation.target))
        )
        .map((relation) => ({
          relation,
          sourceKey: entity.key,
        }))
    )
    .sort((left, right) =>
      `${left.sourceKey}:${left.relation.type}:${left.relation.target}`.localeCompare(
        `${right.sourceKey}:${right.relation.type}:${right.relation.target}`,
      )
    );
}

function collectRouteClosureKeys(
  primary: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalog,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): Set<string> {
  const keys = new Set<string>([primary.key]);
  const addKey = (key: string | null | undefined) => {
    if (!key) {
      return;
    }
    const stripped = stripRevision(key);
    if (entitiesByKey.has(stripped)) {
      keys.add(stripped);
    }
  };

  for (const relation of primary.relations ?? []) {
    addKey(relation.target);
  }

  for (const claim of primary.claims ?? []) {
    for (const sourceKey of claim.sourceKeys ?? []) {
      addKey(sourceKey);
    }
  }

  for (const group of primary.researchLandscape?.groups ?? []) {
    for (const sourceKey of group.sourceKeys) {
      addKey(sourceKey);
    }
  }

  for (const plan of primary.testPlans ?? []) {
    addKey(plan.primaryBiomarkerKey);
    for (const key of plan.secondaryBiomarkerKeys ?? []) {
      addKey(key);
    }
    for (const key of plan.safetyOutcomeKeys ?? []) {
      addKey(key);
    }
  }

  for (const path of primary.measurementPlan?.paths ?? []) {
    for (const key of path.methodKeys) {
      addKey(key);
    }
    for (const key of path.outcomeKeys ?? []) {
      addKey(key);
    }
    for (const key of path.safetyOutcomeKeys ?? []) {
      addKey(key);
    }
  }

  for (const signal of primary.expectedSignalDescriptions ?? []) {
    addKey(signal.biomarkerKey);
  }

  if (primary.entityType === "biomarker") {
    for (const candidate of primary.protocolRanking?.candidates ?? []) {
      addKey(candidate.protocolKey);
    }

    for (const entity of catalog.entities) {
      const referencesBiomarker = (entity.relations ?? []).some(
        (relation) => stripRevision(relation.target) === primary.key,
      );
      const testPlanReferencesBiomarker = (entity.testPlans ?? []).some((plan) =>
        plan.primaryBiomarkerKey === primary.key ||
        (plan.secondaryBiomarkerKeys ?? []).includes(primary.key)
      );

      if (referencesBiomarker || testPlanReferencesBiomarker) {
        addKey(entity.key);
      }
    }
  }

  for (const appraisal of catalog.evidenceAppraisals) {
    if (stripRevision(appraisal.targetKey) === primary.key) {
      addKey(appraisal.sourceKey);
    }
  }

  return keys;
}

function prepareEntityForWebBundle(
  entity: HealthCommonsCatalogEntity,
  options: { primary: boolean },
): HealthCommonsCatalogEntity {
  const finding = extractPublicStudyFinding(entity.body);
  const base = {
    aliases: entity.aliases ?? [],
    categories: entity.categories ?? [],
    entityType: entity.entityType,
    hidden: entity.hidden,
    key: entity.key,
    quality: entity.quality,
    relativePath: entity.relativePath,
    relations: entity.entityType === "source_artifact" ? [] : entity.relations ?? [],
    researchEvidence: entity.researchEvidence,
    revision: entity.revision,
    schemaVersion: entity.schemaVersion,
    slug: entity.slug,
    source: entity.source,
    status: entity.status,
    summary: entity.summary,
    title: entity.title,
  };

  if (entity.entityType === "source_artifact") {
    return {
      ...base,
      body: finding ? `**Findings:** ${finding}` : "",
      evidenceBucket: readPassthroughString(entity, "evidenceBucket"),
      murphV1Priority: readPassthroughString(entity, "murphV1Priority"),
      protocolTakeaway: readPassthroughString(entity, "protocolTakeaway"),
      whyItMatters: readPassthroughString(entity, "whyItMatters"),
    } as HealthCommonsCatalogEntity;
  }

  const publicEntity = {
    ...base,
    body: options.primary ? entity.body : entity.summary ?? "",
    attribution: options.primary ? entity.attribution : undefined,
    biomarker: entity.biomarker,
    claims: entity.claims,
    communityOutcomeSummary: entity.communityOutcomeSummary,
    expectedSignalDescriptions: entity.expectedSignalDescriptions,
    experimentOnboarding: entity.experimentOnboarding,
    interpretationFrame: entity.interpretationFrame,
    lineage: options.primary ? entity.lineage : undefined,
    measurementContexts: entity.measurementContexts,
    measurementMethod: entity.measurementMethod,
    measurementPlan: entity.measurementPlan,
    media: readPassthroughUnknown(entity, "media"),
    options: entity.options,
    profileImageUrl: readPassthroughString(entity, "profileImageUrl"),
    protocol: entity.protocol,
    protocolRanking: entity.protocolRanking,
    researchLandscape: entity.researchLandscape,
    safety: entity.safety,
    sourceIdentity: entity.sourceIdentity,
    testPlans: entity.testPlans,
    unit: entity.unit,
    whyItWorks: entity.whyItWorks,
  };

  return Object.fromEntries(
    Object.entries(publicEntity).filter((entry) => entry[1] !== undefined),
  ) as HealthCommonsCatalogEntity;
}

function readPassthroughString(
  entity: HealthCommonsCatalogEntity,
  key: string,
): string | undefined {
  const value = (entity as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readPassthroughUnknown(
  entity: HealthCommonsCatalogEntity,
  key: string,
): unknown {
  return (entity as Record<string, unknown>)[key];
}

function sourceSnippetForEntity(
  entity: HealthCommonsCatalogEntity,
): HealthCommonsWebSourceSnippet {
  return {
    citation: entity.source?.citation ?? null,
    finding: extractPublicStudyFinding(entity.body) ?? null,
    key: entity.key,
    title: entity.source?.title ?? entity.title,
    url: entity.source?.url ?? null,
    year: entity.source?.year ?? null,
  };
}

function revisionRefForEntity(entity: HealthCommonsCatalogEntity): HealthCommonsWebRevisionRef {
  return {
    pageRevisionId: entity.revision.pageRevisionId,
    recipeHash: entity.revision.recipeHash ?? null,
    runSpecRevisionId: entity.revision.runSpecRevisionId ?? null,
  };
}

function buildEntityRouteIds(
  entity: HealthCommonsCatalogEntity,
  redirects: readonly HealthCommonsRedirect[],
): string[] {
  return uniqueStrings([
    toTrailingRouteId(entity.slug),
    ...redirects.map((redirect) => toRouteIdFromKey(redirect.from)),
  ]);
}

function selectPrimaryRouteId(
  entity: HealthCommonsCatalogEntity | null,
  routeIds: readonly string[],
): string {
  if (entity?.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week") {
    return "finnish-sauna";
  }

  return routeIds[0] ?? toTrailingRouteId(entity?.slug ?? "");
}

function bundlePathForEntity(entityType: HealthCommonsEntityType, routeId: string): string {
  return `bundles/${entityType}/${routeId}.json`;
}

function isPublishedBiomarkerIndexEntity(entity: HealthCommonsCatalogEntity): boolean {
  return entity.entityType === "biomarker"
    && entity.status !== "deprecated"
    && entity.hidden !== true
    && (entity.biomarker?.explainerCards?.length ?? 0) > 0
    && (entity.biomarker?.measurement?.howToMeasure?.length ?? 0) > 0
    && (entity.protocolRanking?.candidates?.length ?? 0) > 0
    && entity.communityOutcomeSummary !== undefined
    && (entity.biomarker?.privateMetricBindings?.some((binding) =>
      binding.source === "browser_vault_metric"
      && typeof binding.domain === "string"
      && typeof binding.metric === "string"
    ) ?? false);
}

function formatProtocolCategory(entity: HealthCommonsCatalogEntity): string {
  const categories = entity.categories ?? [];

  if (categories.includes("sleep") || categories.includes("circadian")) {
    return "Sleep";
  }

  if (
    categories.includes("exercise") ||
    categories.includes("hiit") ||
    categories.includes("vo2max")
  ) {
    return "Exercise";
  }

  if (
    categories.includes("recovery") ||
    categories.includes("dry-sauna") ||
    categories.includes("passive-heat")
  ) {
    return "Recovery";
  }

  return formatCategory(categories[0] ?? entity.entityType);
}

function formatEvidenceLabel(entity: HealthCommonsCatalogEntity): string {
  const status = STATUS_LABELS[entity.status ?? ""];
  const quality = QUALITY_LABELS[entity.quality ?? ""];

  if (status && quality) {
    return `${status} / ${quality}`;
  }

  return status ?? quality ?? "Draft / Stub";
}

function qualityToEvidenceLevel(quality: string | null): number {
  return QUALITY_TO_EVIDENCE_LEVEL[quality ?? ""] ?? 2;
}

function protocolSpecDurationDays(entity: HealthCommonsCatalogEntity): number {
  const duration = entity.protocol?.durationMinutes;

  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    return Math.max(1, Math.ceil(duration / (60 * 24)));
  }

  return 14;
}

function countRouteBundleStudySources(
  bundle: HealthCommonsWebRouteBundle,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): number {
  return Object.keys(bundle.sourceSnippets).filter((sourceKey) => {
    const source = entitiesByKey.get(sourceKey);
    return source?.source?.kind === "journal_article" || source?.source?.kind === "review";
  }).length;
}

function resolveProtocolPageImage(entity: HealthCommonsCatalogEntity): string | null {
  const media = readPassthroughUnknown(entity, "media");
  if (!Array.isArray(media)) {
    return null;
  }

  const image = media.find((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      record["kind"] === "photo" ||
      record["kind"] === "image" ||
      (typeof record["mediaType"] === "string" && record["mediaType"].startsWith("image/"))
    ) && typeof record["relativePath"] === "string" && record["relativePath"].length > 0;
  }) as Record<string, unknown> | undefined;

  const relativePath = image?.["relativePath"];
  if (typeof relativePath !== "string") {
    return null;
  }

  return relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
}

function formatCategory(value: string): string {
  return value
    .split(/[._/-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compareRouteEntries(
  left: HealthCommonsWebRouteIndexEntry,
  right: HealthCommonsWebRouteIndexEntry,
): number {
  const entityDelta = left.entityType.localeCompare(right.entityType);
  if (entityDelta !== 0) {
    return entityDelta;
  }

  return left.routeId.localeCompare(right.routeId);
}

function resolveRedirectTarget(
  value: string,
  redirects: readonly HealthCommonsRedirect[],
): string {
  let current = stripRevision(value);
  const seen = new Set<string>();
  const redirectsBySource = new Map(
    redirects.map((redirect) => [stripRevision(redirect.from), stripRevision(redirect.to)]),
  );

  while (redirectsBySource.has(current) && !seen.has(current)) {
    seen.add(current);
    current = redirectsBySource.get(current) ?? current;
  }

  return current;
}

function toRouteIdFromKey(key: string): string {
  return stripRevision(key).replace(/^[^:]+:/u, "").split("/").at(-1) ?? key;
}

function toTrailingRouteId(slug: string): string {
  return slug.split("/").at(-1) ?? slug;
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.length > 0
  ))];
}

function summarizeBody(body: string): string {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
}

function extractStudyFinding(body: string): string | undefined {
  const lines = body.split("\n");
  const findingsLabel = /^\*\*Findings:\*\*\s*/u;
  const labeledSection = /^\*\*[A-Z][^*]+:\*\*/u;
  const startIndex = lines.findIndex((line) => findingsLabel.test(line.trim()));

  if (startIndex === -1) {
    return undefined;
  }

  const findingLines: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const rawLine = lines[index]?.trim() ?? "";
    const line = index === startIndex ? rawLine.replace(findingsLabel, "").trim() : rawLine;

    if (!line) {
      if (findingLines.length > 0) {
        break;
      }
      continue;
    }

    if (index > startIndex && labeledSection.test(line)) {
      break;
    }

    findingLines.push(line);
  }

  const finding = findingLines.join(" ").replace(/\s+/gu, " ").trim();
  return finding || undefined;
}

function extractPublicStudyFinding(body: string): string | undefined {
  const finding = extractStudyFinding(body);
  if (!finding) {
    return undefined;
  }

  if (finding.length <= SOURCE_SNIPPET_FINDING_MAX_LENGTH) {
    return finding;
  }

  return `${finding.slice(0, SOURCE_SNIPPET_FINDING_MAX_LENGTH - 3).trimEnd()}...`;
}

const QUALITY_TO_EVIDENCE_LEVEL: Record<string, number> = {
  stub: 1,
  usable: 3,
  reviewed: 4,
  excellent: 5,
};

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
