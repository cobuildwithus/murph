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

  for (let offset = 83; offset >= 0; offset -= 1) {
    if (personaId === "family") continue;
    const date = addDays(asOfDate, -offset);
    const followsFactor = factorDates.has(addDays(date, -1));
    const wave = offset % 5;
    const totalSleep = 430 + wave * 9 - (followsFactor ? 42 : 0);
    const sleepScore = 79 + (offset % 4) - (followsFactor ? 9 : 0);
    const efficiency = 87 + (offset % 3) - (followsFactor ? 4 : 0);
    const readiness = 78 + (offset % 6) - (followsFactor ? 8 : 0);
    const hrv =
      personaId === "whoop"
        ? 58 + (offset % 8) - (followsFactor ? 5 : 0)
        : 48 + (offset % 9) - (followsFactor ? 4 : 0);

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
        72 + (offset % 6),
        "min",
      ),
      metricPoint(
        personaId,
        source,
        date,
        "rem-sleep-minutes",
        96 + (offset % 8),
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
          72 + (offset % 6),
          "min",
        ),
        observationEntity(
          personaId,
          date,
          "rem-sleep-minutes",
          96 + (offset % 8),
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
    if (personaId === "oura" && offset % 7 < 5) {
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

  for (const date of personaId === "family" ? [] : factorDates) {
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

  addPersonaSpecificEvents(personaId, asOfDate, entities);

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
) {
  if (personaId === "oura") {
    for (let offset = 6; offset <= 76; offset += 14) {
      entities.push(
        activityEntity(
          personaId,
          addDays(asOfDate, -offset),
          "tennis",
          62,
          "oura",
        ),
      );
    }
    return;
  }

  if (personaId === "whoop") {
    for (let offset = 5; offset <= 75; offset += 7) {
      entities.push(
        activityEntity(
          personaId,
          addDays(asOfDate, -offset),
          "strength-training",
          54,
          "whoop",
        ),
      );
    }
    for (let offset = 9; offset <= 79; offset += 14) {
      entities.push(
        activityEntity(
          personaId,
          addDays(asOfDate, -offset),
          "cycling",
          78,
          "whoop",
        ),
      );
    }
    return;
  }

  if (personaId === "coach") {
    entities.push(
      journalNote({
        date: addDays(asOfDate, -20),
        id: "coach_plan_started",
        note: "Started a six-week strength plan with three sessions each week.",
        noteType: "journal-plan",
        tags: ["key-training-plan"],
        title: "Strength plan",
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
    for (let offset = 2; offset <= 20; offset += 3) {
      const date = addDays(asOfDate, -offset);
      entities.push(
        eventEntity({
          attributes: {
            activityType: "strength-training",
            durationMinutes: 48,
            source: "murph-live",
            workout: {
              endedAt: `${date}T18:48:00.000Z`,
              exercises: [
                { name: "Squat", sets: [{ completed: true, reps: 8 }] },
                { name: "Row", sets: [{ completed: true, reps: 10 }] },
              ],
              routineName: "Strength Base",
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
): MetricPoint {
  const id = `${personaId}_${metricKey}_${date}`;
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: {},
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
