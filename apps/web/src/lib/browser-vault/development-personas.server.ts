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
  active: "d",
  coach: "c",
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

interface PatternedActivityDates {
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
  const timeZone = "Europe/Warsaw";
  const source = personaId === "whoop" ? "whoop" : "oura";
  const entities: CanonicalEntity[] = [];
  const metricPoints: MetricPoint[] = [];
  const factorDates = new Set(
    Array.from({ length: 6 }, (_, index) =>
      addDays(asOfDate, -(index * 14 + 8)),
    ),
  );
  const patternedActivityDates =
    personaId === "oura"
      ? buildOuraPersonaActivityDates(asOfDate)
      : personaId === "coach"
      ? buildTrainingPersonaActivityDates(asOfDate)
      : null;

  for (let offset = 83; offset >= 0; offset -= 1) {
    if (personaId === "active" || personaId === "new") continue;
    const date = addDays(asOfDate, -offset);
    const priorDate = addDays(date, -1);
    const followsFactor = factorDates.has(priorDate);
    const followsCycling =
      patternedActivityDates?.cycling.has(priorDate) ?? false;
    const followsRunning =
      patternedActivityDates?.running.has(priorDate) ?? false;
    const followsStrength =
      patternedActivityDates?.strength.has(priorDate) ?? false;
    const followsTennis =
      patternedActivityDates?.tennis.has(priorDate) ?? false;
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

  for (const date of personaId === "active" || personaId === "new"
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
    patternedActivityDates,
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
  patternedActivityDates: PatternedActivityDates | null,
) {
  if (personaId === "oura" && patternedActivityDates) {
    for (const date of patternedActivityDates.tennis) {
      entities.push(activityEntity(personaId, date, "tennis", 62, "oura"));
    }
    for (const date of patternedActivityDates.cycling) {
      entities.push(activityEntity(personaId, date, "cycling", 50, "oura"));
    }
    for (const date of patternedActivityDates.running) {
      entities.push(activityEntity(personaId, date, "running", 39, "oura"));
    }
    for (const date of patternedActivityDates.hiking) {
      entities.push(activityEntity(personaId, date, "hiking", 120, "oura"));
    }
    for (const date of patternedActivityDates.strength) {
      entities.push(
        activityEntity(personaId, date, "strength-training", 50, "oura"),
      );
    }
    addContextRichEvents(asOfDate, entities);
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
    addWhoopJournalExamples(asOfDate, entities);
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
    for (const [offset, activityType, durationMinutes] of [
      [1, "mobility", 18],
      [5, "running", 32],
      [8, "walking", 58],
      [11, "cycling", 44],
    ] as const) {
      entities.push(
        activityEntity(
          personaId,
          addDays(asOfDate, -offset),
          activityType,
          durationMinutes,
          "murph-live",
        ),
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
      journalNote({
        date: addDays(asOfDate, -8),
        id: "family_group_walk",
        note: "Went for a long walk with the family.",
        source: "private-group-capture",
        tags: ["key-walking"],
        title: "Family walk",
      }),
      journalNote({
        date: addDays(asOfDate, -12),
        id: "family_coach_group",
        note: "The coach group recorded a completed mobility session.",
        source: "private-group-capture",
        tags: ["key-mobility"],
        title: "Mobility",
      }),
      activityEntity(
        personaId,
        addDays(asOfDate, -5),
        "walking",
        52,
        "apple-health",
      ),
      activityEntity(
        personaId,
        addDays(asOfDate, -10),
        "strength-training",
        38,
        "apple-health",
      ),
    );
    return;
  }

  if (personaId === "active") {
    const recentActivities = [
      [1, "walking", 42],
      [2, "strength-training", 46],
      [4, "cycling", 64],
      [6, "running", 31],
      [8, "football", 55],
      [10, "walking", 36],
      [12, "mobility", 20],
    ] as const;
    for (const [offset, activityType, durationMinutes] of recentActivities) {
      entities.push(
        activityEntity(
          personaId,
          addDays(asOfDate, -offset),
          activityType,
          durationMinutes,
          "manual",
        ),
      );
    }
    entities.push(
      journalNote({
        date: addDays(asOfDate, -3),
        id: "active_sleep_outcome",
        note: "Slept poorly and woke up tired.",
        noteType: "journal-outcome",
        tags: ["key-sleep-quality"],
        title: "Poor sleep",
      }),
      journalNote({
        date: addDays(asOfDate, -7),
        id: "active_sauna",
        note: "Spent 18 minutes in a Finnish sauna at 82 C.",
        tags: ["key-sauna", "temperature-82-c"],
        title: "Sauna",
      }),
      eventEntity({
        attributes: {
          ingredients: ["Eggs", "Toast", "Avocado"],
          source: "meal-photo",
        },
        date: addDays(asOfDate, -2),
        id: "active_meal",
        kind: "meal",
        occurredAt: `${addDays(asOfDate, -2)}T08:20:00.000Z`,
        title: "Breakfast",
      }),
    );
    return;
  }

  if (personaId === "new") {
    return;
  }

  addContextRichEvents(asOfDate, entities);
}

function addContextRichEvents(asOfDate: string, entities: CanonicalEntity[]) {
  const tripStart = addDays(asOfDate, -5);
  entities.push(
    habitatEntity({
      aspect: "home-location",
      id: "oura_home_location",
      indicators: {
        area_type: "urban_center",
        location: "Warsaw",
      },
      title: "Location and climate",
    }),
    habitatEntity({
      aspect: "sleep-environment",
      id: "oura_sleep_environment",
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
      id: "oura_trip",
      note: "Four-night work trip. Staying away from home.",
      occurredAt: null,
      source: "calendar",
      tags: ["key-travel", "episode-work-trip"],
      title: "Work trip",
    }),
    journalNote({
      date: addDays(asOfDate, -12),
      id: "oura_environment",
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
      id: "oura_meal",
      kind: "meal",
      occurredAt: `${addDays(asOfDate, -1)}T19:10:00.000Z`,
      title: "Meal",
    }),
  );
}

function addWhoopJournalExamples(
  asOfDate: string,
  entities: CanonicalEntity[],
): void {
  const date = (offset: number) => addDays(asOfDate, -offset);

  entities.push(
    journalNote({
      date: date(1),
      id: "whoop_calendar_tennis",
      note: "Tennis is planned for 18:30 today.",
      noteType: "journal-plan",
      source: "calendar",
      tags: ["key-tennis", "planned"],
      title: "Tennis planned",
    }),
    eventEntity({
      attributes: {
        activityType: "strength-training",
        durationMinutes: 52,
        source: "whoop",
        summary: "Completed the Lower Body A session from Strength Base.",
        workout: {
          exercises: [
            "Goblet squat",
            "Romanian deadlift",
            "Split squat",
            "Calf raise",
          ],
          routineName: "Strength Base · Lower Body A",
        },
      },
      date: date(2),
      id: "whoop_training_plan_session",
      kind: "activity_session",
      occurredAt: `${date(2)}T17:30:00.000Z`,
      tags: ["key-strength-training", "training-plan-strength-base"],
      title: "Strength training",
    }),
    journalNote({
      date: date(3),
      id: "whoop_multi_day_trip",
      note: "Three-day work trip. Staying away from home, day 2 of 3.",
      occurredAt: null,
      source: "calendar",
      tags: ["key-travel", "episode-work-trip"],
      title: "Work trip",
    }),
    journalNote({
      date: date(4),
      id: "whoop_timezone_change",
      note: "Local time changed by two hours during travel.",
      occurredAt: null,
      source: "calendar",
      tags: ["key-travel", "timezone-change"],
      title: "Time zone change",
    }),
    eventEntity({
      attributes: {
        source: "laboratory",
        summary: "A new blood panel is ready with 18 measured markers.",
      },
      date: date(5),
      id: "whoop_lab_result",
      kind: "test",
      occurredAt: `${date(5)}T09:00:00.000Z`,
      title: "Blood test results",
    }),
    eventEntity({
      attributes: {
        source: "murph",
        status: "active",
        summary: "Day 6 of a 14-day magnesium sleep experiment.",
      },
      date: date(6),
      id: "whoop_experiment_active",
      kind: "experiment_context",
      occurredAt: `${date(6)}T08:00:00.000Z`,
      title: "Magnesium for Sleep",
    }),
    journalNote({
      date: date(7),
      id: "whoop_environment_change",
      note: "Bedroom temperature changed from 21 C to 18 C.",
      occurredAt: null,
      source: "environment",
      tags: ["key-bedroom-temperature"],
      title: "Bedroom temperature changed",
    }),
    eventEntity({
      attributes: {
        source: "murph",
        status: "completed",
        summary: "The 14-day consistent wake time experiment finished.",
      },
      date: date(8),
      id: "whoop_experiment_completed",
      kind: "experiment_context",
      occurredAt: `${date(8)}T08:00:00.000Z`,
      title: "Consistent Wake Time completed",
    }),
    journalNote({
      date: date(9),
      id: "whoop_day_trip",
      note: "Day trip by train. Home again the same evening.",
      occurredAt: null,
      source: "calendar",
      tags: ["key-travel", "day-trip"],
      title: "Day trip",
    }),
    eventEntity({
      attributes: {
        source: "murph",
        status: "planned",
        summary: "A seven-day no-late-caffeine experiment was added.",
      },
      date: date(10),
      id: "whoop_experiment_new",
      kind: "experiment_context",
      occurredAt: `${date(10)}T08:00:00.000Z`,
      title: "No Late Caffeine added",
    }),
    journalNote({
      date: date(11),
      id: "whoop_group_joined",
      note: "Joined a private strength training group.",
      source: "group",
      tags: ["group-membership"],
      title: "Joined Strength Crew",
    }),
  );
}

function buildOuraPersonaActivityDates(
  asOfDate: string,
): PatternedActivityDates {
  return {
    cycling: scheduledDates(asOfDate, 4, 80, 12),
    hiking: scheduledDates(asOfDate, 12, 75, 21),
    running: scheduledDates(asOfDate, 9, 79, 14),
    strength: scheduledDates(asOfDate, 3, 80, 10),
    tennis: scheduledDates(asOfDate, 6, 76, 14),
  };
}

function buildTrainingPersonaActivityDates(
  asOfDate: string,
): PatternedActivityDates {
  return {
    cycling: new Set(),
    hiking: new Set(),
    running: new Set(),
    strength: scheduledDates(asOfDate, 2, 44, 3),
    tennis: new Set(),
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
