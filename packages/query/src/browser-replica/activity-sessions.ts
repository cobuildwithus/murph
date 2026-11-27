import {
  DETAILED_WORKOUT_TYPES,
  type DetailedWorkout,
  type ProjectedActivitySession,
} from "./activity-session-types.ts";
import { addDaysToIsoDate, isStrictIsoDate } from "@murphai/contracts";
import type { CanonicalEntity } from "../canonical-entities.ts";
import type { VaultReadModel } from "../read-model.ts";
import {
  buildActivitySessionCandidate,
  dedupeActivitySessionCandidates,
  groupMetricCandidatesByDate,
} from "../wearables/candidates.ts";
import { readWearableExternalRef } from "../wearables/observation.ts";
import type { WearableDataset } from "../wearables/types.ts";
import { isRunActivity } from "./runs.ts";

function detailedType(value: string | null | undefined) {
  const key = value?.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (["strength", "weight_training", "weightlifting", "resistance_training"].includes(key ?? ""))
    return "strength_training";
  if (key === "bike" || key === "biking") return "cycling";
  if (key === "swim") return "swimming";
  return DETAILED_WORKOUT_TYPES.find((type) => type === key);
}

function sessionType(activity: string | null | undefined): ProjectedActivitySession["type"] {
  const kind = activity
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, "-");
  if (isRunActivity(kind)) return "run";
  if (kind === "walk" || kind === "walking") return "walk";
  if (kind === "sauna" || kind === "dry-sauna") return "sauna";
  if (kind === "hiit" || kind === "high-intensity-interval-training") return "hiit";
  if (kind === "basketball") return "basketball";
  return "other";
}

function loggedSession(event: CanonicalEntity) {
  if (event.kind === "intervention_session") {
    const { sessionStatus, interventionType, sessionLocalDate } = event.attributes;
    if (sessionStatus !== "completed" || typeof interventionType !== "string") return null;
    const type = sessionType(interventionType);
    if (type === "other") return null; // Unclassified interventions can describe private treatment.
    const session = buildActivitySessionCandidate(event, "manual", null);
    return (
      session && {
        ...session,
        activityType: type,
        date: typeof sessionLocalDate === "string" ? sessionLocalDate : session.date,
      }
    );
  }
  if (event.kind !== "activity_session") return null;
  const ref = readWearableExternalRef(event.attributes.externalRef);
  if (ref?.system && ref.system.toLowerCase() !== "manual") return null;
  const workout = event.attributes.workout;
  if (
    workout &&
    typeof workout === "object" &&
    "sourceApp" in workout &&
    workout.sourceApp === "murph-live" &&
    !("endedAt" in workout && workout.endedAt)
  )
    return null;
  return buildActivitySessionCandidate(event, "manual", ref);
}

/** The composer counts sessions this month. Retain enough for a delayed publication at a month boundary. */
export function projectActivitySessions(vault: VaultReadModel, wearables: WearableDataset, today: string) {
  const from = addDaysToIsoDate(today, -62);
  const candidates = [...wearables.activitySessionCandidates];
  for (const event of vault.events) {
    if (event.date && event.date < from) continue;
    const candidate = loggedSession(event);
    if (candidate) candidates.push(candidate);
  }
  const recent = candidates.filter(
    (row) =>
      isStrictIsoDate(row.date) &&
      row.date >= from &&
      row.date <= today &&
      Number.isFinite(row.value) &&
      row.value > 0 &&
      row.value <= 1440,
  );
  const detailedWorkouts: DetailedWorkout[] = [];
  const activitySessions = [...groupMetricCandidatesByDate(recent)]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, rows]) =>
      dedupeActivitySessionCandidates(rows).map((row) => {
        const type = sessionType(row.activityType);
        const detail = type === "other" && detailedType(row.activityType);
        if (detail) detailedWorkouts.push({ date, type: detail, minutes: row.value });
        return { date, type, minutes: row.value };
      }),
    );
  return { activitySessions, detailedWorkouts };
}
