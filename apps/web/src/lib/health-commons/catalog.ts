import {
  healthCommonsCatalogSchema,
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsEvidenceAppraisal,
  type HealthCommonsEntityType,
  type HealthCommonsRelationType,
} from "@murphai/contracts";
import healthCommonsCatalogJson from "@murphai/health-commons/generated/catalog.json";

export type HealthCommonsEntity = HealthCommonsCatalogEntity;

export interface HealthCommonsCatalogReader {
  catalogHash: string;
  findByKey(key: string): HealthCommonsEntity | null;
  findByRouteId(input: {
    entityType: HealthCommonsEntityType;
    routeId: string;
  }): HealthCommonsEntity | null;
  findBySlug(slug: string): HealthCommonsEntity | null;
  listByEntityType(entityType: HealthCommonsEntityType): HealthCommonsEntity[];
  listEvidenceAppraisals(input?: {
    groupId?: string;
    sourceKey?: string;
    targetKey?: string;
  }): HealthCommonsEvidenceAppraisal[];
  listRelated(input: {
    entity: HealthCommonsEntity;
    relationTypes?: readonly HealthCommonsRelationType[];
    entityTypes?: readonly HealthCommonsEntityType[];
  }): HealthCommonsEntity[];
}

export const healthCommonsCatalog = createHealthCommonsCatalogReader(
  healthCommonsCatalogSchema.parse(healthCommonsCatalogJson),
);

export function createHealthCommonsCatalogReader(
  catalog: HealthCommonsCatalog,
): HealthCommonsCatalogReader {
  const entitiesByKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const entitiesBySlug = new Map(catalog.entities.map((entity) => [entity.slug, entity]));
  const entitiesByType = new Map<HealthCommonsEntityType, HealthCommonsEntity[]>();
  const entitiesByTrailingSlug = new Map<string, HealthCommonsEntity[]>();
  const redirectsBySource = new Map(catalog.redirects.map((redirect) => [redirect.from, redirect.to]));
  const evidenceAppraisals = catalog.evidenceAppraisals;

  for (const entity of catalog.entities) {
    const existingByType = entitiesByType.get(entity.entityType) ?? [];
    existingByType.push(entity);
    entitiesByType.set(entity.entityType, existingByType);

    const trailingSlug = entity.slug.split("/").at(-1);
    if (!trailingSlug) {
      continue;
    }

    const existing = entitiesByTrailingSlug.get(trailingSlug) ?? [];
    existing.push(entity);
    entitiesByTrailingSlug.set(trailingSlug, existing);
  }

  const resolveKey = (key: string): string => {
    let current = key;
    const seen = new Set<string>();

    while (redirectsBySource.has(current) && !seen.has(current)) {
      seen.add(current);
      current = redirectsBySource.get(current) ?? current;
    }

    return current;
  };

  const findByKey = (key: string): HealthCommonsEntity | null =>
    entitiesByKey.get(resolveKey(key)) ?? null;

  return {
    catalogHash: catalog.catalogHash,
    findByKey,
    findByRouteId({ entityType, routeId }) {
      const normalizedRouteId = normalizeRouteId(routeId);
      const keyCandidate = `${entityType}:${normalizedRouteId}`;
      const byKey = findByKey(keyCandidate);
      if (byKey) {
        return byKey.entityType === entityType ? byKey : null;
      }

      const bySlug = this.findBySlug(normalizedRouteId);
      if (bySlug) {
        return bySlug.entityType === entityType ? bySlug : null;
      }

      const byTrailingSlug = (entitiesByTrailingSlug.get(normalizedRouteId) ?? []).filter(
        (entity) => entity.entityType === entityType,
      );

      return byTrailingSlug.length === 1 ? byTrailingSlug[0] : null;
    },
    findBySlug(slug: string) {
      const normalizedSlug = normalizeRouteId(slug);
      return entitiesBySlug.get(normalizedSlug) ?? null;
    },
    listByEntityType(entityType: HealthCommonsEntityType) {
      return entitiesByType.get(entityType)?.slice() ?? [];
    },
    listEvidenceAppraisals(input = {}) {
      const sourceKey = input.sourceKey ? stripRevision(resolveKey(input.sourceKey)) : null;
      const targetKey = input.targetKey ? stripRevision(resolveKey(input.targetKey)) : null;
      return evidenceAppraisals.filter((appraisal) => {
        if (sourceKey && stripRevision(resolveKey(appraisal.sourceKey)) !== sourceKey) {
          return false;
        }
        if (targetKey && stripRevision(resolveKey(appraisal.targetKey)) !== targetKey) {
          return false;
        }
        if (input.groupId && appraisal.groupId !== input.groupId) {
          return false;
        }
        return true;
      });
    },
    listRelated({ entity, entityTypes, relationTypes }) {
      const relationTypeSet: ReadonlySet<string> | null = relationTypes
        ? new Set(relationTypes)
        : null;
      const entityTypeSet = entityTypes ? new Set(entityTypes) : null;

      return (entity.relations ?? []).flatMap((relation) => {
        if (relationTypeSet && !relationTypeSet.has(relation.type)) {
          return [];
        }

        const target = findByKey(relation.target);
        if (!target) {
          return [];
        }

        if (entityTypeSet && !entityTypeSet.has(target.entityType)) {
          return [];
        }

        return [target];
      });
    },
  };
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
}

function normalizeRouteId(value: string): string {
  return decodeURIComponent(value).trim().replace(/^\/+|\/+$/gu, "");
}
