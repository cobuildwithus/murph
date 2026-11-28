import { distance, type MemberEvidence } from "./engine/model";

export type InputState = "counted" | "absent" | "stale" | "unavailable";
export interface MarkerInput {
  date: string;
  key: string;
  label: string;
  value: number;
  unit: string;
  system: string;
  flag: "high" | "low" | "normal" | null;
  modelKey?: string;
}
export interface YouInputs {
  asOf: string;
  timeZone: string;
  sourceRevision: string;
  evidence: MemberEvidence;
  availability: Record<string, InputState>;
  markers: MarkerInput[];
  /** First date for which this projection can supply any dated evidence. */
  historyFrom: string;
  /** First reconstructed age with full contributing workout windows. */
  ageHistoryFrom?: string;
  hasWearableData: boolean;
  hasHabitQuestions?: boolean;
  hasAnswerProjection?: boolean;
  needsWhoopAnswer?: boolean;
  lifts?: string[];
  activeMinutes?: { date: string; value: number }[];
  bedtime?: { date: string; inTarget: boolean }[];
}
export function inputState(dates: string[], asOf: string, maxAge: number): InputState {
  const latest = dates
    .filter((d) => d <= asOf)
    .sort()
    .at(-1);
  return !latest ? "absent" : distance(asOf, latest) > maxAge ? "stale" : "counted";
}
