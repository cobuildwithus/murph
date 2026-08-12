import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { planWorkoutCsvImport } from "../src/index.ts";

const STRONG_HEADER = [
  "Date",
  "Workout Name",
  "Duration",
  "Exercise Name",
  "Set Order",
  "Weight",
  "Reps",
  "Distance",
  "Seconds",
  "Notes",
  "Workout Notes",
  "RPE",
].join(",");

describe("planWorkoutCsvImport", () => {
  test("maps Strong rows in the vault timezone and preserves set tags and notes", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-03-12 07:00:00,Upper,1h 15m,Press,W,45,10,0,0,Warmup note,Session note,6",
        "2026-03-12 07:00:00,Upper,1h 15m,Press,1,60,8,0,0,Warmup note,Session note,8",
        "2026-03-12 07:00:00,Upper,1h 15m,Press,D,40,12,0,0,Warmup note,Session note,9",
        "2026-03-12 07:00:00,Upper,1h 15m,Row,F,70,0,0,0,,Session note,10",
      ].join("\n"),
      timeZone: "America/Los_Angeles",
      weightUnit: "lb",
    });

    assert.equal(plan.importable, true);
    assert.equal(plan.timeZone, "America/Los_Angeles");
    assert.equal(plan.estimatedWorkouts, 1);
    assert.equal(plan.requiresWeightUnit, false);
    assert.equal(plan.sessions[0]?.occurredAt, "2026-03-12T14:00:00.000Z");
    assert.equal(plan.sessions[0]?.durationMinutes, 75);
    assert.equal(plan.sessions[0]?.workout.endedAt, "2026-03-12T15:15:00.000Z");
    assert.equal(plan.sessions[0]?.workout.sessionNote, "Session note");
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.note, "Warmup note");
    assert.deepEqual(
      plan.sessions[0]?.workout.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => set.type)),
      ["warmup", "normal", "dropset", "failure"],
    );
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.unitOverride, "lb");
    assert.equal(plan.sessions[0]?.workout.exercises[1]?.sets[0]?.reps, 0);
  });

  test("requires an explicit unit for Strong's unitless positive weights", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-01-15 06:30:00,Strength,45m,Squat,1,80,5,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.importable, false);
    assert.equal(plan.requiresWeightUnit, true);
    assert.equal(plan.weightUnit, null);
    assert.match(plan.warnings.join(" "), /--weight-unit lb or --weight-unit kg/u);
  });

  test("repairs a uniquely identifiable unquoted Strong text-field comma", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-02-10 18:00:00,Upper, Phase 2,50m,Press,1,0,12,0,0,,,",
        "2026-02-10 18:30:00,Upper,50m,Press, Paused,1,0,12,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.repairedRowCount, 2);
    assert.equal(plan.skippedRowCount, 0);
    assert.equal(plan.sessions[0]?.title, "Upper, Phase 2");
    assert.equal(plan.sessions[1]?.workout.exercises[0]?.name, "Press, Paused");
    assert.match(plan.warnings.join(" "), /repaired deterministically/u);
  });

  test("keeps quoted workout-title commas on the ordinary CSV path", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        '2026-02-10 18:00:00,"Upper, Phase 2",50m,Press,1,0,12,0,0,,,',
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.repairedRowCount, 0);
    assert.equal(plan.sessions[0]?.title, "Upper, Phase 2");
  });

  test("omits out-of-range duration while preserving the session and sets", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-01-15 06:30:00,Strength,30h 1m,Squat,1,0,5,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.importable, true);
    assert.equal(plan.sessions[0]?.durationMinutes, undefined);
    assert.equal(plan.sessions[0]?.workout.endedAt, undefined);
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.sets[0]?.reps, 5);
    assert.match(plan.warnings.join(" "), /outside the supported 24-hour range/u);
  });

  test("requires and applies an explicit unit for unitless positive distances", () => {
    const text = [
      STRONG_HEADER,
      "2026-01-15 06:30:00,Conditioning,20m,Run,1,0,0,1.5,600,,,",
    ].join("\n");
    const inspected = planWorkoutCsvImport({ text, timeZone: "UTC" });

    assert.equal(inspected.importable, false);
    assert.equal(inspected.requiresDistanceUnit, true);
    assert.equal(inspected.sessions[0]?.workout.exercises[0]?.sets[0]?.distanceMeters, undefined);

    const planned = planWorkoutCsvImport({ text, timeZone: "UTC", distanceUnit: "km" });
    assert.equal(planned.importable, true);
    assert.equal(planned.sessions[0]?.workout.exercises[0]?.sets[0]?.distanceMeters, 1500);
  });

  test("combines separate date and start-time columns in the vault timezone", () => {
    const plan = planWorkoutCsvImport({
      text: [
        "Workout Name,Date,Start Time,End Time,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,Exercise Image",
        "Morning,2026-03-12,07:00:00,08:00:00,60,Press,1,45,kg,8,asset",
      ].join("\n"),
      timeZone: "America/Los_Angeles",
    });

    assert.equal(plan.detectedSource, "hevy");
    assert.equal(plan.importable, true);
    assert.equal(plan.sessions[0]?.occurredAt, "2026-03-12T14:00:00.000Z");
    assert.equal(plan.sessions[0]?.workout.endedAt, "2026-03-12T15:00:00.000Z");
  });

  test("preserves documented Hevy-style explicit value units and set fields", () => {
    const plan = planWorkoutCsvImport({
      text: [
        "Workout Name,Date,Start Time,End Time,Duration,Exercise Name,Set Order,Weight,Reps,Set Type,Distance,Seconds,Exercise Note,Workout Note,Bodyweight,Assistance,Added Weight,Exercise Image",
        "Morning,2026-03-12,07:00:00,08:00:00,60,Press,1,45 lbs,8,warmup,1.5 km,01:30,Exercise note,Session note,,,,asset",
        "Morning,2026-03-12,07:00:00,08:00:00,60,Pull Up,1,,5,,,,,Session note,80,10,,asset",
      ].join("\n"),
      timeZone: "America/Los_Angeles",
    });

    assert.equal(plan.importable, true);
    assert.equal(plan.requiresWeightUnit, false);
    assert.equal(plan.requiresDistanceUnit, false);
    assert.equal(plan.sessions[0]?.workout.sessionNote, "Session note");
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.note, "Exercise note");
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.sets[0]?.type, "warmup");
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.sets[0]?.weightUnit, "lb");
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.sets[0]?.distanceMeters, 1500);
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.sets[0]?.durationSeconds, 90);
    assert.equal(plan.sessions[0]?.workout.exercises[1]?.mode, "assisted_bodyweight");
  });

  test("blocks an explicit option that conflicts with unit metadata in the CSV", () => {
    const plan = planWorkoutCsvImport({
      text: [
        "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Exercise Image",
        "Morning,2026-03-12,07:00:00,60,Press,1,45 kg,8,1 km,asset",
      ].join("\n"),
      timeZone: "UTC",
      weightUnit: "lb",
      distanceUnit: "mi",
    });

    assert.equal(plan.importable, false);
    assert.deepEqual(plan.skipReasons, [
      { reason: "explicit weight unit conflicts with CSV metadata", count: 1 },
    ]);
  });

  test("blocks structured import when a row cannot be mapped without guessing", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-01-15 06:30:00,Strength,45m,Squat,unsupported,0,5,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.importable, false);
    assert.equal(plan.skippedRowCount, 1);
    assert.deepEqual(plan.skipReasons, [
      { reason: "unsupported Strong set-order marker", count: 1 },
    ]);
  });

  test("omits Strong rest-timer metadata without blocking workout sets", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-01-15 06:30:00,Strength,45m,Squat,Rest Timer,0,90,0,0,,,",
        "2026-01-15 06:30:00,Strength,45m,Squat,1,0,5,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.importable, true);
    assert.equal(plan.ignoredRowCount, 1);
    assert.equal(plan.skippedRowCount, 0);
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.sets.length, 1);
    assert.match(plan.warnings.join(" "), /rest-timer metadata/u);
  });

  test("uses privacy-safe stable source identities and preserves repeated exercise blocks", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-05-01 08:00:00,Full Body,40m,Press,1,0,8,0,0,,,",
        "2026-05-01 08:00:00,Full Body,40m,Row,1,0,8,0,0,,,",
        "2026-05-01 08:00:00,Full Body,40m,Press,2,0,6,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    const sourceWorkoutId = plan.sessions[0]?.sourceWorkoutId ?? "";
    assert.match(sourceWorkoutId, /^strong-workout-[a-f0-9]{40}$/u);
    assert.equal(sourceWorkoutId.includes("Full Body"), false);
    assert.equal(sourceWorkoutId.includes("2026-05-01"), false);
    assert.deepEqual(
      plan.sessions[0]?.workout.exercises.map((exercise) => exercise.name),
      ["Press", "Row", "Press"],
    );
  });

  test("fails closed when two workout titles claim the same source timestamp", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-05-01 08:00:00,First,40m,Press,1,0,8,0,0,,,",
        "2026-05-01 08:00:00,Second,40m,Row,1,0,8,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.importable, false);
    assert.deepEqual(plan.skipReasons, [
      { reason: "ambiguous workout identity at the same timestamp", count: 1 },
    ]);
  });

  test("rejects oversized row sets before planning an unbounded batch", () => {
    const row = "2026-01-15 06:30:00,Strength,45m,Squat,1,0,5,0,0,,,";
    const text = [STRONG_HEADER, ...Array.from({ length: 50_001 }, () => row)].join("\n");

    assert.throws(
      () => planWorkoutCsvImport({ text, timeZone: "UTC" }),
      /50000-row limit/u,
    );
  });
});
