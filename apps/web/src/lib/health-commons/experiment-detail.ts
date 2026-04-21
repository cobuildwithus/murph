import type {
  HealthCommonsCatalogEntity,
  HealthCommonsClaim,
  HealthCommonsProtocolSpec,
  HealthCommonsSafety,
  HealthCommonsTestPlan,
  HealthCommonsSource,
} from "@murphai/contracts/health-commons";

import {
  CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
} from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol, Expert, Study } from "@/src/types/experiments";
import { healthCommonsCatalog, type HealthCommonsCatalogReader, type HealthCommonsEntity } from "./catalog";

const FINNISH_SAUNA_ROUTE_ID = "finnish-sauna";
const FINNISH_SAUNA_IMAGE = "/design-assets/hero-sauna.png";
const SLEEP_EXPERIMENT_IMAGE = "/design-assets/hero-02.png";
const EXERCISE_EXPERIMENT_IMAGE = "/design-assets/hero-03.png";

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

const PROTOCOL_LIBRARY_ORDER = [
  FINNISH_SAUNA_ROUTE_ID,
  "norwegian-4x4",
  "red-light-glasses-before-bed",
  "bryan-johnson-blueprint",
] as const;

const BIOMARKER_DISPLAY_HINTS: Record<string, {
  direction: "up" | "down" | "neutral";
  expected: string;
}> = {
  "biomarker:deep-sleep-minutes": {
    direction: "neutral",
    expected: "Exploratory context",
  },
  "biomarker:hrv-rmssd": {
    direction: "neutral",
    expected: "Exploratory signal",
  },
  "biomarker:morning-blood-pressure": {
    direction: "down",
    expected: "Optional marker",
  },
  "biomarker:resting-heart-rate": {
    direction: "down",
    expected: "Primary marker",
  },
  "biomarker:sleep-efficiency": {
    direction: "up",
    expected: "Sleep context",
  },
};

const SOURCE_PERSON_EXPERT_QUOTES: Partial<Record<string, string>> = {
  "source_person:bryan-johnson":
    "Blueprint founder whose public sauna routine offers a higher-burden comparison to simpler dry-sauna experiments and highlights aggressive implementation choices.",
};

export function listHealthCommonsExperimentProtocols(
  catalog: HealthCommonsCatalogReader = healthCommonsCatalog,
): ExperimentProtocol[] {
  return catalog
    .listByEntityType("protocol_variant")
    .filter((protocol) => protocol.entityType === "protocol_variant")
    .filter((protocol) => protocol.status !== "deprecated")
    .map((protocol) => toExperimentDetail(protocol, catalog))
    .sort(compareExperimentProtocolOrder);
}

export function resolveHealthCommonsExperimentProtocol(
  experimentId: string,
  catalog: HealthCommonsCatalogReader = healthCommonsCatalog,
): ExperimentProtocol | null {
  const protocol = catalog.findByRouteId({
    entityType: "protocol_variant",
    routeId: normalizeExperimentRouteId(experimentId),
  });

  if (!protocol || protocol.entityType !== "protocol_variant") {
    return null;
  }

  return toExperimentDetail(protocol, catalog);
}

function normalizeExperimentRouteId(value: string): string {
  if (value === FINNISH_SAUNA_ROUTE_ID) {
    return value;
  }

  return value;
}

function compareExperimentProtocolOrder(
  left: ExperimentProtocol,
  right: ExperimentProtocol,
): number {
  const leftOrder = protocolLibraryOrder(left.id);
  const rightOrder = protocolLibraryOrder(right.id);

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.title.localeCompare(right.title);
}

function protocolLibraryOrder(protocolId: string): number {
  const order = PROTOCOL_LIBRARY_ORDER.findIndex((knownProtocolId) =>
    knownProtocolId === protocolId
  );

  return order === -1 ? Number.MAX_SAFE_INTEGER : order;
}

function toExperimentDetail(
  protocol: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalogReader,
): ExperimentProtocol {
  const routeId = toExperimentId(protocol);
  const testPlan = protocol.testPlans?.[0] ?? null;
  const protocolSpec = protocol.protocol;
  const safety = protocol.safety;
  const citedSources = catalog.listRelated({
    entity: protocol,
    entityTypes: ["source_artifact"],
    relationTypes: ["cites"],
  });
  const citedStudySources = citedSources.filter(isStudySource);
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
    title: protocol.title,
    category: formatProtocolCategory(protocol),
    image: resolveProtocolImage(protocol),
    durationDays: testPlan?.durationDays ?? protocolSpecDurationDays(protocolSpec),
    baselineDays: testPlan?.baselineDays ?? 0,
    studyCount: citedStudySources.length,
    evidenceLevel: QUALITY_TO_EVIDENCE_LEVEL[protocol.quality ?? ""] ?? 2,
    evidenceLabel: formatEvidenceLabel(protocol),
    description: protocol.summary ?? summarizeBody(protocol.body),
    expectedSignals: biomarkerEntities.map((biomarker) => toExpectedSignal(biomarker)),
    protocolFacts: toProtocolFacts(protocolSpec, testPlan),
    protocol: toProtocolSteps(protocolSpec),
    protocolTips: protocolSpec?.tips ?? [],
    protocolKeepInMind: protocolSpec?.keepInMind ?? [],
    protocolLogFields: protocolSpec?.logFields ?? [],
    whyItWorks: toWhyItWorks(protocol, claims),
    experts: sourcePeople.map(toExpert),
    researchStats: toResearchStats(citedStudySources),
    studies: sortStudySourcesForDisplay(citedStudySources).map(toStudy),
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

function resolveProtocolImage(protocol: HealthCommonsCatalogEntity): string {
  const lookupText = [
    protocol.key,
    protocol.slug,
    protocol.title,
    ...(protocol.categories ?? []),
  ].join(" ");

  if (/red-light|sleep|circadian|evening-light/iu.test(lookupText)) {
    return SLEEP_EXPERIMENT_IMAGE;
  }

  if (/4x4|exercise|cardio|vo2max|hiit/iu.test(lookupText)) {
    return EXERCISE_EXPERIMENT_IMAGE;
  }

  return FINNISH_SAUNA_IMAGE;
}

function toExperimentId(protocol: HealthCommonsCatalogEntity): string {
  if (protocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week") {
    return FINNISH_SAUNA_ROUTE_ID;
  }

  return protocol.slug.split("/").at(-1) ?? protocol.slug;
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

function listProtocolBiomarkers(
  protocol: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalogReader,
): HealthCommonsEntity[] {
  const testPlan = protocol.testPlans?.[0];
  const orderedKeys = [
    testPlan?.primaryBiomarkerKey,
    ...(testPlan?.secondaryBiomarkerKeys ?? []),
  ].filter((key): key is string => typeof key === "string");
  const fromTestPlan = orderedKeys.flatMap((key) => {
    const entity = catalog.findByKey(key);
    return entity?.entityType === "biomarker" ? [entity] : [];
  });

  if (fromTestPlan.length > 0) {
    return fromTestPlan;
  }

  return catalog.listRelated({
    entity: protocol,
    entityTypes: ["biomarker"],
    relationTypes: ["primary_biomarker", "secondary_biomarker"],
  });
}

function toExpectedSignal(biomarker: HealthCommonsEntity): ExperimentProtocol["expectedSignals"][number] {
  const hint = BIOMARKER_DISPLAY_HINTS[biomarker.key] ?? {
    direction: "neutral" as const,
    expected: "Worth watching",
  };

  return {
    label: biomarker.title,
    value: "",
    delta: "",
    direction: hint.direction,
    expected: hint.expected,
    description: biomarker.summary ?? summarizeBody(biomarker.body),
  };
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
    detail: step,
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

function toExpert(entity: HealthCommonsEntity): Expert {
  const initials = entity.title
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "HC";

  return {
    initials,
    name: entity.title,
    field: entity.entityType === "source_person"
      ? ""
      : formatCategory(entity.categories?.[0] ?? "source"),
    quote:
      SOURCE_PERSON_EXPERT_QUOTES[entity.key]
      ?? entity.summary
      ?? summarizeBody(entity.body),
  };
}

function sortStudySourcesForDisplay(
  sources: readonly HealthCommonsEntity[],
): HealthCommonsEntity[] {
  return [...sources].sort((left, right) => {
    const rankDelta = studyDisplayRank(left) - studyDisplayRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    const leftYear = left.source?.year ?? Number.MAX_SAFE_INTEGER;
    const rightYear = right.source?.year ?? Number.MAX_SAFE_INTEGER;
    if (leftYear !== rightYear) {
      return leftYear - rightYear;
    }

    return left.title.localeCompare(right.title);
  });
}

function studyDisplayRank(entity: HealthCommonsEntity): number {
  const bucket = typeof entity.evidenceBucket === "string"
    ? entity.evidenceBucket.toLowerCase()
    : "";
  const priority = typeof entity.murphV1Priority === "string"
    ? entity.murphV1Priority.toLowerCase()
    : "";

  if (bucket.includes("evidence backbone")) {
    return 0;
  }

  if (priority === "high") {
    return 1;
  }

  if (bucket.includes("long-term finnish cohort")) {
    return 2;
  }

  if (bucket.includes("acute") || bucket.includes("mechanistic")) {
    return 3;
  }

  if (bucket.includes("intervention") || bucket.includes("reality")) {
    return 4;
  }

  if (priority === "medium") {
    return 5;
  }

  return 6;
}

function isStudySource(entity: HealthCommonsEntity): boolean {
  return entity.source?.kind !== undefined && entity.source.kind !== "other";
}

function toStudy(entity: HealthCommonsEntity): Study {
  const source = entity.source;

  return {
    type: sourceKindToStudyType(source),
    title: source?.title ?? entity.title,
    authors: source?.authors ?? "Health Commons",
    journal: source?.journal ?? formatSourceSurfaceLabel(entity, source),
    year: source?.year,
    finding: entity.summary ?? summarizeBody(entity.body),
    url: source?.url,
  };
}

function formatSourceSurfaceLabel(
  entity: HealthCommonsEntity,
  source: HealthCommonsSource | undefined,
): string {
  if (!source) {
    return formatCategory(entity.entityType);
  }

  if (source.kind !== "web_page") {
    return formatCategory(source.kind);
  }

  const categories = new Set((entity.categories ?? []).map((category) => category.toLowerCase()));
  const url = source.url?.toLowerCase() ?? "";

  if (
    categories.has("x-post") ||
    url.includes("://x.com/") ||
    url.includes("://twitter.com/")
  ) {
    return "X Post";
  }

  if (
    categories.has("linkedin") ||
    url.includes("://www.linkedin.com/") ||
    url.includes("://linkedin.com/")
  ) {
    return "LinkedIn Post";
  }

  if (categories.has("substack") || url.includes(".substack.com/")) {
    return "Substack Post";
  }

  if (categories.has("blueprint") || url.includes("://blueprint.bryanjohnson.com/")) {
    return "Blueprint Page";
  }

  return "Web Page";
}

function sourceKindToStudyType(source: HealthCommonsSource | undefined): Study["type"] {
  if (!source) {
    return "SRC";
  }

  if (source.kind === "review" || source.kind === "guideline") {
    return "MA";
  }

  if (source.kind === "journal_article") {
    const studyText = [source.title, source.journal]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase();

    if (
      studyText.includes("randomized") ||
      studyText.includes("randomised") ||
      studyText.includes("controlled trial")
    ) {
      return "RCT";
    }

    if (
      studyText.includes("cohort") ||
      studyText.includes("association") ||
      studyText.includes("observational")
    ) {
      return "OBS";
    }

    return "SRC";
  }

  return "SRC";
}

function toResearchStats(
  citedSources: readonly HealthCommonsEntity[],
): ExperimentProtocol["researchStats"] {
  const reviewCount = citedSources.filter((entity) => entity.source?.kind === "review").length;
  const journalArticleCount = citedSources.filter(
    (entity) => entity.source?.kind === "journal_article",
  ).length;
  const years = citedSources
    .map((entity) => entity.source?.year)
    .filter((year): year is number => typeof year === "number")
    .sort((left, right) => left - right);
  const researchYears =
    years.length === 0
      ? "—"
      : years[0] === years[years.length - 1]
        ? `${years[0]}`
        : `${years[0]}–${years[years.length - 1]}`;

  return [
    { label: "STUDIES", value: citedSources.length },
    { label: "REVIEWS", value: reviewCount },
    { label: "JOURNAL ARTICLES", value: journalArticleCount },
    { label: "RESEARCH YEARS", value: researchYears },
  ];
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
    precautions: [
      ...(safety.notes ?? []),
      ...(safety.stopIf && safety.stopIf.length > 0
        ? [`Stop if: ${safety.stopIf.map(humanizeToken).join(", ")}.`]
        : []),
    ],
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

function formatDuration(protocol: HealthCommonsProtocolSpec): string | null {
  const min = protocol.durationMinutes?.min;
  const max = protocol.durationMinutes?.max;

  if (typeof min === "number" && typeof max === "number") {
    return min === max ? `${min} minutes per session.` : `${min}–${max} minutes per session.`;
  }

  if (typeof min === "number") {
    return `At least ${min} minutes per session.`;
  }

  if (typeof max === "number") {
    return `Up to ${max} minutes per session.`;
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
