import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { scheduledLogActionSchema } from "@murphai/contracts";
import { initializeVault, parseFrontmatterDocument } from "@murphai/core";

import {
  registerScheduledLogCommands,
  scheduledLogActionOptionKeysByKind,
} from "../src/commands/scheduled-log.js";
import { workoutTypedRepairFields } from "../src/commands/workout-typed-repair-fields.js";
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

type ScheduledLogActionOptionKey =
  (typeof scheduledLogActionOptionKeysByKind)[keyof typeof scheduledLogActionOptionKeysByKind][number];

const scheduledLogActionOptionArgs = {
  actionTitle: ["--action-title", "Session"],
  activityType: ["--activity-type", "walking"],
  distanceKm: ["--distance-km", "1.5"],
  durationMinutes: ["--duration-minutes", "20"],
  foodId: ["--food-id", "food_fixture"],
  ingredient: ["--ingredient", "oats"],
  interventionType: ["--intervention-type", "sauna"],
  measurementMetric: ["--measurement-metric", "weight"],
  measurementNote: ["--measurement-note", "Morning"],
  measurementQualifier: ["--measurement-qualifier", "fasting=true"],
  measurementUnit: ["--measurement-unit", "kg"],
  measurementValue: ["--measurement-value", "72.5"],
  nutritionCalories: ["--nutrition-calories", "420"],
  nutritionCarbsGrams: ["--nutrition-carbs-grams", "52"],
  nutritionConfidence: ["--nutrition-confidence", "medium"],
  nutritionFatGrams: ["--nutrition-fat-grams", "14"],
  nutritionFiberGrams: ["--nutrition-fiber-grams", "9"],
  nutritionProteinGrams: ["--nutrition-protein-grams", "28"],
  nutritionSource: ["--nutrition-source", "estimated"],
  nutritionSourceDetail: ["--nutrition-source-detail", "Fixture estimate"],
  protocolId: ["--protocol-id", "protocol-fixture"],
  workoutEndedAt: ["--workout-ended-at", "2026-05-02T10:25:00.000Z"],
  workoutExercise: ["--workout-exercise", "order=1;name=Squat"],
  workoutMedia: ["--workout-media", "kind=photo;relativePath=raw/workouts/example.jpg"],
  workoutRoutineId: ["--workout-routine-id", "routine-fixture"],
  workoutRoutineName: ["--workout-routine-name", "Fixture routine"],
  workoutSessionNote: ["--workout-session-note", "Easy pace"],
  workoutSet: ["--workout-set", "exercise=1;order=1;reps=10"],
  workoutSourceApp: ["--workout-source-app", "fixture-app"],
  workoutSourceWorkoutId: ["--workout-source-workout-id", "fixture-workout"],
  workoutStartedAt: ["--workout-started-at", "2026-05-02T10:00:00.000Z"],
} as const satisfies Record<ScheduledLogActionOptionKey, readonly string[]>;

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

async function snapshotVaultFiles(vaultRoot: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const relativePaths = await readdir(vaultRoot, { recursive: true });

  for (const relativePath of relativePaths.sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.join(vaultRoot, relativePath);
    if ((await stat(absolutePath)).isFile()) {
      snapshot.set(relativePath, await readFile(absolutePath, "utf8"));
    }
  }

  return snapshot;
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
  for (const field of workoutTypedRepairFields) {
    assert.equal(field in saveSchema.options.properties, true, `scheduled-log save missing ${field}`);
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
      assert.deepEqual(
        result.envelope.error.fieldErrors?.map(({ path }) => path),
        ["workoutExercise"],
      );
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
      assert.deepEqual(
        unsupportedSetField.envelope.error.fieldErrors?.map(({ path }) => path),
        ["workoutSet"],
      );
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
      assert.deepEqual(
        result.envelope.error.fieldErrors?.map(({ path }) => path),
        ["measurementMetric", "measurementValue", "measurementUnit"],
      );
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
      assert.deepEqual(
        result.envelope.error.fieldErrors?.map(({ path }) => path),
        ["measurementQualifier"],
      );
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
      assert.deepEqual(
        result.envelope.error.fieldErrors?.map(({ path }) => path),
        ["scheduleEveryMs"],
      );
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

test("scheduled-log save rejects every action-kind-incompatible field before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-incompatible-options-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });
    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    const actionKinds = [
      "meal.add",
      "activity_session.add",
      "intervention_session.add",
      "measurement.add",
    ] as const;

    for (const ownerKind of actionKinds) {
      const incompatibleKind = ownerKind === "meal.add"
        ? "activity_session.add"
        : "meal.add";

      for (const optionKey of scheduledLogActionOptionKeysByKind[ownerKind]) {
        const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
          "scheduled-log",
          "save",
          `Incompatible ${optionKey}`,
          "--schedule-kind",
          "dailyLocal",
          "--schedule-local-time",
          "09:00",
          "--action-kind",
          incompatibleKind,
          ...scheduledLogActionOptionArgs[optionKey],
          "--vault",
          vaultRoot,
        ]);

        assert.equal(result.exitCode, 1, `${ownerKind}:${optionKey}`);
        assert.equal(result.envelope.ok, false, `${ownerKind}:${optionKey}`);
        if (!result.envelope.ok) {
          assert.equal(result.envelope.error.code, "invalid_option");
          assert.equal(result.envelope.error.stage, "validation");
          assert.equal(
            result.envelope.error.hint,
            "Remove incompatible action flags or choose their matching --action-kind.",
          );
          assert.deepEqual(
            result.envelope.error.fieldErrors?.map(({ code, message, path }) => ({
              code,
              message,
              path,
            })),
            [{
              code: "incompatible_option",
              message: `This option is not valid with action kind ${incompatibleKind}.`,
              path: optionKey,
            }],
            `${ownerKind}:${optionKey}`,
          );
        }
        assert.deepEqual(
          await readdir(scheduledLogDir).catch(() => []),
          [],
          `${ownerKind}:${optionKey}`,
        );
      }
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("scheduled-log save accepts shared action fields for every action kind", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-save-shared-options-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });
    const cases = [
      {
        kind: "meal.add",
        slug: "shared-meal",
        args: ["--food-id", "shared-food"],
      },
      {
        kind: "activity_session.add",
        slug: "shared-activity",
        args: [
          "--action-title",
          "Walk",
          "--activity-type",
          "walking",
          "--duration-minutes",
          "20",
        ],
      },
      {
        kind: "intervention_session.add",
        slug: "shared-intervention",
        args: [
          "--action-title",
          "Sauna",
          "--intervention-type",
          "sauna",
          "--duration-minutes",
          "20",
        ],
      },
      {
        kind: "measurement.add",
        slug: "shared-measurement",
        args: [
          "--action-title",
          "Weight",
          "--measurement-metric",
          "weight",
          "--measurement-value",
          "72.5",
          "--measurement-unit",
          "kg",
        ],
      },
    ] as const;

    for (const entry of cases) {
      const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
        "scheduled-log",
        "save",
        `Shared fields ${entry.kind}`,
        "--slug",
        entry.slug,
        "--schedule-kind",
        "dailyLocal",
        "--schedule-local-time",
        "09:00",
        "--action-kind",
        entry.kind,
        ...entry.args,
        "--action-note",
        "Shared note",
        "--action-tag",
        "shared",
        "--vault",
        vaultRoot,
      ]);

      assert.equal(result.exitCode, null, entry.kind);
      const document = await readSavedDocument(
        vaultRoot,
        requireSavedPath(requireData(result.envelope)),
      );
      const action = scheduledLogActionSchema.parse(document.attributes.action);
      assert.equal(action.kind, entry.kind);
      assert.equal(action.note, "Shared note");
      assert.deepEqual(action.tags, ["shared"]);
    }

    assert.equal(
      (await readdir(path.join(vaultRoot, "bank", "scheduled-logs"))).length,
      cases.length,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("scheduled-log save and import return bounded field recovery without echoing payloads", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-validation-recovery-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });
    const saveSchema = await readCommandSchema(cli, ["scheduled-log", "save"]);
    const beforeInvalidWrites = await snapshotVaultFiles(vaultRoot);

    const typed = await runInProcessJsonCli(cli, [
      "scheduled-log",
      "save",
      "PRIVATE_TYPED_PAYLOAD_SENTINEL",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "15 6 * * 3",
      "--action-kind",
      "meal.add",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(typed.exitCode, 1);
    assert.equal(typed.envelope.ok, false);
    assert.equal(typed.envelope.error.code, "invalid_option");
    assert.equal(typed.envelope.error.stage, "validation");
    assert.equal(typed.envelope.error.retryable, false);
    assert.equal(
      typed.envelope.error.hint,
      "Correct the listed action fields and retry.",
    );
    assert.deepEqual(
      typed.envelope.error.fieldErrors?.map(({ code, message, path }) => ({
        code,
        message,
        path,
      })),
      [{
        code: "custom",
        message: "meal.add scheduled logs require a foodId, note, ingredients, or nutrition template.",
        path: "foodId",
      }],
    );
    assert.doesNotMatch(JSON.stringify(typed.envelope), /PRIVATE_TYPED_PAYLOAD_SENTINEL/u);

    const typedWorkout = await runInProcessJsonCli(cli, [
      "scheduled-log",
      "save",
      "PRIVATE_TYPED_WORKOUT_SENTINEL",
      "--schedule-kind",
      "cron",
      "--schedule-cron",
      "15 6 * * 3",
      "--action-kind",
      "activity_session.add",
      "--action-title",
      "Strength",
      "--duration-minutes",
      "30",
      "--workout-exercise",
      "order=1;name=PRIVATE_TYPED_EXERCISE_SENTINEL",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(typedWorkout.exitCode, 1);
    assert.equal(typedWorkout.envelope.ok, false);
    assert.equal(typedWorkout.envelope.error.code, "invalid_option");
    assert.equal(typedWorkout.envelope.error.stage, "validation");
    assert.equal(typedWorkout.envelope.error.fieldErrors?.[0]?.path, "workoutSet");
    assert.equal("workoutSet" in saveSchema.options.properties, true);
    assert.doesNotMatch(
      JSON.stringify(typedWorkout.envelope),
      /PRIVATE_TYPED_(?:WORKOUT|EXERCISE)_SENTINEL/u,
    );

    const payloadPath = path.join(parentRoot, "invalid-scheduled-log.json");
    await writeFile(payloadPath, JSON.stringify({
      title: "PRIVATE_IMPORTED_PAYLOAD_SENTINEL",
      schedule: { kind: "cron", expression: "15 6 * * 3" },
      action: { kind: "meal.add" },
      body: "PRIVATE_IMPORTED_BODY_SENTINEL",
    }), "utf8");
    const imported = await runInProcessJsonCli(cli, [
      "scheduled-log",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.exitCode, 1);
    assert.equal(imported.envelope.ok, false);
    assert.equal(imported.envelope.error.code, "invalid_payload");
    assert.equal(imported.envelope.error.stage, "validation");
    assert.equal(imported.envelope.error.retryable, false);
    assert.equal(
      imported.envelope.error.hint,
      "Correct the listed scheduled-log payload fields and retry.",
    );
    assert.equal(imported.envelope.error.fieldErrors?.[0]?.path, "action.foodId");
    assert.doesNotMatch(
      JSON.stringify(imported.envelope),
      /PRIVATE_IMPORTED_(?:PAYLOAD|BODY)_SENTINEL/u,
    );

    const workoutPayloadPath = path.join(parentRoot, "invalid-scheduled-workout.json");
    await writeFile(workoutPayloadPath, JSON.stringify({
      title: "PRIVATE_IMPORTED_WORKOUT_SENTINEL",
      schedule: { kind: "cron", expression: "15 6 * * 3" },
      action: {
        kind: "activity_session.add",
        title: "Strength",
        activityType: "strength",
        durationMinutes: 30,
        workout: {
          exercises: [{
            name: "PRIVATE_IMPORTED_EXERCISE_SENTINEL",
            order: 1,
            sets: [],
          }],
        },
      },
    }), "utf8");
    const importedWorkout = await runInProcessJsonCli(cli, [
      "scheduled-log",
      "import-json",
      "--input",
      `@${workoutPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(importedWorkout.exitCode, 1);
    assert.equal(importedWorkout.envelope.ok, false);
    assert.equal(importedWorkout.envelope.error.code, "invalid_payload");
    assert.equal(
      importedWorkout.envelope.error.fieldErrors?.[0]?.path,
      "action.workout.exercises.0.sets",
    );
    assert.doesNotMatch(
      JSON.stringify(importedWorkout.envelope),
      /PRIVATE_IMPORTED_(?:WORKOUT|EXERCISE)_SENTINEL/u,
    );

    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    assert.deepEqual(await readdir(scheduledLogDir).catch(() => []), []);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeInvalidWrites);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("scheduled-log status commands return typed non-echoing not-found recovery", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-status-recovery-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });

    for (const command of ["pause", "resume", "archive"] as const) {
      const result = await runInProcessJsonCli(cli, [
        "scheduled-log",
        command,
        "PRIVATE_LOOKUP_SENTINEL",
        "--vault",
        vaultRoot,
      ]);
      assert.equal(result.exitCode, 1);
      assert.equal(result.envelope.ok, false);
      assert.equal(result.envelope.error.code, "not_found");
      assert.equal(result.envelope.error.stage, "lookup");
      assert.equal(result.envelope.error.fieldErrors?.[0]?.path, "lookup");
      assert.equal(
        result.envelope.error.hint,
        "List scheduled logs and retry with an existing id or slug.",
      );
      assert.doesNotMatch(JSON.stringify(result.envelope), /PRIVATE_LOOKUP_SENTINEL/u);
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("scheduled-log save classifies id/slug conflicts before changing either record", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-conflict-recovery-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });
    const saved: ScheduledLogSaveResult[] = [];

    for (const [title, slug] of [["First measurement", "first-measurement"], ["Second measurement", "second-measurement"]]) {
      const result = await runInProcessJsonCli<ScheduledLogSaveResult>(cli, [
        "scheduled-log",
        "save",
        title,
        "--slug",
        slug,
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
        "--vault",
        vaultRoot,
      ]);
      saved.push(requireData(result.envelope));
    }

    const before = await Promise.all(saved.map((record) =>
      readFile(path.join(vaultRoot, requireSavedPath(record)), "utf8")
    ));
    const first = saved[0];
    const second = saved[1];
    assert.ok(first && second);
    const conflict = await runInProcessJsonCli(cli, [
      "scheduled-log",
      "save",
      "PRIVATE_CONFLICT_TITLE_SENTINEL",
      "--id",
      first.scheduledLogId,
      "--slug",
      second.lookupId,
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "10:00",
      "--action-kind",
      "measurement.add",
      "--measurement-metric",
      "weight",
      "--measurement-value",
      "73",
      "--measurement-unit",
      "kg",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(conflict.exitCode, 1);
    assert.equal(conflict.envelope.ok, false);
    assert.equal(conflict.envelope.error.code, "conflict");
    assert.equal(conflict.envelope.error.stage, "lookup");
    assert.deepEqual(
      conflict.envelope.error.fieldErrors?.map(({ path }) => path),
      ["id", "slug"],
    );
    assert.doesNotMatch(JSON.stringify(conflict.envelope), /PRIVATE_CONFLICT_TITLE_SENTINEL/u);
    assert.deepEqual(
      await Promise.all(saved.map((record) =>
        readFile(path.join(vaultRoot, requireSavedPath(record)), "utf8")
      )),
      before,
    );

    const importPath = path.join(parentRoot, "conflicting-scheduled-log.json");
    await writeFile(importPath, JSON.stringify({
      scheduledLogId: first.scheduledLogId,
      slug: second.lookupId,
      title: "PRIVATE_IMPORT_CONFLICT_TITLE_SENTINEL",
      schedule: { kind: "dailyLocal", localTime: "10:00" },
      action: {
        kind: "measurement.add",
        measurements: [{ metric: "weight", value: 73, unit: "kg" }],
      },
    }), "utf8");
    const importConflict = await runInProcessJsonCli(cli, [
      "scheduled-log",
      "import-json",
      "--input",
      `@${importPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(importConflict.exitCode, 1);
    assert.equal(importConflict.envelope.ok, false);
    assert.equal(importConflict.envelope.error.code, "conflict");
    assert.equal(importConflict.envelope.error.stage, "lookup");
    assert.deepEqual(
      importConflict.envelope.error.fieldErrors?.map(({ path }) => path),
      ["scheduledLogId", "slug"],
    );
    assert.doesNotMatch(
      JSON.stringify(importConflict.envelope),
      /PRIVATE_IMPORT_CONFLICT_TITLE_SENTINEL/u,
    );
    assert.deepEqual(
      await Promise.all(saved.map((record) =>
        readFile(path.join(vaultRoot, requireSavedPath(record)), "utf8")
      )),
      before,
    );
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("scheduled-log commands stop on invalid stored registries without writing or echoing contents", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-scheduled-log-invalid-registry-",
  );

  try {
    const cli = createScheduledLogCli();
    await initializeVault({ vaultRoot });
    const scheduledLogDir = path.join(vaultRoot, "bank", "scheduled-logs");
    await mkdir(scheduledLogDir, { recursive: true });
    const invalidPath = path.join(scheduledLogDir, "invalid.md");
    const canonicalDocument = [
      "---",
      "schemaVersion: murph.frontmatter.scheduled-log.v1",
      "docType: scheduled_log",
      "scheduledLogId: slog_01JX8V9QY2M5ZBV64ZP4N1DRB9",
      "slug: stored-registry-fixture",
      "title: PRIVATE_STORED_TITLE_SENTINEL",
      "status: active",
      "schedule:",
      "  kind: dailyLocal",
      "  localTime: 09:00",
      "action:",
      "  kind: measurement.add",
      "  measurements:",
      "    -",
      "      metric: weight",
      "      value: 72.5",
      "      unit: kg",
      "tags:",
      "  - valid-tag",
      "createdAt: 2026-08-24T09:00:00.000Z",
      "updatedAt: 2026-08-24T09:00:00.000Z",
      "---",
    ].join("\n");
    const importPath = path.join(parentRoot, "valid-import.json");
    await writeFile(importPath, JSON.stringify({
      title: "PRIVATE_SUBMITTED_TITLE_SENTINEL",
      slug: "submitted-import",
      schedule: { kind: "dailyLocal", localTime: "10:00" },
      action: {
        kind: "measurement.add",
        measurements: [{ metric: "weight", value: 73, unit: "kg" }],
      },
    }), "utf8");
    const commands = [
      ["scheduled-log", "list", "--vault", vaultRoot],
      ["scheduled-log", "show", "stored-registry-fixture", "--vault", vaultRoot],
      ["scheduled-log", "pause", "stored-registry-fixture", "--vault", vaultRoot],
      ["scheduled-log", "resume", "stored-registry-fixture", "--vault", vaultRoot],
      ["scheduled-log", "archive", "stored-registry-fixture", "--vault", vaultRoot],
      [
        "scheduled-log",
        "save",
        "PRIVATE_SUBMITTED_TITLE_SENTINEL",
        "--slug",
        "submitted-save",
        "--schedule-kind",
        "dailyLocal",
        "--schedule-local-time",
        "10:00",
        "--action-kind",
        "measurement.add",
        "--measurement-metric",
        "weight",
        "--measurement-value",
        "73",
        "--measurement-unit",
        "kg",
        "--vault",
        vaultRoot,
      ],
      [
        "scheduled-log",
        "import-json",
        "--input",
        `@${importPath}`,
        "--vault",
        vaultRoot,
      ],
    ] as const;
    const variants = [
      [
        "uppercase-tag",
        canonicalDocument.replace("valid-tag", "PRIVATE_UPPERCASE_TAG_SENTINEL"),
      ],
      [
        "invalid-id",
        canonicalDocument.replace(
          "slog_01JX8V9QY2M5ZBV64ZP4N1DRB9",
          "PRIVATE_INVALID_ID_SENTINEL",
        ),
      ],
      [
        "malformed-frontmatter",
        "---\nschemaVersion: [PRIVATE_MALFORMED_FRONTMATTER_SENTINEL\n---\n",
      ],
    ] as const;

    for (const [variant, invalidDocument] of variants) {
      await writeFile(invalidPath, invalidDocument, "utf8");

      for (const command of commands) {
        const before = await snapshotVaultFiles(vaultRoot);
        const result = await runInProcessJsonCli(cli, [...command]);
        const label = `${variant}:${command[1]}`;

        assert.equal(result.exitCode, 1, label);
        assert.equal(result.envelope.ok, false, label);
        assert.equal(result.envelope.error.code, "invalid_registry", label);
        assert.equal(result.envelope.error.stage, "registry", label);
        assert.equal(result.envelope.error.retryable, false, label);
        assert.equal(result.envelope.error.fieldErrors, undefined, label);
        assert.equal(
          result.envelope.error.hint,
          "Stop. Do not retry, edit registry files, or write scheduled logs; report that stored registry data needs operator repair.",
          label,
        );
        assert.doesNotMatch(JSON.stringify(result.envelope), /PRIVATE_[A-Z_]+_SENTINEL/u);
        assert.equal(JSON.stringify(result.envelope).includes(parentRoot), false, label);
        assert.deepEqual(await snapshotVaultFiles(vaultRoot), before, label);
      }
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
