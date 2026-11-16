import { GAME_ACTIVITIES, type GameActivity } from "../contract";
import { invalidGameRequest } from "../http/errors";
import { isRecord } from "../../primitives";

export const STEPS = ["task", "prize", "dare"] as const;
export const CATEGORIES = ["move", "strength", "calm", "home", "other"] as const;
export const RELATIONSHIPS = ["partner", "friend", "family", "roommate", "coworker", "teammate"] as const;
export const SCHEDULES = ["every_day", "weekdays", "three_days"] as const;

export interface GameIdeasInput {
  step: typeof STEPS[number];
  category?: typeof CATEGORIES[number];
  relationship: typeof RELATIONSHIPS[number];
  apart: boolean;
  directions: string[];
  words: string;
  task?: string;
  skipped: string[];
  notForMe?: GameActivity[];
}
export interface GameIdea { text: string; schedule: typeof SCHEDULES[number] }

/** Rebuild the allowlist so unknown fields and private labels never reach the provider. */
export function parseGameIdeasInput(value: unknown): GameIdeasInput {
  if (!isRecord(value)) throw invalidGameRequest("Send an ideas request.");
  const step = oneOf(value.step, "step", STEPS);
  if (typeof value.apart !== "boolean") throw invalidGameRequest("apart must be a boolean.");
  const task = value.task === undefined ? undefined : words(value.task, "task", 120);
  if (value.notForMe !== undefined && !Array.isArray(value.notForMe)) throw invalidGameRequest("notForMe must be a list of activities.");
  const activities = (value.notForMe ?? []).map((item: unknown) => oneOf(item, "notForMe", GAME_ACTIVITIES));
  const notForMe = GAME_ACTIVITIES.filter(activity => activities.includes(activity));
  return {
    step,
    ...(value.category === undefined ? {} : { category: oneOf(value.category, "category", CATEGORIES) }),
    relationship: oneOf(value.relationship, "relationship", RELATIONSHIPS),
    apart: value.apart,
    directions: strings(value.directions, "directions", 6, 30),
    words: words(value.words, "words", 120),
    ...(step !== "task" && task !== undefined ? { task } : {}),
    skipped: strings(value.skipped, "skipped", 24, 40),
    ...(notForMe.length ? { notForMe } : {}),
  };
}

function oneOf<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  const found = choices.find(choice => choice === value);
  if (found === undefined) throw invalidGameRequest(`Choose a valid ${field}.`);
  return found;
}

function words(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw invalidGameRequest(`${field} must be 1 to ${max} characters.`);
  }
  return value.trim();
}

function strings(value: unknown, field: string, max: number, chars: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw invalidGameRequest(`${field} must contain at most ${max} strings.`);
  return value.map(item => words(item, field, chars));
}
