import type {
  HealthCommonsBiomarkerDesiredDirection,
  HealthCommonsBiomarkerProtocolExpectedDirection,
  HealthCommonsCatalogEntity,
} from "@murphai/contracts";
import type {
  HealthCommonsCatalogReader,
  HealthCommonsEntity,
} from "@murphai/health-commons/runtime";

import type { ExperimentProtocol } from "@/src/types/experiments";
import {
  cleanHealthCommonsUserFacingCopy,
  cleanOptionalHealthCommonsUserFacingCopy,
} from "./user-facing-copy";

type BiomarkerSignalDirection =
  ExperimentProtocol["expectedSignals"][number]["direction"];
type BiomarkerSignalProminence = NonNullable<
  ExperimentProtocol["expectedSignals"][number]["protocolProminence"]
>;
type BiomarkerSignalEstimatedChange =
  ExperimentProtocol["expectedSignals"][number]["estimatedChange"];

interface BiomarkerDisplayHint {
  description?: string;
  direction: BiomarkerSignalDirection;
  expected: string;
  protocolProminence?: BiomarkerSignalProminence;
}

const DEFAULT_BIOMARKER_DISPLAY_HINTS: Record<string, BiomarkerDisplayHint> = {
  "biomarker:deep-sleep-minutes": {
    direction: "neutral",
    expected: "Worth watching",
  },
  "biomarker:estimated-vo2max": {
    direction: "up",
    expected: "Could improve",
  },
  "biomarker:hrv-rmssd": {
    direction: "neutral",
    expected: "Worth watching",
  },
  "biomarker:morning-blood-pressure": {
    direction: "down",
    expected: "Could trend lower",
  },
  "biomarker:resting-heart-rate": {
    direction: "down",
    expected: "Could trend lower",
  },
  "biomarker:sleep-efficiency": {
    direction: "up",
    expected: "Could improve",
  },
  "biomarker:sleep-onset-latency": {
    direction: "down",
    expected: "May fall asleep sooner",
  },
};

export function listProtocolBiomarkers(
  protocol: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalogReader,
): HealthCommonsEntity[] {
  const protocolKeys = listProtocolBiomarkerKeys(protocol);
  const fromAuthoredSignals = protocolKeys.flatMap((key) => {
    const entity = catalog.findByKey(key);
    return entity?.entityType === "biomarker" ? [entity] : [];
  });

  if (fromAuthoredSignals.length > 0) {
    return fromAuthoredSignals;
  }

  return catalog.listRelated({
    entity: protocol,
    entityTypes: ["biomarker"],
    relationTypes: ["primary_biomarker", "secondary_biomarker"],
  });
}

function listProtocolBiomarkerKeys(protocol: HealthCommonsCatalogEntity): string[] {
  const testPlan = protocol.testPlans?.[0];

  return uniqueStrings([
    ...(protocol.expectedSignalDescriptions ?? []).map((signal) => signal.biomarkerKey),
    testPlan?.primaryBiomarkerKey,
    ...(testPlan?.secondaryBiomarkerKeys ?? []),
    ...(testPlan?.safetyOutcomeKeys ?? []),
  ]);
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.length > 0
  ))];
}

export function toExpectedSignal(
  protocol: HealthCommonsCatalogEntity,
  biomarker: HealthCommonsEntity,
): ExperimentProtocol["expectedSignals"][number] {
  const hint = resolveBiomarkerDisplayHint(biomarker);
  const protocolSignal = resolveProtocolExpectedSignalDescription(protocol, biomarker.key);
  const protocolProminence =
    protocolSignal?.protocolProminence ?? hint.protocolProminence;
  const direction =
    directionForExpectedSignal(protocolSignal?.expectedDirection)
    ?? directionForExpectedSignal(protocolSignal?.expected)
    ?? hint.direction;
  const description = cleanOptionalHealthCommonsUserFacingCopy(
    protocolSignal?.description
      ?? hint.description
      ?? biomarker.summary
      ?? summarizeBody(biomarker.body),
  );
  const expected = cleanHealthCommonsUserFacingCopy(
    normalizeExpectedSignalLabel(
      protocolSignal?.expected
      ?? expectedLabelForExpectedSignal(protocolSignal?.expectedDirection)
      ?? hint.expected,
    ),
  );
  const estimatedChange = cleanExpectedSignalEstimate(protocolSignal?.estimatedChange);

  return {
    label: cleanHealthCommonsUserFacingCopy(biomarker.title),
    value: "",
    delta: "",
    direction,
    ...(protocolSignal?.displayValue
      ? { displayValue: cleanHealthCommonsUserFacingCopy(protocolSignal.displayValue) }
      : {}),
    ...(estimatedChange
      ? { estimatedChange }
      : {}),
    expected,
    biomarkerRouteId: biomarker.key.replace(/^biomarker:/u, ""),
    ...(description ? { description } : {}),
    ...(protocolProminence
      ? { protocolProminence }
      : {}),
  };
}

function cleanExpectedSignalEstimate(
  estimate: BiomarkerSignalEstimatedChange | undefined,
): BiomarkerSignalEstimatedChange | undefined {
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

function normalizeExpectedSignalLabel(expected: string): string {
  switch (expected) {
    case "down":
    case "down_or_stable":
      return "Could trend lower";
    case "up":
    case "up_or_stable":
      return "Could improve";
    case "mixed_or_contextual":
      return "Possible change";
    case "stable":
      return "Should stay stable";
    default:
      return expected;
  }
}

function resolveProtocolExpectedSignalDescription(
  protocol: HealthCommonsCatalogEntity,
  biomarkerKey: string,
) {
  return protocol.expectedSignalDescriptions?.find(
    (signal) => signal.biomarkerKey === biomarkerKey,
  );
}

export function resolveBiomarkerDisplayHint(
  biomarker: HealthCommonsEntity,
): BiomarkerDisplayHint {
  const biomarkerKey = biomarker.key;
  const baseHint = DEFAULT_BIOMARKER_DISPLAY_HINTS[biomarkerKey] ?? {
    direction: "neutral" as const,
    expected: "Worth watching",
  };
  const direction = directionForBiomarkerDesiredDirection(
    biomarker.biomarker?.direction?.desired,
  );

  return direction
    ? {
        ...baseHint,
        direction,
        expected: expectedLabelForBiomarkerDirection(direction),
      }
    : baseHint;
}

function directionForExpectedSignal(
  expected: HealthCommonsBiomarkerProtocolExpectedDirection | string | undefined,
): BiomarkerSignalDirection | null {
  switch (expected) {
    case "down":
    case "down_or_stable":
      return "down";
    case "up":
    case "up_or_stable":
      return "up";
    case "mixed_or_contextual":
    case "stable":
      return "neutral";
    default:
      return null;
  }
}

function expectedLabelForExpectedSignal(
  expected: HealthCommonsBiomarkerProtocolExpectedDirection | undefined,
): string | null {
  return expected ? normalizeExpectedSignalLabel(expected) : null;
}

function directionForBiomarkerDesiredDirection(
  desired: HealthCommonsBiomarkerDesiredDirection | undefined,
): BiomarkerSignalDirection | null {
  switch (desired) {
    case "higher":
    case "higher_or_stable":
      return "up";
    case "lower":
    case "lower_or_stable":
      return "down";
    case "mixed_or_contextual":
    case "stable":
      return "neutral";
    default:
      return null;
  }
}

function expectedLabelForBiomarkerDirection(direction: BiomarkerSignalDirection): string {
  switch (direction) {
    case "down":
      return "Could trend lower";
    case "up":
      return "Could improve";
    case "neutral":
      return "Worth watching";
  }
}

function summarizeBody(body: string): string {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
}
