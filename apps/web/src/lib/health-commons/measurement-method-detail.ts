import type {
  HealthCommonsMeasurementMethod,
  HealthCommonsMeasurementMethodBurden,
  HealthCommonsMeasurementMethodFidelity,
  HealthCommonsMeasurementMethodInterpretation,
  HealthCommonsMeasurementMethodOutput,
  HealthCommonsMeasurementMethodPrivacy,
  HealthCommonsMeasurementMethodProcedure,
  HealthCommonsMeasurementMethodTier,
} from "@murphai/contracts";
import type {
  HealthCommonsCatalogReader,
  HealthCommonsEntity,
} from "@murphai/health-commons/runtime";
import {
  listGeneratedMeasurementMethodRouteEntries,
  loadGeneratedMeasurementMethodRouteBundle,
  resolveGeneratedMeasurementMethodRoute,
  type GeneratedMeasurementMethodRouteBundle,
  type GeneratedMeasurementMethodRoute,
} from "./generated-measurement-method-artifacts";

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

export interface MeasurementMethodOutputModel {
  direction?: HealthCommonsMeasurementMethodOutput["direction"];
  label: string;
  mapsToLabel?: string;
  notes: string[];
  unit?: string;
  valueType: HealthCommonsMeasurementMethodOutput["valueType"];
}

export interface MeasurementMethodRelatedBiomarkerModel {
  key: string;
  title: string;
}

export interface MeasurementMethodPageModel {
  aliases: string[];
  body: string;
  burden?: HealthCommonsMeasurementMethodBurden;
  catalogHash: string;
  categories: string[];
  confounders: string[];
  fidelity?: HealthCommonsMeasurementMethodFidelity;
  interpretation?: HealthCommonsMeasurementMethodInterpretation;
  key: string;
  modalities: string[];
  outputs: MeasurementMethodOutputModel[];
  pageRevisionId: string;
  privacy?: HealthCommonsMeasurementMethodPrivacy;
  procedure: HealthCommonsMeasurementMethodProcedure;
  qualityLabel: string;
  relatedBiomarkers: MeasurementMethodRelatedBiomarkerModel[];
  routeId: string;
  shortName: string;
  slug: string;
  statusLabel: string;
  summary: string;
  tier: HealthCommonsMeasurementMethodTier;
  title: string;
}

type MeasurementMethodPageCatalogReader = Pick<
  HealthCommonsCatalogReader,
  "catalogHash" | "findByKey"
>;
type MeasurementMethodRouteCatalogReader = Pick<
  HealthCommonsCatalogReader,
  "catalogHash" | "findByKey" | "findByRouteId"
>;

export function listHealthCommonsMeasurementMethodRoutes(
  catalog?: HealthCommonsCatalogReader,
): string[] {
  if (!catalog) {
    return listGeneratedHealthCommonsMeasurementMethodRoutes();
  }

  return catalog
    .listByEntityType("measurement_method")
    .filter(isPublishedMeasurementMethod)
    .map((entity) => toMeasurementMethodRouteId(entity))
    .sort();
}

export function resolveHealthCommonsMeasurementMethodDetail(
  measurementMethodId: string,
  catalog?: HealthCommonsCatalogReader,
): MeasurementMethodPageModel | null {
  if (!catalog) {
    return resolveGeneratedHealthCommonsMeasurementMethodDetail(measurementMethodId);
  }

  const routeId = normalizeRouteId(measurementMethodId);
  const method = catalog.findByRouteId({
    entityType: "measurement_method",
    routeId,
  });

  if (!isPublishedMeasurementMethod(method)) {
    return null;
  }

  if (toMeasurementMethodRouteId(method) !== routeId) {
    return null;
  }

  return toMeasurementMethodPageModel(method, catalog);
}

function listGeneratedHealthCommonsMeasurementMethodRoutes(): string[] {
  return getGeneratedMeasurementMethodRoutes()
    .flatMap((route) => {
      const reader = loadGeneratedMeasurementMethodRouteReader(route.routeId);
      if (!reader) {
        return [];
      }

      const method = reader.findByRouteId({
        entityType: "measurement_method",
        routeId: route.routeId,
      });

      return isPublishedMeasurementMethod(method) ? [toMeasurementMethodRouteId(method)] : [];
    })
    .sort();
}

function resolveGeneratedHealthCommonsMeasurementMethodDetail(
  measurementMethodId: string,
): MeasurementMethodPageModel | null {
  const routeId = normalizeRouteId(measurementMethodId);
  const route = findGeneratedMeasurementMethodRoute(routeId);
  if (!route) {
    return null;
  }

  const reader = loadGeneratedMeasurementMethodRouteReader(route.routeId);
  if (!reader) {
    return null;
  }

  const method = reader.findByRouteId({
    entityType: "measurement_method",
    routeId,
  });

  if (!isPublishedMeasurementMethod(method)) {
    return null;
  }

  if (toMeasurementMethodRouteId(method) !== routeId) {
    return null;
  }

  return toMeasurementMethodPageModel(method, reader);
}

type GeneratedHealthCommonsRoute = GeneratedMeasurementMethodRoute;

function getGeneratedMeasurementMethodRoutes(): GeneratedHealthCommonsRoute[] {
  return listGeneratedMeasurementMethodRouteEntries();
}

function findGeneratedMeasurementMethodRoute(
  routeId: string,
): GeneratedHealthCommonsRoute | null {
  return resolveGeneratedMeasurementMethodRoute(routeId);
}

function loadGeneratedMeasurementMethodRouteReader(
  routeId: string,
): MeasurementMethodRouteCatalogReader | null {
  const bundle = loadGeneratedMeasurementMethodRouteBundle(routeId);

  return bundle ? createMeasurementMethodRouteBundleReader(bundle) : null;
}

function createMeasurementMethodRouteBundleReader(
  bundle: GeneratedMeasurementMethodRouteBundle,
): MeasurementMethodRouteCatalogReader {
  const entities = Object.values(bundle.entitiesByKey);

  return {
    catalogHash: bundle.catalogHash,
    findByKey(key) {
      return bundle.entitiesByKey[stripRevision(key)] ?? null;
    },
    findByRouteId(input) {
      const routeId = normalizeRouteId(input.routeId);
      return entities.find((entity) =>
        entity.entityType === input.entityType && entityMatchesRouteId(entity, routeId)
      ) ?? null;
    },
  };
}

function entityMatchesRouteId(entity: HealthCommonsEntity, routeId: string): boolean {
  return entity.slug === routeId
    || entity.slug.split("/").at(-1) === routeId
    || (entity.aliases ?? []).includes(routeId);
}

function stripRevision(key: string): string {
  return key.split("@").at(0) ?? key;
}

export function isPublishedMeasurementMethod(
  entity: HealthCommonsEntity | null,
): entity is HealthCommonsEntity & {
  entityType: "measurement_method";
  measurementMethod: HealthCommonsMeasurementMethod;
} {
  return entity?.entityType === "measurement_method"
    && entity.status !== "deprecated"
    && entity.measurementMethod !== undefined;
}

export function toMeasurementMethodRouteId(entity: HealthCommonsEntity): string {
  return entity.slug.split("/").at(-1) ?? entity.slug;
}

function toMeasurementMethodPageModel(
  entity: HealthCommonsEntity & {
    entityType: "measurement_method";
    measurementMethod: HealthCommonsMeasurementMethod;
  },
  catalog: MeasurementMethodPageCatalogReader,
): MeasurementMethodPageModel {
  const method = entity.measurementMethod;

  return {
    aliases: entity.aliases ?? [],
    body: entity.body,
    ...(method.burden ? { burden: method.burden } : {}),
    catalogHash: catalog.catalogHash,
    categories: entity.categories ?? [],
    confounders: method.confounders ?? [],
    ...(method.fidelity ? { fidelity: method.fidelity } : {}),
    ...(method.interpretation ? { interpretation: method.interpretation } : {}),
    key: entity.key,
    modalities: method.modalities.map(formatWords),
    outputs: method.outputs.map((output) => toMeasurementMethodOutput(output, catalog)),
    pageRevisionId: entity.revision.pageRevisionId,
    ...(method.privacy ? { privacy: method.privacy } : {}),
    procedure: method.procedure,
    qualityLabel: formatQualityLabel(entity.quality),
    relatedBiomarkers: resolveRelatedBiomarkers(method, catalog),
    routeId: toMeasurementMethodRouteId(entity),
    shortName: method.shortName ?? method.displayName ?? entity.aliases?.[0] ?? entity.title,
    slug: entity.slug,
    statusLabel: formatStatusLabel(entity.status),
    summary: entity.summary ?? summarizeBody(entity.body),
    tier: method.tier,
    title: method.displayName ?? entity.title,
  };
}

function toMeasurementMethodOutput(
  output: HealthCommonsMeasurementMethodOutput,
  catalog: MeasurementMethodPageCatalogReader,
): MeasurementMethodOutputModel {
  return {
    ...(output.direction ? { direction: output.direction } : {}),
    label: output.label,
    ...(output.mapsToBiomarkerKey
      ? {
          mapsToLabel: resolveBiomarkerTitle(output.mapsToBiomarkerKey, catalog),
        }
      : {}),
    notes: output.notes ?? [],
    ...(output.unit ? { unit: output.unit } : {}),
    valueType: output.valueType,
  };
}

function resolveRelatedBiomarkers(
  method: HealthCommonsMeasurementMethod,
  catalog: MeasurementMethodPageCatalogReader,
): MeasurementMethodRelatedBiomarkerModel[] {
  const keys = uniqueStrings([
    ...(method.measuredBiomarkerKeys ?? []),
    ...method.outputs.flatMap((output) =>
      output.mapsToBiomarkerKey ? [output.mapsToBiomarkerKey] : []
    ),
  ]);

  return keys.map((key) => {
    const entity = catalog.findByKey(key);

    if (entity?.entityType !== "biomarker") {
      throw new Error(
        `Measurement method biomarker key ${key} did not resolve to a biomarker.`,
      );
    }

    return { key: entity.key, title: entity.title };
  });
}

function resolveBiomarkerTitle(
  key: string,
  catalog: MeasurementMethodPageCatalogReader,
): string {
  const entity = catalog.findByKey(key);

  if (entity?.entityType !== "biomarker") {
    throw new Error(
      `Measurement method output mapping ${key} did not resolve to a biomarker.`,
    );
  }

  return entity.title;
}

function formatStatusLabel(status: string | undefined): string {
  return status ? STATUS_LABELS[status] ?? formatWords(status) : "Draft";
}

function formatQualityLabel(quality: string | undefined): string {
  return quality ? QUALITY_LABELS[quality] ?? formatWords(quality) : "Usable";
}

function formatWords(value: string): string {
  return value
    .split(/[-_\s/]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeRouteId(value: string): string {
  return decodeURIComponent(value).trim().replace(/^\/+|\/+$/gu, "");
}

function summarizeBody(body: string): string {
  const firstParagraph = body.split(/\n\s*\n/u).find((paragraph) =>
    paragraph.trim().length > 0
  );

  return firstParagraph?.replace(/\s+/gu, " ").trim() ?? "Measurement method.";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
