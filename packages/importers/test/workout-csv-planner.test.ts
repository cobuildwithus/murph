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
      source: "strong",
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

  test("uses an explicit Hevy source for marker-free headers", () => {
    const text = [
      "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,Exercise Notes,Set Type",
      "Upper,2026-04-08,10:00:00,45,Press,2,45,kg,8,Controlled,warmup",
      "Upper,2026-04-08,10:00:00,45,Press,1,50,kg,6,Controlled,dropset",
    ].join("\n");
    const hevy = planWorkoutCsvImport({ text, timeZone: "UTC", source: "hevy" });

    assert.equal(hevy.detectedSource, "hevy");
    assert.equal(hevy.sessions[0]?.workout.exercises[0]?.note, "Controlled");
    assert.deepEqual(
      hevy.sessions[0]?.workout.exercises[0]?.sets.map((set) => [set.order, set.type]),
      [[2, "warmup"], [1, "dropset"]],
    );

    const strong = planWorkoutCsvImport({ text, timeZone: "UTC", source: "strong" });
    assert.equal(strong.detectedSource, "strong");
    assert.equal(strong.sessions[0]?.workout.exercises[0]?.note, undefined);
    assert.deepEqual(
      strong.sessions[0]?.workout.exercises[0]?.sets.map((set) => [set.order, set.type]),
      [[1, "normal"], [2, "normal"]],
    );
    assert.equal(
      hevy.sessions[0]?.sourceSessionKey,
      strong.sessions[0]?.sourceSessionKey,
    );
    assert.notEqual(
      hevy.sessions[0]?.sourceWorkoutId,
      strong.sessions[0]?.sourceWorkoutId,
    );
  });

  test("requires a source choice for headers shared by Strong and Hevy", () => {
    const text = [
      "Workout Name,Date,Start Time,Exercise Name,Set Order,Set Type,Exercise Notes,Reps",
      "Upper,2026-04-08,10:00:00,Press,2,warmup,Controlled,8",
    ].join("\n");

    const plan = planWorkoutCsvImport({ text, timeZone: "UTC" });

    assert.equal(plan.detectedSource, null);
    assert.equal(plan.importable, false);
    assert.equal(plan.skippedRowCount, 0);
    assert.equal(plan.sessions.length, 1);
    assert.equal(
      plan.warnings.includes(
        "The CSV headers are shared by Strong and Hevy; pass --source strong or --source hevy before importing.",
      ),
      true,
    );
  });

  test("maps the common snake-case Hevy workout export", () => {
    const text = [
      "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
      "Morning,2026-04-08T10:00:00,2026-04-08T10:45:00,Session note,Squat,,Controlled,1,warmup,40,8,0,0,6",
      "Morning,2026-04-08T10:00:00,2026-04-08T10:45:00,Session note,Run,,Easy,2,normal,0,0,1.25,420,7",
    ].join("\n");

    const plan = planWorkoutCsvImport({ text, timeZone: "America/Chicago", source: "hevy" });

    assert.equal(plan.importable, true);
    assert.equal(plan.requiresWeightUnit, false);
    assert.equal(plan.requiresDistanceUnit, false);
    assert.equal(plan.sessions[0]?.occurredAt, "2026-04-08T15:00:00.000Z");
    assert.equal(plan.sessions[0]?.workout.endedAt, "2026-04-08T15:45:00.000Z");
    assert.match(plan.sessions[0]?.sourceEndTimeKey ?? "", /^[a-f0-9]{40}$/u);
    assert.equal(plan.sessions[0]?.sourceEndTimeKey?.includes("10:45"), false);
    assert.equal(plan.sessions[0]?.note, "Session note");
    assert.equal(plan.sessions[0]?.distanceKm, 1.25);
    assert.deepEqual(plan.sessions[0]?.workout.exercises[0], {
      name: "Squat",
      order: 1,
      groupId: undefined,
      note: "Controlled",
      sets: [{ order: 1, type: "warmup", reps: 8, weight: 40, weightUnit: "kg", rpe: 6 }],
      mode: "weight_reps",
      unitOverride: "kg",
    });

    const otherTimeZone = planWorkoutCsvImport({ text, timeZone: "UTC", source: "hevy" });
    const changedEnd = planWorkoutCsvImport({
      text: text.replaceAll("2026-04-08T10:45:00", "2026-04-08T10:50:00"),
      timeZone: "America/Chicago",
      source: "hevy",
    });
    assert.equal(otherTimeZone.sessions[0]?.sourceEndTimeKey, plan.sessions[0]?.sourceEndTimeKey);
    assert.notEqual(changedEnd.sessions[0]?.sourceEndTimeKey, plan.sessions[0]?.sourceEndTimeKey);
  });

  test("canonicalizes equivalent source timestamp spellings without using the vault timezone", () => {
    for (const source of ["strong", "hevy"] as const) {
      const build = (startTime: string, timeZone: string) => planWorkoutCsvImport({
        text: [
          "Workout Name,Date,Start Time,Exercise Name,Set Order,Reps",
          `Upper,2026-03-08,${startTime},Press,1,8`,
        ].join("\n"),
        timeZone,
        source,
      }).sessions[0]!;

      const minute = build("01:30", "America/Chicago");
      const seconds = build("01:30:00", "Europe/London");
      const changed = build("01:31", "America/Chicago");
      assert.equal(minute.sourceSessionKey, seconds.sourceSessionKey);
      assert.equal(minute.sourceWorkoutId, seconds.sourceWorkoutId);
      assert.notEqual(minute.occurredAt, seconds.occurredAt);
      assert.notEqual(minute.sourceSessionKey, changed.sourceSessionKey);
    }
  });

  test("rejects an explicit source that conflicts with provider-specific headers", () => {
    assert.throws(
      () => planWorkoutCsvImport({
        text: [
          "Workout Name,Date,Start Time,Exercise Name,Set Order,Reps,Exercise Image",
          "Upper,2026-04-08,10:00:00,Press,1,8,https://example.invalid/press.png",
        ].join("\n"),
        timeZone: "UTC",
        source: "strong",
      }),
      /source strong conflicts with unambiguous hevy headers/u,
    );
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

  test("rejects a Strong comma repair with multiple plausible text fields", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-02-10 18:00:00,Upper,45m,50m,Press,1,0,8,0,0,, ,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.repairedRowCount, 0);
    assert.equal(plan.skippedRowCount, 1);
    assert.equal(plan.importable, false);
    assert.equal(plan.sessions.length, 0);
    assert.deepEqual(plan.skipReasons, [
      { reason: "column count does not match the header", count: 1 },
    ]);
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

  test("does not partially parse a malformed duration", () => {
    const plan = planWorkoutCsvImport({
      text: [
        STRONG_HEADER,
        "2026-01-15 06:30:00,Strength,45m unexpected,Squat,1,0,5,0,0,,,",
      ].join("\n"),
      timeZone: "UTC",
    });

    assert.equal(plan.importable, true);
    assert.equal(plan.sessions[0]?.durationMinutes, undefined);
    assert.equal(plan.sessions[0]?.workout.endedAt, undefined);
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.sets[0]?.reps, 5);
    assert.match(plan.warnings.join(" "), /duration\(s\) were invalid/u);
  });

  test("requires and applies an explicit unit for unitless positive distances", () => {
    const text = [
      STRONG_HEADER,
      "2026-01-15 06:30:00,Conditioning,20m,Run,1,0,0,1.5,600,,,",
      "2026-01-15 06:30:00,Conditioning,20m,Run,2,0,0,0.5,300,,,",
    ].join("\n");
    const inspected = planWorkoutCsvImport({ text, timeZone: "UTC" });

    assert.equal(inspected.importable, false);
    assert.equal(inspected.requiresDistanceUnit, true);
    assert.equal(inspected.sessions[0]?.workout.exercises[0]?.sets[0]?.distanceMeters, undefined);

    const planned = planWorkoutCsvImport({ text, timeZone: "UTC", distanceUnit: "km" });
    assert.equal(planned.importable, true);
    assert.equal(planned.sessions[0]?.distanceKm, 2);
    assert.equal(planned.sessions[0]?.workout.exercises[0]?.sets[0]?.distanceMeters, 1500);
    assert.equal(planned.sessions[0]?.workout.exercises[0]?.sets[1]?.distanceMeters, 500);
  });

  test("backfills later session and exercise metadata", () => {
    const plan = planWorkoutCsvImport({
      text: [
        "Workout Name,Date,Start Time,End Time,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,Notes,Workout Notes,Group",
        "Morning,2026-03-12,07:00:00,,,Press,1,45,kg,8,, ,",
        "Morning,2026-03-12,07:00:00,08:00:00,60,Press,2,40,kg,10,Controlled,Session context,A",
      ].join("\n"),
      timeZone: "America/Los_Angeles",
      source: "strong",
    });

    assert.equal(plan.sessions[0]?.durationMinutes, 60);
    assert.equal(plan.sessions[0]?.workout.endedAt, "2026-03-12T15:00:00.000Z");
    assert.equal(plan.sessions[0]?.workout.sessionNote, "Session context");
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.note, "Controlled");
    assert.equal(plan.sessions[0]?.workout.exercises[0]?.groupId, "A");
  });

  test("fails closed when rows for one workout disagree on the provider end time", () => {
    const plan = planWorkoutCsvImport({
      text: [
        "Workout Name,Date,Start Time,End Time,Exercise Name,Set Order,Reps",
        "Morning,2026-03-12,07:00:00,08:00:00,Press,1,8",
        "Morning,2026-03-12,07:00:00,08:05:00,Press,2,6",
      ].join("\n"),
      timeZone: "UTC",
      source: "strong",
    });

    assert.equal(plan.importable, false);
    assert.equal(plan.skippedRowCount, 1);
    assert.deepEqual(plan.skipReasons, [{ reason: "conflicting workout end times", count: 1 }]);
  });

  test("preserves unit-bearing legacy distance headers and session projection", () => {
    for (const fixture of [
      { header: "Distance Km", value: "1.5", expectedMeters: 1500, expectedKm: 1.5 },
      { header: "Distance Meters", value: "750", expectedMeters: 750, expectedKm: 0.75 },
    ]) {
      const plan = planWorkoutCsvImport({
        text: [
          `Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,${fixture.header},Seconds`,
          `Morning,2026-03-12,07:00:00,30,Run,1,${fixture.value},600`,
        ].join("\n"),
        timeZone: "UTC",
        source: "strong",
      });

      assert.equal(plan.importable, true);
      assert.equal(plan.sessions[0]?.distanceKm, fixture.expectedKm);
      assert.equal(
        plan.sessions[0]?.workout.exercises[0]?.sets[0]?.distanceMeters,
        fixture.expectedMeters,
      );
    }
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
        "Morning,2026-03-12,07:00:00,08:00:00,60,Pull Up,1,,5,,,,,Session note,176.3698 lbs,22.0462 lbs,,asset",
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
    assert.ok(Math.abs((plan.sessions[0]?.workout.exercises[1]?.sets[0]?.bodyweightKg ?? 0) - 80) < 0.001);
    assert.ok(Math.abs((plan.sessions[0]?.workout.exercises[1]?.sets[0]?.assistanceKg ?? 0) - 10) < 0.001);
  });

  test("requires one unit for generic auxiliary loads and converts them to kilograms", () => {
    const text = [
      "Workout Name,Date,Start Time,Exercise Name,Set Order,Reps,Bodyweight,Assistance,Added Weight,Exercise Image",
      "Morning,2026-03-12,07:00:00,Pull Up,1,5,176.3698,22.0462,11.0231,asset",
    ].join("\n");
    const inspection = planWorkoutCsvImport({ text, timeZone: "UTC", source: "hevy" });
    assert.equal(inspection.importable, false);
    assert.equal(inspection.requiresWeightUnit, true);

    const pounds = planWorkoutCsvImport({
      text,
      timeZone: "UTC",
      source: "hevy",
      weightUnit: "lb",
    });
    const poundsSet = pounds.sessions[0]?.workout.exercises[0]?.sets[0];
    assert.ok(Math.abs((poundsSet?.bodyweightKg ?? 0) - 80) < 0.001);
    assert.ok(Math.abs((poundsSet?.assistanceKg ?? 0) - 10) < 0.001);
    assert.ok(Math.abs((poundsSet?.addedWeightKg ?? 0) - 5) < 0.001);

    const kilograms = planWorkoutCsvImport({
      text: text.replace("176.3698,22.0462,11.0231", "80,10,5"),
      timeZone: "UTC",
      source: "hevy",
      weightUnit: "kg",
    });
    const kilogramsSet = kilograms.sessions[0]?.workout.exercises[0]?.sets[0];
    assert.equal(kilogramsSet?.bodyweightKg, 80);
    assert.equal(kilogramsSet?.assistanceKg, 10);
    assert.equal(kilogramsSet?.addedWeightKg, 5);
  });

  test("keeps kilogram auxiliary headers authoritative and rejects unit conflicts", () => {
    const kilograms = planWorkoutCsvImport({
      text: [
        "Workout Name,Date,Start Time,Exercise Name,Set Order,Reps,Bodyweight Kg,Assistance Kg,Added Weight Kg,Exercise Image",
        "Morning,2026-03-12,07:00:00,Pull Up,1,5,80,10,5,asset",
      ].join("\n"),
      timeZone: "UTC",
      source: "hevy",
    });
    assert.equal(kilograms.requiresWeightUnit, false);
    assert.equal(kilograms.sessions[0]?.workout.exercises[0]?.sets[0]?.bodyweightKg, 80);

    const conflict = planWorkoutCsvImport({
      text: [
        "Workout Name,Date,Start Time,Exercise Name,Set Order,Reps,Bodyweight Kg,Exercise Image",
        "Morning,2026-03-12,07:00:00,Pull Up,1,5,176 lbs,asset",
      ].join("\n"),
      timeZone: "UTC",
      source: "hevy",
    });
    assert.equal(conflict.importable, false);
    assert.deepEqual(conflict.skipReasons, [
      { reason: "weight units conflict within CSV metadata", count: 1 },
    ]);
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

  test("keeps source identities private and preserves repeated exercise blocks", () => {
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
