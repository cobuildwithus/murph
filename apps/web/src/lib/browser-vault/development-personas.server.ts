import "server-only";

import {
  createVaultReadModel,
  type CanonicalEntity,
  type MetricPoint,
} from "@murphai/query";
import { createBrowserVaultReplica } from "@murphai/query/browser-replica-server";
import type { BrowserVaultReplica } from "@murphai/query/browser";
import {
  DEVELOPMENT_PERSONAS,
  type DevelopmentPersonaId,
} from "./development-personas";

const PERSONA_HASH_CHAR: Record<DevelopmentPersonaId, string> = {
  coach: "c",
  context: "d",
  family: "e",
  new: "f",
  oura: "a",
  whoop: "b",
};

export async function buildDevelopmentPersonaReplica(
  personaId: DevelopmentPersonaId,
  now = new Date(),
): Promise<BrowserVaultReplica> {
  const generatedAt = now.toISOString();
  const asOfDate = generatedAt.slice(0, 10);
  const fixture = buildPersonaFixture(personaId, asOfDate);

  return createBrowserVaultReplica({
    generatedAt,
    metricPoints: fixture.metricPoints,
    sourceBundleHash: PERSONA_HASH_CHAR[personaId].repeat(64),
    vault: createVaultReadModel({
      entities: fixture.entities,
      metadata: {
        timezone: fixture.timeZone,
        title: `${fixture.label} development data`,
      },
      vaultRoot: `development://persona/${personaId}`,
    }),
  });
}

interface PersonaFixture {
  entities: CanonicalEntity[];
  label: string;
  metricPoints: MetricPoint[];
  timeZone: string;
}

interface OuraPersonaActivityDates {
  cycling: Set<string>;
  hiking: Set<string>;
  running: Set<string>;
  strength: Set<string>;
  tennis: Set<string>;
}

function buildPersonaFixture(
  personaId: DevelopmentPersonaId,
  asOfDate: string,
): PersonaFixture {
  const timeZone =
    personaId === "context" ? "America/New_York" : "Europe/Warsaw";
  const source = personaId === "whoop" ? "whoop" : "oura";
  const entities: CanonicalEntity[] = [];
  const metricPoints: MetricPoint[] = [];
  const factorDates = new Set(
    Array.from({ length: 6 }, (_, index) =>
      addDays(asOfDate, -(index * 14 + 8)),
    ),
  );
  const ouraActivityDates =
    personaId === "oura" ? buildOuraPersonaActivityDates(asOfDate) : null;

  for (let offset = 83; offset >= 0; offset -= 1) {
    if (personaId === "family" || personaId === "new") continue;
    const date = addDays(asOfDate, -offset);
    const priorDate = addDays(date, -1);
    const followsFactor = factorDates.has(priorDate);
    const followsCycling = ouraActivityDates?.cycling.has(priorDate) ?? false;
    const followsRunning = ouraActivityDates?.running.has(priorDate) ?? false;
    const followsStrength = ouraActivityDates?.strength.has(priorDate) ?? false;
    const followsTennis = ouraActivityDates?.tennis.has(priorDate) ?? false;
    const wave = offset % 5;
    const totalSleep =
      430 +
      wave * 9 -
      (followsFactor ? 42 : 0) +
      (followsCycling ? 32 : 0) -
      (followsTennis ? 24 : 0);
    const sleepScore =
      79 +
      (offset % 4) -
      (followsFactor ? 9 : 0) +
      (followsCycling ? 6 : 0) -
      (followsTennis ? 6 : 0);
    const efficiency =
      87 + (offset % 3) - (followsFactor ? 4 : 0) + (followsRunning ? 5 : 0);
    const readiness =
      78 +
      (offset % 6) -
      (followsFactor ? 8 : 0) +
      (followsCycling ? 8 : 0) -
      (followsTennis ? 8 : 0);
    const hrv =
      personaId === "whoop"
        ? 58 + (offset % 8) - (followsFactor ? 5 : 0)
        : 48 +
          (offset % 9) -
          (followsFactor ? 4 : 0) +
          (followsCycling ? 8 : 0) -
          (followsTennis ? 5 : 0);
    const deepSleep = 72 + (offset % 6) + (followsStrength ? 14 : 0);
    const remSleep = 96 + (offset % 8) + (followsRunning ? 16 : 0);

    entities.push(
      eventEntity({
        attributes: {
          durationMinutes: totalSleep,
          sleepType: "main_sleep",
          source,
          timeZone,
        },
        date,
        id: `${personaId}_sleep_${date}`,
        kind: "sleep_session",
        occurredAt: `${date}T07:30:00.000Z`,
        title: "Sleep",
      }),
    );
    metricPoints.push(
      metricPoint(
        personaId,
        source,
        date,
        "total-sleep-minutes",
        totalSleep,
        "min",
      ),
      metricPoint(
        personaId,
        source,
        date,
        "deep-sleep-minutes",
        deepSleep,
        "min",
      ),
      metricPoint(
        personaId,
        source,
        date,
        "rem-sleep-minutes",
        remSleep,
        "min",
      ),
      metricPoint(personaId, source, date, "sleep-score", sleepScore, "score"),
      metricPoint(personaId, source, date, "sleep-efficiency", efficiency, "%"),
      metricPoint(personaId, source, date, "hrv-rmssd", hrv, "ms"),
      metricPoint(
        personaId,
        source,
        date,
        personaId === "whoop" ? "recovery-score" : "readiness-score",
        readiness,
        "%",
      ),
      metricPoint(
        personaId,
        source,
        date,
        "resting-heart-rate",
        57 + (offset % 4) + (followsFactor ? 3 : 0),
        "bpm",
      ),
      metricPoint(
        personaId,
        source,
        date,
        "respiratory-rate",
        14.2 + (offset % 4) * 0.2,
        "breaths/min",
      ),
      metricPoint(personaId, source, date, "spo2", 96 + (offset % 3), "%"),
    );

    if (personaId === "whoop") {
      entities.push(
        observationEntity(personaId, date, "recovery-score", readiness, "%"),
        observationEntity(
          personaId,
          date,
          "deep-sleep-minutes",
          deepSleep,
          "min",
        ),
        observationEntity(
          personaId,
          date,
          "rem-sleep-minutes",
          remSleep,
          "min",
        ),
        observationEntity(
          personaId,
          date,
          "respiratory-rate",
          14.2 + (offset % 4) * 0.2,
          "breaths/min",
        ),
        observationEntity(personaId, date, "spo2", 96 + (offset % 3), "%"),
      );
    }

    if (offset % 7 === 2) {
      entities.push(
        activityEntity(
          personaId,
          date,
          "walking",
          38 + (offset % 4) * 6,
          source,
        ),
      );
    }
    if (personaId === "oura" && offset % 14 === 3) {
      entities.push(
        activityEntity(
          personaId,
          date,
          "yardwork",
          45 + (offset % 3) * 25,
          source,
        ),
      );
    }
  }

  for (const date of personaId === "family" || personaId === "new"
    ? []
    : factorDates) {
    entities.push(
      eventEntity({
        attributes: {
          note:
            personaId === "whoop"
              ? "A late, high-strain session."
              : "Coffee late in the afternoon.",
          noteType: "journal-factor",
          source: "manual",
        },
        date,
        id: `${personaId}_factor_${date}`,
        kind: "note",
        occurredAt: `${date}T16:30:00.000Z`,
        tags:
          personaId === "whoop"
            ? ["key-high-strain", "timing-evening"]
            : ["key-late-caffeine", "timing-afternoon"],
        title: personaId === "whoop" ? "High strain" : "Late caffeine",
      }),
    );
  }

  addPersonaSpecificEvents(
    personaId,
    asOfDate,
    entities,
    metricPoints,
    ouraActivityDates,
  );

  return {
    entities,
    label:
      DEVELOPMENT_PERSONAS.find((persona) => persona.id === personaId)?.label ??
      personaId,
    metricPoints,
    timeZone,
  };
}

function addPersonaSpecificEvents(
  personaId: DevelopmentPersonaId,
  asOfDate: string,
  entities: CanonicalEntity[],
  metricPoints: MetricPoint[],
  ouraActivityDates: OuraPersonaActivityDates | null,
) {
  if (personaId === "oura" && ouraActivityDates) {
    for (const date of ouraActivityDates.tennis) {
      entities.push(activityEntity(personaId, date, "tennis", 62, "oura"));
    }
    for (const date of ouraActivityDates.cycling) {
      entities.push(activityEntity(personaId, date, "cycling", 50, "oura"));
    }
    for (const date of ouraActivityDates.running) {
      entities.push(activityEntity(personaId, date, "running", 39, "oura"));
    }
    for (const date of ouraActivityDates.hiking) {
      entities.push(activityEntity(personaId, date, "hiking", 120, "oura"));
    }
    for (const date of ouraActivityDates.strength) {
      entities.push(
        activityEntity(personaId, date, "strength-training", 50, "oura"),
      );
    }
    return;
  }

  if (personaId === "whoop") {
    for (let offset = 5; offset <= 75; offset += 8) {
      const date = addDays(asOfDate, -offset);
      entities.push(
        activityEntity(personaId, date, "strength-training", 54, "whoop"),
      );
      addWhoopWorkoutMetricPoints(metricPoints, {
        activityType: "strength-training",
        date,
        durationMinutes: 54,
        personaId,
        strain: 13.8 + (offset % 3),
      });
    }
    for (let offset = 9; offset <= 79; offset += 15) {
      const date = addDays(asOfDate, -offset);
      entities.push(activityEntity(personaId, date, "cycling", 78, "whoop"));
      addWhoopWorkoutMetricPoints(metricPoints, {
        activityType: "cycling",
        date,
        durationMinutes: 78,
        personaId,
        strain: 15.4 + (offset % 2),
      });
    }
    for (let offset = 13; offset <= 73; offset += 15) {
      const date = addDays(asOfDate, -offset);
      entities.push(activityEntity(personaId, date, "running", 41, "whoop"));
      addWhoopWorkoutMetricPoints(metricPoints, {
        activityType: "running",
        date,
        durationMinutes: 41,
        personaId,
        strain: 14.6 + (offset % 2),
      });
    }
    for (let offset = 3; offset <= 75; offset += 18) {
      const date = addDays(asOfDate, -offset);
      entities.push(
        activityEntity(personaId, date, "functional-fitness", 47, "whoop"),
      );
      addWhoopWorkoutMetricPoints(metricPoints, {
        activityType: "functional-fitness",
        date,
        durationMinutes: 47,
        personaId,
        strain: 12.9 + (offset % 3),
      });
    }
    return;
  }

  if (personaId === "coach") {
    entities.push(
      journalNote({
        date: addDays(asOfDate, -45),
        id: "coach_plan_started",
        note: "Murph prepared Strength Base, an eight-week plan with four sessions each week.",
        noteType: "journal-plan",
        tags: ["key-training-plan"],
        title: "Strength Base",
      }),
      eventEntity({
        attributes: { source: "murph" },
        date: addDays(asOfDate, -1),
        id: "coach_unaccepted_suggestion",
        kind: "reminder",
        occurredAt: `${addDays(asOfDate, -1)}T08:00:00.000Z`,
        title: "Suggested mobility session",
      }),
    );
    for (let offset = 2; offset <= 44; offset += 3) {
      const date = addDays(asOfDate, -offset);
      const isLowerBodyDay = offset % 2 === 0;
      entities.push(
        eventEntity({
          attributes: {
            activityType: "strength-training",
            durationMinutes: 48,
            source: "murph-live",
            workout: {
              endedAt: `${date}T18:48:00.000Z`,
              exercises: isLowerBodyDay
                ? [
                    { name: "Squat", sets: [{ completed: true, reps: 8 }] },
                    {
                      name: "Romanian deadlift",
                      sets: [{ completed: true, reps: 10 }],
                    },
                  ]
                : [
                    {
                      name: "Bench press",
                      sets: [{ completed: true, reps: 8 }],
                    },
                    { name: "Row", sets: [{ completed: true, reps: 10 }] },
                  ],
              routineName: isLowerBodyDay
                ? "Strength Base: Lower"
                : "Strength Base: Upper",
              sourceApp: "murph-live",
              startedAt: `${date}T18:00:00.000Z`,
            },
          },
          date,
          id: `coach_training_${date}`,
          kind: "activity_session",
          occurredAt: `${date}T18:00:00.000Z`,
          title: "Strength Base",
        }),
      );
    }
    return;
  }

  if (personaId === "family") {
    entities.push(
      journalNote({
        date: addDays(asOfDate, -3),
        id: "family_football",
        note: "Played football and felt energetic afterward.",
        source: "private-group-capture",
        tags: ["key-football"],
        title: "Football",
      }),
      journalNote({
        date: addDays(asOfDate, -1),
        id: "family_recovery",
        note: "Legs felt sore after the match.",
        noteType: "journal-outcome",
        source: "private-group-capture",
        tags: ["key-muscle-soreness"],
        title: "Muscle soreness",
      }),
    );
    return;
  }

  if (personaId === "new") {
    return;
  }

  const tripStart = addDays(asOfDate, -5);
  entities.push(
    habitatEntity({
      aspect: "home-location",
      id: "context_home_location",
      indicators: {
        area_type: "urban_center",
        location: "New York",
      },
      title: "Location and climate",
    }),
    habitatEntity({
      aspect: "sleep-environment",
      id: "context_sleep_environment",
      indicators: {
        co2_meter: "aranet",
        darkness: "blackout",
        mattress_satisfaction: "good",
        night_noise: "quiet",
        night_temp_c: 18,
        phone_by_bed: false,
        tv_in_bedroom: false,
      },
      title: "Bedroom and sleep",
    }),
    journalNote({
      date: tripStart,
      id: "context_trip",
      note: "Four-night work trip. Staying away from home.",
      occurredAt: null,
      source: "calendar",
      tags: ["key-travel", "episode-work-trip"],
      title: "Work trip",
    }),
    journalNote({
      date: addDays(asOfDate, -12),
      id: "context_environment",
      note: "Bedroom temperature changed to 18 C.",
      occurredAt: null,
      source: "environment",
      tags: ["key-bedroom-temperature"],
      title: "Bedroom temperature",
    }),
    eventEntity({
      attributes: {
        ingredients: ["Salmon", "Rice", "Vegetables"],
        nutrition: { totals: { calories: 680, proteinGrams: 44 } },
        source: "meal-photo",
      },
      date: addDays(asOfDate, -1),
      id: "context_meal",
      kind: "meal",
      occurredAt: `${addDays(asOfDate, -1)}T19:10:00.000Z`,
      title: "Meal",
    }),
  );
}

function buildOuraPersonaActivityDates(
  asOfDate: string,
): OuraPersonaActivityDates {
  return {
    cycling: scheduledDates(asOfDate, 4, 80, 12),
    hiking: scheduledDates(asOfDate, 12, 75, 21),
    running: scheduledDates(asOfDate, 9, 79, 14),
    strength: scheduledDates(asOfDate, 3, 80, 10),
    tennis: scheduledDates(asOfDate, 6, 76, 14),
  };
}

function scheduledDates(
  asOfDate: string,
  firstOffset: number,
  lastOffset: number,
  step: number,
): Set<string> {
  const dates = new Set<string>();
  for (let offset = firstOffset; offset <= lastOffset; offset += step) {
    dates.add(addDays(asOfDate, -offset));
  }
  return dates;
}

function habitatEntity(input: {
  aspect: string;
  id: string;
  indicators: Record<string, boolean | number | string>;
  title: string;
}): CanonicalEntity {
  return {
    attributes: {
      aspect: input.aspect,
      domain: "environment",
      indicators: input.indicators,
    },
    body: null,
    date: null,
    entityId: input.id,
    experimentSlug: null,
    family: "habitat",
    frontmatter: null,
    kind: "habitat",
    links: [],
    lookupIds: [input.id],
    occurredAt: null,
    path: `bank/habitat/${input.aspect}.md`,
    primaryLookupId: input.id,
    recordClass: "bank",
    relatedIds: [],
    status: "active",
    stream: null,
    tags: [],
    title: input.title,
  };
}

function activityEntity(
  personaId: DevelopmentPersonaId,
  date: string,
  activityType: string,
  durationMinutes: number,
  source: string,
): CanonicalEntity {
  return eventEntity({
    attributes: { activityType, durationMinutes, source },
    date,
    id: `${personaId}_${activityType}_${date}`,
    kind: "activity_session",
    occurredAt: `${date}T17:00:00.000Z`,
    title: activityType,
  });
}

function addWhoopWorkoutMetricPoints(
  metricPoints: MetricPoint[],
  input: {
    activityType: string;
    date: string;
    durationMinutes: number;
    personaId: DevelopmentPersonaId;
    strain: number;
  },
): void {
  const averageHeartRate = 132 + (input.durationMinutes % 11);
  const options = {
    context: { activityType: input.activityType },
    recordSuffix: input.activityType,
  };
  metricPoints.push(
    metricPoint(
      input.personaId,
      "whoop",
      input.date,
      "workout-strain",
      input.strain,
      "strain",
      options,
    ),
    metricPoint(
      input.personaId,
      "whoop",
      input.date,
      "activity-average-heart-rate",
      averageHeartRate,
      "bpm",
      options,
    ),
    metricPoint(
      input.personaId,
      "whoop",
      input.date,
      "max-heart-rate",
      averageHeartRate + 36,
      "bpm",
      options,
    ),
    metricPoint(
      input.personaId,
      "whoop",
      input.date,
      "active-calories",
      Math.round(input.durationMinutes * 8.4),
      "kcal",
      options,
    ),
  );
}

function observationEntity(
  personaId: DevelopmentPersonaId,
  date: string,
  metric: string,
  value: number,
  unit: string,
): CanonicalEntity {
  return eventEntity({
    attributes: {
      dayKey: date,
      externalRef: {
        resourceId: `${personaId}_${metric}_${date}`,
        resourceType: "summary",
        system: personaId,
      },
      metric,
      observationGrain: "summary",
      recordedAt: `${date}T07:35:00.000Z`,
      source: "device",
      value,
      unit,
    },
    date,
    id: `${personaId}_${metric}_observation_${date}`,
    kind: "observation",
    occurredAt: `${date}T07:30:00.000Z`,
    title: metric,
  });
}

function journalNote(input: {
  date: string;
  id: string;
  note: string;
  noteType?: "journal-factor" | "journal-outcome" | "journal-plan";
  occurredAt?: string | null;
  source?: string;
  tags: string[];
  title: string;
}): CanonicalEntity {
  return eventEntity({
    attributes: {
      note: input.note,
      noteType: input.noteType ?? "journal-context",
      source: input.source ?? "murph",
    },
    date: input.date,
    id: input.id,
    kind: "note",
    occurredAt:
      input.occurredAt === undefined
        ? `${input.date}T12:00:00.000Z`
        : input.occurredAt,
    tags: input.tags,
    title: input.title,
  });
}

function eventEntity(input: {
  attributes: Record<string, unknown>;
  date: string;
  id: string;
  kind: string;
  occurredAt: string | null;
  tags?: string[];
  title: string;
}): CanonicalEntity {
  return {
    attributes: input.attributes,
    body: null,
    date: input.date,
    entityId: input.id,
    experimentSlug: null,
    family: "event",
    frontmatter: null,
    kind: input.kind,
    links: [],
    lookupIds: [input.id],
    occurredAt: input.occurredAt,
    path: `development/events/${input.id}.jsonl`,
    primaryLookupId: input.id,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: input.tags ?? [],
    title: input.title,
  };
}

function metricPoint(
  personaId: DevelopmentPersonaId,
  provider: string,
  date: string,
  metricKey: string,
  value: number,
  unit: string,
  options: {
    context?: Record<string, boolean | number | string>;
    recordSuffix?: string;
  } = {},
): MetricPoint {
  const id = [personaId, metricKey, date, options.recordSuffix]
    .filter(Boolean)
    .join("_");
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: options.context ?? {},
    effectiveDate: date,
    grain: "day",
    id: `metric-point:${id}`,
    metricKey,
    observedAt: `${date}T07:30:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider,
      rawRefs: [],
      sourceLabel: provider === "whoop" ? "Whoop" : "Oura",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: "wearable-summary",
      path: "",
      recordId: id,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
