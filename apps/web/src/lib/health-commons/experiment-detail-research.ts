import type {
  HealthCommonsCatalogEntity,
  HealthCommonsEvidenceAppraisal,
  HealthCommonsResearchEvidence,
  HealthCommonsResearchLandscapeGroup,
  HealthCommonsSource,
} from "@murphai/contracts";

import type {
  ExperimentProtocol,
  ExperimentResearchGroup,
  Study,
} from "@/src/types/experiments";
import type { HealthCommonsEntity } from "@murphai/health-commons/runtime";

const NORWEGIAN_4X4_ROUTE_ID = "norwegian-4x4";
const PARTICIPANT_STAT_LABEL = "DIRECT HUMAN PARTICIPANTS";

interface BuiltResearchGroups {
  coveredSourceCount: number;
  groups: ExperimentResearchGroup[];
  totalSourceCount: number;
}

export function sortStudySourcesForDisplay(
  sources: readonly HealthCommonsEntity[],
): HealthCommonsEntity[] {
  return [...sources].sort((left, right) => {
    const participantDelta =
      studyParticipantSortValue(right) - studyParticipantSortValue(left);
    if (participantDelta !== 0) {
      return participantDelta;
    }

    const yearDelta = studyYearSortValue(right) - studyYearSortValue(left);
    if (yearDelta !== 0) {
      return yearDelta;
    }

    const includedStudyDelta =
      studyIncludedStudySortValue(right) - studyIncludedStudySortValue(left);
    if (includedStudyDelta !== 0) {
      return includedStudyDelta;
    }

    const rankDelta = studyDisplayRank(left) - studyDisplayRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

function studyParticipantSortValue(entity: HealthCommonsEntity): number {
  return entity.researchEvidence?.participantCount ?? -1;
}

function studyYearSortValue(entity: HealthCommonsEntity): number {
  return entity.source?.year ?? -1;
}

function studyIncludedStudySortValue(entity: HealthCommonsEntity): number {
  return entity.researchEvidence?.includedStudyCount ?? -1;
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

export function isDisplaySource(entity: HealthCommonsEntity): boolean {
  return entity.source?.kind !== undefined && entity.source.kind !== "other";
}

export function isCountedResearchSource(entity: HealthCommonsEntity): boolean {
  return entity.source?.kind === "journal_article" || entity.source?.kind === "review";
}

export function toStudy(
  entity: HealthCommonsEntity,
  appraisal?: HealthCommonsEvidenceAppraisal,
): Study {
  const source = entity.source;
  const evidence = entity.researchEvidence;
  const extractedFinding = extractStudyFinding(entity.body);
  const fallbackFinding = extractedFinding
    ? undefined
    : buildStudyFindingFallback(entity, appraisal);

  return {
    type: researchEvidenceToStudyType(evidence, source),
    title: source?.title ?? entity.title,
    authors: source?.authors ?? "Health Commons",
    journal: source?.journal ?? formatSourceSurfaceLabel(entity, source),
    year: source?.year,
    participants: evidence?.participantCount,
    participantCountKind: evidence?.participantCountKind,
    includedStudyCount: evidence?.includedStudyCount,
    population: evidence?.populationLabel,
    duration: evidence?.durationLabel,
    designLabel: evidence?.designLabel ?? (evidence
      ? formatResearchDesignLabel(evidence.designKind)
      : undefined),
    groupId: appraisal?.groupId,
    stance: appraisal?.stance,
    scope: appraisal?.scope,
    result: appraisal?.result,
    headline: appraisal?.headline,
    finding: extractedFinding ?? fallbackFinding?.text,
    findingKind: extractedFinding ? "finding" : fallbackFinding?.kind,
    implication: appraisal?.implication,
    caveat: appraisal?.caveat,
    displayPriority: appraisal?.displayPriority,
    url: source?.url,
  };
}

export function findProtocolEvidenceAppraisal(
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
  sourceKey: string,
  protocolKey: string,
): HealthCommonsEvidenceAppraisal | undefined {
  const normalizedSourceKey = stripRevision(sourceKey);
  const normalizedProtocolKey = stripRevision(protocolKey);
  const matchingAppraisals = evidenceAppraisals.filter((appraisal) =>
    stripRevision(appraisal.sourceKey) === normalizedSourceKey
    && stripRevision(appraisal.targetKey) === normalizedProtocolKey
  );

  return matchingAppraisals.length === 1 ? matchingAppraisals[0] : undefined;
}

export function toResearchGroups({
  citedStudySources,
  evidenceAppraisals,
  protocol,
}: {
  citedStudySources: readonly HealthCommonsEntity[];
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[];
  protocol: HealthCommonsCatalogEntity;
}): BuiltResearchGroups {
  const landscapeGroups = protocol.researchLandscape?.groups ?? [];

  if (landscapeGroups.length === 0) {
    return {
      coveredSourceCount: 0,
      groups: [],
      totalSourceCount: citedStudySources.length,
    };
  }

  const sourcesByKey = new Map(
    citedStudySources.map((source) => [source.key, source]),
  );

  const coveredSourceKeys = new Set<string>();
  const groups = landscapeGroups.flatMap((group) => {
    const studies = orderGroupStudySources(group, sourcesByKey, protocol.key, evidenceAppraisals)
      .flatMap((source) => {
        const appraisal = findGroupProtocolEvidenceAppraisal(
          evidenceAppraisals,
          source,
          protocol.key,
          group.id,
        );
        return appraisal ? [[source, appraisal] as const] : [];
      })
      .map((source) => {
        const [entity, appraisal] = source;
        coveredSourceKeys.add(entity.key);
        return toStudy(entity, appraisal);
      });

    if (studies.length === 0) {
      return [];
    }

    return [
      {
        id: group.id,
        label: group.label,
        stance: group.stance,
        summary: group.summary,
        studies,
        defaultOpen: group.defaultOpen,
      },
    ];
  });

  return {
    coveredSourceCount: coveredSourceKeys.size,
    groups,
    totalSourceCount: citedStudySources.length,
  };
}

function orderGroupStudySources(
  group: HealthCommonsResearchLandscapeGroup,
  sourcesByKey: ReadonlyMap<string, HealthCommonsEntity>,
  protocolKey: string,
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
): HealthCommonsEntity[] {
  const fromLandscapeOrder = group.sourceKeys.flatMap((sourceKey) => {
    const source = sourcesByKey.get(sourceKey);
    return source ? [source] : [];
  });

  return fromLandscapeOrder.sort((left, right) => {
    const leftPriority = findStudyDisplayPriority(left, group.id, protocolKey, evidenceAppraisals);
    const rightPriority = findStudyDisplayPriority(right, group.id, protocolKey, evidenceAppraisals);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return group.sourceKeys.indexOf(left.key) - group.sourceKeys.indexOf(right.key);
  });
}

function findStudyDisplayPriority(
  entity: HealthCommonsEntity,
  groupId: string,
  protocolKey: string,
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
): number {
  return findGroupProtocolEvidenceAppraisal(evidenceAppraisals, entity, protocolKey, groupId)
    ?.displayPriority ?? Number.MAX_SAFE_INTEGER;
}

function findGroupProtocolEvidenceAppraisal(
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
  entity: HealthCommonsEntity,
  protocolKey: string,
  groupId: string,
): HealthCommonsEvidenceAppraisal | undefined {
  const normalizedSourceKey = stripRevision(entity.key);
  const normalizedProtocolKey = stripRevision(protocolKey);
  return evidenceAppraisals.find((appraisal) =>
    stripRevision(appraisal.sourceKey) === normalizedSourceKey
    && stripRevision(appraisal.targetKey) === normalizedProtocolKey
    && appraisal.groupId === groupId
  );
}

function researchEvidenceToStudyType(
  evidence: HealthCommonsResearchEvidence | undefined,
  source: HealthCommonsSource | undefined,
): Study["type"] {
  switch (evidence?.designKind) {
    case "randomized_controlled_trial":
      return "RCT";
    case "single_person_report":
      return "N1";
    case "controlled_trial":
    case "crossover_trial":
    case "single_arm_trial":
    case "pilot_intervention":
      return "INT";
    case "prospective_cohort":
    case "retrospective_registry":
    case "cross_sectional":
    case "case_control":
      return "OBS";
    case "acute_mechanistic":
      return "MECH";
    case "meta_analysis":
      return "MA";
    case "systematic_review":
    case "narrative_review":
      return "REV";
    case "guideline":
    case "expert_protocol":
      return "GUIDE";
    case "bibliography":
    case "other":
      return "SRC";
    case undefined:
      break;
  }

  return sourceKindToStudyType(source);
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

  if (source.kind === "guideline" || source.kind === "external_protocol") {
    return "GUIDE";
  }

  if (source.kind === "review") {
    const title = source.title?.toLowerCase() ?? "";
    return title.includes("meta-analysis") || title.includes("meta analysis") ? "MA" : "REV";
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

export function countResearchStudies(
  countedResearchSources: readonly HealthCommonsEntity[],
): number {
  return countedResearchSources.filter(
    (entity) => entity.source?.kind === "journal_article",
  ).length;
}

export function hasMixedResearchAndProvenanceSources({
  countedResearchSources,
  displaySources,
}: {
  countedResearchSources: readonly HealthCommonsEntity[];
  displaySources: readonly HealthCommonsEntity[];
}): boolean {
  return countedResearchSources.length > 0
    && countedResearchSources.length < displaySources.length;
}

export function formatResearchSummaryLabel({
  countedResearchSources,
  displaySources,
}: {
  countedResearchSources: readonly HealthCommonsEntity[];
  displaySources: readonly HealthCommonsEntity[];
}): string {
  if (!hasMixedResearchAndProvenanceSources({
    countedResearchSources,
    displaySources,
  })) {
    const primaryParticipantCount = sumPrimaryParticipantCount(displaySources);
    if (
      primaryParticipantCount === 1 &&
      displaySources.some((entity) => entity.researchEvidence?.designKind === "single_person_report")
    ) {
      return "n=1 report";
    }

    return `${displaySources.length.toLocaleString()} ${
      displaySources.length === 1 ? "study" : "studies"
    }`;
  }

  const journalArticleCount = countResearchStudies(countedResearchSources);
  const reviewCount = countedResearchSources.filter(
    (entity) => entity.source?.kind === "review",
  ).length;

  if (journalArticleCount > 0 && reviewCount > 0) {
    return `${journalArticleCount.toLocaleString()} ${
      journalArticleCount === 1 ? "study" : "studies"
    } + ${reviewCount.toLocaleString()} ${
      reviewCount === 1 ? "review" : "reviews"
    }`;
  }

  if (journalArticleCount > 0) {
    return `${journalArticleCount.toLocaleString()} ${
      journalArticleCount === 1 ? "study" : "studies"
    }`;
  }

  if (reviewCount > 0) {
    return `${reviewCount.toLocaleString()} ${
      reviewCount === 1 ? "review" : "reviews"
    }`;
  }

  return `${displaySources.length.toLocaleString()} ${
    displaySources.length === 1 ? "source" : "sources"
  }`;
}

function formatResearchDesignLabel(
  designKind: HealthCommonsResearchEvidence["designKind"],
): string {
  return designKind
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toResearchStats({
  countedResearchSources,
  displaySources,
  evidenceAppraisals,
  protocolKey,
  routeId,
}: {
  countedResearchSources: readonly HealthCommonsEntity[];
  displaySources: readonly HealthCommonsEntity[];
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[];
  protocolKey: string;
  routeId: string;
}): ExperimentProtocol["researchStats"] {
  const participantCountSources = participantCountResearchSources({
    countedResearchSources,
    evidenceAppraisals,
    protocolKey,
    routeId,
  });

  if (!hasMixedResearchAndProvenanceSources({
    countedResearchSources,
    displaySources,
  })) {
    const reviewCount = displaySources.filter((entity) => entity.source?.kind === "review").length;
    const journalArticleCount = displaySources.filter(
      (entity) => entity.source?.kind === "journal_article",
    ).length;
    const codedParticipantCount = sumPrimaryParticipantCount(participantCountSources);
    const codedParticipantStats = codedParticipantCount > 0
      ? [
          {
            label: PARTICIPANT_STAT_LABEL,
            value: codedParticipantCount === 1
              ? "1"
              : `${codedParticipantCount.toLocaleString()}+`,
          },
        ]
      : [];
    const years = displaySources
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
      { label: "SOURCES CHECKED", value: displaySources.length },
      ...codedParticipantStats,
      { label: "REVIEW PAPERS", value: reviewCount },
      { label: "RESEARCH PAPERS", value: journalArticleCount },
      { label: "YEARS COVERED", value: researchYears },
    ];
  }

  const reviewCount = countedResearchSources.filter(
    (entity) => entity.source?.kind === "review",
  ).length;
  const journalArticleCount = countedResearchSources.filter(
    (entity) => entity.source?.kind === "journal_article",
  ).length;
  const codedParticipantCount = sumPrimaryParticipantCount(participantCountSources);
  const codedParticipantStats = codedParticipantCount > 0
    ? [
        {
          label: PARTICIPANT_STAT_LABEL,
          value: codedParticipantCount === 1
            ? "1"
            : `${codedParticipantCount.toLocaleString()}+`,
        },
      ]
    : [];
  const years = countedResearchSources
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
    { label: "SOURCES CHECKED", value: displaySources.length },
    ...codedParticipantStats,
    { label: "REVIEW PAPERS", value: reviewCount },
    { label: "RESEARCH PAPERS", value: journalArticleCount },
    { label: "YEARS COVERED", value: researchYears },
  ];
}

function participantCountResearchSources({
  countedResearchSources,
  evidenceAppraisals,
  protocolKey,
  routeId,
}: {
  countedResearchSources: readonly HealthCommonsEntity[];
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[];
  protocolKey: string;
  routeId: string;
}): readonly HealthCommonsEntity[] {
  if (routeId !== NORWEGIAN_4X4_ROUTE_ID) {
    return countedResearchSources;
  }

  return countedResearchSources.filter((entity) =>
    !isExcludedNorwegianParticipantCountSource(entity, protocolKey, evidenceAppraisals)
  );
}

function sumPrimaryParticipantCount(
  citedSources: readonly HealthCommonsEntity[],
): number {
  const countsByCohort = new Map<string, number>();

  for (const entity of citedSources) {
    const evidence = entity.researchEvidence;
    if (
      evidence?.aggregateRole !== "primary" ||
      typeof evidence.participantCount !== "number"
    ) {
      continue;
    }

    const cohortKey = evidence.cohortKey ?? entity.key;
    const existingCount = countsByCohort.get(cohortKey) ?? 0;
    countsByCohort.set(cohortKey, Math.max(existingCount, evidence.participantCount));
  }

  return [...countsByCohort.values()].reduce((sum, count) => sum + count, 0);
}

function isExcludedNorwegianParticipantCountSource(
  entity: HealthCommonsEntity,
  protocolKey: string,
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
): boolean {
  const evidence = entity.researchEvidence;

  if (
    evidence?.aggregateRole !== "primary"
    || evidence.designKind !== "retrospective_registry"
  ) {
    return false;
  }

  const normalizedSourceKey = stripRevision(entity.key);
  const normalizedProtocolKey = stripRevision(protocolKey);
  return evidenceAppraisals.some((appraisal) =>
    stripRevision(appraisal.sourceKey) === normalizedSourceKey
    && stripRevision(appraisal.targetKey) === normalizedProtocolKey
    && appraisal.stance === "safety_boundary"
  );
}

function buildStudyFindingFallback(
  entity: HealthCommonsEntity,
  appraisal: HealthCommonsEvidenceAppraisal | undefined,
): { kind: Study["findingKind"]; text: string } | undefined {
  const headline = normalizeStudyCardText(appraisal?.headline);
  const whyItMatters = normalizeStudyCardText(readPassthroughString(entity, "whyItMatters"));
  if (whyItMatters && whyItMatters !== headline) {
    return {
      kind: "why_it_matters",
      text: whyItMatters,
    };
  }

  const protocolTakeaway = normalizeStudyCardText(readPassthroughString(entity, "protocolTakeaway"));
  if (protocolTakeaway && protocolTakeaway !== headline && protocolTakeaway !== whyItMatters) {
    return {
      kind: "protocol_takeaway",
      text: protocolTakeaway,
    };
  }

  return undefined;
}

function readPassthroughString(entity: HealthCommonsEntity, key: string): string | undefined {
  const value = (entity as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeStudyCardText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  return normalized ? normalized : undefined;
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
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

function formatCategory(value: string): string {
  return value
    .split(/[._/-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
