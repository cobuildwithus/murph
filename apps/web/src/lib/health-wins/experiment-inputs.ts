import { createHash } from "node:crypto";
import type { ExperimentOutcome } from "@murphai/contracts";
import { normalizeMetricValue } from "@murphai/health-metrics";
import { resolveExperimentMetricIdentity, type BrowserVaultEntity } from "@murphai/query/browser-replica-client";
import type { Experiment, Metric } from "./engine";
import { WIN_METRIC_KEYS } from "./wearable-inputs";

// A free-text experiment name (and even its slug) can identify a private intervention.
// Only these explicitly identified modalities may supply a social card label.
const PUBLIC_MODALITIES: ReadonlyMap<string, string> = new Map([
  ["sauna", "Sauna"], ["traditional-dry-sauna", "Sauna"], ["dry-sauna", "Sauna"],
  ["evening-screen-curfew", "Evening screen curfew"], ["pre-sleep-downshift-practices", "Bedtime routine"],
  ["blue-light-blocking-glasses", "Blue-light blocking glasses"], ["running", "Running"], ["run", "Running"],
  ["walking", "Walking"], ["walk", "Walking"], ["cycling", "Cycling"], ["meditation", "Meditation"],
  ["stretching", "Stretching"], ["sleep-routine", "Sleep routine"], ["tabata-interval-training", "Tabata intervals"],
  ["aerobic-base-training", "Aerobic base training"], ["norwegian-4x4", "Interval training"], ["resistance-training", "Resistance training"],
]);
const metricByKey = new Map(Object.entries(WIN_METRIC_KEYS).map(([metric, key]) => [key, metric as Metric]));

function publicTitle(outcome: ExperimentOutcome, runPlan: unknown) {
  const key = outcome.commonsProtocolRef?.key;
  if (key) {
    const protocol = /^(?:protocol|protocol_variant):([a-z0-9-]+)(?:\/[a-z0-9-]+)?$/u.exec(key)?.[1];
    return protocol ? PUBLIC_MODALITIES.get(protocol) : undefined;
  }
  const modality = outcome.effectiveProtocolSnapshot?.modality ??
    (runPlan && typeof runPlan === "object" && "modality" in runPlan ? runPlan.modality : null);
  return typeof modality === "string" ? PUBLIC_MODALITIES.get(modality.trim().toLowerCase().replace(/[ _]+/gu, "-")) : undefined;
}

function cardsFromOutcome(outcome: ExperimentOutcome, today: string, runPlan: unknown): Experiment[] {
  const title = publicTitle(outcome, runPlan);
  const { baselineStart, baselineEnd, interventionStart, interventionEnd } = outcome.windows;
  if (!title || outcome.experiment.status !== "completed" || !baselineStart || !baselineEnd || !interventionStart
    || !interventionEnd || interventionEnd > today || interventionEnd > outcome.asOf || baselineEnd >= interventionStart) return [];
  const { completedSessions, targetSessions } = outcome.adherenceSummary;
  if (targetSessions === null || outcome.structuredReview) return [];
  if (outcome.metricResults.some(result => !metricByKey.has(resolveExperimentMetricIdentity(result.biomarkerKey).metricKey))) return [];
  const slug = createHash("sha256").update(outcome.experiment.id).digest("base64url").slice(0, 22);
  return outcome.metricResults.flatMap(result => {
    const key = resolveExperimentMetricIdentity(result.biomarkerKey).metricKey;
    const metric = metricByKey.get(key);
    if (!metric || (result.statistic && result.statistic !== "mean")) return [];
    const before = result.baseline ?? { mean: result.baselineMean, unit: result.unit };
    const during = result.intervention ?? { mean: result.interventionMean, unit: result.unit };
    if (!before.unit || !during.unit) return [];
    const baselineMean = normalizeMetricValue({ metricKey: key, unit: before.unit, value: before.mean }).canonicalValue;
    const interventionMean = normalizeMetricValue({ metricKey: key, unit: during.unit, value: during.mean }).canonicalValue;
    if (baselineMean === null || interventionMean === null) return [];
    return [{ slug, title, metric, baseline: { start: baselineStart, end: baselineEnd },
      intervention: { start: interventionStart, end: interventionEnd }, baselineMean, interventionMean,
      expectedDirection: result.expectedDirection, adherence: { done: completedSessions, target: targetSessions } }];
  });
}

type Period = { id: string; start: string; end: string };

function currentIntervention(entity: BrowserVaultEntity, today: string): Period | null {
  const plan = entity.attributes.runPlan;
  const start = plan && typeof plan === "object" && "interventionStart" in plan
    ? plan.interventionStart : entity.attributes.startedOn;
  const end = plan && typeof plan === "object" && "interventionEnd" in plan
    ? plan.interventionEnd : entity.attributes.endedOn;
  return typeof start !== "string" ? null : { id: entity.id, start, end: typeof end === "string" ? end : today };
}

/** Withhold a connected group if one overlapping intervention cannot be described safely.
 * This preserves caveats even when removing a private readout would remove its neighbor's caveat. */
function shareableGroups(periods: Iterable<Period>, byId: ReadonlyMap<string, Experiment[]>): Experiment[] {
  const eligible: Experiment[] = [];
  let group: Experiment[] = [];
  let withheld = false;
  let end = "";
  for (const period of [...periods].sort((a, b) => a.start.localeCompare(b.start))) {
    if (period.start > end) {
      if (!withheld) eligible.push(...group);
      group = [];
      withheld = false;
    }
    const cards = byId.get(period.id);
    if (cards?.length) group.push(...cards);
    else withheld = true;
    if (period.end > end) end = period.end;
  }
  if (!withheld) eligible.push(...group);
  return eligible;
}

/** Read canonical bank summaries only. Projected schedules identify concurrent, possibly unfinished interventions. */
export function readHealthWinExperiments(
  outcomes: readonly ExperimentOutcome[], entities: readonly BrowserVaultEntity[], today: string,
): Experiment[] {
  const plans = new Map(entities.map(entity => [entity.id, entity.attributes.runPlan]));
  const byId = new Map(outcomes.map(o => [o.experiment.id, cardsFromOutcome(o, today, plans.get(o.experiment.id))]));
  const periods = new Map<string, Period>();
  for (const { experiment, windows } of outcomes) {
    if (windows.interventionStart && experiment.status !== "planned") {
      periods.set(experiment.id, { id: experiment.id, start: windows.interventionStart, end: windows.interventionEnd ?? today });
    }
  }
  for (const entity of entities) {
    if (entity.status && entity.status !== "completed") byId.delete(entity.id);
    if (entity.status === "planned") {
      periods.delete(entity.id);
      continue;
    }
    const current = currentIntervention(entity, today);
    if (current) {
      const saved = periods.get(entity.id);
      if (saved && (saved.start !== current.start || saved.end !== current.end)) byId.delete(entity.id);
      periods.set(entity.id, current);
    }
  }
  return shareableGroups(periods.values(), byId);
}
