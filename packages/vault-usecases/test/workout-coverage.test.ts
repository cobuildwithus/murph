import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  test,
  vi,
} from "vitest";

import {
  type ActivityStrengthExercise,
  type WorkoutSession,
  type WorkoutTemplate,
  workoutSessionSchema,
  workoutTemplateSchema,
} from "@murphai/contracts";
import {
  buildRawImportManifest,
  initializeVault,
  resolveRawAssetDirectory,
} from "@murphai/core";

import {
  MAX_DURATION_MINUTES,
  inferDurationMinutes,
  validateDurationMinutes,
} from "../src/usecases/text-duration.ts";
import {
  buildWorkoutSessionFromSummary,
  buildWorkoutSessionFromTemplate,
  buildWorkoutTemplateFromSummary,
  buildWorkoutTitle,
  deriveDurationMinutesFromTimestamps,
  summarizeWorkoutSessionExercises,
  summarizeWorkoutTemplateExercises,
} from "../src/usecases/workout-model.ts";
import {
  workoutImportManifestResultSchema,
  workoutLookupSchema,
} from "../src/usecases/workout-read.ts";
import { importWithMocks, mockActualModule } from "./mock-import.ts";

const mockedModuleSpecifiers = [
  "../src/json-input.js",
  "../src/usecases/workout-core.js",
  "../src/usecases/workout-read.js",
  "../src/usecases/event-record-mutations.js",
  "../src/usecases/workout.js",
  "../src/usecases/workout-format.js",
  "@murphai/core",
];

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  for (const specifier of mockedModuleSpecifiers) {
    vi.doUnmock(specifier);
  }
});

async function withTempDir<T>(run: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "vault-usecases-workout-"));
  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createWorkoutSession(): WorkoutSession {
  return workoutSessionSchema.parse({
    sourceApp: "strong",
    sourceWorkoutId: "session-1",
    startedAt: "2026-04-08T10:00:00.000Z",
    endedAt: "2026-04-08T10:45:00.000Z",
    routineName: "Upper Body",
    sessionNote: "Pushed hard.",
    exercises: [
      {
        name: "Push Up",
        order: 2,
        mode: "bodyweight",
        sets: [
          { order: 1, reps: 12 },
          { order: 2, reps: 10 },
        ],
      },
      {
        name: "Squat",
        order: 1,
        mode: "weight_reps",
        note: "Main work",
        sets: [
          { order: 2, reps: 5, weight: 100, weightUnit: "lb" },
          { order: 1, reps: 5, weight: 100, weightUnit: "lb" },
        ],
      },
    ],
  });
}

function createWorkoutTemplate(): WorkoutTemplate {
  return workoutTemplateSchema.parse({
    routineNote: "Template note",
    exercises: [
      {
        name: "Squat",
        order: 2,
        mode: "weight_reps",
        note: "Heavy",
        plannedSets: [
          { order: 2, targetReps: 5, targetWeight: 100, targetWeightUnit: "lb" },
          { order: 1, targetReps: 5, targetWeight: 100, targetWeightUnit: "lb" },
        ],
      },
      {
        name: "Push Up",
        order: 1,
        mode: "bodyweight",
        plannedSets: [
          { order: 1, targetReps: 12 },
        ],
      },
    ],
  });
}

describe("text-duration", () => {
  test("infers durations and validates bounds", () => {
    assert.equal(inferDurationMinutes("half hour walk"), 30);
    assert.equal(inferDurationMinutes("1 hour and 20 minutes"), 80);
    assert.equal(inferDurationMinutes("1h 15m"), 75);
    assert.equal(inferDurationMinutes("45 minutes"), 45);
    assert.equal(inferDurationMinutes("45m"), 45);
    assert.equal(inferDurationMinutes("1 hour, 20 minutes"), "ambiguous");
    assert.equal(inferDurationMinutes("unclear text"), null);

    assert.equal(validateDurationMinutes(12.4), 12);
    assert.equal(validateDurationMinutes(MAX_DURATION_MINUTES), MAX_DURATION_MINUTES);
    assert.throws(
      () => validateDurationMinutes(Number.NaN),
      {
        name: "VaultCliError",
        code: "invalid_option",
        message: "Duration must be a positive number of minutes.",
      },
    );
    assert.throws(
      () => validateDurationMinutes(0),
      {
        name: "VaultCliError",
        code: "invalid_option",
        message: `Duration must be between 1 and ${MAX_DURATION_MINUTES} minutes.`,
      },
    );
  });
});

describe("workout-model", () => {
  test("derives durations, titles, and summaries from workout sessions and templates", () => {
    assert.equal(deriveDurationMinutesFromTimestamps(undefined, undefined), null);
    assert.equal(
      deriveDurationMinutesFromTimestamps("2026-04-08T10:00:00.000Z", "2026-04-08T10:00:30.000Z"),
      1,
    );
    assert.equal(
      deriveDurationMinutesFromTimestamps("2026-04-08T10:00:00.000Z", "2026-04-08T10:44:31.000Z"),
      45,
    );
    assert.equal(
      deriveDurationMinutesFromTimestamps("2026-04-08T10:00:00.000Z", "2026-04-08T09:00:00.000Z"),
      null,
    );

    assert.equal(buildWorkoutTitle("running", 45), "45-minute run");
    assert.equal(buildWorkoutTitle("strength-training", 60, "  Full Body  "), "Full Body");
    assert.equal(buildWorkoutTitle("mobility-flow", 30), "30-minute mobility flow");

    const sessionFromSummary = buildWorkoutSessionFromSummary({
      note: "Done.",
      routineId: "routine_1",
      routineName: "Upper",
      sourceApp: "strong",
      sourceWorkoutId: "source_1",
      startedAt: "2026-04-08T10:00:00.000Z",
      endedAt: "2026-04-08T10:45:00.000Z",
      strengthExercises: [
        {
          exercise: "Squat",
          setCount: 3,
          repsPerSet: 5,
          load: 100,
          loadUnit: "lb",
          loadDescription: "100 lb",
        },
        {
          exercise: "Push Up",
          setCount: 2,
          repsPerSet: 10,
        },
      ],
    });
    assert.deepEqual(sessionFromSummary, {
      sourceApp: "strong",
      sourceWorkoutId: "source_1",
      startedAt: "2026-04-08T10:00:00.000Z",
      endedAt: "2026-04-08T10:45:00.000Z",
      routineId: "routine_1",
      routineName: "Upper",
      sessionNote: "Done.",
      exercises: [
        {
          name: "Squat",
          order: 1,
          mode: "weight_reps",
          note: "100 lb",
          sets: [
            { order: 1, reps: 5, weight: 100, weightUnit: "lb" },
            { order: 2, reps: 5, weight: 100, weightUnit: "lb" },
            { order: 3, reps: 5, weight: 100, weightUnit: "lb" },
          ],
        },
        {
          name: "Push Up",
          order: 2,
          mode: "bodyweight",
          sets: [
            { order: 1, reps: 10 },
            { order: 2, reps: 10 },
          ],
        },
      ],
    });

    const templateFromSummary = buildWorkoutTemplateFromSummary({
      note: "Template",
      strengthExercises: [
        {
          exercise: "Squat",
          setCount: 2,
          repsPerSet: 5,
          load: 100,
          loadUnit: "lb",
          loadDescription: "100 lb",
        },
      ],
    });
    assert.deepEqual(templateFromSummary, {
      routineNote: "Template",
      exercises: [
        {
          name: "Squat",
          order: 1,
          mode: "weight_reps",
          note: "100 lb",
          plannedSets: [
            { order: 1, targetReps: 5, targetWeight: 100, targetWeightUnit: "lb" },
            { order: 2, targetReps: 5, targetWeight: 100, targetWeightUnit: "lb" },
          ],
        },
      ],
    });

    const template = createWorkoutTemplate();
    const sessionFromTemplate = buildWorkoutSessionFromTemplate(template, {
      sourceApp: "strong",
      sourceWorkoutId: "source-template",
      startedAt: "2026-04-08T10:00:00.000Z",
      endedAt: "2026-04-08T10:45:00.000Z",
      routineId: "routine-template",
      routineName: "Template Name",
      sessionNote: "Session note",
    });
    assert.equal(sessionFromTemplate.exercises[0]?.name, "Push Up");
    assert.equal(sessionFromTemplate.exercises[1]?.note, "Heavy");
    assert.equal(sessionFromTemplate.exercises[1]?.sets[0]?.weight, 100);
    assert.equal(sessionFromTemplate.exercises[1]?.sets[0]?.weightUnit, "lb");

    const sessionSummary = summarizeWorkoutSessionExercises(createWorkoutSession());
    assert.deepEqual(sessionSummary, [
      {
        exercise: "Squat",
        setCount: 2,
        repsPerSet: 5,
        load: 100,
        loadUnit: "lb",
        loadDescription: "Main work",
      },
      {
        exercise: "Push Up",
        setCount: 2,
        repsPerSet: 12,
      },
    ]);
    assert.equal(summarizeWorkoutSessionExercises(undefined), undefined);
    assert.equal(summarizeWorkoutSessionExercises({
      exercises: [
        {
          name: "Warmup",
          order: 1,
          mode: "bodyweight",
          sets: [{ order: 1, reps: 0 }],
        },
      ],
    } as WorkoutSession), undefined);

    const templateSummary = summarizeWorkoutTemplateExercises(template);
    assert.deepEqual(templateSummary, [
      {
        exercise: "Push Up",
        setCount: 1,
        repsPerSet: 12,
      },
      {
        exercise: "Squat",
        setCount: 2,
        repsPerSet: 5,
        load: 100,
        loadUnit: "lb",
        loadDescription: "Heavy",
      },
    ]);
    assert.equal(summarizeWorkoutTemplateExercises(undefined), undefined);
  });
});

describe("workout-read", () => {
  test("parses workout lookups and raw import manifests", () => {
    assert.equal(workoutLookupSchema.parse("evt_01ARZ3NDEKTSV4RRFFQ69G5FAV"), "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    assert.throws(
      () => workoutLookupSchema.parse("goal_123"),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            error instanceof Error &&
            error.message.includes("Expected a canonical workout event id in evt_* form."),
        ),
    );

    const owner = {
      kind: "workout_batch" as const,
      id: "xfm_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      partition: "strong",
    };
    const rawDirectory = resolveRawAssetDirectory({
      owner,
      occurredAt: "2026-04-08T10:00:00.000Z",
    });
    const manifest = buildRawImportManifest({
      importId: owner.id,
      importKind: "workout_batch",
      importedAt: "2026-04-08T10:00:00.000Z",
      owner,
      rawDirectory,
      source: "strong",
      artifacts: [
        {
          role: "source",
          relativePath: `${rawDirectory}/workout.csv`,
          originalFileName: "workout.csv",
          mediaType: "text/csv",
          byteSize: 42,
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      ],
      provenance: {
        sourceFileName: "workout.csv",
      },
    });

    assert.equal(
      workoutImportManifestResultSchema.parse({
        vault: "./vault",
        entityId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        lookupId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        kind: "activity_session",
        manifestFile: `${rawDirectory}/manifest.json`,
        manifest,
      }).kind,
      "activity_session",
    );
  });
});

describe("workout-core", () => {
  test("loads the workout core runtime through the shared runtime importer", async () => {
    const fakeRuntime = {
      addActivitySession: vi.fn(),
      addBodyMeasurement: vi.fn(),
    };

    const workoutCoreModule = await importWithMocks<typeof import("../src/usecases/workout-core.ts")>(
      "../src/usecases/workout-core.ts",
      {
        "../src/runtime-import.js": () => ({
          loadRuntimeModule: vi.fn(async () => fakeRuntime),
        }),
      },
    );

    const runtime = await workoutCoreModule.loadWorkoutCoreRuntime();
    assert.equal(runtime, fakeRuntime);
  });
});

describe("workout", () => {
  test("resolves workout capture text and builds structured drafts", async () => {
    const workoutModule = await import("../src/usecases/workout.ts");

    assert.throws(
      () => workoutModule.resolveWorkoutCapture({ text: "" }),
      {
        name: "VaultCliError",
        code: "contract_invalid",
        message: "Workout text is required.",
      },
    );

    const capture = workoutModule.resolveWorkoutCapture({
      text: "45 minute trail run 3 mi",
    });
    assert.equal(capture.activityType, "running");
    assert.equal(capture.durationMinutes, 45);
    assert.equal(capture.distanceKm, 4.828032);
    assert.equal(capture.title, "45-minute run");

    assert.throws(
      () => workoutModule.resolveWorkoutCapture({
        text: "This was ambiguous",
        durationMinutes: undefined,
        activityType: "!!!",
      }),
      {
        code: "invalid_option",
      },
    );

    const draft = workoutModule.buildStructuredWorkoutActivitySessionDraft({
      payload: {
        note: "45 minute trail run 3 mi",
        rawRefs: ["bank/raw/workout.csv"],
        tags: ["run"],
        relatedIds: ["evt_01ARZ3NDEKTSV4RRFFQ69G5FAV"],
        timeZone: "UTC",
      },
      activityType: "running",
      source: "import",
    });

    assert.equal(draft.activityType, "running");
    assert.equal(draft.durationMinutes, 45);
    assert.equal(draft.distanceKm, 4.828032);
    assert.equal(draft.source, "import");
    assert.equal(draft.title, "45-minute run");
    assert.equal(draft.note, "45 minute trail run 3 mi");
    assert.equal(draft.rawRefs?.[0], "bank/raw/workout.csv");

    const explicitDraft = workoutModule.buildStructuredWorkoutActivitySessionDraft({
      payload: {},
      workout: createWorkoutSession(),
      source: "device",
      title: "  Custom title  ",
      text: "ignored text",
      durationMinutes: 50,
      activityType: "strength-training",
      distanceKm: 8.5,
    });

    assert.equal(explicitDraft.title, "Custom title");
    assert.equal(explicitDraft.source, "device");
    assert.equal(explicitDraft.activityType, "strength-training");
    assert.equal(explicitDraft.durationMinutes, 50);
    assert.equal(explicitDraft.distanceKm, 8.5);
    assert.equal(explicitDraft.note, "ignored text");
    assert.equal(explicitDraft.workout?.sessionNote, "Pushed hard.");

    assert.throws(
      () => workoutModule.buildStructuredWorkoutActivitySessionDraft({
        payload: {
          attachments: [{ relativePath: "bank/raw/workout.csv" }],
        } as never,
        source: "manual",
      }),
      {
        name: "VaultCliError",
        code: "invalid_payload",
        message: "Structured workout payloads cannot set attachments[]. Use --media <path> to stage workout files.",
      },
    );
  });

  test("adds, edits, and deletes workout records through the shared runtime seams", async () => {
    const addActivitySession = vi.fn(async () => ({
      eventId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      ledgerFile: "journal/workout.md",
      created: true,
      manifestPath: "bank/raw/workout/manifest.json",
      event: {
        occurredAt: "2026-04-08T10:00:00.000Z",
        title: "45-minute run",
        activityType: "running",
        durationMinutes: 45,
        distanceKm: 4.8,
        workout: null,
        note: "45 minute run",
      },
    }));
    const loadWorkoutCoreRuntime = vi.fn(async () => ({
      addActivitySession,
    }));
    const addJsonInputObject = vi.fn(async () => ({
      note: "45 minute trail run 3 mi",
      rawRefs: ["bank/raw/workout.csv"],
      tags: ["run"],
      relatedIds: [],
      timeZone: "UTC",
    }));
    const editEventRecord = vi.fn(async () => ({ lookupId: "evt_edited" }));
    const deleteEventRecord = vi.fn(async () => ({ deleted: true }));
    const showWorkoutRecord = vi.fn(async () => ({
      vault: "./vault",
      entity: { id: "evt_edited" },
    }));

    const workoutModule = await importWithMocks<typeof import("../src/usecases/workout.ts")>(
      "../src/usecases/workout.ts",
      {
        "../src/usecases/workout-core.js": () => ({
          loadWorkoutCoreRuntime,
        }),
        "../src/json-input.js": () => ({
          loadJsonInputObject: addJsonInputObject,
        }),
        "../src/usecases/event-record-mutations.js": () => ({
          editEventRecord,
          deleteEventRecord,
        }),
        "../src/usecases/workout-read.js": () => ({
          showWorkoutRecord,
        }),
      },
    );

    const added = await workoutModule.addWorkoutRecord({
      vault: "./vault",
      text: "45 minute trail run 3 mi",
      source: "manual",
    });
    assert.equal(added.eventId, "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    assert.equal(addActivitySession.mock.calls.length, 1);
    assert.equal(addActivitySession.mock.calls[0]?.[0].vaultRoot, "./vault");

    const structuredAdded = await workoutModule.addWorkoutRecord({
      vault: "./vault",
      inputFile: "@payload.json",
      source: "import",
      workout: createWorkoutSession(),
    });
    assert.equal(structuredAdded.created, true);
    assert.equal(addJsonInputObject.mock.calls.length, 1);

    const edited = await workoutModule.editWorkoutRecord({
      vault: "./vault",
      lookup: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    assert.equal(edited.entity.id, "evt_edited");
    assert.equal(editEventRecord.mock.calls.length, 1);

    const deleted = await workoutModule.deleteWorkoutRecord({
      vault: "./vault",
      lookup: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    assert.equal(deleted.deleted, true);
    assert.equal(deleteEventRecord.mock.calls.length, 1);
  });
});

describe("workout-format", () => {
  test("saves, shows, and lists workout formats", async () => {
    const upsertWorkoutFormat = vi.fn(async () => ({
      created: true,
      record: {
        workoutFormatId: "wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        slug: "full-body",
        title: "Full Body",
        relativePath: "bank/workout-formats/full-body.md",
        markdown: "# Full Body",
      },
    }));
    const readWorkoutFormat = vi.fn(async () => ({
      workoutFormatId: "wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "full-body",
      title: "Full Body",
      status: "active",
      summary: "Weekly strength work",
      activityType: "strength-training",
      durationMinutes: 45,
      distanceKm: 8,
      template: createWorkoutTemplate(),
      tags: ["strength"],
      note: "Train hard.",
      templateText: "Train hard.",
      markdown: "# Full Body",
      relativePath: "bank/workout-formats/full-body.md",
    }));
    const listWorkoutFormats = vi.fn(async () => [await readWorkoutFormat()]);

    const workoutFormatModule = (await importWithMocks(
      "../src/usecases/workout-format.ts",
      {
        "@murphai/core": () => ({
          isVaultError: () => false,
          listWorkoutFormats,
          readWorkoutFormat,
          upsertWorkoutFormat,
        }),
      },
    )) as typeof import("../src/usecases/workout-format.ts");

    const saved = await workoutFormatModule.saveWorkoutFormat({
      vault: "./vault",
      name: "Full Body",
      text: "45 minute trail run 3 mi",
      durationMinutes: 45,
    });
    assert.equal(saved.created, true);
    assert.equal(upsertWorkoutFormat.mock.calls.length, 1);

    const shown = await workoutFormatModule.showWorkoutFormat("./vault", "full-body");
    assert.equal(shown.entity.id, "wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    const listed = await workoutFormatModule.listWorkoutFormats({
      vault: "./vault",
      limit: 1,
    });
    assert.equal(listed.items.length, 1);
  });

  test("logs workout formats through the workout record seam", async () => {
    const addWorkoutRecord = vi.fn(async () => ({ vault: "./vault", created: true }));
    const readWorkoutFormat = vi.fn(async () => ({
      workoutFormatId: "wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "full-body",
      title: "Full Body",
      status: "active",
      summary: "Weekly strength work",
      activityType: "strength-training",
      durationMinutes: 45,
      distanceKm: 8,
      template: createWorkoutTemplate(),
      tags: ["strength"],
      note: "Train hard.",
      templateText: "Train hard.",
      markdown: "# Full Body",
      relativePath: "bank/workout-formats/full-body.md",
    }));

    const workoutFormatModule = (await importWithMocks(
      "../src/usecases/workout-format.ts",
      {
        "@murphai/core": () => ({
          isVaultError: () => false,
          listWorkoutFormats: vi.fn(),
          readWorkoutFormat,
          upsertWorkoutFormat: vi.fn(),
        }),
        "../src/usecases/workout.js": mockActualModule(
          "../src/usecases/workout.js",
          (actual) => ({
            ...actual,
            addWorkoutRecord,
          }),
        ),
      },
    )) as typeof import("../src/usecases/workout-format.ts");

    const logged = await workoutFormatModule.logWorkoutFormat({
      vault: "./vault",
      name: "wfmt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      source: "manual",
    });
    assert.equal(logged.vault, "./vault");
    assert.equal(addWorkoutRecord.mock.calls.length, 1);
  });
});

describe("workout-measurement", () => {
  test("adds measurements and manages unit preferences", async () => {
    const readCurrentProfile = vi.fn(async () => ({
      snapshot: {
        id: "ps_1",
        recordedAt: "2026-04-08T10:00:00.000Z",
      },
      profile: {
        unitPreferences: {
          weight: "lb",
          distance: "mi",
          bodyMeasurement: "cm",
        },
      },
    }));
    const appendProfileSnapshot = vi.fn(async (input: {
      profile: { unitPreferences: { weight: "kg" } }
    }) => ({
      snapshot: {
        id: "ps_2",
        recordedAt: "2026-04-08T11:00:00.000Z",
        profile: input.profile,
      },
    }));
    const addBodyMeasurement = vi.fn(async () => ({
      eventId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      ledgerFile: "journal/body-measurement.md",
      created: true,
      manifestPath: "bank/raw/body-measurement/manifest.json",
      event: {
        occurredAt: "2026-04-08T10:00:00.000Z",
        title: "Weight check-in",
        measurements: [
          { type: "weight", value: 180, unit: "lb" },
        ],
        media: [],
        note: "Morning weigh-in",
      },
    }));
    const loadWorkoutCoreRuntime = vi.fn(async () => ({
      addBodyMeasurement,
    }));

    const workoutMeasurementModule = (await importWithMocks(
      "../src/usecases/workout-measurement.ts",
      {
        "@murphai/core": () => ({
          isVaultError: () => false,
          readCurrentProfile,
          appendProfileSnapshot,
        }),
        "../src/usecases/workout-core.js": () => ({
          loadWorkoutCoreRuntime,
        }),
      },
    )) as typeof import("../src/usecases/workout-measurement.ts");

    const added = await workoutMeasurementModule.addWorkoutMeasurementRecord({
      vault: "./vault",
      type: "weight",
      value: 180,
      unit: "lb",
      mediaPaths: [" /tmp/photo.jpg ", "", " /tmp/photo-2.jpg "],
    });
    assert.equal(added.eventId, "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    assert.equal(addBodyMeasurement.mock.calls.length, 1);
    assert.equal(addBodyMeasurement.mock.calls[0]?.[0].draft.title, "Weight check-in");

    const shown = await workoutMeasurementModule.showWorkoutUnitPreferences("./vault");
    assert.equal(shown.unitPreferences.weight, "lb");
    assert.equal(shown.snapshotId, "ps_1");

    const noChange = await workoutMeasurementModule.setWorkoutUnitPreferences({
      vault: "./vault",
      weight: "lb",
      distance: "mi",
      bodyMeasurement: "cm",
    });
    assert.equal(noChange.updated, false);
    assert.equal(appendProfileSnapshot.mock.calls.length, 0);

    const updated = await workoutMeasurementModule.setWorkoutUnitPreferences({
      vault: "./vault",
      weight: "kg",
      recordedAt: "2026-04-08T12:00:00.000Z",
    });
    assert.equal(updated.updated, true);
    assert.equal(appendProfileSnapshot.mock.calls.length, 1);
  });
});

describe("workout-import", () => {
  test("inspects CSV imports and stores raw workout batches without faking the core seam", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Coverage Test Vault",
        timezone: "UTC",
      });
      const csvPath = path.join(tempDir, "workout.csv");
      await writeFile(
        csvPath,
        [
          "workout name,date,start time,end time,exercise name,set order,reps,weight,weight unit,note",
          "Upper,2026-04-08,10:00:00,10:45:00,Squat,1,5,100,lb,Main work",
          "Upper,2026-04-08,10:00:00,10:45:00,Push Up,1,12,,,",
          "",
        ].join("\n"),
        "utf8",
      );

      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/usecases/workout-core.js": () => ({
            loadWorkoutCoreRuntime: vi.fn(async () => ({
              addActivitySession: vi.fn(async () => ({
                eventId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
                ledgerFile: "journal/workout.md",
                created: true,
                manifestPath: "bank/raw/workout/manifest.json",
                event: {
                  occurredAt: "2026-04-08T10:00:00.000Z",
                  title: "Upper",
                  activityType: "strength-training",
                  durationMinutes: 45,
                  distanceKm: null,
                  workout: null,
                  note: "Main work",
                },
              })),
            })),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const inspection = await workoutImportModule.inspectWorkoutCsvImport({
        vault: tempDir,
        file: csvPath,
      });
      assert.equal(inspection.importable, true);
      assert.equal(inspection.estimatedWorkouts, 1);

      const imported = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        storeRawOnly: true,
      });
      assert.equal(imported.rawOnly, true);
      assert.equal(imported.importedCount, 0);
      assert.deepEqual(imported.lookupIds, []);
      assert.equal(imported.warnings.includes("No structured workouts were detected; only the raw CSV was stored."), false);

      const storedCsv = await readFile(path.join(tempDir, imported.rawFile), "utf8");
      const storedManifest = JSON.parse(await readFile(path.join(tempDir, imported.manifestFile), "utf8")) as {
        artifacts: Array<{ relativePath: string }>;
        provenance: { estimatedWorkouts: number; rowCount: number };
      };
      assert.equal(storedCsv.includes("workout name,date,start time,end time"), true);
      assert.deepEqual(storedManifest.artifacts.map((artifact) => artifact.relativePath), [imported.rawFile]);
      assert.equal(storedManifest.provenance.estimatedWorkouts, 1);
      assert.equal(storedManifest.provenance.rowCount, 2);
    });
  });
});
