import type { HealthCommonsCatalogEntity } from "@murphai/contracts";

import type { ExperimentProtocol } from "@/src/types/experiments";
import type { HealthCommonsCatalogReader, HealthCommonsEntity } from "./catalog";

type BiomarkerSignalDirection =
  ExperimentProtocol["expectedSignals"][number]["direction"];
type BiomarkerSignalProminence = NonNullable<
  ExperimentProtocol["expectedSignals"][number]["protocolProminence"]
>;

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
        "Heat exposure may deepen perceived recovery on some nights, but wearable sleep-stage estimates are noisy enough to keep this as background.",
      protocolProminence: "context",
    },
    "biomarker:hrv-rmssd": {
      description:
        "Sauna is a recovery stressor: the cooldown may support relaxation, but dehydration or too much heat can push HRV the other way.",
      protocolProminence: "focus",
    },
    "biomarker:morning-blood-pressure": {
      description:
        "Heat widens blood vessels during the session; repeated exposure may ease vascular tone, making consistent morning cuff readings worth watching.",
      protocolProminence: "focus",
    },
    "biomarker:resting-heart-rate": {
      description:
        "Repeated heat sessions make the heart work harder while you cool down; over weeks, adaptation may show as a lower resting pulse.",
      protocolProminence: "focus",
    },
    "biomarker:sleep-efficiency": {
      description:
        "A warm-to-cool evening pattern can feel sedating for some people, but timing and room temperature decide whether sleep actually consolidates.",
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

export function toExpectedSignal(
  protocol: HealthCommonsCatalogEntity,
  biomarker: HealthCommonsEntity,
): ExperimentProtocol["expectedSignals"][number] {
  const hint = resolveBiomarkerDisplayHint(protocol.key, biomarker.key);

  return {
    label: biomarker.title,
    value: "",
    delta: "",
    direction: hint.direction,
    expected: hint.expected,
    description:
      hint.description ?? biomarker.summary ?? summarizeBody(biomarker.body),
    ...(hint.protocolProminence
      ? { protocolProminence: hint.protocolProminence }
      : {}),
  };
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
