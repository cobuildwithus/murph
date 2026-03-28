import { stripUndefined } from "../shared.ts";
import {
  minutesBetween,
  pushObservationEvent,
  pushSample,
} from "./shared-normalization.ts";
import {
  asObjectArray,
  firstDayKeyFromPaths,
  firstIdentifierFromPaths,
  firstInstantFromPaths,
  firstIsoFromPaths,
  firstNumberFromPaths,
  firstStringFromPaths,
  firstTimeZoneFromPaths,
  gramsToKilograms,
  makeGarminExternalRef,
  millisecondsToMinutes,
  normalizeSleepStage,
  normalizePositiveIntegerMinutes,
  pushGarminArtifact,
  secondsToMinutes,
  synthesizeUtcStartOfDay,
} from "./garmin-helpers.ts";

import type {
  DeviceEventPayload,
  DeviceRawArtifactPayload,
  DeviceSamplePayload,
} from "../core-port.ts";
import type { PlainObject } from "./shared-normalization.ts";

export interface GarminHealthNormalizationContext {
  importedAt: string;
  events: DeviceEventPayload[];
  samples: DeviceSamplePayload[];
  rawArtifacts: DeviceRawArtifactPayload[];
}

interface GarminObservationSpec {
  metric: string;
  unit: string;
  title: string;
  facet: string;
  resolveValue(record: PlainObject): number | undefined;
}

interface GarminCalendarBucketContext {
  dayKey?: string;
  timeZone?: string;
}

function resolveGarminCalendarBucketTiming(
  record: PlainObject,
  importedAt: string,
  options: {
    instantPaths: readonly string[];
    dayKeyPaths: readonly string[];
    timeZonePaths: readonly string[];
  },
): { recordedAt: string; bucketContext: GarminCalendarBucketContext } {
  const dayKey = firstDayKeyFromPaths(record, options.dayKeyPaths);
  const timeZone = firstTimeZoneFromPaths(record, options.timeZonePaths);
  const instant = firstInstantFromPaths(record, options.instantPaths);

  if (instant) {
    return {
      recordedAt: instant,
      bucketContext: {
        dayKey,
        timeZone,
      },
    };
  }

  const synthesizedRecordedAt =
    dayKey && timeZone
      ? synthesizeUtcStartOfDay(dayKey, timeZone)
      : undefined;

  if (synthesizedRecordedAt) {
    return {
      recordedAt: synthesizedRecordedAt,
      bucketContext: {
        dayKey,
        timeZone,
      },
    };
  }

  return {
    recordedAt: firstIsoFromPaths(record, options.dayKeyPaths) ?? importedAt,
    bucketContext: {
      dayKey,
    },
  };
}

function pushGarminObservation(
  context: GarminHealthNormalizationContext,
  resourceType: string,
  resourceId: string,
  version: string | undefined,
  role: string,
  occurredAt: string,
  recordedAt: string,
  record: PlainObject,
  observation: GarminObservationSpec,
  bucketContext: GarminCalendarBucketContext = {},
): void {
  pushObservationEvent(context.events, {
    metric: observation.metric,
    value: observation.resolveValue(record),
    unit: observation.unit,
    occurredAt,
    recordedAt,
    dayKey: bucketContext.dayKey,
    timeZone: bucketContext.timeZone,
    title: observation.title,
    rawArtifactRoles: [role],
    externalRef: makeGarminExternalRef(resourceType, resourceId, version, observation.facet),
  });
}

function pushSleepStageSample(
  samples: DeviceSamplePayload[],
  sleepId: string,
  version: string | undefined,
  stageRecord: PlainObject,
): void {
  const stage = normalizeSleepStage(
    firstStringFromPaths(stageRecord, ["stage", "sleepStage", "level", "name"]),
  );
  const startAt = firstIsoFromPaths(stageRecord, [
    "startTime",
    "startAt",
    "start_timestamp",
  ]);
  const endAt = firstIsoFromPaths(stageRecord, [
    "endTime",
    "endAt",
    "end_timestamp",
  ]);
  const durationMinutes =
    normalizePositiveIntegerMinutes(firstNumberFromPaths(stageRecord, ["durationMinutes"])) ??
    normalizePositiveIntegerMinutes(
      secondsToMinutes(firstNumberFromPaths(stageRecord, ["durationSeconds", "durationInSeconds"])),
    ) ??
    normalizePositiveIntegerMinutes(
      millisecondsToMinutes(firstNumberFromPaths(stageRecord, ["durationMillis", "durationInMilliseconds"])),
    ) ??
    normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));

  if (!stage || !startAt || !endAt || durationMinutes === undefined) {
    return;
  }

  samples.push(
    stripUndefined({
      stream: "sleep_stage",
      recordedAt: startAt,
      source: "device",
      quality: "normalized",
      unit: "stage",
      externalRef: makeGarminExternalRef("sleep", sleepId, version, `sleep-stage-${stage}`),
      sample: {
        recordedAt: startAt,
        stage,
        startAt,
        endAt,
        durationMinutes,
      },
    }),
  );
}

function stageMinutes(
  sleep: PlainObject,
  stages: readonly PlainObject[],
  stageName: string,
  minutePaths: readonly string[],
  secondPaths: readonly string[],
): number | undefined {
  const directMinutes = firstNumberFromPaths(sleep, minutePaths);

  if (directMinutes !== undefined) {
    return directMinutes;
  }

  const directSeconds = firstNumberFromPaths(sleep, secondPaths);

  if (directSeconds !== undefined) {
    return secondsToMinutes(directSeconds);
  }

  const normalizedStage = normalizeSleepStage(stageName);

  if (!normalizedStage) {
    return undefined;
  }

  let totalMinutes = 0;
  let found = false;

  for (const stage of stages) {
    if (normalizeSleepStage(firstStringFromPaths(stage, ["stage", "sleepStage", "level", "name"])) !== normalizedStage) {
      continue;
    }

    const durationMinutes =
      firstNumberFromPaths(stage, ["durationMinutes"]) ??
      secondsToMinutes(firstNumberFromPaths(stage, ["durationSeconds", "durationInSeconds"])) ??
      millisecondsToMinutes(firstNumberFromPaths(stage, ["durationMillis", "durationInMilliseconds"]));

    if (durationMinutes === undefined) {
      continue;
    }

    totalMinutes += durationMinutes;
    found = true;
  }

  return found ? totalMinutes : undefined;
}

export function normalizeGarminDailySummaries(
  context: GarminHealthNormalizationContext,
  dailySummaries: readonly unknown[],
): void {
  const observations: readonly GarminObservationSpec[] = [
    {
      metric: "daily-steps",
      unit: "count",
      title: "Garmin daily steps",
      facet: "steps",
      resolveValue: (record) => firstNumberFromPaths(record, ["steps", "summary.steps", "totals.steps"]),
    },
    {
      metric: "active-calories",
      unit: "kcal",
      title: "Garmin active calories",
      facet: "active-calories",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "activeCalories",
          "activeKilocalories",
          "active_calories",
          "summary.activeCalories",
        ]),
    },
    {
      metric: "total-calories",
      unit: "kcal",
      title: "Garmin total calories",
      facet: "total-calories",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "totalCalories",
          "totalKilocalories",
          "calories",
          "summary.totalCalories",
        ]),
    },
    {
      metric: "distance",
      unit: "meter",
      title: "Garmin distance",
      facet: "distance",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "distanceMeters",
          "distanceInMeters",
          "distance",
          "summary.distanceInMeters",
        ]),
    },
    {
      metric: "floors-climbed",
      unit: "count",
      title: "Garmin floors climbed",
      facet: "floors-climbed",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "floorsClimbed",
          "floors",
          "floorsAscended",
          "summary.floorsClimbed",
        ]),
    },
    {
      metric: "moderate-intensity-minutes",
      unit: "minutes",
      title: "Garmin moderate intensity minutes",
      facet: "moderate-intensity-minutes",
      resolveValue: (record) =>
        firstNumberFromPaths(record, ["moderateIntensityMinutes", "moderateMinutes"]) ??
        secondsToMinutes(firstNumberFromPaths(record, ["moderateIntensitySeconds", "moderateDurationInSeconds"])),
    },
    {
      metric: "vigorous-intensity-minutes",
      unit: "minutes",
      title: "Garmin vigorous intensity minutes",
      facet: "vigorous-intensity-minutes",
      resolveValue: (record) =>
        firstNumberFromPaths(record, ["vigorousIntensityMinutes", "vigorousMinutes"]) ??
        secondsToMinutes(firstNumberFromPaths(record, ["vigorousIntensitySeconds", "vigorousDurationInSeconds"])),
    },
    {
      metric: "resting-heart-rate",
      unit: "bpm",
      title: "Garmin resting heart rate",
      facet: "resting-heart-rate",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "restingHeartRate",
          "restingHeartRateInBeatsPerMinute",
          "heartRate.resting",
        ]),
    },
    {
      metric: "average-heart-rate",
      unit: "bpm",
      title: "Garmin average heart rate",
      facet: "average-heart-rate",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "averageHeartRate",
          "averageHeartRateInBeatsPerMinute",
          "heartRate.average",
        ]),
    },
    {
      metric: "max-heart-rate",
      unit: "bpm",
      title: "Garmin max heart rate",
      facet: "max-heart-rate",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "maxHeartRate",
          "maxHeartRateInBeatsPerMinute",
          "heartRate.max",
        ]),
    },
    {
      metric: "stress-level",
      unit: "score",
      title: "Garmin stress level",
      facet: "stress-level",
      resolveValue: (record) =>
        firstNumberFromPaths(record, ["stressLevel", "averageStressLevel", "stress.average", "stressLevelValue"]),
    },
    {
      metric: "body-battery",
      unit: "score",
      title: "Garmin body battery",
      facet: "body-battery",
      resolveValue: (record) =>
        firstNumberFromPaths(record, ["bodyBattery", "averageBodyBattery", "bodyBatteryLevel"]),
    },
    {
      metric: "spo2",
      unit: "%",
      title: "Garmin Pulse Ox",
      facet: "spo2",
      resolveValue: (record) => firstNumberFromPaths(record, ["spo2", "averageSpo2", "pulseOx.average"]),
    },
    {
      metric: "respiratory-rate",
      unit: "breaths_per_minute",
      title: "Garmin respiration",
      facet: "respiratory-rate",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "respirationRate",
          "averageRespirationRate",
          "avgRespirationValue",
          "respiration.average",
        ]),
    },
    {
      metric: "systolic-blood-pressure",
      unit: "mmHg",
      title: "Garmin systolic blood pressure",
      facet: "blood-pressure-systolic",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "systolicBloodPressure",
          "bloodPressure.systolic",
          "bloodPressure.systolicMmHg",
        ]),
    },
    {
      metric: "diastolic-blood-pressure",
      unit: "mmHg",
      title: "Garmin diastolic blood pressure",
      facet: "blood-pressure-diastolic",
      resolveValue: (record) =>
        firstNumberFromPaths(record, [
          "diastolicBloodPressure",
          "bloodPressure.diastolic",
          "bloodPressure.diastolicMmHg",
        ]),
    },
    {
      metric: "weight",
      unit: "kg",
      title: "Garmin weight",
      facet: "weight",
      resolveValue: (record) =>
        firstNumberFromPaths(record, ["weightKg", "bodyComposition.weightKg"]) ??
        gramsToKilograms(firstNumberFromPaths(record, ["weightGrams", "weightInGrams", "bodyComposition.weightInGrams"])),
    },
    {
      metric: "body-fat-percentage",
      unit: "%",
      title: "Garmin body fat percentage",
      facet: "body-fat-percentage",
      resolveValue: (record) =>
        firstNumberFromPaths(record, ["bodyFatPercent", "bodyFatPercentage", "bodyComposition.bodyFatPercent"]),
    },
    {
      metric: "bmi",
      unit: "kg_m2",
      title: "Garmin BMI",
      facet: "bmi",
      resolveValue: (record) => firstNumberFromPaths(record, ["bmi", "bodyComposition.bmi"]),
    },
  ];

  for (const summary of asObjectArray(dailySummaries)) {
    const summaryId =
      firstIdentifierFromPaths(summary, ["summaryId", "id", "calendarDate", "day", "date", "summaryDate"]) ??
      `daily-summary-${context.events.length + 1}`;
    const { recordedAt, bucketContext } = resolveGarminCalendarBucketTiming(summary, context.importedAt, {
      instantPaths: ["timestamp", "summaryTimestamp", "recordedAt", "updatedAt"],
      dayKeyPaths: ["calendarDate", "day", "date", "summaryDate"],
      timeZonePaths: ["timeZone", "timezone", "time_zone"],
    });
    const version =
      firstInstantFromPaths(summary, ["updatedAt", "summaryTimestamp", "timestamp", "recordedAt"]) ??
      recordedAt;
    const role = `daily-summary:${summaryId}`;

    pushGarminArtifact(
      context.rawArtifacts,
      role,
      `daily-summary-${summaryId}.json`,
      summary,
    );

    for (const observation of observations) {
      pushGarminObservation(
        context,
        "daily-summary",
        summaryId,
        version,
        role,
        recordedAt,
        recordedAt,
        summary,
        observation,
        bucketContext,
      );
    }
  }
}

export function normalizeGarminEpochSummaries(
  context: GarminHealthNormalizationContext,
  epochSummaries: readonly unknown[],
): void {
  for (const epoch of asObjectArray(epochSummaries)) {
    const epochId =
      firstIdentifierFromPaths(epoch, ["epochId", "id", "timestamp", "startTime", "startAt"]) ??
      `epoch-${context.samples.length + 1}`;
    const recordedAt =
      firstIsoFromPaths(epoch, ["timestamp", "recordedAt", "startTime", "startAt"]) ??
      context.importedAt;
    const version =
      firstIsoFromPaths(epoch, ["updatedAt", "timestamp", "recordedAt"]) ??
      recordedAt;
    const role = `epoch-summary:${epochId}`;

    pushGarminArtifact(
      context.rawArtifacts,
      role,
      `epoch-summary-${epochId}.json`,
      epoch,
    );

    pushSample(context.samples, {
      stream: "heart_rate",
      value: firstNumberFromPaths(epoch, ["heartRate", "heartRateInBeatsPerMinute", "heart_rate"]),
      unit: "bpm",
      recordedAt,
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "heart-rate"),
    });
    pushSample(context.samples, {
      stream: "steps",
      value: firstNumberFromPaths(epoch, ["steps", "stepCount", "stepsInEpoch"]),
      unit: "count",
      recordedAt,
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "steps"),
    });
    pushSample(context.samples, {
      stream: "respiratory_rate",
      value: firstNumberFromPaths(epoch, ["respirationRate", "respiration_rate", "breathingRate"]),
      unit: "breaths_per_minute",
      recordedAt,
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "respiratory-rate"),
    });
    pushSample(context.samples, {
      stream: "temperature",
      value: firstNumberFromPaths(epoch, ["temperatureCelsius", "temperature", "temperature.celsius"]),
      unit: "celsius",
      recordedAt,
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "temperature"),
    });
    pushSample(context.samples, {
      stream: "hrv",
      value: firstNumberFromPaths(epoch, ["hrvMs", "hrv", "heartRateVariabilityMs"]),
      unit: "ms",
      recordedAt,
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "hrv"),
    });

    pushObservationEvent(context.events, {
      metric: "stress-level",
      value: firstNumberFromPaths(epoch, ["stressLevel", "stress", "stressLevelValue"]),
      unit: "score",
      occurredAt: recordedAt,
      recordedAt,
      title: "Garmin stress level",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "stress-level"),
    });
    pushObservationEvent(context.events, {
      metric: "body-battery",
      value: firstNumberFromPaths(epoch, ["bodyBattery", "bodyBatteryLevel"]),
      unit: "score",
      occurredAt: recordedAt,
      recordedAt,
      title: "Garmin body battery",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "body-battery"),
    });
    pushObservationEvent(context.events, {
      metric: "spo2",
      value: firstNumberFromPaths(epoch, ["spo2", "pulseOx", "pulseOxPercent"]),
      unit: "%",
      occurredAt: recordedAt,
      recordedAt,
      title: "Garmin Pulse Ox",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "spo2"),
    });
    pushObservationEvent(context.events, {
      metric: "active-calories",
      value: firstNumberFromPaths(epoch, ["activeCalories", "calories", "activeKilocalories"]),
      unit: "kcal",
      occurredAt: recordedAt,
      recordedAt,
      title: "Garmin active calories",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("epoch-summary", epochId, version, "active-calories"),
    });
  }
}

export function normalizeGarminSleeps(
  context: GarminHealthNormalizationContext,
  sleeps: readonly unknown[],
): void {
  for (const sleep of asObjectArray(sleeps)) {
    const sleepId =
      firstIdentifierFromPaths(sleep, ["sleepId", "id", "summaryId", "startTime", "startAt"]) ??
      `sleep-${context.events.length + 1}`;
    const startAt = firstIsoFromPaths(sleep, ["startTime", "startAt", "bedtimeStart", "sleepStartTime"]);
    const endAt = firstIsoFromPaths(sleep, ["endTime", "endAt", "bedtimeEnd", "sleepEndTime"]);
    const recordedAt =
      firstIsoFromPaths(sleep, ["timestamp", "recordedAt", "updatedAt", "endTime", "endAt"]) ??
      endAt ??
      startAt ??
      context.importedAt;
    const occurredAt = startAt ?? recordedAt;
    const version =
      firstIsoFromPaths(sleep, ["updatedAt", "timestamp", "recordedAt"]) ??
      recordedAt;
    const durationMinutes =
      normalizePositiveIntegerMinutes(firstNumberFromPaths(sleep, ["durationMinutes"])) ??
      normalizePositiveIntegerMinutes(
        secondsToMinutes(firstNumberFromPaths(sleep, ["durationSeconds", "sleepDurationSeconds"])),
      ) ??
      normalizePositiveIntegerMinutes(
        millisecondsToMinutes(firstNumberFromPaths(sleep, ["durationMillis", "sleepDurationMillis"])),
      ) ??
      normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));
    const stages = asObjectArray(sleep.stages ?? sleep.sleepStages ?? sleep.sleepLevels);
    const role = `sleep:${sleepId}`;

    pushGarminArtifact(context.rawArtifacts, role, `sleep-${sleepId}.json`, sleep);

    if (occurredAt && startAt && endAt && durationMinutes !== undefined) {
      context.events.push(
        stripUndefined({
          kind: "sleep_session",
          occurredAt,
          recordedAt,
          source: "device",
          title: sleep.nap === true ? "Garmin nap" : "Garmin sleep",
          rawArtifactRoles: [role],
          externalRef: makeGarminExternalRef("sleep", sleepId, version),
          fields: {
            startAt,
            endAt,
            durationMinutes,
          },
        }),
      );
    }

    pushSample(context.samples, {
      stream: "respiratory_rate",
      value: firstNumberFromPaths(sleep, ["averageRespirationRate", "averageBreathsPerMinute", "respiration.average"]),
      unit: "breaths_per_minute",
      recordedAt,
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "respiratory-rate"),
    });
    pushSample(context.samples, {
      stream: "hrv",
      value: firstNumberFromPaths(sleep, ["averageHrvMs", "averageHrv", "hrv.average"]),
      unit: "ms",
      recordedAt,
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "hrv"),
    });

    for (const stage of stages) {
      pushSleepStageSample(context.samples, sleepId, version, stage);
    }

    const awakeMinutes = stageMinutes(
      sleep,
      stages,
      "awake",
      ["awakeMinutes", "awakeDurationMinutes"],
      ["awakeDurationSeconds", "awakeDurationInSeconds"],
    );
    const lightMinutes = stageMinutes(
      sleep,
      stages,
      "light",
      ["lightMinutes", "lightSleepMinutes"],
      ["lightSleepSeconds", "lightSleepDurationInSeconds"],
    );
    const deepMinutes = stageMinutes(
      sleep,
      stages,
      "deep",
      ["deepMinutes", "deepSleepMinutes"],
      ["deepSleepSeconds", "deepSleepDurationInSeconds"],
    );
    const remMinutes = stageMinutes(
      sleep,
      stages,
      "rem",
      ["remMinutes", "remSleepMinutes"],
      ["remSleepSeconds", "remSleepDurationInSeconds"],
    );

    pushObservationEvent(context.events, {
      metric: "sleep-score",
      value: firstNumberFromPaths(sleep, ["sleepScore", "score"]),
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Garmin sleep score",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "sleep-score"),
    });
    pushObservationEvent(context.events, {
      metric: "sleep-efficiency",
      value: firstNumberFromPaths(sleep, ["sleepEfficiency", "efficiency"]),
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Garmin sleep efficiency",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "sleep-efficiency"),
    });
    pushObservationEvent(context.events, {
      metric: "time-in-bed-minutes",
      value: firstNumberFromPaths(sleep, ["timeInBedMinutes"]) ??
        secondsToMinutes(firstNumberFromPaths(sleep, ["timeInBedSeconds"])) ??
        millisecondsToMinutes(firstNumberFromPaths(sleep, ["timeInBedMillis"])),
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Garmin time in bed",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "time-in-bed-minutes"),
    });
    pushObservationEvent(context.events, {
      metric: "sleep-awake-minutes",
      value: awakeMinutes,
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Garmin awake time",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "sleep-awake-minutes"),
    });
    pushObservationEvent(context.events, {
      metric: "sleep-light-minutes",
      value: lightMinutes,
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Garmin light sleep",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "sleep-light-minutes"),
    });
    pushObservationEvent(context.events, {
      metric: "sleep-deep-minutes",
      value: deepMinutes,
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Garmin deep sleep",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "sleep-deep-minutes"),
    });
    pushObservationEvent(context.events, {
      metric: "sleep-rem-minutes",
      value: remMinutes,
      unit: "minutes",
      occurredAt,
      recordedAt,
      title: "Garmin REM sleep",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "sleep-rem-minutes"),
    });
    pushObservationEvent(context.events, {
      metric: "average-heart-rate",
      value: firstNumberFromPaths(sleep, ["averageHeartRate", "averageHeartRateInBeatsPerMinute"]),
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: "Garmin average heart rate",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "average-heart-rate"),
    });
    pushObservationEvent(context.events, {
      metric: "lowest-heart-rate",
      value: firstNumberFromPaths(sleep, ["lowestHeartRate", "lowestHeartRateInBeatsPerMinute"]),
      unit: "bpm",
      occurredAt,
      recordedAt,
      title: "Garmin lowest heart rate",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "lowest-heart-rate"),
    });
    pushObservationEvent(context.events, {
      metric: "spo2",
      value: firstNumberFromPaths(sleep, ["averageSpo2", "spo2", "pulseOx.average"]),
      unit: "%",
      occurredAt,
      recordedAt,
      title: "Garmin Pulse Ox",
      rawArtifactRoles: [role],
      externalRef: makeGarminExternalRef("sleep", sleepId, version, "spo2"),
    });
  }
}

export function normalizeGarminWomenHealth(
  context: GarminHealthNormalizationContext,
  womenHealthRecords: readonly unknown[],
): void {
  const observations: readonly GarminObservationSpec[] = [
    {
      metric: "cycle-day",
      unit: "count",
      title: "Garmin cycle day",
      facet: "cycle-day",
      resolveValue: (record) => firstNumberFromPaths(record, ["cycleDay", "menstrualCycleDay"]),
    },
    {
      metric: "cycle-length-days",
      unit: "days",
      title: "Garmin cycle length",
      facet: "cycle-length-days",
      resolveValue: (record) => firstNumberFromPaths(record, ["cycleLengthDays", "cycleLength"]),
    },
    {
      metric: "period-day",
      unit: "count",
      title: "Garmin period day",
      facet: "period-day",
      resolveValue: (record) => firstNumberFromPaths(record, ["periodDay"]),
    },
    {
      metric: "period-length-days",
      unit: "days",
      title: "Garmin period length",
      facet: "period-length-days",
      resolveValue: (record) => firstNumberFromPaths(record, ["periodLengthDays", "periodLength"]),
    },
    {
      metric: "pregnancy-week",
      unit: "week",
      title: "Garmin pregnancy week",
      facet: "pregnancy-week",
      resolveValue: (record) => firstNumberFromPaths(record, ["pregnancyWeek", "gestationalWeek"]),
    },
  ];

  for (const record of asObjectArray(womenHealthRecords)) {
    const resourceId =
      firstIdentifierFromPaths(record, ["recordId", "id", "calendarDate", "date", "recordedAt"]) ??
      `women-health-${context.events.length + 1}`;
    const { recordedAt, bucketContext } = resolveGarminCalendarBucketTiming(record, context.importedAt, {
      instantPaths: ["recordedAt", "timestamp", "updatedAt"],
      dayKeyPaths: ["calendarDate", "date"],
      timeZonePaths: ["timeZone", "timezone", "time_zone"],
    });
    const version =
      firstInstantFromPaths(record, ["updatedAt", "recordedAt", "timestamp"]) ??
      recordedAt;
    const role = `women-health:${resourceId}`;

    pushGarminArtifact(
      context.rawArtifacts,
      role,
      `women-health-${resourceId}.json`,
      record,
    );

    for (const observation of observations) {
      pushGarminObservation(
        context,
        "women-health",
        resourceId,
        version,
        role,
        recordedAt,
        recordedAt,
        record,
        observation,
        bucketContext,
      );
    }
  }
}
