import type {
  HealthCommonsWebExperimentProtocolTab,
  HealthCommonsWebExperimentResearchTab,
  HealthCommonsWebExperimentResultsPublic,
  HealthCommonsWebExperimentShell,
} from "@murphai/health-commons/runtime";

import {
  CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
} from "@/src/lib/experiments/experiment-detail";
import type {
  ExperimentCommonsReference,
  ExperimentProtocolStep,
} from "@/src/types/experiments";
import { resolveExperimentRouteImage } from "./experiment-images";
import {
  loadGeneratedExperimentProjection,
} from "./generated-experiment-artifacts";
import {
  cleanHealthCommonsUserFacingCopy,
  cleanHealthCommonsUserFacingCopyList,
  cleanOptionalHealthCommonsUserFacingCopy,
} from "./user-facing-copy";

export interface ExperimentShellProjection {
  protocolContractVersion: number;
  baselineDays: number;
  category: string;
  description: string;
  durationDays: number;
  evidenceLabel: string;
  evidenceLevel: number;
  id: string;
  image: string;
  key: string;
  revision: HealthCommonsWebExperimentShell["revision"];
  title: string;
}

export interface ExperimentResultsPublicProjection {
  protocolContractVersion: number;
  baselineDays: number;
  commons: ExperimentCommonsReference;
  durationDays: number;
  id: string;
  key: string;
  protocol: ExperimentProtocolStep[];
  revision: HealthCommonsWebExperimentResultsPublic["revision"];
  title: string;
}

export type ExperimentProtocolTabProjection =
  HealthCommonsWebExperimentProtocolTab & {
    protocolContractVersion: number;
  };

export type ExperimentResearchTabProjection = HealthCommonsWebExperimentResearchTab;

export function resolveHealthCommonsExperimentShell(
  experimentId: string,
): ExperimentShellProjection | null {
  const shell = loadGeneratedExperimentProjection(experimentId, "experiment.shell");

  return shell ? toExperimentShellProjection(shell) : null;
}

export function resolveHealthCommonsExperimentProtocolTab(
  experimentId: string,
): ExperimentProtocolTabProjection | null {
  const protocolTab = loadGeneratedExperimentProjection(experimentId, "experiment.protocol");

  return protocolTab ? toExperimentProtocolTabProjection(protocolTab) : null;
}

export function resolveHealthCommonsExperimentResearchTab(
  experimentId: string,
): ExperimentResearchTabProjection | null {
  const researchTab = loadGeneratedExperimentProjection(experimentId, "experiment.research");

  return researchTab ? toExperimentResearchTabProjection(researchTab) : null;
}

export function resolveHealthCommonsExperimentResultsPublic(
  experimentId: string,
): ExperimentResultsPublicProjection | null {
  const resultsPublic = loadGeneratedExperimentProjection(
    experimentId,
    "experiment.results-public",
  );

  return resultsPublic ? toExperimentResultsPublicProjection(resultsPublic) : null;
}

function toExperimentShellProjection(
  shell: HealthCommonsWebExperimentShell,
): ExperimentShellProjection {
  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    baselineDays: shell.baselineDays,
    category: cleanHealthCommonsUserFacingCopy(shell.category),
    description: cleanHealthCommonsUserFacingCopy(shell.description),
    durationDays: shell.durationDays,
    evidenceLabel: shell.evidenceLabel,
    evidenceLevel: shell.evidenceLevel,
    id: shell.id,
    image: resolveExperimentRouteImage(shell.id, shell.image),
    key: shell.key,
    revision: shell.revision,
    title: cleanHealthCommonsUserFacingCopy(shell.title),
  };
}

function toExperimentProtocolTabProjection(
  protocolTab: HealthCommonsWebExperimentProtocolTab,
): ExperimentProtocolTabProjection {
  return {
    ...protocolTab,
    expectedSignals: protocolTab.expectedSignals.map(cleanExperimentSignal),
    experts: protocolTab.experts.map(cleanExperimentExpert),
    measurementPaths: protocolTab.measurementPaths.map(cleanExperimentMeasurementPath),
    mechanismChain: protocolTab.mechanismChain.map(cleanExperimentMechanismChainStep),
    protocol: protocolTab.protocol.map(cleanExperimentProtocolStep),
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    protocolFacts: protocolTab.protocolFacts.map(cleanExperimentProtocolFact),
    protocolTips: cleanHealthCommonsUserFacingCopyList(protocolTab.protocolTips),
    safety: cleanExperimentSafety(protocolTab.safety),
    ...(protocolTab.sessionShape
      ? { sessionShape: cleanExperimentSessionShape(protocolTab.sessionShape) }
      : {}),
    title: cleanHealthCommonsUserFacingCopy(protocolTab.title),
    whyItWorks: cleanHealthCommonsUserFacingCopy(protocolTab.whyItWorks),
  };
}

function cleanExperimentMechanismChainStep(
  step: HealthCommonsWebExperimentProtocolTab["mechanismChain"][number],
): HealthCommonsWebExperimentProtocolTab["mechanismChain"][number] {
  return {
    content: cleanHealthCommonsUserFacingCopy(step.content),
    label: cleanHealthCommonsUserFacingCopy(step.label),
  };
}

function cleanExperimentSessionShape(
  shape: NonNullable<HealthCommonsWebExperimentProtocolTab["sessionShape"]>,
): NonNullable<HealthCommonsWebExperimentProtocolTab["sessionShape"]> {
  return {
    ...(shape.label ? { label: cleanHealthCommonsUserFacingCopy(shape.label) } : {}),
    segments: shape.segments.map(cleanExperimentSessionShapeSegment),
    ...(shape.summarySegments
      ? { summarySegments: shape.summarySegments.map(cleanExperimentSessionShapeSegment) }
      : {}),
    ...(shape.ticks ? { ticks: shape.ticks.map(cleanExperimentSessionShapeTick) } : {}),
  };
}

type ExperimentProjectionSessionShapeTick = NonNullable<
  NonNullable<HealthCommonsWebExperimentProtocolTab["sessionShape"]>["ticks"]
>[number];

function cleanExperimentSessionShapeTick(
  tick: ExperimentProjectionSessionShapeTick,
): ExperimentProjectionSessionShapeTick {
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

function cleanExperimentSessionShapeSegment(
  segment: NonNullable<HealthCommonsWebExperimentProtocolTab["sessionShape"]>["segments"][number],
): NonNullable<HealthCommonsWebExperimentProtocolTab["sessionShape"]>["segments"][number] {
  return {
    durationMinutes: segment.durationMinutes,
    kind: segment.kind,
    label: cleanHealthCommonsUserFacingCopy(segment.label),
  };
}

function toExperimentResearchTabProjection(
  researchTab: HealthCommonsWebExperimentResearchTab,
): ExperimentResearchTabProjection {
  return {
    ...researchTab,
    description: cleanHealthCommonsUserFacingCopy(researchTab.description),
    protocolKeepInMind: cleanHealthCommonsUserFacingCopyList(researchTab.protocolKeepInMind),
    ...(researchTab.researchGroups
      ? { researchGroups: researchTab.researchGroups.map(cleanExperimentResearchGroup) }
      : {}),
    ...(researchTab.researchLandscape
      ? { researchLandscape: cleanExperimentResearchLandscape(researchTab.researchLandscape) }
      : {}),
    researchStats: researchTab.researchStats.map(cleanExperimentResearchStat),
    studies: researchTab.studies.map(cleanExperimentResearchStudy),
    title: cleanHealthCommonsUserFacingCopy(researchTab.title),
  };
}

function toExperimentResultsPublicProjection(
  resultsPublic: HealthCommonsWebExperimentResultsPublic,
): ExperimentResultsPublicProjection {
  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    baselineDays: resultsPublic.baselineDays,
    commons: resultsPublic.commons,
    durationDays: resultsPublic.durationDays,
    id: resultsPublic.id,
    key: resultsPublic.key,
    protocol: resultsPublic.protocol.map(cleanExperimentProtocolStep),
    revision: resultsPublic.revision,
    title: cleanHealthCommonsUserFacingCopy(resultsPublic.title),
  };
}

function cleanExperimentSignal(
  signal: HealthCommonsWebExperimentProtocolTab["expectedSignals"][number],
): HealthCommonsWebExperimentProtocolTab["expectedSignals"][number] {
  const {
    baseline,
    description,
    displayValue,
    estimatedChange,
    unit,
    ...requiredSignal
  } = signal;
  const cleanBaseline = cleanOptionalHealthCommonsUserFacingCopy(baseline);
  const cleanDescription = cleanOptionalHealthCommonsUserFacingCopy(description);
  const cleanDisplayValue = cleanOptionalHealthCommonsUserFacingCopy(displayValue);
  const cleanEstimatedChange = cleanExperimentSignalEstimate(estimatedChange);
  const cleanUnit = cleanOptionalHealthCommonsUserFacingCopy(unit);

  return {
    ...requiredSignal,
    delta: cleanHealthCommonsUserFacingCopy(requiredSignal.delta),
    expected: cleanHealthCommonsUserFacingCopy(requiredSignal.expected),
    label: cleanHealthCommonsUserFacingCopy(requiredSignal.label),
    value: cleanHealthCommonsUserFacingCopy(requiredSignal.value),
    ...(cleanBaseline ? { baseline: cleanBaseline } : {}),
    ...(cleanDescription ? { description: cleanDescription } : {}),
    ...(cleanDisplayValue ? { displayValue: cleanDisplayValue } : {}),
    ...(cleanEstimatedChange ? { estimatedChange: cleanEstimatedChange } : {}),
    ...(cleanUnit ? { unit: cleanUnit } : {}),
  };
}

function cleanExperimentSignalEstimate(
  estimate:
    | HealthCommonsWebExperimentProtocolTab["expectedSignals"][number]["estimatedChange"]
    | undefined,
):
  | HealthCommonsWebExperimentProtocolTab["expectedSignals"][number]["estimatedChange"]
  | undefined {
  if (!estimate) {
    return undefined;
  }

  const cleanBasis = cleanOptionalHealthCommonsUserFacingCopy(estimate.basis);
  const cleanWindow = cleanOptionalHealthCommonsUserFacingCopy(estimate.window);

  if (estimate.kind === "mixed_or_contextual") {
    return {
      kind: estimate.kind,
      ...(estimate.confidence ? { confidence: estimate.confidence } : {}),
      ...(cleanWindow ? { window: cleanWindow } : {}),
      ...(cleanBasis ? { basis: cleanBasis } : {}),
    };
  }

  return {
    high: estimate.high,
    kind: estimate.kind,
    low: estimate.low,
    unit: cleanHealthCommonsUserFacingCopy(estimate.unit),
    ...(estimate.confidence ? { confidence: estimate.confidence } : {}),
    ...(cleanWindow ? { window: cleanWindow } : {}),
    ...(cleanBasis ? { basis: cleanBasis } : {}),
  };
}

function cleanExperimentExpert(
  expert: HealthCommonsWebExperimentProtocolTab["experts"][number],
): HealthCommonsWebExperimentProtocolTab["experts"][number] {
  const { profileImageUrl, ...requiredExpert } = expert;

  return {
    ...requiredExpert,
    field: cleanHealthCommonsUserFacingCopy(requiredExpert.field),
    initials: cleanHealthCommonsUserFacingCopy(requiredExpert.initials),
    name: cleanHealthCommonsUserFacingCopy(requiredExpert.name),
    quote: cleanHealthCommonsUserFacingCopy(requiredExpert.quote),
    ...(profileImageUrl ? { profileImageUrl } : {}),
  };
}

function cleanExperimentMeasurementPath(
  path: HealthCommonsWebExperimentProtocolTab["measurementPaths"][number],
): HealthCommonsWebExperimentProtocolTab["measurementPaths"][number] {
  return {
    ...path,
    label: cleanHealthCommonsUserFacingCopy(path.label),
    methods: path.methods.map(cleanExperimentMeasurementMethod),
    notes: cleanHealthCommonsUserFacingCopyList(path.notes),
    outcomeLabels: path.outcomeLabels.map(cleanHealthCommonsUserFacingCopy),
    safetyOutcomeLabels: path.safetyOutcomeLabels.map(cleanHealthCommonsUserFacingCopy),
  };
}

function cleanExperimentMeasurementMethod(
  method: HealthCommonsWebExperimentProtocolTab["measurementPaths"][number]["methods"][number],
): HealthCommonsWebExperimentProtocolTab["measurementPaths"][number]["methods"][number] {
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

function cleanExperimentProtocolFact(
  fact: HealthCommonsWebExperimentProtocolTab["protocolFacts"][number],
): HealthCommonsWebExperimentProtocolTab["protocolFacts"][number] {
  const cleanDetail = cleanOptionalHealthCommonsUserFacingCopy(fact.detail);

  return {
    label: cleanHealthCommonsUserFacingCopy(fact.label),
    value: cleanHealthCommonsUserFacingCopy(fact.value),
    ...(cleanDetail ? { detail: cleanDetail } : {}),
  };
}

function cleanExperimentProtocolStep(
  step: HealthCommonsWebExperimentProtocolTab["protocol"][number],
): HealthCommonsWebExperimentProtocolTab["protocol"][number] {
  return {
    ...step,
    detail: cleanHealthCommonsUserFacingCopy(step.detail),
    title: cleanHealthCommonsUserFacingCopy(step.title),
  };
}

function cleanExperimentSafety(
  safety: HealthCommonsWebExperimentProtocolTab["safety"],
): HealthCommonsWebExperimentProtocolTab["safety"] {
  return {
    cautionLevel: safety.cautionLevel,
    precautions: cleanHealthCommonsUserFacingCopyList(safety.precautions),
    whoShouldAvoid: cleanHealthCommonsUserFacingCopyList(safety.whoShouldAvoid),
  };
}

function cleanExperimentResearchLandscape(
  landscape: NonNullable<HealthCommonsWebExperimentResearchTab["researchLandscape"]>,
): NonNullable<HealthCommonsWebExperimentResearchTab["researchLandscape"]> {
  return {
    bottomLine: cleanHealthCommonsUserFacingCopy(landscape.bottomLine),
    confidenceLabel: landscape.confidenceLabel,
    mainCaveat: cleanHealthCommonsUserFacingCopy(landscape.mainCaveat),
    primaryClaim: cleanHealthCommonsUserFacingCopy(landscape.primaryClaim),
  };
}

function cleanExperimentResearchGroup(
  group: NonNullable<HealthCommonsWebExperimentResearchTab["researchGroups"]>[number],
): NonNullable<HealthCommonsWebExperimentResearchTab["researchGroups"]>[number] {
  return {
    ...group,
    label: cleanHealthCommonsUserFacingCopy(group.label),
    studies: group.studies.map(cleanExperimentResearchStudy),
    summary: cleanHealthCommonsUserFacingCopy(group.summary),
  };
}

function cleanExperimentResearchStat(
  stat: HealthCommonsWebExperimentResearchTab["researchStats"][number],
): HealthCommonsWebExperimentResearchTab["researchStats"][number] {
  return {
    label: cleanHealthCommonsUserFacingCopy(stat.label),
    value: typeof stat.value === "string"
      ? cleanHealthCommonsUserFacingCopy(stat.value)
      : stat.value,
  };
}

function cleanExperimentResearchStudy(
  study: HealthCommonsWebExperimentResearchTab["studies"][number],
): HealthCommonsWebExperimentResearchTab["studies"][number] {
  const {
    caveat,
    designLabel,
    duration,
    finding,
    headline,
    implication,
    population,
    ...requiredStudy
  } = study;
  const cleanCaveat = cleanOptionalHealthCommonsUserFacingCopy(caveat);
  const cleanDesignLabel = cleanOptionalHealthCommonsUserFacingCopy(designLabel);
  const cleanDuration = cleanOptionalHealthCommonsUserFacingCopy(duration);
  const cleanFinding = cleanOptionalHealthCommonsUserFacingCopy(finding);
  const cleanHeadline = cleanOptionalHealthCommonsUserFacingCopy(headline);
  const cleanImplication = cleanOptionalHealthCommonsUserFacingCopy(implication);
  const cleanPopulation = cleanOptionalHealthCommonsUserFacingCopy(population);

  return {
    ...requiredStudy,
    authors: cleanHealthCommonsUserFacingCopy(requiredStudy.authors),
    journal: cleanHealthCommonsUserFacingCopy(requiredStudy.journal),
    title: cleanHealthCommonsUserFacingCopy(requiredStudy.title),
    ...(cleanCaveat ? { caveat: cleanCaveat } : {}),
    ...(cleanDesignLabel ? { designLabel: cleanDesignLabel } : {}),
    ...(cleanDuration ? { duration: cleanDuration } : {}),
    ...(cleanFinding ? { finding: cleanFinding } : {}),
    ...(cleanHeadline ? { headline: cleanHeadline } : {}),
    ...(cleanImplication ? { implication: cleanImplication } : {}),
    ...(cleanPopulation ? { population: cleanPopulation } : {}),
  };
}
