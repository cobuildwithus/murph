import {
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsEvidenceAppraisal,
  type HealthCommonsRedirect,
} from "@murphai/contracts";
import {
  getGeneratedHealthCommonsWebRouteIndex,
  loadGeneratedHealthCommonsWebRouteBundle,
} from "@murphai/health-commons/runtime";

export function createHealthCommonsRouteBundleFixtureCatalog(): HealthCommonsCatalog {
  const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
  const seenBundlePaths = new Set<string>();
  const entitiesByKey = new Map<string, HealthCommonsCatalogEntity>();
  const redirectsByKey = new Map<string, HealthCommonsRedirect>();
  const evidenceAppraisalsByKey = new Map<string, HealthCommonsEvidenceAppraisal>();

  for (const route of routeIndex.routes) {
    if (seenBundlePaths.has(route.bundlePath)) {
      continue;
    }
    seenBundlePaths.add(route.bundlePath);

    const bundle = loadGeneratedHealthCommonsWebRouteBundle({
      entityType: route.entityType,
      routeId: route.routeId,
    });
    if (!bundle) {
      continue;
    }

    for (const entity of Object.values(bundle.entitiesByKey)) {
      entitiesByKey.set(entity.key, structuredClone(entity));
    }
    for (const redirect of bundle.redirects) {
      redirectsByKey.set(`${redirect.from}->${redirect.to}`, structuredClone(redirect));
    }
    for (const appraisal of bundle.evidenceAppraisals) {
      evidenceAppraisalsByKey.set(
        [
          appraisal.targetKey,
          appraisal.sourceKey,
          appraisal.groupId ?? "",
          appraisal.scope ?? "",
        ].join("|"),
        structuredClone(appraisal),
      );
    }
  }

  return {
    artifactManifests: [],
    catalogHash: routeIndex.catalogHash,
    changes: [],
    entities: [...entitiesByKey.values()].sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
    evidenceAppraisals: [...evidenceAppraisalsByKey.values()],
    redirects: [...redirectsByKey.values()],
    schemaVersion: "murph.commons.catalog.v1",
  };
}
