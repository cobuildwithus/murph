import {
  HABITAT_CATALOG,
  type HabitatIndicatorDefinition,
  type HabitatIndicatorValue,
  validateHabitatIndicatorValue,
} from "./habitat-catalog.ts";

export const ENVIRONMENT_INTERVIEW_TOPIC_GROUPS = [
  {
    aspectIds: ["sleep-environment"],
    eyebrow: "Sleep",
    id: "sleep",
    title: "Your sleep setup",
  },
  {
    aspectIds: ["home-location", "home-air", "water", "allergens-home"],
    eyebrow: "Air & water",
    id: "air",
    title: "Air and water at home",
  },
  {
    aspectIds: ["lighting"],
    eyebrow: "Light",
    id: "light",
    title: "Your lighting",
  },
  {
    aspectIds: ["recovery-access", "health-devices"],
    eyebrow: "Recovery & devices",
    id: "recovery",
    title: "Recovery and devices",
  },
  {
    aspectIds: ["workspace"],
    eyebrow: "Workspace",
    id: "workspace",
    title: "Your workspace",
  },
] as const;

export type EnvironmentInterviewTopicGroupId =
  (typeof ENVIRONMENT_INTERVIEW_TOPIC_GROUPS)[number]["id"];

export function buildEnvironmentInterviewTopicId(
  groupId: EnvironmentInterviewTopicGroupId,
  chunkIndex: number,
): string {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new TypeError(
      "Environment interview topic index must be a non-negative integer.",
    );
  }
  return `${groupId}:${chunkIndex}`;
}

const ENVIRONMENT_INTERVIEW_UPDATE_TOPIC = {
  aspectIds: ENVIRONMENT_INTERVIEW_TOPIC_GROUPS.flatMap(
    (group) => [...group.aspectIds],
  ),
  eyebrow: "Quick update",
  id: "update",
  title: "What changed?",
} as const;

export interface EnvironmentInterviewField {
  aspectId: string;
  indicator: HabitatIndicatorDefinition;
}

export interface EnvironmentInterviewAnswer {
  aspectId: string;
  indicatorId: string;
  note?: string | null;
  value: Exclude<HabitatIndicatorValue, null>;
}

export const ENVIRONMENT_INTERVIEW_NOTE_MAX_LENGTH = 400;

export function getEnvironmentInterviewTopicGroup(
  topicId: string,
): (typeof ENVIRONMENT_INTERVIEW_TOPIC_GROUPS)[number]
  | typeof ENVIRONMENT_INTERVIEW_UPDATE_TOPIC
  | null {
  const groupId = topicId.split(":", 1)[0];
  if (groupId === ENVIRONMENT_INTERVIEW_UPDATE_TOPIC.id) {
    return ENVIRONMENT_INTERVIEW_UPDATE_TOPIC;
  }
  return ENVIRONMENT_INTERVIEW_TOPIC_GROUPS.find(
    (candidate) => candidate.id === groupId,
  ) ?? null;
}

export function listEnvironmentInterviewFields(
  topicId: string,
): EnvironmentInterviewField[] {
  const group = getEnvironmentInterviewTopicGroup(topicId);
  if (!group) {
    return [];
  }

  return group.aspectIds.flatMap((aspectId) => {
    const aspect = HABITAT_CATALOG.aspects.find(
      (candidate) => candidate.id === aspectId,
    );
    return aspect
      ? aspect.indicators.map((indicator) => ({ aspectId, indicator }))
      : [];
  });
}

export function validateEnvironmentInterviewAnswer(
  topicId: string,
  answer: EnvironmentInterviewAnswer,
): string | null {
  const field = listEnvironmentInterviewFields(topicId).find(
    (candidate) =>
      candidate.aspectId === answer.aspectId
      && candidate.indicator.id === answer.indicatorId,
  );
  if (!field) {
    return "The answer is outside this environment topic.";
  }
  const valueIssue = validateHabitatIndicatorValue(field.indicator, answer.value);
  if (valueIssue) {
    return valueIssue;
  }
  if (
    answer.note !== undefined &&
    answer.note !== null &&
    (answer.note.trim().length === 0 ||
      answer.note.length > ENVIRONMENT_INTERVIEW_NOTE_MAX_LENGTH)
  ) {
    return `Environment interview notes must contain 1-${ENVIRONMENT_INTERVIEW_NOTE_MAX_LENGTH} characters.`;
  }
  return null;
}
