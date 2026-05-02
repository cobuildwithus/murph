import {
  normalizeMetricKey,
  type GoalMetricTarget,
  type MetricComparator,
  type MetricSelectionPolicy,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";

export function parseGoalMetricTargets(entity: CanonicalEntity): GoalMetricTarget[] {
  const source = entity.frontmatter ?? entity.attributes;
  const rawTargets = Array.isArray(source.metricTargets) ? source.metricTargets : [];
  return rawTargets.flatMap((target, index) => parseGoalMetricTarget(entity.entityId, target, index));
}

function parseGoalMetricTarget(goalId: string, value: unknown, index: number): GoalMetricTarget[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const metricKey = readString(record.metricKey);
  const comparator = readComparator(record.comparator);
  const targetValue = readNumber(record.value);
  const unit = readString(record.unit);
  if (!metricKey || !comparator || targetValue === null || !unit) return [];

  const targetId = readString(record.targetId) ?? `metric-target-${index + 1}`;
  return [{
    biomarkerKey: readString(record.biomarkerKey) ?? undefined,
    comparator,
    evaluation: readEvaluation(record.evaluation),
    highValue: readNumber(record.highValue) ?? undefined,
    kind: "metric",
    metricKey: normalizeMetricKey(metricKey),
    note: readString(record.note) ?? undefined,
    selectionPolicyOverride: readSelectionPolicyOverride(record.selectionPolicyOverride) ?? undefined,
    startAt: readString(record.startAt) ?? undefined,
    targetAt: readString(record.targetAt) ?? undefined,
    targetId,
    unit,
    value: targetValue,
  } satisfies GoalMetricTarget];
}

function readEvaluation(value: unknown): GoalMetricTarget["evaluation"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "selected-value" };
  const record = value as Record<string, unknown>;
  const kind = readString(record.kind);
  if (kind === "latest-lab") return { kind };
  if (kind === "rolling-window") {
    const statistic = readString(record.statistic);
    const windowDays = readNumber(record.windowDays);
    if ((statistic === "mean" || statistic === "median") && windowDays !== null) {
      return { kind, statistic, windowDays };
    }
  }
  return { kind: "selected-value" };
}

function readSelectionPolicyOverride(value: unknown): MetricSelectionPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = readString(record.kind);
  const staleAfterDays = readNumber(record.staleAfterDays) ?? undefined;
  if (kind === "latest-valid") return { kind, staleAfterDays };
  if (kind === "latest-device-estimate") return { kind, staleAfterDays };
  if (kind === "latest-lab") {
    return {
      kind,
      preferCollectedAt: true,
      preferFasting: readBoolean(record.preferFasting) ?? undefined,
      staleAfterDays,
    };
  }
  if (kind === "qualified-latest") {
    const requiredQualifiers = readQualifierMap(record.requiredQualifiers);
    if (requiredQualifiers) return { kind, requiredQualifiers, staleAfterDays };
  }
  return null;
}

function readQualifierMap(value: unknown): Record<string, string | number | boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      output[key] = entry;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readComparator(value: unknown): GoalMetricTarget["comparator"] | null {
  return value === "<" || value === "<=" || value === ">" || value === ">=" || value === "between"
    ? value as MetricComparator | "between"
    : null;
}
