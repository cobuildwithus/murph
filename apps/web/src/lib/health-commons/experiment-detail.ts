import type {
  HealthCommonsCatalogEntity,
  HealthCommonsClaim,
  HealthCommonsProtocolSpec,
  HealthCommonsSafety,
  HealthCommonsSource,
} from "@murphai/contracts/health-commons";

import type { Experiment, Expert, Study } from "@/src/types/experiments";
import { healthCommonsCatalog, type HealthCommonsCatalogReader, type HealthCommonsEntity } from "./catalog";

const FINNISH_SAUNA_ROUTE_ID = "finnish-sauna";
const FINNISH_SAUNA_IMAGE = "/design-assets/hero-sauna.png";

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

export function resolveHealthCommonsExperimentDetail(
  experimentId: string,
  catalog: HealthCommonsCatalogReader = healthCommonsCatalog,
): Experiment | null {
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

function toExperimentDetail(
  protocol: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalogReader,
): Experiment {
  const testPlan = protocol.testPlans?.[0] ?? null;
  const protocolSpec = protocol.protocol;
  const safety = protocol.safety;
  const citedSources = catalog.listRelated({
    entity: protocol,
    entityTypes: ["source_artifact"],
    relationTypes: ["cites"],
  });
  const biomarkerEntities = listProtocolBiomarkers(protocol, catalog);
  const sourcePeople = catalog.listRelated({
    entity: protocol,
    entityTypes: ["source_person"],
    relationTypes: ["source_person"],
  });
  const claims = protocol.claims ?? [];

  return {
    id: toExperimentId(protocol),
    title: protocol.title,
    category: formatCategory(protocol.categories?.[0] ?? protocol.entityType),
    status: "upcoming",
    image: FINNISH_SAUNA_IMAGE,
    durationDays: testPlan?.durationDays ?? protocolSpecDurationDays(protocolSpec),
    baselineDays: testPlan?.baselineDays ?? 0,
    studyCount: citedSources.length,
    evidenceLevel: QUALITY_TO_EVIDENCE_LEVEL[protocol.quality ?? ""] ?? 2,
    evidenceLabel: formatEvidenceLabel(protocol),
    description: protocol.summary ?? summarizeBody(protocol.body),
    expectedSignals: biomarkerEntities.map((biomarker) => toExpectedSignal(biomarker)),
    protocol: toProtocolSteps(protocolSpec),
    whyItWorks: toWhyItWorks(protocol, claims),
    experts: sourcePeople.map(toExpert),
    researchStats: toResearchStats(citedSources),
    studies: citedSources
      .filter((entity) => entity.source?.kind !== "other")
      .slice(0, 6)
      .map(toStudy),
    safety: toSafety(safety),
    signals: [],
    trends: [],
    timeline: [],
    commons: {
      catalogHash: catalog.catalogHash,
      key: protocol.key,
      pageRevisionId: protocol.revision.pageRevisionId,
      recipeHash: protocol.revision.recipeHash ?? null,
      runSpecRevisionId: protocol.revision.runSpecRevisionId ?? null,
    },
  };
}

function toExperimentId(protocol: HealthCommonsCatalogEntity): string {
  if (protocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week") {
    return FINNISH_SAUNA_ROUTE_ID;
  }

  return protocol.slug.split("/").at(-1) ?? protocol.slug;
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

function toExpectedSignal(biomarker: HealthCommonsEntity): Experiment["expectedSignals"][number] {
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

function toProtocolSteps(protocol: HealthCommonsProtocolSpec | undefined): Experiment["protocol"] {
  if (!protocol) {
    return [];
  }

  const setupSteps = [
    protocol.doseSignature,
    formatFrequency(protocol),
    formatDuration(protocol),
    formatTemperature(protocol),
  ].filter((step): step is string => step !== null);
  const steps = [...setupSteps, ...(protocol.steps ?? [])];

  return steps.map((step, index) => ({
    number: index + 1,
    title: index === 0 ? "Dose" : `Step ${index + 1}`,
    detail: step,
  }));
}

function toWhyItWorks(
  protocol: HealthCommonsCatalogEntity,
  claims: readonly HealthCommonsClaim[],
): string {
  const selectedClaims = claims
    .filter((claim) => claim.type !== "safety")
    .slice(0, 4)
    .map((claim) => claim.text);

  if (selectedClaims.length > 0) {
    return selectedClaims.join("\n\n");
  }

  return summarizeBody(protocol.body);
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
    field: formatCategory(entity.categories?.[0] ?? "source"),
    quote: entity.summary ?? summarizeBody(entity.body),
  };
}

function toStudy(entity: HealthCommonsEntity): Study {
  const source = entity.source;

  return {
    type: sourceKindToStudyType(source),
    title: source?.title ?? entity.title,
    authors: source?.authors ?? "Health Commons",
    journal: source?.journal ?? formatCategory(source?.kind ?? entity.entityType),
    year: source?.year,
    finding: entity.summary ?? summarizeBody(entity.body),
    url: source?.url,
  };
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
): Experiment["researchStats"] {
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
    { label: "CITED SOURCES", value: citedSources.length },
    { label: "REVIEWS", value: reviewCount },
    { label: "JOURNAL ARTICLES", value: journalArticleCount },
    { label: "RESEARCH YEARS", value: researchYears },
  ];
}

function toSafety(safety: HealthCommonsSafety | undefined): Experiment["safety"] {
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
