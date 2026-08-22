import {
  buildEnvironmentInterviewTopicId,
  ENVIRONMENT_INTERVIEW_TOPIC_GROUPS,
  HABITAT_DECLINED_VALUE,
  listEnvironmentInterviewFields,
  type HabitatIndicatorValueType,
} from "@murphai/contracts";

import type { HabitatIndicatorNotes, HabitatValues } from "./home-model";

export type EnvironmentVoiceFlow = "walkthrough" | "fill-gaps" | "update";

export type EnvironmentVoiceField = {
  aspectId: string;
  indicatorId: string;
  label: string;
  existingNote?: string;
  question?: string;
  valueType: HabitatIndicatorValueType;
};

export type EnvironmentVoiceTopic = {
  id: string;
  title: string;
  eyebrow: string;
  prompt: string;
  fields?: readonly EnvironmentVoiceField[];
  focus?: readonly string[];
};

export type EnvironmentVoiceScript = {
  flow: EnvironmentVoiceFlow;
  dialogTitle: string;
  idleTitle: string;
  idleDescription: string;
  initialCoveredDetails?: number;
  totalDetails?: number;
  topics: readonly [EnvironmentVoiceTopic, ...EnvironmentVoiceTopic[]];
};

const MAX_TOPIC_FIELDS = 4;

const VOICE_FIELD_LABELS: Readonly<Record<string, string>> = {
  "allergens-home.pets_at_home": "Whether you have pets and what kind",
  "health-devices.bp_cuff": "Whether you have a blood-pressure cuff",
  "health-devices.scale": "Whether your scale is smart or basic",
  "home-air.air_purifier": "Whether you use an air purifier and what kind",
  "home-air.air_quality_meter": "What indoor air quality you measure",
  "home-air.damp_or_mold": "Whether you have damp or mold at home",
  "home-air.stove": "What kind of stove you cook on",
  "home-air.ventilation": "How fresh air enters your home",
  "home-location.area_type":
    "Whether you live in a city, suburb, or rural area",
  "home-location.location": "Your city or region, not your address",
  "lighting.daytime_light": "How much daylight you get during the day",
  "lighting.evening_light": "How bright and warm your evening light is",
  "lighting.morning_light_access": "How you get daylight after waking",
  "recovery-access.cold_exposure": "What cold exposure you use, if any",
  "recovery-access.red_light": "Whether you can use red light therapy",
  "recovery-access.sauna_access": "Where you can use a sauna, if anywhere",
  "sleep-environment.bedding_overheating":
    "How often your bedding makes you overheat",
  "sleep-environment.co2_meter": "Whether you have a bedroom CO2 meter",
  "sleep-environment.co2_typical_ppm": "Your typical bedroom CO2 reading",
  "sleep-environment.co_sleepers": "Who shares your bed",
  "sleep-environment.darkness": "How dark your bedroom stays at night",
  "sleep-environment.humidity_known":
    "How you measure or manage bedroom humidity",
  "sleep-environment.mattress_satisfaction":
    "How comfortable your mattress feels",
  "sleep-environment.night_noise": "How noisy your bedroom is at night",
  "sleep-environment.night_temp_c": "Your bedroom temperature at night",
  "sleep-environment.noise_countermeasures":
    "How you block noise while sleeping",
  "sleep-environment.phone_by_bed": "Where your phone stays at night",
  "sleep-environment.temp_control": "How you control bedroom temperature",
  "sleep-environment.window_at_night":
    "Whether your window is open or closed at night",
  "workspace.breaks": "How often you take breaks from sitting",
  "workspace.chair": "What kind of chair you use",
  "workspace.desk_hours": "How many hours you spend at a desk each day",
  "workspace.external_keyboard":
    "Whether you use an external keyboard with a laptop",
  "workspace.screen_at_eye_level": "Whether your screen is at eye level",
  "workspace.screen_setup": "Whether you use a laptop or external monitor",
  "workspace.standing_desk": "Whether your desk adjusts for standing",
  "workspace.work_mode": "Whether you work at home, an office, or both",
  "workspace.wrist_complaints": "Whether desk work causes wrist discomfort",
};

const VOICE_TOPIC_COPY: Readonly<
  Record<
    string,
    {
      eyebrow: string;
      title: string;
    }
  >
> = {
  air: {
    eyebrow: "Home & air",
    title: "Your home and indoor air",
  },
  light: {
    eyebrow: "Light",
    title: "Light through your day",
  },
  recovery: {
    eyebrow: "Tools & devices",
    title: "Recovery tools and health devices",
  },
  sleep: {
    eyebrow: "Sleep",
    title: "Your bedroom at night",
  },
  workspace: {
    eyebrow: "Workspace",
    title: "Your work setup",
  },
};

function buildUpdateScript(notes: HabitatIndicatorNotes): EnvironmentVoiceScript {
  return {
  flow: "update",
  dialogTitle: "Update your environment",
  idleTitle: "Tell Murph what changed",
  idleDescription:
    "Speak naturally. Murph will save only the clear details that changed.",
  topics: [
    {
      fields: listEnvironmentInterviewFields("update")
        .filter(({ indicator }) => indicator.priority !== "low")
        .map((field) => toVoiceField(field, notes)),
      id: "update",
      title: "What changed?",
      eyebrow: "Quick update",
      prompt:
        "Describe anything that changed in your home, sleep setup, lighting, recovery tools, or workspace.",
    },
  ],
  };
}

export const DEFAULT_ENVIRONMENT_VOICE_SCRIPT = buildMissingScript({}, {});

export function buildEnvironmentVoiceScript(
  values: HabitatValues,
  notes: HabitatIndicatorNotes = {},
): EnvironmentVoiceScript {
  const missingScript = buildMissingScript(values, notes);
  const hasKnownOrDeclinedValue = Object.values(values).some((aspect) =>
    Object.values(aspect).some(
      (value) => value !== null && value !== undefined,
    ),
  );
  if (!hasKnownOrDeclinedValue) {
    return missingScript;
  }
  return missingScript.flow === "update"
    ? missingScript
    : { ...missingScript, flow: "fill-gaps" };
}

export function buildEnvironmentVoiceScriptForIndicator(
  indicatorId: string,
  notes: HabitatIndicatorNotes = {},
): EnvironmentVoiceScript | null {
  for (const group of ENVIRONMENT_INTERVIEW_TOPIC_GROUPS) {
    const field = listEnvironmentInterviewFields(group.id).find(
      ({ indicator }) => indicator.id === indicatorId,
    );
    if (!field) {
      continue;
    }
    const voiceField = toVoiceField(field, notes);
    const voiceTopicCopy = VOICE_TOPIC_COPY[group.id];
    return {
      dialogTitle: "Add an Environment detail",
      flow: "update",
      idleDescription:
        "Answer one short prompt. Murph processes your answer as you speak.",
      idleTitle: "Ready when you are",
      topics: [
        {
          eyebrow: voiceTopicCopy?.eyebrow ?? group.eyebrow,
          fields: [voiceField],
          focus: [voiceField.label],
          id: `${group.id}:0`,
          prompt: topicPrompt(1),
          title: voiceTopicCopy?.title ?? group.title,
        },
      ],
    };
  }
  return null;
}

export function buildEnvironmentVoiceScriptForGroup(
  groupId: string,
  values: HabitatValues,
  notes: HabitatIndicatorNotes = {},
): EnvironmentVoiceScript | null {
  const group = ENVIRONMENT_INTERVIEW_TOPIC_GROUPS.find(
    (candidate) => candidate.id === groupId,
  );
  if (!group) {
    return null;
  }

  const allFields = listEnvironmentInterviewFields(group.id);
  const missingFields = allFields.filter(
    ({ aspectId, indicator }) =>
      values[aspectId]?.[indicator.id] === undefined,
  );
  const selectedFields = missingFields.length > 0 ? missingFields : allFields;
  const topics = chunk(
    selectedFields.map((field) => toVoiceField(field, notes)),
    MAX_TOPIC_FIELDS,
  ).map((fields, chunkIndex): EnvironmentVoiceTopic => {
    const copy = VOICE_TOPIC_COPY[group.id];
    return {
      eyebrow: copy?.eyebrow ?? group.eyebrow,
      fields,
      focus: fields.map((field) => field.label),
      id: buildEnvironmentInterviewTopicId(group.id, chunkIndex),
      prompt: topicPrompt(fields.length),
      title: copy?.title ?? group.title,
    };
  });
  const firstTopic = topics[0];
  if (!firstTopic) {
    return null;
  }

  return {
    dialogTitle:
      missingFields.length > 0
        ? `Complete ${group.title}`
        : `Update ${group.title}`,
    flow: missingFields.length > 0 ? "fill-gaps" : "update",
    idleDescription:
      "Speak naturally. Murph saves each clear detail as you cover this section.",
    idleTitle: `Talk through ${(
      VOICE_TOPIC_COPY[group.id]?.title ?? group.title
    ).toLowerCase()}`,
    initialCoveredDetails: allFields.length - missingFields.length,
    totalDetails: allFields.length,
    topics: [firstTopic, ...topics.slice(1)],
  };
}

export function findEnvironmentVoiceTopicForField(
  script: EnvironmentVoiceScript,
  aspectId: string,
  indicatorId: string,
): string | null {
  return (
    script.topics.find(
      (topic) =>
        topic.fields?.some(
          (field) =>
            field.aspectId === aspectId && field.indicatorId === indicatorId,
        ),
    )?.id ?? null
  );
}

export function findEnvironmentVoiceTopicForIndicator(
  script: EnvironmentVoiceScript,
  indicatorId: string,
): string | null {
  return (
    script.topics.find(
      (topic) =>
        topic.fields?.some((field) => field.indicatorId === indicatorId),
    )?.id ?? null
  );
}

function buildMissingScript(
  values: HabitatValues,
  notes: HabitatIndicatorNotes,
): EnvironmentVoiceScript {
  const interviewFields = ENVIRONMENT_INTERVIEW_TOPIC_GROUPS.flatMap((group) =>
    listEnvironmentInterviewFields(group.id).filter(
      ({ indicator }) => indicator.priority !== "low",
    ),
  );
  const totalDetails = interviewFields.length;
  const initialCoveredDetails = interviewFields.filter(
    ({ aspectId, indicator }) => {
      const value = values[aspectId]?.[indicator.id];
      return value !== undefined && value !== HABITAT_DECLINED_VALUE;
    },
  ).length;
  const topics = ENVIRONMENT_INTERVIEW_TOPIC_GROUPS.flatMap((group) => {
    const missingFields = listEnvironmentInterviewFields(group.id)
      .filter(
        ({ aspectId, indicator }) =>
          indicator.priority !== "low" &&
          values[aspectId]?.[indicator.id] === undefined,
      )
      .map((field) => toVoiceField(field, notes));
    return chunk(missingFields, MAX_TOPIC_FIELDS).map(
      (fields, chunkIndex): EnvironmentVoiceTopic => {
        const voiceTopicCopy = VOICE_TOPIC_COPY[group.id];
        return {
          eyebrow: voiceTopicCopy?.eyebrow ?? group.eyebrow,
          fields,
          focus: fields.map((field) => field.label),
          id: buildEnvironmentInterviewTopicId(group.id, chunkIndex),
          prompt: topicPrompt(fields.length),
          title: voiceTopicCopy?.title ?? group.title,
        };
      },
    );
  });
  const firstTopic = topics[0];
  if (!firstTopic) {
    return {
      ...buildUpdateScript(notes),
      initialCoveredDetails,
      totalDetails,
    };
  }

  const typedTopics: [EnvironmentVoiceTopic, ...EnvironmentVoiceTopic[]] = [
    firstTopic,
    ...topics.slice(1),
  ];
  const hasKnownOrDeclinedValue = Object.values(values).some((aspect) =>
    Object.values(aspect).some(
      (value) => value !== null && value !== undefined,
    ),
  );
  return {
    dialogTitle: hasKnownOrDeclinedValue
      ? "Continue your Environment report"
      : "Build your Environment report",
    flow: hasKnownOrDeclinedValue ? "fill-gaps" : "walkthrough",
    idleDescription: `${typedTopics.length} focused ${
      typedTopics.length === 1 ? "topic" : "topics"
    }. Murph saves each topic before moving on.`,
    idleTitle: hasKnownOrDeclinedValue
      ? "Pick up where you left off"
      : "Ready when you are",
    initialCoveredDetails,
    totalDetails,
    topics: typedTopics,
  };
}

function toVoiceField({
  aspectId,
  indicator,
}: ReturnType<
  typeof listEnvironmentInterviewFields
>[number], notes: HabitatIndicatorNotes): EnvironmentVoiceField {
  return {
    aspectId,
    indicatorId: indicator.id,
    label: VOICE_FIELD_LABELS[`${aspectId}.${indicator.id}`] ?? indicator.label,
    ...(notes[aspectId]?.[indicator.id]
      ? { existingNote: notes[aspectId][indicator.id] }
      : {}),
    ...(indicator.question ? { question: indicator.question } : {}),
    valueType: indicator.valueType,
  };
}

function topicPrompt(fieldCount: number): string {
  if (fieldCount === 1) {
    return "Describe the item below. Leave it for later if you do not know.";
  }
  return "Describe each item below. Leave anything unknown for later.";
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
