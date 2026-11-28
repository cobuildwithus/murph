import { createHash } from "node:crypto";
import { experimentRunPlanSchema, isStrictIsoDate, type ExperimentOutcome, type ExperimentRunPlan } from "@murphai/contracts";
import { normalizeMetricValue } from "@murphai/health-metrics";
import {
  resolveExperimentAdherenceRollupTarget, resolveExperimentAdherenceTargets, resolveExperimentMetricIdentity, type BrowserVaultEntity,
} from "@murphai/query/browser-replica-client";
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

function publicTitle(outcome: ExperimentOutcome, runPlan: ExperimentRunPlan) {
  const key = outcome.commonsProtocolRef?.key;
  if (key) {
    const protocol = /^(?:protocol|protocol_variant):([a-z0-9-]+)(?:\/[a-z0-9-]+)?$/u.exec(key)?.[1];
    return protocol ? PUBLIC_MODALITIES.get(protocol) : undefined;
  }
  const modality = outcome.effectiveProtocolSnapshot?.modality ?? runPlan.modality;
  return typeof modality === "string" ? PUBLIC_MODALITIES.get(modality.trim().toLowerCase().replace(/[ _]+/gu, "-")) : undefined;
}

function loggedInWindow(session: BrowserVaultEntity, { interventionStart, interventionEnd }: ExperimentOutcome["windows"]) {
  const { sessionStatus, source, sessionLocalDate, scheduledLocalDate } = session.attributes;
  // Older explicit session records can omit status, which the experiment reader treats as completed.
  if (source === "derived" || (sessionStatus !== undefined && sessionStatus !== "completed")) return false;
  const date = sessionLocalDate ?? scheduledLocalDate ?? session.date ?? session.occurredAt?.slice(0, 10);
  if (typeof date !== "string" || !isStrictIsoDate(date)) return null;
  return interventionStart !== null && interventionEnd !== null && date >= interventionStart && date <= interventionEnd;
}

function countLoggedSessions(outcomes: readonly ExperimentOutcome[], sessions: readonly BrowserVaultEntity[]) {
  const byId = new Map(outcomes.map(o => [o.experiment.id, o]));
  const bySlug = new Map(outcomes.map(o => [o.experiment.slug, o]));
  const counts = new Map<string, number | null>(outcomes.map(o => [o.experiment.id, 0]));
  for (const session of sessions) {
    const slug = session.attributes.experimentSlug ?? session.experimentSlug;
    const id = session.attributes.experimentId;
    const outcome = typeof id === "string" ? byId.get(id) : typeof slug === "string" ? bySlug.get(slug) : undefined;
    if (!outcome || (slug != null && slug !== outcome.experiment.slug)) continue;
    const experimentId = outcome.experiment.id;
    const logged = loggedInWindow(session, outcome.windows);
    const count = counts.get(experimentId);
    if (logged === null) counts.set(experimentId, null);
    else if (logged && count != null) counts.set(experimentId, count + 1);
  }
  return counts;
}

function usesActivitySessions(outcome: ExperimentOutcome, runPlan: ExperimentRunPlan, title: string) {
  const snapshot = outcome.effectiveProtocolSnapshot;
  const target = resolveExperimentAdherenceRollupTarget(resolveExperimentAdherenceTargets({
    explicitTargets: runPlan.adherenceTargets, protocolKey: outcome.commonsProtocolRef?.key,
    protocolActivitySessionEvidence: snapshot?.activitySessionEvidence, protocolSessionsPerDay: snapshot?.frequency?.sessionsPerDay,
    runPlan: { ...runPlan, modality: runPlan.modality ?? snapshot?.modality ?? title },
  }));
  return target?.evidence.kind === "linkedEventCount" && target.evidence.eventKind === "activity_session";
}

function cardsFromOutcome(outcome: ExperimentOutcome, today: string, runPlan: ExperimentRunPlan, loggedSessions: number | null): Experiment[] {
  const title = publicTitle(outcome, runPlan);
  const { baselineStart, baselineEnd, interventionStart, interventionEnd } = outcome.windows;
  if (!title || outcome.experiment.status !== "completed" || !baselineStart || !baselineEnd || !interventionStart
    || !interventionEnd || interventionEnd > today || interventionEnd > outcome.asOf || baselineEnd >= interventionStart) return [];
  const { targetSessions, completedSessions } = outcome.adherenceSummary;
  const done = usesActivitySessions(outcome, runPlan, title) ? completedSessions : loggedSessions;
  if (done === null || targetSessions === null || outcome.structuredReview) return [];
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
      expectedDirection: result.expectedDirection, adherence: { done, target: targetSessions } }];
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

/** Projected schedules identify concurrent, possibly unfinished interventions. */
export function readHealthWinExperiments(
  outcomes: readonly ExperimentOutcome[], entities: readonly BrowserVaultEntity[], sessions: readonly BrowserVaultEntity[] | null, today: string,
): Experiment[] {
  const plans = new Map(entities.map(entity => [entity.id, entity.attributes.runPlan]));
  const counts = sessions && countLoggedSessions(outcomes, sessions);
  const byId = new Map(outcomes.map(outcome => {
    const { id } = outcome.experiment;
    const plan = experimentRunPlanSchema.safeParse(plans.get(id) ?? {});
    return [id, plan.success ? cardsFromOutcome(outcome, today, plan.data, counts?.get(id) ?? null) : []];
  }));
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
