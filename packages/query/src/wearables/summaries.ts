import { formatMetricValue, formatProviderName } from "./provider-policy.ts";
import { uniqueStrings } from "./shared.ts";
import type {
  WearableMetricConfidence,
  WearableResolvedMetric,
  WearableSummaryConfidence,
  WearableSleepWindowCandidate,
} from "./types.ts";

export function summarizeActivityNotes(input: {
  activityTypes: string[];
  sessionCount: WearableResolvedMetric;
  sessionMinutes: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.sessionCount.selection.value !== null && input.sessionMinutes.selection.value !== null) {
    notes.push(
      `Selected ${formatMetricValue(input.sessionCount.selection.value, "count")} activity session${input.sessionCount.selection.value === 1 ? "" : "s"} covering ${formatMetricValue(input.sessionMinutes.selection.value, "minutes")}.`,
    );
  }

  if (input.activityTypes.length > 0) {
    notes.push(`Selected activity types: ${input.activityTypes.join(", ")}.`);
  }

  return uniqueStrings(notes);
}

export function summarizeSleepNotes(input: {
  summaryConfidence: WearableSummaryConfidence;
  timeInBedMinutes: WearableResolvedMetric;
  totalSleepMinutes: WearableResolvedMetric;
  windowSelection: {
    confidence: WearableMetricConfidence;
    selection: WearableSleepWindowCandidate | null;
  };
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.windowSelection.selection) {
    notes.push(
      `Selected sleep window from ${formatProviderName(input.windowSelection.selection.provider)} spanning ${input.windowSelection.selection.startAt ?? "unknown start"} to ${input.windowSelection.selection.endAt ?? "unknown end"}.`,
    );
  }

  if (input.totalSleepMinutes.selection.value !== null) {
    notes.push(`Selected total sleep: ${formatMetricValue(input.totalSleepMinutes.selection.value, "minutes")}.`);
  }

  if (input.totalSleepMinutes.selection.resolution === "fallback" && input.totalSleepMinutes.selection.fallbackReason) {
    notes.push(input.totalSleepMinutes.selection.fallbackReason);
  }

  if (input.timeInBedMinutes.selection.resolution === "fallback" && input.timeInBedMinutes.selection.fallbackReason) {
    notes.push(input.timeInBedMinutes.selection.fallbackReason);
  }

  return uniqueStrings(notes);
}

export function summarizeRecoveryNotes(input: {
  readinessScore: WearableResolvedMetric;
  recoveryScore: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.recoveryScore.selection.value !== null) {
    notes.push(`Selected recovery score: ${formatMetricValue(input.recoveryScore.selection.value, "%")}.`);
  }

  if (input.readinessScore.selection.value !== null) {
    notes.push(`Selected readiness score: ${formatMetricValue(input.readinessScore.selection.value, "%")}.`);
  }

  return uniqueStrings(notes);
}

export function summarizeBodyStateNotes(input: {
  bodyFatPercentage: WearableResolvedMetric;
  summaryConfidence: WearableSummaryConfidence;
  weightKg: WearableResolvedMetric;
}): string[] {
  const notes = [...input.summaryConfidence.notes];

  if (input.weightKg.selection.value !== null) {
    notes.push(`Selected weight: ${formatMetricValue(input.weightKg.selection.value, "kg")}.`);
  }

  if (input.bodyFatPercentage.selection.value !== null) {
    notes.push(`Selected body-fat percentage: ${formatMetricValue(input.bodyFatPercentage.selection.value, "%")}.`);
  }

  return uniqueStrings(notes);
}
