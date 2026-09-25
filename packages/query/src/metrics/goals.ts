import { goalMetricTargetSchema } from "@murphai/contracts";
import { normalizeMetricKey, type GoalMetricTarget } from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";

export function parseGoalMetricTargets(entity: CanonicalEntity): GoalMetricTarget[] {
  const source = entity.frontmatter ?? entity.attributes;
  const rawTargets = Array.isArray(source.metricTargets) ? source.metricTargets : [];
  return rawTargets.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (typeof record.metricKey !== "string" || !record.metricKey.trim()) return [];

    // Older query inputs omitted these fields; keep that adaptation outside the
    // canonical schema instead of reconstructing evaluation and policy variants.
    const result = goalMetricTargetSchema.safeParse({
      ...record,
      kind: record.kind ?? "metric",
      targetId: typeof record.targetId === "string"
        ? record.targetId.trim() || `metric-target-${index + 1}`
        : record.targetId ?? `metric-target-${index + 1}`,
      metricKey: normalizeMetricKey(record.metricKey),
    });
    return result.success ? [result.data] : [];
  });
}
