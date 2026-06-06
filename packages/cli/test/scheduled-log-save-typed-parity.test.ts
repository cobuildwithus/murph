import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault, parseFrontmatterDocument } from "@murphai/core";

import { registerScheduledLogCommands } from "../src/commands/scheduled-log.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>;
    required?: string[];
  };
  options: {
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ScheduledLogSaveResult {
  vault: string;
  scheduledLogId: string;
  lookupId: string;
  path?: string;
  created: boolean;
}

function createScheduledLogCli() {
  const cli = Cli.create("vault-cli", {
    description: "scheduled-log typed save parity test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerScheduledLogCommands(cli);
  return cli;
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<string> {
  const output: string[] = [];
  let exitCode: number | null = null;

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code;
    },
    stdout(chunk) {
      output.push(chunk);
    },
  });

  assert.equal(exitCode, null);
  return output.join("").trim();
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  return JSON.parse(
    await runRawInProcessCli(cli, [...commandArgs, "--schema", "--format", "json"]),
  ) as CommandSchemaEnvelope;
}

function optionDescription(schema: CommandSchemaEnvelope, optionName: string): string {
  const property = schema.options.properties[optionName];
  assert.equal(typeof property, "object", `missing ${optionName}`);
  assert.notEqual(property, null, `missing ${optionName}`);

  const description = (property as { description?: unknown }).description;
  if (typeof description !== "string") {
    assert.fail(`missing ${optionName} description`);
  }
  return description;
}

function requireSavedPath(result: ScheduledLogSaveResult): string {
  if (!result.path) {
    throw new Error("Expected scheduled-log save result to include a relative path.");
  }
  return result.path;
}

async function readSavedDocument(vaultRoot: string, relativePath: string) {
  return parseFrontmatterDocument(await readFile(path.join(vaultRoot, relativePath), "utf8"));
}

test("scheduled-log save schema exposes typed parity fields while import-json remains JSON fallback", async () => {
  const cli = createScheduledLogCli();

  const saveSchema = await readCommandSchema(cli, ["scheduled-log", "save"]);
  assert.deepEqual(saveSchema.args.required, ["title"]);
  assert.equal("input" in saveSchema.options.properties, false);
  assert.equal(saveSchema.options.required?.includes("input") ?? false, false);
  assert.equal(saveSchema.options.required?.includes("scheduleKind") ?? false, true);
  assert.equal(saveSchema.options.required?.includes("actionKind") ?? false, true);

  for (const field of [
    "id",
    "slug",
    "status",
    "scheduleKind",
    "scheduleAt",
    "scheduleEveryMs",
    "scheduleCron",
    "scheduleLocalTime",
    "actionKind",
    "actionTitle",
    "actionNote",
    "actionTag",
    "foodId",
    "ingredient",
    "nutritionCalories",
    "nutritionProteinGrams",
    "nutritionCarbsGrams",
    "nutritionFatGrams",
    "nutritionFiberGrams",
    "nutritionSource",
    "nutritionConfidence",
    "nutritionSourceDetail",
    "activityType",
    "interventionType",
    "durationMinutes",
    "distanceKm",
    "protocolId",
    "workoutSourceApp",
    "workoutSourceWorkoutId",
    "workoutStartedAt",
    "workoutEndedAt",
    "workoutRoutineId",
    "workoutRoutineName",
    "workoutSessionNote",
    "workoutMedia",
    "workoutExercise",
    "workoutSet",
    "measurementMetric",
    "measurementValue",
    "measurementUnit",
    "measurementQualifier",
    "measurementNote",
    "summary",
    "tag",
    "body",
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field);
  }

  const importJsonSchema = await readCommandSchema(cli, ["scheduled-log", "import-json"]);
  assert.equal("input" in importJsonSchema.options.properties, true);
  assert.equal(importJsonSchema.options.required?.includes("input") ?? false, true);
  assert.deepEqual(importJsonSchema.args.required ?? [], []);
  await assert.rejects(async () => {
    await readCommandSchema(cli, ["scheduled-log", "upsert"]);
  });
});

test("scheduled-log save guidance keeps branch examples shell-copyable", async () => {
  const cli = createScheduledLogCli();
  const schema = await readCommandSchema(cli, ["scheduled-log", "save"]);
  const help = await runRawInProcessCli(cli, ["scheduled-log", "save", "--help"]);
  const llms = await runRawInProcessCli(cli, [
    "scheduled-log",
    "save",
    "--llms-full",
  ]);

  assert.match(optionDescription(schema, "workoutExercise"), /Shell-quote each semicolon-separated value/u);
  assert.match(optionDescription(schema, "ingredient"), /Do not comma-delimit multiple ingredients/u);
  assert.match(optionDescription(schema, "measurementMetric"), /keep the order aligned/u);

  for (const rendered of [help, llms]) {
    assert.match(
      rendered,
      /scheduled-log save 'Weekly strength template'[\s\S]*--actionKind activity_session\.add[\s\S]*--scheduleCron '0 7 \* \* 1'[\s\S]*--workoutExercise 'order=1;name=Goblet Squat;mode=weight_reps'[\s\S]*--workoutSet 'exercise=1;order=1;reps=10;weight=24;weightUnit=kg'/u,
    );
    assert.match(
      rendered,
      /scheduled-log save 'Weekly weight check'[\s\S]*--actionKind measurement\.add[\s\S]*--actionTitle 'Weight check'[\s\S]*--measurementMetric weight[\s\S]*--measurementQualifier fasting=true/u,
    );
  }
});

test.sequential("scheduled-log save maps typed fields for every flattened schedule and action variant", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });

    const mealResult = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Daily breakfast template",
      "--id",
      "slog_01JNV44P4R5SWC90K2AHXQJQYT",
      "--slug",
      "daily-breakfast-template",
      "--status",
      "active",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--action-kind",
      "meal.add",
      "--food-id",
      "food_01JNV44P4R5SWC90K2AHXQJQYT",
      "--action-note",
      "Breakfast template",
      "--ingredient",
      "oats",
      "--ingredient",
      "berries",
      "--nutrition-calories",
      "420",
      "--nutrition-protein-grams",
      "28",
      "--nutrition-carbs-grams",
      "52",
      "--nutrition-fat-grams",
      "14",
      "--nutrition-fiber-grams",
      "9",
      "--nutrition-source",
      "estimated",
      "--nutrition-confidence",
      "medium",
      "--nutrition-source-detail",
      "Typed CLI estimate",
      "--action-tag",
      "breakfast",
      "--tag",
      "scheduled",
      "--tag",
      "meal",
      "--summary",
      "Auto-log a planned breakfast.",
      "--body",
      "Used by the assistant scheduler.",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(mealResult.exitCode, null);
    const mealSaved = requireData(mealResult.envelope);
    assert.equal(mealSaved.created, true);
    assert.equal(mealSaved.scheduledLogId, "slog_01JNV44P4R5SWC90K2AHXQJQYT");
    const mealDocument = await readSavedDocument(vaultRoot, requireSavedPath(mealSaved));
    assert.equal(mealDocument.attributes.slug, "daily-breakfast-template");
    assert.equal(mealDocument.attributes.status, "active");
    assert.deepEqual(mealDocument.attributes.schedule, {
      kind: "dailyLocal",
      localTime: "08:30",
    });
    assert.deepEqual(mealDocument.attributes.tags, ["meal", "scheduled"]);
    assert.equal(mealDocument.body.trim(), "Used by the assistant scheduler.");
    assert.deepEqual(mealDocument.attributes.action, {
      kind: "meal.add",
      foodId: "food_01JNV44P4R5SWC90K2AHXQJQYT",
      note: "Breakfast template",
      ingredients: ["oats", "berries"],
      nutrition: {
        totals: {
          calories: 420,
          proteinGrams: 28,
          carbsGrams: 52,
          fatGrams: 14,
          fiberGrams: 9,
        },
        provenance: {
          source: "estimated",
          confidence: "medium",
          sourceDetail: "Typed CLI estimate",
        },
      },
      tags: ["breakfast"],
    });

    const activityResult = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Every six hour walk",
      "--slug",
      "every-six-hour-walk",
      "--schedule-kind",
      "every",
      "--schedule-every-ms",
      "21600000",
      "--action-kind",
      "activity_session.add",
      "--action-title",
      "Walk",
      "--activity-type",
      "walking",
      "--duration-minutes",
      "20",
      "--distance-km",
      "1.5",
      "--action-note",
      "Easy pace",
      "--workout-source-app",
      "strong",
      "--workout-source-workout-id",
      "strong-template-1",
      "--workout-started-at",
      "2026-05-02T10:00:00.000Z",
      "--workout-ended-at",
      "2026-05-02T10:25:00.000Z",
      "--workout-routine-id",
      "routine-a",
      "--workout-routine-name",
      "Strength A",
      "--workout-session-note",
      "Template note",
      "--workout-media",
      "kind=photo;relativePath=raw/workouts/template.jpg;mediaType=image/jpeg;caption=Template",
      "--workout-exercise",
      "order=1;name=Goblet Squat;mode=weight_reps;unitOverride=kg;note=Controlled",
      "--workout-set",
      "exercise=1;order=1;type=normal;reps=10;weight=24;weightUnit=kg;rpe=7",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(activityResult.exitCode, null);
    const activityDocument = await readSavedDocument(
      vaultRoot,
      requireSavedPath(requireData(activityResult.envelope)),
    );
    assert.deepEqual(activityDocument.attributes.schedule, {
      kind: "every",
      everyMs: 21600000,
    });
    assert.deepEqual(activityDocument.attributes.action, {
      kind: "activity_session.add",
      title: "Walk",
      activityType: "walking",
      durationMinutes: 20,
      distanceKm: 1.5,
      note: "Easy pace",
      workout: {
        sourceApp: "strong",
        sourceWorkoutId: "strong-template-1",
        startedAt: "2026-05-02T10:00:00.000Z",
        endedAt: "2026-05-02T10:25:00.000Z",
        routineId: "routine-a",
        routineName: "Strength A",
        sessionNote: "Template note",
        media: [
          {
            kind: "photo",
            relativePath: "raw/workouts/template.jpg",
            mediaType: "image/jpeg",
            caption: "Template",
          },
        ],
        exercises: [
          {
            order: 1,
            name: "Goblet Squat",
            mode: "weight_reps",
            unitOverride: "kg",
            note: "Controlled",
            sets: [
              {
                order: 1,
                type: "normal",
                reps: 10,
                weight: 24,
                weightUnit: "kg",
                rpe: 7,
              },
            ],
          },
        ],
      },
    });

    const interventionResult = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "One scheduled sauna",
      "--slug",
      "one-scheduled-sauna",
      "--schedule-kind",
      "at",
      "--schedule-at",
      "2026-05-01T18:00:00.000Z",
      "--action-kind",
      "intervention_session.add",
      "--action-title",
      "Sauna",
      "--intervention-type",
      "sauna",
      "--duration-minutes",
      "20",
      "--protocol-id",
      "protocol-sauna",
      "--action-note",
      "Post-work sauna",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(interventionResult.exitCode, null);
    const interventionDocument = await readSavedDocument(
      vaultRoot,
      requireSavedPath(requireData(interventionResult.envelope)),
    );
    assert.deepEqual(interventionDocument.attributes.schedule, {
      kind: "at",
      at: "2026-05-01T18:00:00.000Z",
    });
    assert.deepEqual(interventionDocument.attributes.action, {
      kind: "intervention_session.add",
      title: "Sauna",
      interventionType: "sauna",
      durationMinutes: 20,
      protocolId: "protocol-sauna",
      note: "Post-work sauna",
    });

    const measurementResult = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Weekly weight check",
      "--slug",
      "weekly-weight-check",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "0 8 * * 1",
      "--action-kind",
      "measurement.add",
      "--action-title",
      "Weight check",
      "--action-note",
      "Monday morning weigh-in",
      "--measurement-metric",
      "weight",
      "--measurement-value",
      "72.5",
      "--measurement-unit",
      "kg",
      "--measurement-qualifier",
      "fasting=true",
      "--measurement-note",
      "Before breakfast",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(measurementResult.exitCode, null);
    const measurementDocument = await readSavedDocument(
      vaultRoot,
      requireSavedPath(requireData(measurementResult.envelope)),
    );
    assert.deepEqual(measurementDocument.attributes.schedule, {
      kind: "cron",
      expression: "0 8 * * 1",
    });
    assert.deepEqual(measurementDocument.attributes.action, {
      kind: "measurement.add",
      title: "Weight check",
      note: "Monday morning weigh-in",
      measurements: [
        {
          metric: "weight",
          value: 72.5,
          unit: "kg",
          qualifiers: {
            fasting: true,
          },
          note: "Before breakfast",
        },
      ],
    });
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("scheduled-log save rejects unsupported workout compact fields before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-unsupported-workout-field-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Unsupported workout compact field",
      "--slug",
      "unsupported-workout-compact-field",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "09:00",
      "--action-kind",
      "activity_session.add",
      "--action-title",
      "Strength",
      "--activity-type",
      "strength",
      "--duration-minutes",
      "30",
      "--workout-exercise",
      "order=1;name=Goblet Squat;unknown=ignored",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(
        result.envelope.error.message ?? "",
        /Unsupported --workout-exercise field "unknown"/u,
      );
      assert.match(result.envelope.error.message ?? "", /Supported fields:/u);
    }

    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    const writtenFiles = await readdir(scheduledLogDir).catch(() => []);
    assert.deepEqual(writtenFiles, []);

    const unsupportedSetField = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Unsupported workout set compact field",
      "--slug",
      "unsupported-workout-set-compact-field",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "09:00",
      "--action-kind",
      "activity_session.add",
      "--action-title",
      "Strength",
      "--activity-type",
      "strength",
      "--duration-minutes",
      "30",
      "--workout-exercise",
      "order=1;name=Goblet Squat",
      "--workout-set",
      "exercise=1;order=1;reps=10;weightUnt=kg",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(unsupportedSetField.exitCode, 1);
    assert.equal(unsupportedSetField.envelope.ok, false);
    if (!unsupportedSetField.envelope.ok) {
      assert.equal(unsupportedSetField.envelope.error.code, "invalid_option");
      assert.match(
        unsupportedSetField.envelope.error.message ?? "",
        /Unsupported --workout-set field "weightUnt"/u,
      );
      assert.match(
        unsupportedSetField.envelope.error.message ?? "",
        /Supported fields: exercise, order, type, reps, weight, weightUnit/u,
      );
    }

    const writtenFilesAfterSetFailure = await readdir(scheduledLogDir).catch(() => []);
    assert.deepEqual(writtenFilesAfterSetFailure, []);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("scheduled-log save rejects malformed typed measurements before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-invalid-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Broken measurement schedule",
      "--slug",
      "broken-measurement-schedule",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "09:00",
      "--action-kind",
      "measurement.add",
      "--measurement-metric",
      "weight",
      "--measurement-unit",
      "kg",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(result.envelope.error.message ?? "", /measurement\.add/u);
    }

    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    const writtenFiles = await readdir(scheduledLogDir).catch(() => []);
    assert.deepEqual(writtenFiles, []);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("scheduled-log save rejects ambiguous qualifiers for multiple measurements", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-ambiguous-qualifier-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Ambiguous measurement schedule",
      "--slug",
      "ambiguous-measurement-schedule",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "09:00",
      "--action-kind",
      "measurement.add",
      "--measurement-metric",
      "weight",
      "--measurement-value",
      "72.5",
      "--measurement-unit",
      "kg",
      "--measurement-metric",
      "glucose",
      "--measurement-value",
      "95",
      "--measurement-unit",
      "mg/dL",
      "--measurement-qualifier",
      "fasting=true",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(result.envelope.error.message ?? "", /N:key=value/u);
    }

    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    const writtenFiles = await readdir(scheduledLogDir).catch(() => []);
    assert.deepEqual(writtenFiles, []);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("scheduled-log save rejects sub-minute every schedules before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-subminute-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Too frequent schedule",
      "--slug",
      "too-frequent-schedule",
      "--schedule-kind",
      "every",
      "--schedule-every-ms",
      "59999",
      "--action-kind",
      "measurement.add",
      "--measurement-metric",
      "weight",
      "--measurement-value",
      "72.5",
      "--measurement-unit",
      "kg",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(result.envelope.error.message ?? "", /60000 ms/u);
    }

    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    const writtenFiles = await readdir(scheduledLogDir).catch(() => []);
    assert.deepEqual(writtenFiles, []);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("scheduled-log save rejects workout fields on non-activity actions before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-invalid-workout-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
      "scheduled-log",
      "save",
      "Broken meal workout schedule",
      "--slug",
      "broken-meal-workout-schedule",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "09:00",
      "--action-kind",
      "meal.add",
      "--workout-exercise",
      "order=1;name=Goblet Squat",
      "--workout-set",
      "exercise=1;order=1;reps=10",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(result.envelope.error.message ?? "", /Workout template fields/u);
    }

    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    const writtenFiles = await readdir(scheduledLogDir).catch(() => []);
    assert.deepEqual(writtenFiles, []);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
