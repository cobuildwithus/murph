import type { CategoryNote } from "./category-notes";

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
      "Tell Murph how you ventilate, whether there is damp or mold, what you cook on, any smoke indoors, and whether you drink tap, filtered, or bottled water.",
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
  sleep: "Your remaining sleep details",
  air: "Your remaining air and water details",
  light: "Your remaining light details",
  recovery: "Your remaining recovery details",
  workspace: "Your remaining workspace details",
};

export function buildEnvironmentVoiceScript(
  notes: readonly CategoryNote[],
  coverage: number,
): EnvironmentVoiceScript {
  if (coverage <= 0) {
    return DEFAULT_ENVIRONMENT_VOICE_SCRIPT;
  }

  const incompleteNotes = notes.filter((note) => note.unknownFacts.length > 0);
  const [firstIncompleteNote, ...remainingIncompleteNotes] = incompleteNotes;
  if (coverage >= 95 || !firstIncompleteNote) {
    return UPDATE_SCRIPT;
  }

  const buildGapTopic = (note: CategoryNote): EnvironmentVoiceTopic => ({
    id: note.id,
    title: GAP_TOPIC_TITLES[note.id] ?? `Your remaining ${note.title} details`,
    eyebrow: note.title,
    prompt:
      "Cover only the details Murph is still missing. If something does not apply or you would rather skip it, say so.",
    focus: note.unknownFacts.map((fact) => fact.label),
  });
  const topics: [EnvironmentVoiceTopic, ...EnvironmentVoiceTopic[]] = [
    buildGapTopic(firstIncompleteNote),
    ...remainingIncompleteNotes.map(buildGapTopic),
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
