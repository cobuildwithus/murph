import { HABITAT_CATALOG } from "@murphai/contracts";

import type { HabitatValues } from "./home-model";

export type EnvironmentVoiceFlow = "walkthrough" | "fill-gaps" | "update";

export type EnvironmentVoiceTopic = {
  id: string;
  title: string;
  eyebrow: string;
  prompt: string;
  focus?: readonly string[];
};

export type EnvironmentVoiceScript = {
  flow: EnvironmentVoiceFlow;
  dialogTitle: string;
  idleTitle: string;
  idleDescription: string;
  topics: readonly [EnvironmentVoiceTopic, ...EnvironmentVoiceTopic[]];
};

const WALKTHROUGH_TOPICS = [
  {
    id: "sleep",
    title: "Your bedroom",
    eyebrow: "Sleep",
    prompt:
      "Describe the temperature, darkness and noise at night. Mention windows, your mattress, overheating, and whether your phone or a TV is near the bed.",
  },
  {
    id: "air",
    title: "The air and water",
    eyebrow: "Air & water",
    prompt:
      "Start with your city or approximate region — never your address. Then describe ventilation, damp or mold, cooking, indoor smoke, and drinking water.",
  },
  {
    id: "light",
    title: "Light through the day",
    eyebrow: "Light",
    prompt:
      "Describe morning daylight, where you spend the day, and whether your evening light is warm and dim or bright and cool.",
  },
  {
    id: "recovery",
    title: "Recovery and devices",
    eyebrow: "Optional extras",
    prompt:
      "Mention any sauna, cold exposure, red light, scale, blood-pressure cuff or other devices you already use. None of these are required for a good grade.",
  },
  {
    id: "workspace",
    title: "Where you work",
    eyebrow: "Workspace",
    prompt:
      "Describe how long you sit, your screen height, your desk and chair, how often you take breaks, and any wrist, neck or back discomfort.",
  },
] as const satisfies readonly [
  EnvironmentVoiceTopic,
  ...EnvironmentVoiceTopic[],
];

export const DEFAULT_ENVIRONMENT_VOICE_SCRIPT: EnvironmentVoiceScript = {
  flow: "walkthrough",
  dialogTitle: "Walk Murph through your home",
  idleTitle: "Ready when you are",
  idleDescription:
    "Preview the five topics, then record one continuous memo.",
  topics: WALKTHROUGH_TOPICS,
};

const UPDATE_SCRIPT: EnvironmentVoiceScript = {
  flow: "update",
  dialogTitle: "Update your environment",
  idleTitle: "Record what changed",
  idleDescription:
    "You do not need to repeat the full walkthrough. Mention only what is new or different.",
  topics: [
    {
      id: "update",
      title: "What changed?",
      eyebrow: "Quick update",
      prompt:
        "Describe anything that changed at home, in your bedroom, workspace, lighting, air, water, recovery setup or devices. Murph will update only the clear details.",
    },
  ],
};

const GAP_TOPIC_TITLES: Readonly<Record<string, string>> = {
  sleep: "Your sleep setup",
  air: "Air and water at home",
  light: "Your lighting",
  recovery: "Recovery and devices",
  workspace: "Your workspace",
};

const COLLECTION_TOPICS = [
  {
    aspectIds: ["sleep-environment"],
    id: "sleep",
    title: "Sleep",
  },
  {
    aspectIds: ["home-location", "home-air", "water", "allergens-home"],
    id: "air",
    title: "Air & water",
  },
  {
    aspectIds: ["lighting"],
    id: "light",
    title: "Light",
  },
  {
    aspectIds: ["recovery-access", "health-devices"],
    id: "recovery",
    title: "Recovery & devices",
  },
  {
    aspectIds: ["workspace"],
    id: "workspace",
    title: "Workspace",
  },
] as const;

export function buildEnvironmentVoiceScript(
  values: HabitatValues,
): EnvironmentVoiceScript {
  const gaps = COLLECTION_TOPICS.map((topic) => {
    const focus: string[] = [];
    let resolved = 0;
    let total = 0;
    for (const aspectId of topic.aspectIds) {
      const aspect = HABITAT_CATALOG.aspects.find(
        (candidate) => candidate.id === aspectId,
      );
      if (!aspect) {
        continue;
      }
      const aspectValues = values[aspectId] ?? {};
      for (const indicator of aspect.indicators) {
        if (indicator.priority === "low") {
          continue;
        }
        total += 1;
        const value = aspectValues[indicator.id];
        if (value !== undefined && value !== null) {
          resolved += 1;
          continue;
        }
        focus.push(indicator.label);
      }
    }
    return { ...topic, focus, resolved, total };
  });
  const resolved = gaps.reduce((sum, topic) => sum + topic.resolved, 0);
  const total = gaps.reduce((sum, topic) => sum + topic.total, 0);
  if (resolved === 0) {
    return DEFAULT_ENVIRONMENT_VOICE_SCRIPT;
  }

  const incompleteTopics = gaps.filter((topic) => topic.focus.length > 0);
  const [firstIncompleteTopic, ...remainingIncompleteTopics] = incompleteTopics;
  if (!firstIncompleteTopic || resolved === total) {
    return UPDATE_SCRIPT;
  }

  const buildGapTopic = (
    gap: (typeof incompleteTopics)[number],
  ): EnvironmentVoiceTopic => ({
    id: gap.id,
    title: GAP_TOPIC_TITLES[gap.id] ?? gap.title,
    eyebrow: gap.title,
    prompt:
      "Cover only the details Murph is still missing. If something does not apply or you would rather skip it, say so.",
    focus: gap.focus,
  });
  const topics: [EnvironmentVoiceTopic, ...EnvironmentVoiceTopic[]] = [
    buildGapTopic(firstIncompleteTopic),
    ...remainingIncompleteTopics.map(buildGapTopic),
  ];

  return {
    flow: "fill-gaps",
    dialogTitle: "Fill the gaps in your report",
    idleTitle: "Only the missing details",
    idleDescription: `${topics.length} short ${
      topics.length === 1 ? "topic" : "topics"
    }, based on what Murph does not know yet.`,
    topics,
  };
}
