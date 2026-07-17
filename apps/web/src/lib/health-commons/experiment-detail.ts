import type {
  HealthCommonsCatalogEntity,
  HealthCommonsClaim,
  HealthCommonsMeasurementMethod,
  HealthCommonsMeasurementPlanPath,
  HealthCommonsProtocolSpec,
  HealthCommonsSafety,
  HealthCommonsTestPlan,
  StoredMedia,
} from "@murphai/contracts";
import {
  createHealthCommonsRouteBundleReader,
  getGeneratedHealthCommonsWebExperimentIndex,
  isRunnableProtocolStatus,
  loadGeneratedHealthCommonsWebRouteBundle,
  type HealthCommonsCatalogReader,
  type HealthCommonsEntity,
} from "@murphai/health-commons/runtime";

import {
  CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
} from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";
import { resolveExperimentRouteImage } from "./experiment-images";
import {
  listProtocolBiomarkers,
  toExpectedSignal,
} from "./experiment-detail-biomarkers";
import { toExpert } from "./experiment-detail-experts";
import {
  countResearchStudies,
  findProtocolEvidenceAppraisal,
  formatResearchSummaryLabel,
  hasMixedResearchAndProvenanceSources,
  isCountedResearchSource,
  isDisplaySource,
  sortStudySourcesForDisplay,
  toResearchGroups,
  toResearchStats,
  toStudy,
} from "./experiment-detail-research";
import {
  cleanHealthCommonsUserFacingCopy,
  cleanHealthCommonsUserFacingCopyList,
  cleanOptionalHealthCommonsUserFacingCopy,
} from "./user-facing-copy";

export { readOptionalProfileImageUrl } from "./experiment-detail-experts";

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

export function listHealthCommonsExperimentProtocols(
  catalog?: HealthCommonsCatalogReader,
): ExperimentProtocol[] {
  if (!catalog) {
    return getGeneratedHealthCommonsWebExperimentIndex()
      .experiments
      .filter(isPublicExperimentIndexEntry)
      .sort(compareExperimentIndexEntries)
      .map(toExperimentProtocolIndexEntry);
  }

  return catalog
    .listByEntityType("protocol_variant")
    .filter((protocol) => protocol.entityType === "protocol_variant")
    .filter((protocol) => isRunnableProtocolStatus(protocol.status))
    .filter((protocol) => protocol.hidden !== true)
    .sort(compareProtocolEntities)
    .map((protocol) => toExperimentDetail(protocol, catalog));
}

export function resolveHealthCommonsExperimentProtocol(
  experimentId: string,
  catalog?: HealthCommonsCatalogReader,
): ExperimentProtocol | null {
  if (!catalog) {
    const bundle = loadGeneratedHealthCommonsWebRouteBundle({
      entityType: "protocol_variant",
      routeId: normalizeExperimentRouteId(experimentId),
    });
    if (!bundle) {
      return null;
    }
    const reader = createHealthCommonsRouteBundleReader(bundle);
    const protocol = reader.findByKey(bundle.primaryKey);

    return isPublicExperimentProtocol(protocol)
      ? toExperimentDetail(protocol, reader)
      : null;
  }

  const protocol = catalog.findByRouteId({
    entityType: "protocol_variant",
    routeId: normalizeExperimentRouteId(experimentId),
  });

  if (!isPublicExperimentProtocol(protocol)) {
    return null;
  }

  return toExperimentDetail(protocol, catalog);
}

export function listHealthCommonsExperimentRouteParams(): { experimentId: string }[] {
  return getGeneratedHealthCommonsWebExperimentIndex()
    .experiments
    .filter(isPublicExperimentIndexEntry)
    .map((entry) => ({ experimentId: entry.routeId }))
    .sort((left, right) => left.experimentId.localeCompare(right.experimentId));
}

function isPublicExperimentIndexEntry(
  entry: ReturnType<typeof getGeneratedHealthCommonsWebExperimentIndex>["experiments"][number],
): boolean {
  return isRunnableProtocolStatus(entry.status) && entry.hidden !== true;
}

function isPublicExperimentProtocol(
  entity: HealthCommonsEntity | null,
): entity is HealthCommonsEntity & { entityType: "protocol_variant" } {
  return entity?.entityType === "protocol_variant"
    && isRunnableProtocolStatus(entity.status)
    && entity.hidden !== true;
}

function toExperimentProtocolIndexEntry(
  entry: ReturnType<typeof getGeneratedHealthCommonsWebExperimentIndex>["experiments"][number],
): ExperimentProtocol {
  const description = cleanHealthCommonsUserFacingCopy(entry.description);

  const image = resolveExperimentRouteImage(entry.routeId, entry.image);

  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    id: entry.routeId,
    title: cleanHealthCommonsUserFacingCopy(entry.title),
    category: cleanHealthCommonsUserFacingCopy(entry.category),
    image,
    durationDays: entry.durationDays,
    baselineDays: entry.baselineDays,
    studyCount: entry.studyCount,
    researchSummaryLabel: formatIndexResearchSummaryLabel(entry.studyCount),
    evidenceLevel: entry.evidenceLevel,
    evidenceLabel: entry.evidenceLabel,
    description,
    expectedSignals: [],
    measurementPaths: [],
    protocolFacts: [],
    protocol: [],
    protocolTips: [],
    protocolKeepInMind: [],
    protocolLogFields: [],
    mechanismChain: [],
    whyItWorks: description,
    experts: [],
    researchStats: [],
    studies: [],
    safety: {
      cautionLevel: 1,
      precautions: [],
      whoShouldAvoid: [],
    },
    commons: {
      aliases: uniqueStrings([
        entry.routeId,
        entry.key,
        entry.key.replace(/^protocol_variant:/u, ""),
        entry.slug,
        entry.slug.split("/").at(-1) ?? null,
        ...entry.aliases,
      ]),
      catalogHash: getGeneratedHealthCommonsWebExperimentIndex().catalogHash,
      key: entry.key,
      pageRevisionId: entry.revision.pageRevisionId,
      recipeHash: entry.revision.recipeHash ?? null,
      routeId: entry.routeId,
      runSpecRevisionId: entry.revision.runSpecRevisionId ?? null,
      slug: entry.slug,
    },
  };
}

function formatIndexResearchSummaryLabel(studyCount: number): string {
  if (studyCount === 0) {
    return "Research mapped";
  }

  return studyCount === 1 ? "1 study" : `${studyCount} studies`;
}

function normalizeExperimentRouteId(value: string): string {
  return value;
}

function compareExperimentIndexEntries(
  left: ReturnType<typeof getGeneratedHealthCommonsWebExperimentIndex>["experiments"][number],
  right: ReturnType<typeof getGeneratedHealthCommonsWebExperimentIndex>["experiments"][number],
): number {
  const leftOrder = left.sortRank ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sortRank ?? Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.title.localeCompare(right.title);
}

function compareProtocolEntities(
  left: HealthCommonsCatalogEntity,
  right: HealthCommonsCatalogEntity,
): number {
  const leftOrder = left.sortRank ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sortRank ?? Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.title.localeCompare(right.title);
}

function toExperimentDetail(
  protocol: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalogReader,
): ExperimentProtocol {
  const routeId = toExperimentId(protocol);
  const testPlan = protocol.testPlans?.[0] ?? null;
  const protocolSpec = protocol.protocol;
  const measurementPaths = toMeasurementPaths(protocol, catalog);
  const safety = protocol.safety;
  const evidenceAppraisals = catalog.listEvidenceAppraisals({
    targetKey: protocol.key,
  });
  const directlyCitedSources = catalog.listRelated({
    entity: protocol,
    entityTypes: ["source_artifact"],
    relationTypes: ["cites"],
  });
  const appraisalSources = evidenceAppraisals.flatMap((appraisal) => {
    const source = catalog.findByKey(appraisal.sourceKey);
    return source?.entityType === "source_artifact" ? [source] : [];
  });
  const landscapeSources = (protocol.researchLandscape?.groups ?? []).flatMap((group) =>
    group.sourceKeys.flatMap((sourceKey) => {
      const source = catalog.findByKey(sourceKey);
      return source?.entityType === "source_artifact" ? [source] : [];
    })
  );
  const citedSources = uniqueEntities([
    ...directlyCitedSources,
    ...appraisalSources,
    ...landscapeSources,
  ]);
  const citedDisplaySources = citedSources.filter(isDisplaySource);
  const countedResearchSources = citedDisplaySources.filter(isCountedResearchSource);
  const studies = sortStudySourcesForDisplay(citedDisplaySources)
    .map((source) => toStudy(
      source,
      findProtocolEvidenceAppraisal(evidenceAppraisals, source.key, protocol.key),
    ));
  const {
    coveredSourceCount: researchGroupCoveredSourceCount,
    groups: researchGroups,
    totalSourceCount: researchGroupTotalSourceCount,
  } = toResearchGroups({
    protocol,
    citedStudySources: citedDisplaySources,
    evidenceAppraisals,
  });
  const hasCompleteResearchGroupCoverage =
    researchGroups.length > 0
    && researchGroupCoveredSourceCount === researchGroupTotalSourceCount;
  const biomarkerEntities = listProtocolBiomarkers(protocol, catalog);
  const sourcePeople = catalog.listRelated({
    entity: protocol,
    entityTypes: ["source_person"],
    relationTypes: ["source_person"],
  });
  const claims = protocol.claims ?? [];

  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    id: routeId,
    title: cleanHealthCommonsUserFacingCopy(protocol.title),
    category: formatProtocolCategory(protocol),
    image: resolveExperimentRouteImage(routeId, resolveProtocolPageImage(protocol)),
    durationDays: testPlan?.durationDays ?? protocolSpecDurationDays(protocolSpec),
    baselineDays: testPlan?.baselineDays ?? 0,
    studyCount: hasMixedResearchAndProvenanceSources({
      countedResearchSources,
      displaySources: citedDisplaySources,
    })
      ? countResearchStudies(countedResearchSources)
      : citedDisplaySources.length,
    researchSummaryLabel: formatResearchSummaryLabel({
      countedResearchSources,
      displaySources: citedDisplaySources,
    }),
    evidenceLevel: QUALITY_TO_EVIDENCE_LEVEL[protocol.quality ?? ""] ?? 2,
    evidenceLabel: formatEvidenceLabel(protocol),
    description: cleanHealthCommonsUserFacingCopy(protocol.summary ?? summarizeBody(protocol.body)),
    expectedSignals: biomarkerEntities.map((biomarker) =>
      toExpectedSignal(protocol, biomarker)
    ),
    measurementPaths: measurementPaths.map(cleanMeasurementPathCopy),
    protocolFacts: toProtocolFacts(protocolSpec, testPlan).map(cleanProtocolFactCopy),
    protocol: toProtocolSteps(protocolSpec),
    protocolTips: cleanHealthCommonsUserFacingCopyList(protocolSpec?.tips),
    protocolKeepInMind: cleanHealthCommonsUserFacingCopyList(protocolSpec?.keepInMind),
    protocolLogFields: protocolSpec?.logFields ?? [],
    ...(protocol.experimentOnboarding
      ? { experimentOnboarding: protocol.experimentOnboarding }
      : {}),
    mechanismChain: (protocol.mechanismChain ?? []).map(cleanMechanismChainStepCopy),
    ...(protocol.protocol?.sessionShape
      ? { sessionShape: cleanSessionShapeCopy(protocol.protocol.sessionShape) }
      : {}),
    whyItWorks: cleanHealthCommonsUserFacingCopy(toWhyItWorks(protocol, claims)),
    experts: sourcePeople.map(toExpert),
    researchStats: toResearchStats({
      countedResearchSources,
      displaySources: citedDisplaySources,
      evidenceAppraisals,
      protocolKey: protocol.key,
    }),
    ...(protocol.researchLandscape
      ? {
          researchLandscape: {
            bottomLine: cleanHealthCommonsUserFacingCopy(
              protocol.researchLandscape?.bottomLine
                ?? "The evidence base is mixed enough to read by category.",
            ),
            confidenceLabel: protocol.researchLandscape?.confidenceLabel ?? "limited",
            primaryClaim: cleanHealthCommonsUserFacingCopy(
              protocol.researchLandscape?.primaryClaim
                ?? "Use the highest-quality direct sources to set the main claim.",
            ),
            mainCaveat: cleanHealthCommonsUserFacingCopy(
              protocol.researchLandscape?.mainCaveat
                ?? "Adjacent and safety sources should calibrate the claim rather than become direct proof.",
            ),
            groups: hasCompleteResearchGroupCoverage ? researchGroups : [],
          },
          ...(hasCompleteResearchGroupCoverage ? { researchGroups } : {}),
        }
      : {}),
    studies,
    safety: toSafety(safety),
    commons: {
      aliases: buildProtocolRouteAliases(protocol),
      catalogHash: catalog.catalogHash,
      key: protocol.key,
      pageRevisionId: protocol.revision.pageRevisionId,
      recipeHash: protocol.revision.recipeHash ?? null,
      routeId,
      runSpecRevisionId: protocol.revision.runSpecRevisionId ?? null,
      slug: protocol.slug,
    },
  };
}

function cleanProtocolFactCopy(
  fact: ExperimentProtocol["protocolFacts"][number],
): ExperimentProtocol["protocolFacts"][number] {
  const detail = cleanOptionalHealthCommonsUserFacingCopy(fact.detail);

  return {
    label: cleanHealthCommonsUserFacingCopy(fact.label),
    value: cleanHealthCommonsUserFacingCopy(fact.value),
    ...(detail ? { detail } : {}),
  };
}

function cleanMechanismChainStepCopy(
  step: ExperimentProtocol["mechanismChain"][number],
): ExperimentProtocol["mechanismChain"][number] {
  return {
    content: cleanHealthCommonsUserFacingCopy(step.content),
    label: cleanHealthCommonsUserFacingCopy(step.label),
  };
}

function cleanSessionShapeCopy(
  shape: NonNullable<ExperimentProtocol["sessionShape"]>,
): NonNullable<ExperimentProtocol["sessionShape"]> {
  return {
    ...(shape.label ? { label: cleanHealthCommonsUserFacingCopy(shape.label) } : {}),
    segments: shape.segments.map(cleanSessionShapeSegmentCopy),
    ...(shape.summarySegments
      ? { summarySegments: shape.summarySegments.map(cleanSessionShapeSegmentCopy) }
      : {}),
    ...(shape.ticks ? { ticks: shape.ticks.map(cleanSessionShapeTickCopy) } : {}),
  };
}

type ExperimentSessionShapeTick = NonNullable<
  NonNullable<ExperimentProtocol["sessionShape"]>["ticks"]
>[number];

function cleanSessionShapeTickCopy(
  tick: ExperimentSessionShapeTick,
): ExperimentSessionShapeTick {
  if (typeof tick === "string") {
    return cleanHealthCommonsUserFacingCopy(tick);
  }
  if ("offsetMinutes" in tick) {
    return {
      label: cleanHealthCommonsUserFacingCopy(tick.label),
      offsetMinutes: tick.offsetMinutes,
    };
  }
  return {
    label: cleanHealthCommonsUserFacingCopy(tick.label),
    positionPercent: tick.positionPercent,
  };
}

function cleanSessionShapeSegmentCopy(
  segment: NonNullable<ExperimentProtocol["sessionShape"]>["segments"][number],
): NonNullable<ExperimentProtocol["sessionShape"]>["segments"][number] {
  return {
    durationMinutes: segment.durationMinutes,
    kind: segment.kind,
    label: cleanHealthCommonsUserFacingCopy(segment.label),
  };
}

function cleanMeasurementPathCopy(
  path: ExperimentProtocol["measurementPaths"][number],
): ExperimentProtocol["measurementPaths"][number] {
  return {
    ...path,
    label: cleanHealthCommonsUserFacingCopy(path.label),
    methods: path.methods.map(cleanMeasurementMethodCopy),
    notes: cleanHealthCommonsUserFacingCopyList(path.notes),
    outcomeLabels: path.outcomeLabels.map(cleanHealthCommonsUserFacingCopy),
    safetyOutcomeLabels: path.safetyOutcomeLabels.map(cleanHealthCommonsUserFacingCopy),
  };
}

function cleanMeasurementMethodCopy(
  method: ExperimentProtocol["measurementPaths"][number]["methods"][number],
): ExperimentProtocol["measurementPaths"][number]["methods"][number] {
  const { privacy, summary, ...requiredMethod } = method;
  const cleanSummary = cleanOptionalHealthCommonsUserFacingCopy(summary);

  return {
    ...requiredMethod,
    shortName: cleanHealthCommonsUserFacingCopy(requiredMethod.shortName),
    title: cleanHealthCommonsUserFacingCopy(requiredMethod.title),
    ...(cleanSummary ? { summary: cleanSummary } : {}),
    ...(privacy
      ? {
          privacy: {
            ...privacy,
            notes: cleanHealthCommonsUserFacingCopyList(privacy.notes),
          },
        }
      : {}),
  };
}

function formatProtocolCategory(protocol: HealthCommonsCatalogEntity): string {
  const categories = protocol.categories ?? [];

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

  return formatCategory(categories[0] ?? protocol.entityType);
}

function toExperimentId(protocol: HealthCommonsCatalogEntity): string {
  return protocol.preferredRouteId ?? toTrailingRouteId(protocol.slug);
}

function toTrailingRouteId(slug: string): string {
  return slug.split("/").at(-1) ?? slug;
}

function buildProtocolRouteAliases(protocol: HealthCommonsCatalogEntity): string[] {
  return uniqueStrings([
    toExperimentId(protocol),
    protocol.key,
    protocol.key.replace(/^protocol_variant:/u, ""),
    protocol.slug,
    protocol.slug.split("/").at(-1) ?? null,
  ]);
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

function uniqueEntities(entities: readonly HealthCommonsEntity[]): HealthCommonsEntity[] {
  const seen = new Set<string>();
  const result: HealthCommonsEntity[] = [];

  for (const entity of entities) {
    if (seen.has(entity.key)) {
      continue;
    }

    seen.add(entity.key);
    result.push(entity);
  }

  return result;
}

function isStoredMediaEntry(value: unknown): value is StoredMedia {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  const relativePath = record["relativePath"];
  const mediaType = record["mediaType"];
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

  if (typeof mediaType !== "string" || mediaType.length === 0) {
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

function toMeasurementPaths(
  protocol: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalogReader,
): ExperimentProtocol["measurementPaths"] {
  const plan = protocol.measurementPlan;

  if (!plan) {
    return [];
  }

  return plan.paths
    .map((path, index) => ({
      index,
      path,
    }))
    .sort((left, right) => {
      if (left.path.pathId === plan.defaultPathId) {
        return -1;
      }

      if (right.path.pathId === plan.defaultPathId) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ path }) => toMeasurementPath({
      catalog,
      isDefault: path.pathId === plan.defaultPathId,
      path,
    }));
}

function toMeasurementPath(input: {
  catalog: HealthCommonsCatalogReader;
  isDefault: boolean;
  path: HealthCommonsMeasurementPlanPath;
}): ExperimentProtocol["measurementPaths"][number] {
  return {
    isDefault: input.isDefault,
    label: input.path.label,
    methodKeys: input.path.methodKeys,
    methods: input.path.methodKeys.map((methodKey) =>
      toMeasurementMethodReference({
        catalog: input.catalog,
        methodKey,
      })
    ),
    notes: input.path.notes ?? [],
    outcomeLabels: toMeasurementOutcomeLabels(input.catalog, input.path.outcomeKeys ?? []),
    pathId: input.path.pathId,
    required: input.path.required,
    safetyOutcomeLabels: toMeasurementOutcomeLabels(
      input.catalog,
      input.path.safetyOutcomeKeys ?? [],
    ),
    tier: input.path.tier,
  };
}

function toMeasurementMethodReference(input: {
  catalog: HealthCommonsCatalogReader;
  methodKey: string;
}): ExperimentProtocol["measurementPaths"][number]["methods"][number] {
  const entity = input.catalog.findByKey(input.methodKey);

  if (!isMeasurementMethodEntity(entity)) {
    throw new Error(
      `Measurement plan method key ${input.methodKey} did not resolve to a measurement_method.`,
    );
  }

  const method = entity.measurementMethod;
  const routeId = toTrailingRouteId(entity.slug);

  return {
    href: `/measurement-methods/${routeId}`,
    key: entity.key,
    modalities: method.modalities.map(formatCategory),
    ...(method.privacy
      ? {
          privacy: {
            ...(method.privacy.containsIdentifiableImages === undefined
              ? {}
              : { containsIdentifiableImages: method.privacy.containsIdentifiableImages }),
            ...(method.privacy.localOnlyRecommended === undefined
              ? {}
              : { localOnlyRecommended: method.privacy.localOnlyRecommended }),
            notes: method.privacy.notes ?? [],
          },
        }
      : {}),
    routeId,
    shortName: method.shortName ?? method.displayName ?? entity.title,
    summary: entity.summary ?? summarizeBody(entity.body),
    tier: method.tier,
    title: method.displayName ?? entity.title,
  };
}

function toMeasurementOutcomeLabels(
  catalog: HealthCommonsCatalogReader,
  keys: readonly string[],
): string[] {
  return keys.map((key) => {
    const entity = catalog.findByKey(key);

    if (entity?.entityType !== "biomarker") {
      throw new Error(
        `Measurement plan outcome key ${key} did not resolve to a biomarker.`,
      );
    }

    return entity.title;
  });
}

function isMeasurementMethodEntity(
  entity: HealthCommonsEntity | null,
): entity is HealthCommonsEntity & {
  entityType: "measurement_method";
  measurementMethod: HealthCommonsMeasurementMethod;
} {
  return entity?.entityType === "measurement_method" && entity.measurementMethod !== undefined;
}

function toProtocolFacts(
  protocol: HealthCommonsProtocolSpec | undefined,
  testPlan: HealthCommonsTestPlan | null,
): ExperimentProtocol["protocolFacts"] {
  if (!protocol) {
    return [];
  }

  return [
    testPlan
      ? {
          label: "Baseline",
          value: formatDays(testPlan.baselineDays),
          detail: "Keep the usual routine stable before the change.",
        }
      : null,
    testPlan
      ? {
          label: "Intervention",
          value: formatDays(testPlan.interventionDays),
          detail: formatAdherenceTarget(testPlan, protocol),
        }
      : null,
    formatProtocolFrequencyFact(protocol),
    formatProtocolDurationFact(protocol),
    formatProtocolTargetFact(protocol),
  ].filter((fact): fact is ExperimentProtocol["protocolFacts"][number] => fact !== null);
}

function toProtocolSteps(protocol: HealthCommonsProtocolSpec | undefined): ExperimentProtocol["protocol"] {
  const steps = protocol?.steps ?? [];

  return steps.map((step, index) => ({
    number: index + 1,
    title: `Step ${index + 1}`,
    detail: cleanHealthCommonsUserFacingCopy(step),
  }));
}

function toWhyItWorks(
  protocol: HealthCommonsCatalogEntity,
  claims: readonly HealthCommonsClaim[],
): string {
  if (protocol.whyItWorks && protocol.whyItWorks.length > 0) {
    return protocol.whyItWorks.join("\n\n");
  }

  const selectedClaims = claims
    .filter((claim) => claim.type !== "safety")
    .map((claim, index) => ({ claim, index }))
    .sort((left, right) => {
      const rankDelta = claimWhyItWorksRank(left.claim) - claimWhyItWorksRank(right.claim);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .slice(0, 4)
    .map(({ claim }) => claim.text);

  if (selectedClaims.length > 0) {
    return selectedClaims.join("\n\n");
  }

  return summarizeBody(protocol.body);
}

function claimWhyItWorksRank(claim: HealthCommonsClaim): number {
  switch (claim.type) {
    case "mechanistic":
      return 0;
    case "intervention_result":
      return 1;
    case "mixed_evidence":
      return 2;
    case "design_guardrail":
      return 3;
    case "evidence_scope":
      return 4;
    case "association_not_causation":
      return 5;
    case "community_outcome":
      return 6;
    case "safety":
      return 7;
  }
}

function formatProtocolFrequencyFact(
  protocol: HealthCommonsProtocolSpec,
): ExperimentProtocol["protocolFacts"][number] | null {
  const value = formatFrequency(protocol);

  return value
    ? {
        label: "Frequency",
        value: stripTrailingPeriod(value),
      }
    : null;
}

function formatProtocolDurationFact(
  protocol: HealthCommonsProtocolSpec,
): ExperimentProtocol["protocolFacts"][number] | null {
  const value = formatDuration(protocol);

  return value
    ? {
        label: "Session",
        value: stripTrailingPeriod(value),
      }
    : null;
}

function formatProtocolTargetFact(
  protocol: HealthCommonsProtocolSpec,
): ExperimentProtocol["protocolFacts"][number] | null {
  const target = protocol.target ?? formatTemperature(protocol);

  return target
    ? {
        label: protocol.temperatureC ? "Target" : "Dose",
        value: stripTrailingPeriod(target),
      }
    : {
        label: "Dose",
        value: protocol.doseSignature,
      };
}

function formatAdherenceTarget(
  testPlan: HealthCommonsTestPlan,
  protocol: HealthCommonsProtocolSpec,
): string | undefined {
  const target = testPlan.targetAdherenceSessions ?? protocol.interventionSessionsTarget;
  const minimum = testPlan.minimumAdherenceSessions ?? protocol.interventionSessionsMinimum;

  if (typeof target === "number" && typeof minimum === "number" && target !== minimum) {
    return `${minimum} session minimum; ${target} session target.`;
  }

  if (typeof target === "number") {
    return `${target} session target.`;
  }

  if (typeof minimum === "number") {
    return `${minimum} session minimum.`;
  }

  return undefined;
}

function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/\.$/u, "");
}

function toSafety(safety: HealthCommonsSafety | undefined): ExperimentProtocol["safety"] {
  if (!safety) {
    return {
      cautionLevel: 3,
      whoShouldAvoid: ["Use appropriate clinician guidance for heat exposure risks."],
      precautions: ["Stop if symptoms feel concerning."],
    };
  }

  return {
    cautionLevel: safetyCautionLevel(safety.cautionLevel),
    whoShouldAvoid: (safety.avoidOrGetClinicianGuidance ?? []).map(humanizeToken),
    precautions: cleanHealthCommonsUserFacingCopyList([
      ...(safety.notes ?? []),
      ...(safety.stopIf ?? []).map((item) => `Stop if: ${humanizeToken(item)}`),
    ]),
  };
}

function safetyCautionLevel(cautionLevel: HealthCommonsSafety["cautionLevel"]): number {
  switch (cautionLevel) {
    case "low":
      return 2;
    case "moderate":
      return 3;
    case "high":
      return 4;
    case "unknown":
      return 3;
  }
}

function protocolSpecDurationDays(protocol: HealthCommonsProtocolSpec | undefined): number {
  return protocol?.interventionSessionsTarget ?? 14;
}

function formatFrequency(protocol: HealthCommonsProtocolSpec): string | null {
  if (protocol.frequency?.sessionsPerWeek) {
    return `${protocol.frequency.sessionsPerWeek} sessions per week.`;
  }

  if (protocol.frequency?.sessionsPerDay) {
    return `${protocol.frequency.sessionsPerDay} sessions per day.`;
  }

  return null;
}

function formatDurationValue(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (minutes >= 120) {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return `${hours} hours`;
  }
  return `${minutes} minutes`;
}

function splitDurationValue(value: string): { amount: string; unit: string } | null {
  const match = /^(.+) (minutes|hours?)$/u.exec(value);

  if (!match) {
    return null;
  }

  const amount = match[1];
  const unit = match[2];
  if (!amount || !unit) {
    return null;
  }

  return {
    amount,
    unit: unit === "hour" ? "hours" : unit,
  };
}

function formatDurationRangeValue(min: number, max: number): string {
  const minValue = formatDurationValue(min);
  const maxValue = formatDurationValue(max);
  const minParts = splitDurationValue(minValue);
  const maxParts = splitDurationValue(maxValue);

  if (minParts && maxParts && minParts.unit === maxParts.unit) {
    return `${minParts.amount}–${maxValue}`;
  }

  return `${minValue}–${maxValue}`;
}

function formatDuration(protocol: HealthCommonsProtocolSpec): string | null {
  const min = protocol.durationMinutes?.min;
  const max = protocol.durationMinutes?.max;

  if (typeof min === "number" && typeof max === "number") {
    return min === max
      ? `${formatDurationValue(min)} per session.`
      : `${formatDurationRangeValue(min, max)} per session.`;
  }

  if (typeof min === "number") {
    return `At least ${formatDurationValue(min)} per session.`;
  }

  if (typeof max === "number") {
    return `Up to ${formatDurationValue(max)} per session.`;
  }

  return null;
}

function formatTemperature(protocol: HealthCommonsProtocolSpec): string | null {
  const min = protocol.temperatureC?.min;
  const max = protocol.temperatureC?.max;

  if (typeof min === "number" && typeof max === "number") {
    return min === max ? `${min} °C target temperature.` : `${min}–${max} °C target temperature.`;
  }

  return null;
}

function formatEvidenceLabel(protocol: HealthCommonsCatalogEntity): string {
  const status = formatStatus(protocol.status);
  const quality = formatQuality(protocol.quality);

  return status === quality ? quality : `${status} · ${quality}`;
}

function formatStatus(status: string | undefined): string {
  return status ? STATUS_LABELS[status] ?? humanizeToken(status) : "Draft";
}

function formatQuality(quality: string | undefined): string {
  return quality ? QUALITY_LABELS[quality] ?? humanizeToken(quality) : "Unreviewed";
}

function formatCategory(value: string): string {
  return value
    .split(/[._/-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeToken(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (match) => match.toUpperCase());
}

function summarizeBody(body: string): string {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.trim().length > 0
  ))];
}
