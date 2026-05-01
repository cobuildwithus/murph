import type { HealthCommonsCatalogEntity } from "@murphai/contracts";
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

const PROTOCOL_BIOMARKER_DISPLAY_HINT_OVERRIDES: Record<
  string,
  Record<string, Partial<BiomarkerDisplayHint>>
> = {
  "protocol_variant:dry-sauna/bryan-johnson-blueprint": {
    "biomarker:hrv-rmssd": {
      description:
        "Because this routine is both hot and frequent, HRV is a tolerability check: recovery may improve, but overload can suppress it.",
      protocolProminence: "focus",
    },
    "biomarker:resting-heart-rate": {
      description:
        "This daily, very hot post-workout dose piles heat on top of training; resting pulse helps show whether your body adapts or stays strained.",
      protocolProminence: "focus",
    },
  },
  "protocol_variant:dry-sauna/murph-finnish-standard-3x-week": {
    "biomarker:deep-sleep-minutes": {
      description:
        "A calming warm-to-cool transition may make sleep feel more settled, but Finnish dry sauna has not shown reliable deep-sleep gains, so keep this as background.",
      protocolProminence: "context",
    },
    "biomarker:hrv-rmssd": {
      description:
        "Sauna first adds heat stress, then a cooling and relaxation phase; if the rebound is easy to recover from, HRV may rise or stabilize, but too much heat can push it lower.",
      protocolProminence: "focus",
    },
    "biomarker:morning-blood-pressure": {
      description:
        "Heat widens blood vessels during the session; repeated tolerable exposure may ease vascular tone slightly, so blood pressure could drift lower.",
      protocolProminence: "focus",
    },
    "biomarker:resting-heart-rate": {
      description:
        "Repeated heat sessions make the heart work harder during cooling; over time, adaptation may show as a steadier or lower resting pulse.",
      direction: "neutral",
      protocolProminence: "focus",
    },
    "biomarker:sleep-efficiency": {
      description:
        "A warm-to-cool transition can feel sedating for some people, but a strong heat dose can also leave the body too activated for smooth sleep.",
      direction: "neutral",
      protocolProminence: "context",
    },
  },
  "protocol_variant:norwegian-4x4/norwegian-4x4": {
    "biomarker:estimated-vo2max": {
      description:
        "Hard four-minute intervals repeatedly stress oxygen delivery and use, which is the training stimulus most likely to nudge VO₂ max or same-device wearable cardio-fitness upward.",
      protocolProminence: "focus",
    },
    "biomarker:hrv-rmssd": {
      description:
        "Intervals can improve fitness but also add nervous-system stress, so HRV is useful for spotting whether the dose is recoverable.",
      protocolProminence: "focus",
    },
    "biomarker:morning-blood-pressure": {
      description:
        "Better aerobic fitness can help vascular function, but home blood pressure moves slowly and depends heavily on timing, salt, stress, and caffeine.",
      protocolProminence: "context",
    },
    "biomarker:resting-heart-rate": {
      description:
        "If the aerobic system adapts, your heart may need slightly less work at rest; fatigue, illness, or under-recovery can hide that.",
      protocolProminence: "focus",
    },
    "biomarker:sleep-efficiency": {
      description:
        "Poor sleep can blunt interval recovery and make the fitness signal harder to read, so treat sleep efficiency as context.",
      protocolProminence: "context",
    },
  },
  "protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed": {
    "biomarker:deep-sleep-minutes": {
      description:
        "Better-timed light may support a steadier night, but wearables can misread sleep stages; treat deep sleep only as background context.",
      expected: "Can be noisy",
      protocolProminence: "context",
    },
    "biomarker:hrv-rmssd": {
      description:
        "A calmer pre-bed window can support overnight recovery, but HRV is also sensitive to stress, alcohol, illness, and short sleep.",
      expected: "Can be noisy",
      protocolProminence: "context",
    },
    "biomarker:resting-heart-rate": {
      description:
        "Less evening alerting may reduce overnight strain for some people, but resting pulse is exploratory because many factors move it.",
      expected: "Can be noisy",
      protocolProminence: "context",
    },
    "biomarker:sleep-efficiency": {
      description:
        "If evenings feel less wired, more of your time in bed may become actual sleep rather than quiet wakefulness or clock-watching.",
      expected: "Could improve",
      protocolProminence: "focus",
    },
    "biomarker:sleep-onset-latency": {
      description:
        "Blocking evening blue-rich light may lower the brain’s daytime signal, making it easier to feel sleepy near your intended bedtime.",
      expected: "May fall asleep sooner",
      protocolProminence: "focus",
    },
  },
};

export function listProtocolBiomarkers(
  protocol: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalogReader,
): HealthCommonsEntity[] {
  const testPlan = protocol.testPlans?.[0];
  const orderedKeys = Array.from(new Set([
    testPlan?.primaryBiomarkerKey,
    ...(testPlan?.secondaryBiomarkerKeys ?? []),
    ...(testPlan?.safetyOutcomeKeys ?? []),
  ].filter((key): key is string => typeof key === "string")));
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

export function toExpectedSignal(
  protocol: HealthCommonsCatalogEntity,
  biomarker: HealthCommonsEntity,
): ExperimentProtocol["expectedSignals"][number] {
  const hint = resolveBiomarkerDisplayHint(protocol.key, biomarker.key);
  const protocolSignal = resolveProtocolExpectedSignalDescription(protocol, biomarker.key);
  const protocolProminence =
    protocolSignal?.protocolProminence ?? hint.protocolProminence;
  const description = cleanOptionalHealthCommonsUserFacingCopy(
    protocolSignal?.description
      ?? hint.description
      ?? biomarker.summary
      ?? summarizeBody(biomarker.body),
  );
  const expected = cleanHealthCommonsUserFacingCopy(
    normalizeExpectedSignalLabel(protocolSignal?.expected ?? hint.expected),
  );
  const estimatedChange = cleanExpectedSignalEstimate(protocolSignal?.estimatedChange);

  return {
    label: cleanHealthCommonsUserFacingCopy(biomarker.title),
    value: "",
    delta: "",
    direction: hint.direction,
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
    case "mixed_or_contextual":
      return "Possible change";
    case "down_or_stable":
      return "Could trend lower";
    case "up_or_stable":
      return "Could improve";
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
  protocolKey: string,
  biomarkerKey: string,
): BiomarkerDisplayHint {
  const baseHint = DEFAULT_BIOMARKER_DISPLAY_HINTS[biomarkerKey] ?? {
    direction: "neutral" as const,
    expected: "Worth watching",
  };
  const override =
    PROTOCOL_BIOMARKER_DISPLAY_HINT_OVERRIDES[protocolKey]?.[biomarkerKey];

  return override ? { ...baseHint, ...override } : baseHint;
}

function summarizeBody(body: string): string {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
}
