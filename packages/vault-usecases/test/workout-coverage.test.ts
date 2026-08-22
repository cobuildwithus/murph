import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  ID_PREFIXES,
  type ActivityStrengthExercise,
  type JsonObject,
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
import * as coreRuntime from "@murphai/core";
import * as importersRuntime from "@murphai/importers";
import {
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";

import {
  MAX_DURATION_MINUTES,
  inferDurationMinutes,
  validateDurationMinutes,
} from "../src/usecases/text-duration.ts";
import { editEventRecord } from "../src/usecases/event-record-mutations.js";
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
import * as workoutModule from "../src/usecases/workout.ts";
import { importWithMocks, mockActualModule } from "./mock-import.ts";

const mockedModuleSpecifiers = [
  "../src/json-input.js",
  "../src/runtime-import.js",
  "../src/usecases/workout-core.js",
  "../src/usecases/workout-read.js",
  "../src/usecases/event-record-mutations.js",
  "../src/usecases/workout.js",
  "../src/usecases/workout-format.js",
  "@murphai/core",
];

afterEach(() => {
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

async function countAuditRows(vaultRoot: string): Promise<number> {
  const paths = await coreRuntime.walkVaultFiles(vaultRoot, "audit", { extension: ".jsonl" });
  const rows = await Promise.all(paths.map((relativePath) =>
    coreRuntime.readJsonlRecords({ vaultRoot, relativePath })));
  return rows.reduce((count, entries) => count + entries.length, 0);
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
    assert.equal(buildWorkoutTitle("strength-training"), "Strength Training");

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
          exercise: "Incline Bench",
          setCount: 4,
          repsPerSet: 15,
          loadDescription: "25s on each side",
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
          name: "Incline Bench",
          order: 2,
          mode: "weight_reps",
          note: "25s on each side",
          sets: [
            { order: 1, reps: 15 },
            { order: 2, reps: 15 },
            { order: 3, reps: 15 },
            { order: 4, reps: 15 },
          ],
        },
        {
          name: "Push Up",
          order: 3,
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

    assert.throws(
      () =>
        buildWorkoutSessionFromSummary({
          strengthExercises: [
            {
              exercise: "Marathon sets",
              setCount: 151,
              repsPerSet: 1,
            },
          ],
        }),
      /Too big/u,
    );

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
      addMeasurement: vi.fn(),
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
        text: "Easy run around the neighborhood",
      }),
      {
        name: "VaultCliError",
        code: "invalid_option",
        message: "Workout duration is missing. Pass --duration <minutes> to record it explicitly.",
      },
    );

    assert.throws(
      () => workoutModule.resolveWorkoutCapture({
        text: "Morning run to the beach, followed by a quick 10-minute swim, then back home. Approx 8.56 km total.",
      }),
      {
        name: "VaultCliError",
        code: "invalid_option",
        message: "Workout note includes multiple activities or segments. Pass --duration <minutes> to record the total workout duration explicitly.",
      },
    );

    assert.throws(
      () => workoutModule.resolveWorkoutCapture({
        text: "10-minute warmup jog then easy run home.",
      }),
      {
        name: "VaultCliError",
        code: "invalid_option",
        message: "Workout note includes multiple activities or segments. Pass --duration <minutes> to record the total workout duration explicitly.",
      },
    );

    const mixedCapture = workoutModule.resolveWorkoutCapture({
      text: "Morning run to the beach, followed by a quick 10-minute swim, then back home. Approx 8.56 km total.",
      durationMinutes: 70,
    });
    assert.equal(mixedCapture.activityType, "running");
    assert.equal(mixedCapture.durationMinutes, 70);
    assert.equal(mixedCapture.distanceKm, 8.56);
    assert.equal(mixedCapture.title, "70-minute run");

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
      occurredAt: "2026-08-08T09:00:00.000Z",
      source: "import",
    });

    assert.equal(draft.activityType, "running");
    assert.equal(draft.durationMinutes, 45);
    assert.equal(draft.distanceKm, 4.828032);
    assert.equal(draft.source, "import");
    assert.equal(draft.title, "45-minute run");
    assert.equal(draft.note, "45 minute trail run 3 mi");
    assert.equal(draft.rawRefs?.[0], "bank/raw/workout.csv");
    assert.deepEqual(draft.workout?.exercises, []);

    const cardioReplica = await createBrowserVaultReplica({
      generatedAt: "2026-08-09T12:00:00.000Z",
      metricPoints: [],
      sourceBundleHash: "structured-workout-cardio",
      vault: createVaultReadModel({
        entities: [{
          attributes: { ...draft },
          body: null,
          date: "2026-08-08",
          entityId: "structured_cardio",
          experimentSlug: null,
          family: "event",
          frontmatter: null,
          kind: "activity_session",
          links: [],
          lookupIds: ["structured_cardio"],
          occurredAt: "2026-08-08T09:00:00.000Z",
          path: "history/events/structured-cardio.jsonl",
          primaryLookupId: "structured_cardio",
          recordClass: "ledger",
          relatedIds: [],
          status: null,
          stream: null,
          tags: [],
          title: draft.title,
        }],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    });
    const projectedCardio = cardioReplica.entities.find(
      (entity) => entity.id === "structured_cardio",
    );
    const projectedTraining = projectedCardio?.attributes.training;
    assert.ok(
      projectedTraining
      && typeof projectedTraining === "object"
      && !Array.isArray(projectedTraining),
    );
    assert.equal(Reflect.get(projectedTraining, "distanceKm"), 4.828032);

    const compactStrengthDraft = workoutModule.buildStructuredWorkoutActivitySessionDraft({
      payload: {
        title: "Incline bench and pull-ups",
        note: "Hey I worked out today 4 sets of 15 incline bench with 25s on each side and 4 sets of 10 pull-ups.",
        activityType: "strength-training",
        durationMinutes: 20,
        strengthExercises: [
          {
            exercise: "Incline bench press",
            setCount: 4,
            repsPerSet: 15,
            loadDescription: "25s on each side",
          },
          {
            exercise: "Pull-up",
            setCount: 4,
            repsPerSet: 10,
          },
        ],
      },
      source: "manual",
    });
    assert.equal(compactStrengthDraft.title, "Incline bench and pull-ups");
    assert.equal(compactStrengthDraft.activityType, "strength-training");
    assert.equal(compactStrengthDraft.durationMinutes, 20);
    assert.equal(compactStrengthDraft.workout?.exercises[0]?.mode, "weight_reps");
    assert.equal(compactStrengthDraft.workout?.exercises[0]?.note, "25s on each side");
    assert.deepEqual(compactStrengthDraft.workout?.exercises[0]?.sets, [
      { order: 1, reps: 15 },
      { order: 2, reps: 15 },
      { order: 3, reps: 15 },
      { order: 4, reps: 15 },
    ]);
    assert.equal(compactStrengthDraft.workout?.exercises[1]?.mode, "bodyweight");
    assert.equal(compactStrengthDraft.workout?.exercises[1]?.sets.length, 4);

    const topLevelWorkoutPayload = createWorkoutSession();
    const topLevelWorkoutDraft = workoutModule.buildStructuredWorkoutActivitySessionDraft({
      payload: topLevelWorkoutPayload,
      source: "device",
    });
    assert.equal(topLevelWorkoutDraft.title, "45-minute strength training");
    assert.equal(topLevelWorkoutDraft.source, "device");
    assert.equal(topLevelWorkoutDraft.durationMinutes, 45);
    assert.equal(topLevelWorkoutDraft.note, "Pushed hard.");
    assert.deepEqual(topLevelWorkoutDraft.workout, topLevelWorkoutPayload);

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

    assert.throws(
      () => workoutModule.buildStructuredWorkoutActivitySessionDraft({
        payload: {
          note: "20 minute strength session",
          strengthExercises: [
            {
              exercise: "Incline bench press",
              setCount: 4,
              repsPerSet: 15,
              loadDescripton: "25s on each side",
            },
          ],
        } as never,
        source: "manual",
      }),
      {
        name: "VaultCliError",
        code: "invalid_payload",
      },
    );
  });

  test("adds, edits, and deletes workout records through the shared runtime seams", async () => {
    const addActivitySession = vi.fn(async (_input: { vaultRoot: string }) => ({
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
    const addJsonInputObject = vi.fn<() => Promise<JsonObject>>(async () => ({
      note: "45 minute trail run 3 mi",
      rawRefs: ["bank/raw/workout.csv"],
      tags: ["run"],
      relatedIds: [],
      timeZone: "UTC",
    }));
    const editEventRecord = vi.fn(async (_input: Record<string, unknown>) => ({
      lookupId: "evt_edited",
      entity: { id: "evt_edited" },
    }));
    const deleteEventRecord = vi.fn(async (_input: Record<string, unknown>) => ({
      deleted: true,
    }));
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
    const addActivitySessionFirstCall = addActivitySession.mock.calls.at(0);
    assert.ok(addActivitySessionFirstCall);
    const [addActivitySessionInput] = addActivitySessionFirstCall;
    assert.ok(addActivitySessionInput);
    assert.equal(addActivitySessionInput.vaultRoot, "./vault");

    const structuredAdded = await workoutModule.addWorkoutRecord({
      vault: "./vault",
      inputFile: "@payload.json",
      source: "import",
      workout: createWorkoutSession(),
    });
    assert.equal(structuredAdded.created, true);
    assert.equal(addJsonInputObject.mock.calls.length, 1);
    addJsonInputObject.mockResolvedValueOnce({
      title: "No duration",
      workout: {
        sourceApp: "strong",
        routineName: "No duration",
        exercises: [{
          name: "Squat",
          order: 1,
          sets: [{ order: 1, reps: 5 }],
        }],
      },
    });
    const writesBeforeRejectedStructuredAdd = addActivitySession.mock.calls.length;
    await assert.rejects(
      workoutModule.addWorkoutRecord({
        vault: "./vault",
        inputFile: "@payload.json",
        source: "import",
      }),
      /Workout duration is missing/u,
    );
    assert.equal(addActivitySession.mock.calls.length, writesBeforeRejectedStructuredAdd);

    const edited = await workoutModule.editWorkoutRecord({
      vault: "./vault",
      lookup: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    assert.equal(edited.entity.id, "evt_edited");
    assert.equal(editEventRecord.mock.calls.length, 1);
    assert.equal(showWorkoutRecord.mock.calls.length, 0);

    const deleted = await workoutModule.deleteWorkoutRecord({
      vault: "./vault",
      lookup: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      expectedRevision: 3,
    });
    assert.equal(deleted.deleted, true);
    assert.equal(deleteEventRecord.mock.calls.length, 1);
    assert.deepEqual(deleteEventRecord.mock.calls.at(0)?.[0], {
      vault: "./vault",
      lookup: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      expectedRevision: 3,
      expectedKinds: ["activity_session"],
      entityLabel: "workout",
    });
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

describe("workout-unit-preferences", () => {
  test("manages unit preferences", async () => {
    const readPreferencesDocument = vi
      .fn()
      .mockResolvedValue({
        exists: true,
        sourcePath: "bank/preferences.json",
        schemaVersion: 1,
        updatedAt: "2026-04-08T10:00:00.000Z",
        workoutUnitPreferences: {
          weight: "lb",
          bodyMeasurement: "cm",
        },
      });
    const updateWorkoutUnitPreferences = vi.fn(async () => ({
      created: false,
      document: {
        exists: true,
        sourcePath: "bank/preferences.json",
        schemaVersion: 1,
        updatedAt: "2026-04-08T12:00:00.000Z",
        workoutUnitPreferences: {
          weight: "kg",
          bodyMeasurement: "cm",
        },
      },
    }));

    const workoutMeasurementModule = (await importWithMocks(
      "../src/usecases/workout-measurement.ts",
      {
        "@murphai/core": () => ({
          isVaultError: () => false,
          readPreferencesDocument,
          updateWorkoutUnitPreferences,
        }),
      },
    )) as typeof import("../src/usecases/workout-measurement.ts");

    const shown = await workoutMeasurementModule.showWorkoutUnitPreferences("./vault");
    assert.equal(shown.unitPreferences.weight, "lb");
    assert.equal(shown.preferencesPath, "bank/preferences.json");

    const noChange = await workoutMeasurementModule.setWorkoutUnitPreferences({
      vault: "./vault",
      weight: "lb",
      bodyMeasurement: "cm",
    });
    assert.equal(noChange.updated, false);
    assert.equal(updateWorkoutUnitPreferences.mock.calls.length, 0);

    const updated = await workoutMeasurementModule.setWorkoutUnitPreferences({
      vault: "./vault",
      weight: "kg",
      recordedAt: "2026-04-08T12:00:00.000Z",
    });
    assert.equal(updated.updated, true);
    assert.equal(updateWorkoutUnitPreferences.mock.calls.length, 1);
  });
});

describe("workout-import", () => {
  test("inspects CSV imports and stores raw workout batches without faking the core seam", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Coverage Test Vault",
        timezone: "America/Chicago",
      });
      const csvPath = path.join(tempDir, "workout.csv");
      await writeFile(
        csvPath,
        [
          "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
          "2026-04-08 00:30:00,Upper,1h 30m,Squat,1,100,5,0,0,Main work,,",
          "2026-04-08 00:30:00,Upper,1h 30m,Push Up,1,0,12,1.5,0,,Session note,",
          "",
        ].join("\n"),
        "utf8",
      );

      let afterNextPreview: (() => Promise<void>) | undefined;
      const fencedCoreRuntime = {
        ...coreRuntime,
        importEventBatch: async (input: Parameters<typeof coreRuntime.importEventBatch>[0]) => {
          const result = await coreRuntime.importEventBatch(input);
          if (!input.apply && afterNextPreview) {
            const callback = afterNextPreview;
            afterNextPreview = undefined;
            await callback();
          }
          return result;
        },
      };

      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return fencedCoreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const inspection = await workoutImportModule.inspectWorkoutCsvImport({
        vault: tempDir,
        file: csvPath,
        weightUnit: "lb",
        distanceUnit: "km",
      });
      assert.equal(inspection.importable, true);
      assert.equal(inspection.estimatedWorkouts, 1);
      assert.equal(inspection.timeZone, "America/Chicago");

      const imported = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "lb",
        distanceUnit: "km",
      });
      assert.equal(imported.rawOnly, false);
      assert.equal(imported.importedCount, 1);
      assert.equal(imported.createdCount, 1);
      assert.equal(imported.lookupIds.length, 1);
      assert.equal(imported.rawStored, true);
      assert.equal(typeof imported.rawFile, "string");
      assert.equal(typeof imported.manifestFile, "string");
      assert.ok(imported.rawFile);
      assert.ok(imported.manifestFile);

      const storedCsv = await readFile(path.join(tempDir, imported.rawFile), "utf8");
      const storedManifest = JSON.parse(await readFile(path.join(tempDir, imported.manifestFile), "utf8")) as {
        artifacts: Array<{ relativePath: string }>;
        provenance: { estimatedWorkouts: number; rowCount: number; timeZone: string };
      };
      assert.equal(storedCsv.includes("Date,Workout Name,Duration"), true);
      assert.deepEqual(storedManifest.artifacts.map((artifact) => artifact.relativePath), [imported.rawFile]);
      assert.equal(storedManifest.provenance.estimatedWorkouts, 1);
      assert.equal(storedManifest.provenance.rowCount, 2);
      assert.equal(storedManifest.provenance.timeZone, "America/Chicago");
      const storedEvent = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: importersRuntime.planWorkoutCsvImport({
          text: await readFile(csvPath, "utf8"),
          timeZone: "America/Chicago",
          weightUnit: "lb",
          distanceUnit: "km",
        }).sessions[0]?.sourceWorkoutId ?? "missing",
      });
      assert.equal(storedEvent?.kind, "activity_session");
      if (!storedEvent || storedEvent.kind !== "activity_session") {
        throw new Error("Expected the imported workout to be an activity session.");
      }
      assert.equal(storedEvent?.note, "Session note");
      assert.equal(storedEvent.distanceKm, 1.5);
      assert.equal(storedEvent.workout?.sessionNote, "Session note");
      const nonUnitSnapshot = {
        occurredAt: storedEvent.occurredAt,
        dayKey: storedEvent.dayKey,
        timeZone: storedEvent.timeZone,
        title: storedEvent.title,
        note: storedEvent.note,
        durationMinutes: storedEvent.durationMinutes,
        startedAt: storedEvent.workout?.startedAt,
        endedAt: storedEvent.workout?.endedAt,
        routineName: storedEvent.workout?.routineName,
        sessionNote: storedEvent.workout?.sessionNote,
      };

      const replay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "lb",
        distanceUnit: "km",
      });
      assert.equal(replay.importedCount, 0);
      assert.equal(replay.skippedExistingCount, 1);
      assert.equal(replay.rawStored, false);
      assert.equal(replay.rawFile, null);
      assert.equal(replay.manifestFile, null);

      await coreRuntime.updateVaultSummary({
        vaultRoot: tempDir,
        timezone: "America/Los_Angeles",
      });

      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          weightUnit: "kg",
          distanceUnit: "km",
        }),
        /rerun with --correct-units/u,
      );

      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00.000Z"));
      const rawFilesBeforeCorrection = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");
      const corrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
        distanceUnit: "km",
        correctUnits: true,
      });
      assert.equal(corrected.createdCount, 0);
      assert.equal(corrected.supersededCount, 1);
      assert.equal(corrected.rawStored, false);
      assert.deepEqual(corrected.lookupIds, imported.lookupIds);
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeCorrection,
      );
      const correctedEvent = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: importersRuntime.planWorkoutCsvImport({
          text: await readFile(csvPath, "utf8"),
          timeZone: "America/Chicago",
          weightUnit: "kg",
          distanceUnit: "km",
        }).sessions[0]?.sourceWorkoutId ?? "missing",
      });
      if (!correctedEvent || correctedEvent.kind !== "activity_session") {
        throw new Error("Expected the unit-corrected workout to be an activity session.");
      }
      assert.equal(correctedEvent.workout?.exercises[0]?.sets[0]?.weightUnit, "kg");
      assert.deepEqual({
        occurredAt: correctedEvent.occurredAt,
        dayKey: correctedEvent.dayKey,
        timeZone: correctedEvent.timeZone,
        title: correctedEvent.title,
        note: correctedEvent.note,
        durationMinutes: correctedEvent.durationMinutes,
        startedAt: correctedEvent.workout?.startedAt,
        endedAt: correctedEvent.workout?.endedAt,
        routineName: correctedEvent.workout?.routineName,
        sessionNote: correctedEvent.workout?.sessionNote,
      }, nonUnitSnapshot);

      const revisionAfterCorrection = correctedEvent.lifecycle?.revision;
      const auditRowsAfterCorrection = await countAuditRows(tempDir);
      const identicalCorrection = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
        distanceUnit: "km",
        correctUnits: true,
      });
      assert.equal(identicalCorrection.importedCount, 0);
      assert.equal(identicalCorrection.supersededCount, 0);
      assert.equal(identicalCorrection.skippedExistingCount, 1);
      assert.equal(await countAuditRows(tempDir), auditRowsAfterCorrection);
      const afterIdenticalCorrection = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: correctedEvent.externalRef?.resourceId ?? "missing",
      });
      assert.equal(afterIdenticalCorrection?.lifecycle?.revision, revisionAfterCorrection);

      const auditRowsBeforeRace = await countAuditRows(tempDir);
      afterNextPreview = async () => {
        await editEventRecord({
          vault: tempDir,
          lookup: correctedEvent.id,
          entityLabel: "workout session",
          expectedKinds: ["activity_session"],
          set: ["activityType=mobility"],
        });
      };
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          weightUnit: "kg",
          distanceUnit: "mi",
          correctUnits: true,
        }),
        /changed after it was inspected/u,
      );
      const afterRace = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: correctedEvent.externalRef?.resourceId ?? "missing",
      });
      assert.equal(afterRace?.lifecycle?.revision, (revisionAfterCorrection ?? 0) + 1);
      assert.equal(afterRace?.kind === "activity_session" ? afterRace.distanceKm : undefined, 1.5);
      assert.equal(
        afterRace?.kind === "activity_session"
          ? afterRace.workout.exercises[0]?.sets[0]?.weightUnit
          : undefined,
        "kg",
      );
      assert.equal(await countAuditRows(tempDir), auditRowsBeforeRace + 1);

      const distanceCorrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
        distanceUnit: "mi",
        correctUnits: true,
      });
      assert.equal(distanceCorrected.createdCount, 0);
      assert.equal(distanceCorrected.supersededCount, 1);
      const distanceCorrectedEvent = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: correctedEvent.externalRef?.resourceId ?? "missing",
      });
      if (!distanceCorrectedEvent || distanceCorrectedEvent.kind !== "activity_session") {
        throw new Error("Expected the distance-corrected workout to be an activity session.");
      }
      assert.equal(distanceCorrectedEvent.distanceKm, 2.414016);
      assert.equal(distanceCorrectedEvent.occurredAt, nonUnitSnapshot.occurredAt);
      assert.equal(distanceCorrectedEvent.dayKey, nonUnitSnapshot.dayKey);
      assert.equal(distanceCorrectedEvent.timeZone, nonUnitSnapshot.timeZone);

      const correctedAgain = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "lb",
        distanceUnit: "km",
        correctUnits: true,
      });
      assert.equal(correctedAgain.createdCount, 0);
      assert.equal(correctedAgain.supersededCount, 1);
      assert.equal(correctedAgain.rawStored, false);

      const correctedReplay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "lb",
        distanceUnit: "km",
      });
      assert.equal(correctedReplay.importedCount, 0);
      assert.equal(correctedReplay.skippedExistingCount, 1);
      assert.equal(correctedReplay.rawStored, false);
    });
  });

  test("imports sessions with unknown duration and preserves them through correction and refresh", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Duration Test Vault",
        timezone: "UTC",
      });
      const header = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE";
      const originalText = [
        header,
        "2026-04-08 10:00:00,Malformed,45m unexpected,Squat,1,100,5,0,0,,,",
        "2026-04-09 10:00:00,Over range,30h 1m,Press,1,80,8,0,0,,,",
        "2026-04-10 10:00:00,Missing,,Row,1,60,10,0,0,,,",
        "",
      ].join("\n");
      const csvPath = path.join(tempDir, "unknown-duration.csv");
      await writeFile(csvPath, originalText, "utf8");
      const generatedIds = [
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      ];
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => generatedIds.shift()! };
              }
              throw new Error("Unexpected runtime module.");
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const inspection = await workoutImportModule.inspectWorkoutCsvImport({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
      });
      assert.equal(inspection.importable, true);
      assert.equal(inspection.estimatedWorkouts, 3);
      assert.match(inspection.warnings.join(" "), /duration/u);

      const imported = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
      });
      assert.equal(imported.createdCount, 3);
      const originalPlan = importersRuntime.planWorkoutCsvImport({
        text: originalText,
        timeZone: "UTC",
        weightUnit: "kg",
      });
      const importedRecords = await Promise.all(originalPlan.sessions.map((session) =>
        coreRuntime.findEventByExternalRef({
          vaultRoot: tempDir,
          system: "strong",
          resourceType: "workout-session",
          resourceId: session.sourceWorkoutId,
        })));
      for (const record of importedRecords) {
        assert.equal(record?.kind, "activity_session");
        if (!record || record.kind !== "activity_session") {
          throw new Error("Expected an imported activity session.");
        }
        assert.equal(record.durationMinutes, undefined);
        assert.equal(record.workout.endedAt, undefined);
        assert.equal(record.workout.exercises[0]?.sets.length, 1);
      }

      const structuredWithTextDuration = workoutModule.buildStructuredWorkoutActivitySessionDraft({
        payload: {
          title: "45 minute challenge",
          workout: {
            sourceApp: "strong",
            routineName: "45 minute challenge",
            exercises: [{
              name: "Squat",
              order: 1,
              sets: [{ order: 1, reps: 5 }],
            }],
          },
        },
        source: "import",
      });
      assert.equal(structuredWithTextDuration.durationMinutes, 45);
      assert.throws(
        () => workoutModule.buildStructuredWorkoutActivitySessionDraft({
          payload: {
            title: "Challenge",
            workout: {
              sourceApp: "strong",
              routineName: "Challenge",
              exercises: [{
                name: "Squat",
                order: 1,
                sets: [{ order: 1, reps: 5 }],
              }],
            },
          },
          source: "manual",
        }),
        /Workout duration is missing/u,
      );

      const replay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
      });
      assert.equal(replay.importedCount, 0);
      assert.equal(replay.skippedExistingCount, 3);

      const corrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "lb",
        correctUnits: true,
      });
      assert.equal(corrected.supersededCount, 3);
      const correctedRecords = await Promise.all(originalPlan.sessions.map((session) =>
        coreRuntime.findEventByExternalRef({
          vaultRoot: tempDir,
          system: "strong",
          resourceType: "workout-session",
          resourceId: session.sourceWorkoutId,
        })));
      for (const record of correctedRecords) {
        assert.equal(record?.kind, "activity_session");
        if (!record || record.kind !== "activity_session") {
          throw new Error("Expected a corrected activity session.");
        }
        assert.equal(record.durationMinutes, undefined);
        assert.equal(record.workout.endedAt, undefined);
        assert.equal(record.workout.exercises[0]?.sets[0]?.weightUnit, "lb");
      }

      const expandedText = [
        originalText.trimEnd(),
        "2026-04-11 10:00:00,Known,20m,Deadlift,1,120,5,0,0,,,",
        "",
      ].join("\n");
      const expandedPath = path.join(tempDir, "unknown-duration-expanded.csv");
      await writeFile(expandedPath, expandedText, "utf8");
      const expanded = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        weightUnit: "lb",
      });
      assert.equal(expanded.createdCount, 1);
      assert.equal(expanded.skippedExistingCount, 3);
      for (const session of originalPlan.sessions) {
        const record = await coreRuntime.findEventByExternalRef({
          vaultRoot: tempDir,
          system: "strong",
          resourceType: "workout-session",
          resourceId: session.sourceWorkoutId,
        });
        assert.equal(
          record?.kind === "activity_session" ? record.durationMinutes : null,
          undefined,
        );
      }
    });
  });

  test("attaches structured imports only to raw batches with matching provenance", async () => {
    await withTempDir(async (tempDir) => {
      const csvText = [
        "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
        "2026-04-08 10:00:00,Upper,45m,Press,1,100,5,0,0,,Scoped evidence,",
        "",
      ].join("\n");
      const generatedIds = [
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        "01ARZ3NDEKTSV4RRFFQ69G5FAX",
        "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
      ];
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => generatedIds.shift()! };
              }
              throw new Error("Unexpected runtime module.");
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Raw Provenance Test Vault",
        timezone: "UTC",
      });
      const csvPath = path.join(tempDir, "raw-provenance.csv");
      await writeFile(csvPath, csvText, "utf8");
      const unresolved = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        storeRawOnly: true,
      });
      assert.equal(unresolved.weightUnit, null);

      const confirmed = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
      });
      assert.equal(confirmed.createdCount, 1);
      assert.equal(confirmed.rawStored, true);
      assert.notEqual(confirmed.rawFile, unresolved.rawFile);
      assert.ok(confirmed.manifestFile);
      const confirmedManifest = JSON.parse(
        await readFile(path.join(tempDir, confirmed.manifestFile), "utf8"),
      ) as { provenance: { weightUnit: string | null } };
      assert.equal(confirmedManifest.provenance.weightUnit, "kg");
      const confirmedPlan = importersRuntime.planWorkoutCsvImport({
        text: csvText,
        timeZone: "UTC",
        weightUnit: "kg",
      });
      const confirmedEvent = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: confirmedPlan.sessions[0]?.sourceWorkoutId ?? "missing",
      });
      assert.deepEqual(confirmedEvent?.rawRefs, [confirmed.rawFile]);

      const replay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
      });
      assert.equal(replay.importedCount, 0);
      assert.equal(replay.skippedExistingCount, 1);

      const expandedPath = path.join(tempDir, "raw-provenance-expanded.csv");
      await writeFile(expandedPath, [
        csvText.trimEnd(),
        "2026-04-09 10:00:00,Lower,30m,Squat,1,120,5,0,0,,Second session,",
        "",
      ].join("\n"), "utf8");
      const expanded = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        weightUnit: "kg",
      });
      assert.equal(expanded.createdCount, 1);
      assert.equal(expanded.skippedExistingCount, 1);

      const matchingVault = path.join(tempDir, "matching");
      await initializeVault({
        vaultRoot: matchingVault,
        title: "Matching Workout Raw Provenance Test Vault",
        timezone: "UTC",
      });
      const matchingCsvPath = path.join(matchingVault, "raw-provenance.csv");
      await writeFile(matchingCsvPath, csvText, "utf8");
      const matchingRaw = await workoutImportModule.importWorkoutCsv({
        vault: matchingVault,
        file: matchingCsvPath,
        weightUnit: "kg",
        storeRawOnly: true,
      });
      const rawFilesBefore = await coreRuntime.walkVaultFiles(matchingVault, "raw/workouts");
      const matchingImport = await workoutImportModule.importWorkoutCsv({
        vault: matchingVault,
        file: matchingCsvPath,
        weightUnit: "kg",
      });
      assert.equal(matchingImport.createdCount, 1);
      assert.equal(matchingImport.rawStored, false);
      assert.equal(matchingImport.rawFile, matchingRaw.rawFile);
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(matchingVault, "raw/workouts"),
        rawFilesBefore,
      );
    });
  });

  test("rejects an explicit source conflict before storing raw or canonical data", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Source Conflict Test Vault",
        timezone: "UTC",
      });
      const csvPath = path.join(tempDir, "conflict.csv");
      await writeFile(
        csvPath,
        [
          "Workout Name,Date,Start Time,Exercise Name,Set Order,Reps,Exercise Image",
          "Upper,2026-04-08,10:00:00,Press,1,8,https://example.invalid/press.png",
        ].join("\n"),
        "utf8",
      );
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          source: "strong",
        }),
        /source strong conflicts with unambiguous hevy headers/u,
      );
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), []);
    });
  });

  test("blocks ambiguous provider inference before storing raw or canonical data", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Ambiguous Workout Source Test Vault",
        timezone: "UTC",
      });
      const csvPath = path.join(tempDir, "ambiguous.csv");
      await writeFile(
        csvPath,
        [
          "Workout Name,Date,Start Time,Exercise Name,Set Order,Set Type,Exercise Notes,Reps",
          "Upper,2026-04-08,10:00:00,Press,2,warmup,Controlled,8",
        ].join("\n"),
        "utf8",
      );
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const inspection = await workoutImportModule.inspectWorkoutCsvImport({
        vault: tempDir,
        file: csvPath,
      });
      assert.equal(inspection.detectedSource, null);
      assert.equal(inspection.importable, false);
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({ vault: tempDir, file: csvPath }),
        /supported structured workout export/u,
      );
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          storeRawOnly: true,
        }),
        /supported structured workout export/u,
      );
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), []);

      const imported = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "hevy",
      });
      assert.equal(imported.createdCount, 1);
      const hevyPlan = importersRuntime.planWorkoutCsvImport({
        text: await readFile(csvPath, "utf8"),
        timeZone: "UTC",
        source: "hevy",
      });
      const importedEvent = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: hevyPlan.sessions[0]!.sourceWorkoutId,
      });
      assert.ok(importedEvent);
      await editEventRecord({
        vault: tempDir,
        lookup: importedEvent.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: ['tags=["member-edit"]'],
      });
      const beforeAmbiguousReplay = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: hevyPlan.sessions[0]!.sourceWorkoutId,
      });
      const rawFilesBeforeAmbiguousReplay = await coreRuntime.walkVaultFiles(
        tempDir,
        "raw/workouts",
      );
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({ vault: tempDir, file: csvPath }),
        /supported structured workout export/u,
      );
      const afterAmbiguousReplay = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: hevyPlan.sessions[0]!.sourceWorkoutId,
      });
      assert.equal(afterAmbiguousReplay?.id, beforeAmbiguousReplay?.id);
      assert.equal(afterAmbiguousReplay?.lifecycle?.revision, beforeAmbiguousReplay?.lifecycle?.revision);
      assert.equal(
        afterAmbiguousReplay?.kind === "activity_session"
          ? afterAmbiguousReplay.workout.sourceApp
          : undefined,
        "hevy",
      );
      assert.deepEqual(afterAmbiguousReplay?.tags, ["member-edit"]);
      assert.equal(
        afterAmbiguousReplay?.kind === "activity_session"
          ? afterAmbiguousReplay.workout.exercises[0]?.note
          : undefined,
        "Controlled",
      );
      assert.equal(
        afterAmbiguousReplay?.kind === "activity_session"
          ? afterAmbiguousReplay.workout.exercises[0]?.sets[0]?.type
          : undefined,
        "warmup",
      );
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeAmbiguousReplay,
      );

      const explicitlyCorrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "strong",
      });
      assert.equal(explicitlyCorrected.createdCount, 0);
      assert.equal(explicitlyCorrected.supersededCount, 1);
      const afterExplicitCorrection = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: hevyPlan.sessions[0]!.sourceWorkoutId,
      });
      assert.equal(afterExplicitCorrection?.id, importedEvent.id);
      assert.equal(
        afterExplicitCorrection?.kind === "activity_session"
          ? afterExplicitCorrection.workout.sourceApp
          : undefined,
        "strong",
      );
      assert.deepEqual(afterExplicitCorrection?.tags, ["member-edit"]);
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeAmbiguousReplay,
      );
    });
  });

  test("preserves edits and tombstones while expanding a prior workout snapshot", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Snapshot Lifecycle Test Vault",
        timezone: "UTC",
      });
      const text = [
        "Workout Name,Date,Start Time,End Time,Duration,Exercise Name,Set Order,Weight,Reps",
        "Upper,2026-04-08,10:00,10:45,45,Press,1,40,8",
        "Lower,2026-04-09,11:00,11:30,30,Row,1,50,10",
      ].join("\n");
      const csvPath = path.join(tempDir, "lifecycle.csv");
      await writeFile(csvPath, text, "utf8");
      const generatedIds = [
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        "01ARZ3NDEKTSV4RRFFQ69G5FAX",
        "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
        "01ARZ3NDEKTSV4RRFFQ69G5FB0",
        "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        "01ARZ3NDEKTSV4RRFFQ69G5FB2",
        "01ARZ3NDEKTSV4RRFFQ69G5FB3",
        "01ARZ3NDEKTSV4RRFFQ69G5FB4",
        "01ARZ3NDEKTSV4RRFFQ69G5FB5",
        "01ARZ3NDEKTSV4RRFFQ69G5FB6",
        "01ARZ3NDEKTSV4RRFFQ69G5FB7",
        "01ARZ3NDEKTSV4RRFFQ69G5FB8",
        "01ARZ3NDEKTSV4RRFFQ69G5FB9",
      ];
      let afterNextPreview: (() => Promise<void>) | undefined;
      const fencedCoreRuntime = {
        ...coreRuntime,
        importEventBatch: async (input: Parameters<typeof coreRuntime.importEventBatch>[0]) => {
          const result = await coreRuntime.importEventBatch(input);
          if (!input.apply && afterNextPreview) {
            const callback = afterNextPreview;
            afterNextPreview = undefined;
            await callback();
          }
          return result;
        },
      };
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return fencedCoreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => generatedIds.shift()! };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const imported = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "strong",
        weightUnit: "lb",
      });
      assert.equal(imported.createdCount, 2);
      const plan = importersRuntime.planWorkoutCsvImport({
        text,
        timeZone: "UTC",
        source: "strong",
        weightUnit: "lb",
      });
      const records = await Promise.all(plan.sessions.map((session) =>
        coreRuntime.findEventByExternalRef({
          vaultRoot: tempDir,
          system: "strong",
          resourceType: "workout-session",
          resourceId: session.sourceWorkoutId,
        })));
      const edited = records[0];
      const removed = records[1];
      assert.ok(edited);
      assert.ok(removed);
      const {
        schemaVersion: _schemaVersion,
        id: _id,
        dayKey: _dayKey,
        lifecycle: _lifecycle,
        ...editablePayload
      } = edited;
      await coreRuntime.upsertEvent({
        vaultRoot: tempDir,
        payload: {
          ...editablePayload,
          id: edited.id,
          title: "Member-edited title",
          occurredAt: "2026-04-08T12:00:00.000Z",
        },
      });
      await editEventRecord({
        vault: tempDir,
        lookup: edited.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: ['tags=["member-edit"]'],
      });
      await coreRuntime.deleteEvent({ vaultRoot: tempDir, eventId: removed.id });

      const exactReplay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "strong",
        weightUnit: "lb",
      });
      assert.equal(exactReplay.importedCount, 0);
      assert.equal(exactReplay.skippedExistingCount, 2);
      assert.equal(exactReplay.rawStored, false);
      const exactReplayEdit = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[0]!.sourceWorkoutId,
      });
      assert.deepEqual(exactReplayEdit?.tags, ["member-edit"]);
      await coreRuntime.updateVaultSummary({
        vaultRoot: tempDir,
        timezone: "America/Los_Angeles",
      });

      const expandedText = [
        text.replace(",10:00,", ",10:00:00,"),
        "New Session,2026-04-10,09:00:00,09:30:00,30,Squat,1,60,5",
      ].join("\n");
      const changedStartPath = path.join(tempDir, "changed-start.csv");
      await writeFile(
        changedStartPath,
        expandedText.replace(",10:00:00,", ",10:05:00,"),
        "utf8",
      );
      const rawFilesBeforeStartConflict = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: changedStartPath,
          source: "strong",
          weightUnit: "lb",
        }),
        /source session is missing or changed/u,
      );
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeStartConflict,
      );
      const changedEndPath = path.join(tempDir, "changed-end.csv");
      await writeFile(
        changedEndPath,
        expandedText.replace(",10:45,", ",10:50,"),
        "utf8",
      );
      const rawFilesBeforeConflict = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: changedEndPath,
          source: "strong",
          weightUnit: "lb",
        }),
        /source session changed/u,
      );
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeConflict,
      );

      const expandedPath = path.join(tempDir, "expanded.csv");
      await writeFile(expandedPath, expandedText, "utf8");
      const expanded = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "strong",
        weightUnit: "lb",
      });
      assert.equal(expanded.createdCount, 1);
      assert.equal(expanded.supersededCount, 0);
      assert.equal(expanded.skippedExistingCount, 2);
      assert.equal(expanded.receivedCount, 3);
      const retainedEdit = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[0]!.sourceWorkoutId,
      });
      assert.equal(retainedEdit?.id, edited.id);
      assert.equal(retainedEdit?.title, "Member-edited title");
      assert.equal(retainedEdit?.occurredAt, "2026-04-08T12:00:00.000Z");
      assert.deepEqual(retainedEdit?.tags, ["member-edit"]);
      assert.equal(await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[1]!.sourceWorkoutId,
      }), null);
      const expandedReplay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "strong",
        weightUnit: "lb",
      });
      assert.equal(expandedReplay.importedCount, 0);
      assert.equal(expandedReplay.skippedExistingCount, 3);
      assert.equal(expandedReplay.rawStored, false);

      const expandedPlan = importersRuntime.planWorkoutCsvImport({
        text: expandedText,
        timeZone: "UTC",
        source: "strong",
        weightUnit: "lb",
      });
      const addedBeforeCorrection = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: expandedPlan.sessions[2]!.sourceWorkoutId,
      });
      assert.ok(addedBeforeCorrection);
      const rawFilesBeforeCorrection = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");
      const providerCorrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "hevy",
        weightUnit: "lb",
      });
      assert.equal(providerCorrected.createdCount, 0);
      assert.equal(providerCorrected.supersededCount, 2);
      assert.equal(providerCorrected.skippedExistingCount, 1);
      assert.equal(providerCorrected.rawStored, false);
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeCorrection,
      );
      const providerCorrectedEdit = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[0]!.sourceWorkoutId,
      });
      const providerCorrectedAdded = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: expandedPlan.sessions[2]!.sourceWorkoutId,
      });
      assert.equal(providerCorrectedEdit?.id, edited.id);
      assert.equal(providerCorrectedEdit?.title, "Member-edited title");
      assert.equal(providerCorrectedEdit?.occurredAt, "2026-04-08T12:00:00.000Z");
      assert.deepEqual(providerCorrectedEdit?.tags, ["member-edit"]);
      assert.equal(
        providerCorrectedEdit?.kind === "activity_session"
          ? providerCorrectedEdit.workout.sourceApp
          : undefined,
        "hevy",
      );
      assert.equal(providerCorrectedAdded?.id, addedBeforeCorrection.id);
      assert.equal(await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[1]!.sourceWorkoutId,
      }), null);

      const unitCorrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "hevy",
        weightUnit: "kg",
        correctUnits: true,
      });
      assert.equal(unitCorrected.createdCount, 0);
      assert.equal(unitCorrected.supersededCount, 2);
      assert.equal(unitCorrected.skippedExistingCount, 1);
      assert.equal(unitCorrected.rawStored, false);
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeCorrection,
      );
      const unitCorrectedEdit = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[0]!.sourceWorkoutId,
      });
      const unitCorrectedAdded = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: expandedPlan.sessions[2]!.sourceWorkoutId,
      });
      assert.equal(unitCorrectedEdit?.id, edited.id);
      assert.equal(unitCorrectedEdit?.title, "Member-edited title");
      assert.deepEqual(unitCorrectedEdit?.tags, ["member-edit"]);
      assert.equal(
        unitCorrectedEdit?.kind === "activity_session"
          ? unitCorrectedEdit.workout.exercises[0]?.sets[0]?.weightUnit
          : undefined,
        "kg",
      );
      assert.equal(unitCorrectedAdded?.id, addedBeforeCorrection.id);
      assert.equal(
        unitCorrectedAdded?.kind === "activity_session"
          ? unitCorrectedAdded.workout.exercises[0]?.sets[0]?.weightUnit
          : undefined,
        "kg",
      );

      const correctedReplay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "hevy",
        weightUnit: "kg",
      });
      assert.equal(correctedReplay.importedCount, 0);
      assert.equal(correctedReplay.skippedExistingCount, 3);
      assert.equal(correctedReplay.rawStored, false);

      assert.ok(unitCorrectedAdded);
      afterNextPreview = async () => {
        await editEventRecord({
          vault: tempDir,
          lookup: unitCorrectedAdded.id,
          entityLabel: "workout session",
          expectedKinds: ["activity_session"],
          set: ["activityType=mobility"],
        });
      };
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: expandedPath,
          source: "hevy",
          weightUnit: "lb",
          correctUnits: true,
        }),
        /changed after it was inspected/u,
      );
      const afterRace = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: expandedPlan.sessions[2]!.sourceWorkoutId,
      });
      assert.equal(
        afterRace?.kind === "activity_session" ? afterRace.activityType : undefined,
        "mobility",
      );
      assert.equal(
        afterRace?.kind === "activity_session"
          ? afterRace.workout.exercises[0]?.sets[0]?.weightUnit
          : undefined,
        "kg",
      );
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesBeforeCorrection,
      );

      const furtherExpandedText = [
        expandedText,
        "Latest Session,2026-04-11,08:00:00,08:30:00,30,Deadlift,1,80,5",
      ].join("\n");
      const furtherExpandedPath = path.join(tempDir, "further-expanded.csv");
      await writeFile(furtherExpandedPath, furtherExpandedText, "utf8");
      const furtherExpandedPlan = importersRuntime.planWorkoutCsvImport({
        text: furtherExpandedText,
        timeZone: "America/Los_Angeles",
        source: "hevy",
        weightUnit: "kg",
      });
      afterNextPreview = async () => {
        await editEventRecord({
          vault: tempDir,
          lookup: unitCorrectedAdded.id,
          entityLabel: "workout session",
          expectedKinds: ["activity_session"],
          set: ['tags=["expanded-race-edit"]'],
        });
      };
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: furtherExpandedPath,
          source: "hevy",
          weightUnit: "kg",
        }),
        /changed after it was inspected/u,
      );
      assert.equal(await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: furtherExpandedPlan.sessions[3]!.sourceWorkoutId,
      }), null);
      const rawFilesAfterFurtherExpansionRace = await coreRuntime.walkVaultFiles(
        tempDir,
        "raw/workouts",
      );
      assert.equal(
        rawFilesAfterFurtherExpansionRace.length,
        rawFilesBeforeCorrection.length + 2,
      );
      const furtherExpanded = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: furtherExpandedPath,
        source: "hevy",
        weightUnit: "kg",
      });
      assert.equal(furtherExpanded.createdCount, 1);
      assert.equal(furtherExpanded.supersededCount, 0);
      assert.equal(furtherExpanded.skippedExistingCount, 3);
      assert.equal(furtherExpanded.rawStored, false);
      const rawFilesAfterFurtherExpansion = await coreRuntime.walkVaultFiles(
        tempDir,
        "raw/workouts",
      );
      assert.deepEqual(rawFilesAfterFurtherExpansion, rawFilesAfterFurtherExpansionRace);
      const retainedAfterFurtherExpansion = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[0]!.sourceWorkoutId,
      });
      const addedAfterFurtherExpansion = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: expandedPlan.sessions[2]!.sourceWorkoutId,
      });
      assert.equal(retainedAfterFurtherExpansion?.id, edited.id);
      assert.equal(retainedAfterFurtherExpansion?.title, "Member-edited title");
      assert.deepEqual(retainedAfterFurtherExpansion?.tags, ["member-edit"]);
      assert.equal(addedAfterFurtherExpansion?.id, addedBeforeCorrection.id);
      assert.equal(
        addedAfterFurtherExpansion?.kind === "activity_session"
          ? addedAfterFurtherExpansion.workout.exercises[0]?.sets[0]?.weightUnit
          : undefined,
        "kg",
      );
      assert.equal(
        addedAfterFurtherExpansion?.kind === "activity_session"
          ? addedAfterFurtherExpansion.activityType
          : undefined,
        "mobility",
      );
      assert.deepEqual(addedAfterFurtherExpansion?.tags, ["expanded-race-edit"]);
      assert.equal(await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: plan.sessions[1]!.sourceWorkoutId,
      }), null);
      const latest = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: furtherExpandedPlan.sessions[3]!.sourceWorkoutId,
      });
      assert.ok(latest);
      const furtherExpandedReplay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: furtherExpandedPath,
        source: "hevy",
        weightUnit: "kg",
      });
      assert.equal(furtherExpandedReplay.importedCount, 0);
      assert.equal(furtherExpandedReplay.skippedExistingCount, 4);
      assert.equal(furtherExpandedReplay.rawStored, false);
      assert.deepEqual(
        await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
        rawFilesAfterFurtherExpansion,
      );
    });
  });

  test("treats an all-tombstoned equivalent workout snapshot as a no-op", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Tombstone Replay Test Vault",
        timezone: "UTC",
      });
      const text = [
        "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Reps",
        "Upper,2026-04-08,10:00,45,Press,1,8",
        "Lower,2026-04-09,11:00,30,Row,1,10",
      ].join("\n");
      const csvPath = path.join(tempDir, "tombstoned.csv");
      await writeFile(csvPath, text, "utf8");
      const generatedIds = [
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      ];
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => generatedIds.shift()! };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const imported = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "strong",
      });
      assert.equal(imported.createdCount, 2);
      const plan = importersRuntime.planWorkoutCsvImport({
        text,
        timeZone: "UTC",
        source: "strong",
      });
      const importedRecords = await Promise.all(plan.sessions.map((session) =>
        coreRuntime.findEventByExternalRef({
          vaultRoot: tempDir,
          system: "strong",
          resourceType: "workout-session",
          resourceId: session.sourceWorkoutId,
        })));
      for (const record of importedRecords) {
        assert.ok(record);
        await coreRuntime.deleteEvent({ vaultRoot: tempDir, eventId: record.id });
      }
      const rawFilesBeforeReplay = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");
      const auditRowsBeforeReplay = await countAuditRows(tempDir);
      const eventRowsBeforeReplay = await coreRuntime.readJsonlRecords({
        vaultRoot: tempDir,
        relativePath: imported.ledgerFiles[0]!,
      });
      const equivalentPath = path.join(tempDir, "tombstoned-equivalent.csv");
      await writeFile(
        equivalentPath,
        text.replace(",10:00,", ",10:00:00,").replace(",11:00,", ",11:00:00,"),
        "utf8",
      );

      const replay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: equivalentPath,
        source: "strong",
      });

      assert.equal(replay.importedCount, 0);
      assert.equal(replay.receivedCount, 2);
      assert.equal(replay.skippedExistingCount, 2);
      assert.equal(replay.rawStored, false);
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), rawFilesBeforeReplay);
      assert.equal(await countAuditRows(tempDir), auditRowsBeforeReplay);
      assert.equal((await coreRuntime.readJsonlRecords({
        vaultRoot: tempDir,
        relativePath: imported.ledgerFiles[0]!,
      })).length, eventRowsBeforeReplay.length);
      for (const session of plan.sessions) {
        assert.equal(await coreRuntime.findEventByExternalRef({
          vaultRoot: tempDir,
          system: "strong",
          resourceType: "workout-session",
          resourceId: session.sourceWorkoutId,
        }), null);
      }
    });
  });

  test("unit correction preserves blank-note fallbacks and later canonical workout context", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Correction Context Test Vault",
        timezone: "America/Chicago",
      });
      const text = [
        "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
        "2026-04-08 00:30:00,Upper,45m,Squat,1,100,5,0,0,,,",
      ].join("\n");
      const csvPath = path.join(tempDir, "blank-note.csv");
      await writeFile(csvPath, text, "utf8");
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "lb",
      });
      const planned = importersRuntime.planWorkoutCsvImport({
        text,
        timeZone: "America/Chicago",
        source: "strong",
        weightUnit: "lb",
      });
      const resourceId = planned.sessions[0]?.sourceWorkoutId;
      assert.ok(resourceId);
      const initial = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId,
      });
      assert.ok(initial);
      await editEventRecord({
        vault: tempDir,
        lookup: initial.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: [
          "activityType=mobility",
          'tags=["member-edit"]',
          "experimentSlug=mobility-trial",
          "workout.routineId=member-routine",
          'workout.media=[{"kind":"photo","relativePath":"raw/workouts/member-edit.jpg"}]',
          "workout.exercises.0.mode=cardio",
          'workout.exercises.0.note="member exercise note"',
          'workout.exercises.0.sets.0.note="member set note"',
          "workout.exercises.0.sets.0.reps=9",
          "workout.exercises.0.sets.0.durationSeconds=30",
          "workout.exercises.0.sets.0.rpe=8",
        ],
      });
      const rawFilesBefore = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");

      const corrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        weightUnit: "kg",
        correctUnits: true,
      });
      assert.equal(corrected.createdCount, 0);
      assert.equal(corrected.supersededCount, 1);
      assert.equal(corrected.rawStored, false);
      const current = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId,
      });
      if (!current || current.kind !== "activity_session") {
        throw new Error("Expected a corrected activity session.");
      }
      assert.equal(current.id, initial.id);
      assert.equal(current.note, "Upper");
      assert.equal(current.workout.sessionNote, "Upper");
      assert.equal(current.activityType, "mobility");
      assert.deepEqual(current.tags, ["member-edit"]);
      assert.equal(current.experimentSlug, "mobility-trial");
      assert.equal(current.workout.routineId, "member-routine");
      assert.deepEqual(current.workout.media, [{
        kind: "photo",
        relativePath: "raw/workouts/member-edit.jpg",
      }]);
      assert.equal(current.workout.exercises[0]?.mode, "cardio");
      assert.equal(current.workout.exercises[0]?.note, "member exercise note");
      assert.equal(current.workout.exercises[0]?.sets[0]?.note, "member set note");
      assert.equal(current.workout.exercises[0]?.sets[0]?.reps, 9);
      assert.equal(current.workout.exercises[0]?.sets[0]?.durationSeconds, 30);
      assert.equal(current.workout.exercises[0]?.sets[0]?.rpe, 8);
      assert.equal(current.workout.exercises[0]?.sets[0]?.weightUnit, "kg");
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), rawFilesBefore);

      await editEventRecord({
        vault: tempDir,
        lookup: current.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: ["workout.exercises.0.sets.0.order=2"],
      });
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          weightUnit: "lb",
          correctUnits: true,
        }),
        /overlaps edited exercise or set fields/u,
      );
      await editEventRecord({
        vault: tempDir,
        lookup: current.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: ["workout.exercises.0.sets.0.order=1"],
      });
      await editEventRecord({
        vault: tempDir,
        lookup: current.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: ["workout.exercises.0.sets.0.weight=999"],
      });
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          weightUnit: "lb",
          correctUnits: true,
        }),
        /overlaps edited load or distance fields/u,
      );
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), rawFilesBefore);
    });
  });

  test("unit correction changes only the selected axis and preserves member edits on the other axis", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Axis Correction Test Vault",
        timezone: "UTC",
      });
      const weightText = [
        "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Weight,Reps,Distance Km",
        "Weight Axis,2026-04-08,10:00,45,Carry,1,100,5,1.5",
      ].join("\n");
      const distanceText = [
        "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Weight Kg,Reps,Distance",
        "Distance Axis,2026-04-09,10:00,45,Carry,1,40,5,1.5",
      ].join("\n");
      const weightPath = path.join(tempDir, "weight-axis.csv");
      const distancePath = path.join(tempDir, "distance-axis.csv");
      await writeFile(weightPath, weightText, "utf8");
      await writeFile(distancePath, distanceText, "utf8");
      const generatedIds = [
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        "01ARZ3NDEKTSV4RRFFQ69G5FAX",
        "01ARZ3NDEKTSV4RRFFQ69G5FAY",
      ];
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => generatedIds.shift()! };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: weightPath,
        source: "strong",
        weightUnit: "lb",
      });
      const weightPlan = importersRuntime.planWorkoutCsvImport({
        text: weightText,
        timeZone: "UTC",
        source: "strong",
        weightUnit: "lb",
      });
      const weightRecord = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: weightPlan.sessions[0]!.sourceWorkoutId,
      });
      assert.ok(weightRecord);
      await editEventRecord({
        vault: tempDir,
        lookup: weightRecord.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: [
          "distanceKm=9",
          "workout.exercises.0.sets.0.distanceMeters=9000",
        ],
      });
      const weightCorrection = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: weightPath,
        source: "strong",
        weightUnit: "kg",
        correctUnits: true,
      });
      assert.equal(weightCorrection.supersededCount, 1);
      const afterWeightCorrection = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: weightPlan.sessions[0]!.sourceWorkoutId,
      });
      if (!afterWeightCorrection || afterWeightCorrection.kind !== "activity_session") {
        throw new Error("Expected a weight-corrected activity session.");
      }
      assert.equal(afterWeightCorrection.distanceKm, 9);
      assert.equal(afterWeightCorrection.workout.exercises[0]?.sets[0]?.weightUnit, "kg");
      assert.equal(afterWeightCorrection.workout.exercises[0]?.sets[0]?.distanceMeters, 9000);
      const identicalWeightCorrection = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: weightPath,
        source: "strong",
        weightUnit: "kg",
        correctUnits: true,
      });
      assert.equal(identicalWeightCorrection.supersededCount, 0);
      assert.equal(identicalWeightCorrection.skippedExistingCount, 1);

      await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: distancePath,
        source: "hevy",
        distanceUnit: "km",
      });
      const distancePlan = importersRuntime.planWorkoutCsvImport({
        text: distanceText,
        timeZone: "UTC",
        source: "hevy",
        distanceUnit: "km",
      });
      const distanceRecord = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: distancePlan.sessions[0]!.sourceWorkoutId,
      });
      assert.ok(distanceRecord);
      await editEventRecord({
        vault: tempDir,
        lookup: distanceRecord.id,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: ["workout.exercises.0.sets.0.weight=77"],
      });
      const distanceCorrection = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: distancePath,
        source: "hevy",
        distanceUnit: "mi",
        correctUnits: true,
      });
      assert.equal(distanceCorrection.supersededCount, 1);
      const afterDistanceCorrection = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: distancePlan.sessions[0]!.sourceWorkoutId,
      });
      if (!afterDistanceCorrection || afterDistanceCorrection.kind !== "activity_session") {
        throw new Error("Expected a distance-corrected activity session.");
      }
      assert.equal(afterDistanceCorrection.workout.exercises[0]?.sets[0]?.weight, 77);
      assert.equal(afterDistanceCorrection.distanceKm, 2.414016);
      assert.equal(afterDistanceCorrection.workout.exercises[0]?.sets[0]?.distanceMeters, 2414.016);
      const identicalDistanceCorrection = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: distancePath,
        source: "hevy",
        distanceUnit: "mi",
        correctUnits: true,
      });
      assert.equal(identicalDistanceCorrection.supersededCount, 0);
      assert.equal(identicalDistanceCorrection.skippedExistingCount, 1);
    });
  });

  test("corrects an exact prior ambiguous Strong import to Hevy in place", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Dialect Correction Test Vault",
        timezone: "UTC",
      });
      const text = [
        "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Set Type,Exercise Notes,Reps,Weight",
        "Upper,2026-04-08,10:00:00,45,Press,2,warmup,Controlled,8,100",
      ].join("\n");
      const csvPath = path.join(tempDir, "history.csv");
      await writeFile(csvPath, text, "utf8");

      const importId = `${ID_PREFIXES.transform}_01ARZ3NDEKTSV4RRFFQ69G5FAV`;
      const owner = { kind: "workout_batch" as const, id: importId, partition: "strong" };
      const rawDirectory = resolveRawAssetDirectory({
        owner,
        occurredAt: "2026-04-08T12:00:00.000Z",
      });
      const rawFile = path.posix.join(rawDirectory, "history.csv");
      const manifestFile = path.posix.join(rawDirectory, "manifest.json");
      const manifest = buildRawImportManifest({
        importId,
        importKind: "workout_batch",
        importedAt: "2026-04-08T12:00:00.000Z",
        owner,
        source: "strong" as const,
        rawDirectory,
        artifacts: [{
          role: "source",
          relativePath: rawFile,
          originalFileName: "history.csv",
          mediaType: "text/csv",
          byteSize: new TextEncoder().encode(text).byteLength,
          sha256: createHash("sha256").update(text).digest("hex"),
        }],
        provenance: {
          source: "strong",
          timeZone: "UTC",
          weightUnit: "lb",
          distanceUnit: null,
        },
      });
      await coreRuntime.applyCanonicalWriteBatch({
        vaultRoot: tempDir,
        operationType: "workout_import_csv_raw",
        summary: "Seed exact prior workout evidence.",
        audit: {
          action: "workout_import_csv",
          commandName: "test.seedAmbiguousWorkoutImport",
          summary: "Seeded exact prior workout evidence.",
        },
        rawContents: [{
          targetRelativePath: rawFile,
          content: text,
          originalFileName: "history.csv",
          mediaType: "text/csv",
        }, {
          targetRelativePath: manifestFile,
          content: `${JSON.stringify(manifest, null, 2)}\n`,
          originalFileName: "manifest.json",
          mediaType: "application/json",
        }],
      });
      const strongPlan = importersRuntime.planWorkoutCsvImport({
        text,
        timeZone: "UTC",
        source: "strong",
        weightUnit: "lb",
      });
      const strongSession = strongPlan.sessions[0];
      assert.ok(strongSession);
      const seeded = await coreRuntime.importEventBatch({
        vaultRoot: tempDir,
        decisions: [{
          action: "upsert",
          payload: {
            kind: "activity_session",
            ...workoutModule.buildStructuredWorkoutActivitySessionDraft({
              payload: {
                title: strongSession.title,
                occurredAt: strongSession.occurredAt,
                timeZone: "UTC",
                source: "import",
                activityType: "mobility",
                tags: ["member-edit"],
                rawRefs: [rawFile],
                externalRef: {
                  system: "strong",
                  resourceType: "workout-session",
                  resourceId: strongSession.sourceWorkoutId,
                  version: "2026-08-12T00:00:00.000Z",
                },
                workout: {
                  ...strongSession.workout,
                  routineId: "member-routine",
                  media: [{
                    kind: "photo",
                    relativePath: "raw/workouts/member-edit.jpg",
                  }],
                },
              } as JsonObject,
              source: "import",
            }),
          },
        }],
        apply: true,
      });
      const rawFilesBefore = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
              }
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const prematureExpandedPath = path.join(tempDir, "history-premature-expanded.csv");
      await writeFile(prematureExpandedPath, [
        text,
        "Lower,2026-04-09,11:00:00,30,Row,1,normal,New note,10,50",
      ].join("\n"), "utf8");
      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: prematureExpandedPath,
          source: "hevy",
          weightUnit: "kg",
        }),
        /source session changed|different provider dialect/u,
      );
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), rawFilesBefore);

      await assert.rejects(
        workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          source: "hevy",
          weightUnit: "kg",
          correctUnits: true,
        }),
        /Correct the workout provider first by rerunning this exact CSV with the confirmed --source and without --correct-units/u,
      );
      const corrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "hevy" as const,
        weightUnit: "kg",
      });
      assert.equal(corrected.createdCount, 0);
      assert.equal(corrected.supersededCount, 1);
      assert.equal(corrected.rawStored, false);
      assert.deepEqual(corrected.lookupIds, seeded.eventIds);
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), rawFilesBefore);
      const current = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: strongSession.sourceWorkoutId,
      });
      if (!current || current.kind !== "activity_session") {
        throw new Error("Expected the source-corrected workout to remain one activity session.");
      }
      assert.equal(current.id, seeded.eventIds[0]);
      assert.equal(current.workout?.sourceApp, "hevy");
      assert.equal(current.activityType, "mobility");
      assert.deepEqual(current.tags, ["member-edit"]);
      assert.equal(current.workout?.routineId, "member-routine");
      assert.deepEqual(current.workout?.media, [{
        kind: "photo",
        relativePath: "raw/workouts/member-edit.jpg",
      }]);
      assert.equal(current.workout?.exercises[0]?.note, "Controlled");
      assert.deepEqual(
        current.workout?.exercises[0]?.sets.map((set) => [set.order, set.type]),
        [[2, "warmup"]],
      );
      assert.equal(current.workout.exercises[0]?.sets[0]?.weightUnit, "lb");
      const unitCorrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "hevy",
        weightUnit: "kg",
        correctUnits: true,
      });
      assert.equal(unitCorrected.createdCount, 0);
      assert.equal(unitCorrected.supersededCount, 1);
      assert.deepEqual(unitCorrected.lookupIds, seeded.eventIds);
      const afterBothCorrections = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: strongSession.sourceWorkoutId,
      });
      if (!afterBothCorrections || afterBothCorrections.kind !== "activity_session") {
        throw new Error("Expected both corrections to retain one activity session.");
      }
      assert.equal(afterBothCorrections.id, seeded.eventIds[0]);
      assert.equal(afterBothCorrections.workout.sourceApp, "hevy");
      assert.equal(afterBothCorrections.workout.exercises[0]?.sets[0]?.weightUnit, "kg");
      assert.equal(afterBothCorrections.activityType, "mobility");
      assert.deepEqual(afterBothCorrections.tags, ["member-edit"]);
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), rawFilesBefore);
      const hevyPlan = importersRuntime.planWorkoutCsvImport({
        text,
        timeZone: "UTC",
        source: "hevy",
        weightUnit: "kg",
      });
      assert.equal(await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "hevy",
        resourceType: "workout-session",
        resourceId: hevyPlan.sessions[0]?.sourceWorkoutId ?? "missing",
      }), null);
      const replay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "hevy",
        weightUnit: "kg",
      });
      assert.equal(replay.importedCount, 0);
      assert.equal(replay.skippedExistingCount, 1);
      assert.equal(replay.rawStored, false);
      assert.deepEqual(await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"), rawFilesBefore);

      const expandedText = [
        text,
        "Lower,2026-04-09,11:00:00,30,Row,1,normal,New note,10,50",
      ].join("\n");
      const expandedPath = path.join(tempDir, "history-expanded.csv");
      await writeFile(expandedPath, expandedText, "utf8");
      const expanded = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "hevy",
        weightUnit: "kg",
      });
      assert.equal(expanded.createdCount, 1);
      assert.equal(expanded.skippedExistingCount, 1);
      assert.equal(expanded.supersededCount, 0);
      const retained = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: strongSession.sourceWorkoutId,
      });
      assert.equal(retained?.id, seeded.eventIds[0]);
      const expandedReplay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "hevy",
        weightUnit: "kg",
      });
      assert.equal(expandedReplay.importedCount, 0);
      assert.equal(expandedReplay.skippedExistingCount, 2);
    });
  });

  test("keeps provider-corrected tombstones authoritative during snapshot expansion", async () => {
    await withTempDir(async (tempDir) => {
      await initializeVault({
        vaultRoot: tempDir,
        title: "Workout Provider Tombstone Test Vault",
        timezone: "UTC",
      });
      const text = [
        "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Set Type,Exercise Notes,Reps,Weight",
        "Upper,2026-04-08,10:00:00,45,Press,1,warmup,Controlled,8,100",
        "Lower,2026-04-09,10:00:00,30,Row,1,normal,Steady,10,80",
      ].join("\n");
      const csvPath = path.join(tempDir, "provider-tombstone.csv");
      await writeFile(csvPath, text, "utf8");
      const importId = `${ID_PREFIXES.transform}_01ARZ3NDEKTSV4RRFFQ69G5FAV`;
      const owner = { kind: "workout_batch" as const, id: importId, partition: "strong" };
      const rawDirectory = resolveRawAssetDirectory({
        owner,
        occurredAt: "2026-04-08T12:00:00.000Z",
      });
      const rawFile = path.posix.join(rawDirectory, "provider-tombstone.csv");
      const manifestFile = path.posix.join(rawDirectory, "manifest.json");
      const manifest = buildRawImportManifest({
        importId,
        importKind: "workout_batch",
        importedAt: "2026-04-08T12:00:00.000Z",
        owner,
        source: "strong" as const,
        rawDirectory,
        artifacts: [{
          role: "source",
          relativePath: rawFile,
          originalFileName: "provider-tombstone.csv",
          mediaType: "text/csv",
          byteSize: new TextEncoder().encode(text).byteLength,
          sha256: createHash("sha256").update(text).digest("hex"),
        }],
        provenance: {
          delimiter: ",",
          timeZone: "UTC",
          weightUnit: "lb",
          distanceUnit: null,
        },
      });
      await coreRuntime.applyCanonicalWriteBatch({
        vaultRoot: tempDir,
        operationType: "workout_import_csv_raw",
        summary: "Seed provider tombstone evidence.",
        audit: {
          action: "workout_import_csv",
          commandName: "test.seedProviderTombstone",
          summary: "Seeded provider tombstone evidence.",
        },
        rawContents: [{
          targetRelativePath: rawFile,
          content: text,
          originalFileName: "provider-tombstone.csv",
          mediaType: "text/csv",
        }, {
          targetRelativePath: manifestFile,
          content: `${JSON.stringify(manifest, null, 2)}\n`,
          originalFileName: "manifest.json",
          mediaType: "application/json",
        }],
      });
      const strongPlan = importersRuntime.planWorkoutCsvImport({
        text,
        timeZone: "UTC",
        source: "strong",
        weightUnit: "lb",
      });
      const seeded = await coreRuntime.importEventBatch({
        vaultRoot: tempDir,
        decisions: strongPlan.sessions.map((session) => ({
          action: "upsert",
          payload: {
            kind: "activity_session",
            ...workoutModule.buildStructuredWorkoutActivitySessionDraft({
              payload: {
                title: session.title,
                occurredAt: session.occurredAt,
                timeZone: "UTC",
                source: "import",
                activityType: "strength-training",
                durationMinutes: session.durationMinutes,
                rawRefs: [rawFile],
                externalRef: {
                  system: "strong",
                  resourceType: "workout-session",
                  resourceId: session.sourceWorkoutId,
                  version: "2026-08-12T00:00:00.000Z",
                },
                workout: session.workout,
              } as JsonObject,
              source: "import",
            }),
          },
        })),
        apply: true,
      });
      assert.equal(seeded.eventIds.length, 2);
      await editEventRecord({
        vault: tempDir,
        lookup: seeded.eventIds[0]!,
        entityLabel: "workout session",
        expectedKinds: ["activity_session"],
        set: ['tags=["member-edit"]'],
      });
      await coreRuntime.deleteEvent({
        vaultRoot: tempDir,
        eventId: seeded.eventIds[1]!,
      });
      const generatedIds = [
        "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        "01ARZ3NDEKTSV4RRFFQ69G5FAX",
        "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
      ];
      const workoutImportModule = (await importWithMocks(
        "../src/usecases/workout-import.ts",
        {
          "../src/runtime-import.js": () => ({
            loadRuntimeModule: vi.fn(async (specifier: string) => {
              if (specifier === "@murphai/core") return coreRuntime;
              if (specifier === "@murphai/importers") return importersRuntime;
              if (specifier === "@murphai/runtime-state") {
                return { generateUlid: () => generatedIds.shift()! };
              }
              throw new Error("Unexpected runtime module.");
            }),
          }),
        },
      )) as typeof import("../src/usecases/workout-import.ts");

      const corrected = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: csvPath,
        source: "hevy",
        weightUnit: "lb",
      });
      assert.equal(corrected.supersededCount, 1);
      assert.equal(corrected.skippedExistingCount, 1);
      const correctedLive = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: strongPlan.sessions[0]!.sourceWorkoutId,
      });
      assert.equal(correctedLive?.kind === "activity_session"
        ? correctedLive.workout.sourceApp
        : null, "hevy");
      assert.deepEqual(correctedLive?.tags, ["member-edit"]);

      const expandedText = [
        text,
        "New,2026-04-10,10:00:00,20,Squat,1,normal,New,5,120",
      ].join("\n");
      const expandedPath = path.join(tempDir, "provider-tombstone-expanded.csv");
      await writeFile(expandedPath, expandedText, "utf8");
      const expanded = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "hevy",
        weightUnit: "lb",
      });
      assert.equal(expanded.createdCount, 1);
      assert.equal(expanded.skippedExistingCount, 2);
      const retainedLive = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: strongPlan.sessions[0]!.sourceWorkoutId,
      });
      assert.equal(retainedLive?.id, correctedLive?.id);
      assert.deepEqual(retainedLive?.tags, ["member-edit"]);
      const deleted = await coreRuntime.findEventByExternalRef({
        vaultRoot: tempDir,
        system: "strong",
        resourceType: "workout-session",
        resourceId: strongPlan.sessions[1]!.sourceWorkoutId,
      });
      assert.equal(deleted, null);
      const replay = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: expandedPath,
        source: "hevy",
        weightUnit: "lb",
      });
      assert.equal(replay.importedCount, 0);
      assert.equal(replay.skippedExistingCount, 3);

      assert.ok(correctedLive);
      await coreRuntime.deleteEvent({
        vaultRoot: tempDir,
        eventId: correctedLive.id,
      });
      const furtherExpandedText = [
        expandedText,
        "Later,2026-04-11,10:00:00,20,Deadlift,1,normal,Later,5,140",
      ].join("\n");
      const furtherExpandedPath = path.join(tempDir, "provider-tombstone-further-expanded.csv");
      await writeFile(furtherExpandedPath, furtherExpandedText, "utf8");
      const furtherExpanded = await workoutImportModule.importWorkoutCsv({
        vault: tempDir,
        file: furtherExpandedPath,
        source: "hevy",
        weightUnit: "lb",
      });
      assert.equal(furtherExpanded.createdCount, 1);
      assert.equal(furtherExpanded.skippedExistingCount, 3);
      for (const originalSession of strongPlan.sessions) {
        assert.equal(await coreRuntime.findEventByExternalRef({
          vaultRoot: tempDir,
          system: "strong",
          resourceType: "workout-session",
          resourceId: originalSession.sourceWorkoutId,
        }), null);
      }
    });
  });

  test("reconciles Strong and Hevy legacy imports across host and vault timezone changes", async () => {
    for (const fixture of [
      {
        source: "strong" as const,
        text: [
          "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
          "2026-03-07 10:00:00,Full Body,45m,Squat,1,100,5,1.5,0,Main work,Session note,8",
          "2026-03-09 10:00:00,Full Body,45m,Deadlift,1,120,5,1.5,0,Main work,Session note,8",
          "",
        ].join("\n"),
        weightUnit: "lb" as const,
        distanceUnit: "mi" as const,
        legacyUnitless: true,
        legacyVersion: undefined,
        legacyOccurredAts: ["2026-03-07T10:00:00.000Z", "2026-03-09T10:00:00.000Z"],
      },
      {
        source: "hevy" as const,
        text: [
          "Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,Exercise Notes,Workout Notes,Set Type,Distance Km,Bodyweight,Assistance",
          "Upper,2026-04-08,10:00:00,45,Squat,2,40,kg,8,Controlled,Session note,warmup,0.4,80,10",
          "Upper,2026-04-08,10:00:00,45,Squat,1,45,kg,5,Controlled,Session note,dropset,0.6,80,10",
          "",
        ].join("\n"),
        weightUnit: "kg" as const,
        distanceUnit: undefined,
        legacyUnitless: false,
        legacyVersion: "2026-08-12T00:00:00.000Z",
        legacyOccurredAts: ["2026-04-08T10:00:00.000Z"],
      },
    ]) {
      await withTempDir(async (tempDir) => {
        await initializeVault({
          vaultRoot: tempDir,
          title: "Legacy Workout Import Test Vault",
          timezone: "America/Chicago",
        });
        const csvPath = path.join(tempDir, `${fixture.source}.csv`);
        await writeFile(csvPath, fixture.text, "utf8");

        const importedAt = "2026-04-08T12:00:00.000Z";
        const importId = `${ID_PREFIXES.transform}_01ARZ3NDEKTSV4RRFFQ69G5FAV`;
        const owner = {
          kind: "workout_batch" as const,
          id: importId,
          partition: fixture.source,
        };
        const rawDirectory = resolveRawAssetDirectory({ owner, occurredAt: importedAt });
        const rawFile = path.posix.join(rawDirectory, `${fixture.source}.csv`);
        const manifestFile = path.posix.join(rawDirectory, "manifest.json");
        const manifest = buildRawImportManifest({
          importId,
          importKind: "workout_batch",
          importedAt,
          owner,
          source: fixture.source,
          rawDirectory,
          artifacts: [{
            role: "source",
            relativePath: rawFile,
            originalFileName: `${fixture.source}.csv`,
            mediaType: "text/csv",
            byteSize: new TextEncoder().encode(fixture.text).byteLength,
            sha256: createHash("sha256").update(fixture.text).digest("hex"),
          }],
          provenance: { source: fixture.source },
        });
        await coreRuntime.applyCanonicalWriteBatch({
          vaultRoot: tempDir,
          operationType: "workout_import_csv_raw",
          summary: "Seed a legacy workout import.",
          audit: {
            action: "workout_import_csv",
            commandName: "test.seedLegacyWorkoutImport",
            summary: "Seeded a legacy workout import.",
          },
          rawContents: [{
            targetRelativePath: rawFile,
            content: fixture.text,
            originalFileName: `${fixture.source}.csv`,
            mediaType: "text/csv",
          }, {
            targetRelativePath: manifestFile,
            content: `${JSON.stringify(manifest, null, 2)}\n`,
            originalFileName: "manifest.json",
            mediaType: "application/json",
          }],
        });

        const plan = importersRuntime.planWorkoutCsvImport({
          text: fixture.text,
          timeZone: "America/Chicago",
          source: fixture.source,
          ...(fixture.weightUnit ? { weightUnit: fixture.weightUnit } : {}),
          ...(fixture.distanceUnit ? { distanceUnit: fixture.distanceUnit } : {}),
        });
        const legacyPlan = fixture.legacyUnitless
          ? importersRuntime.planWorkoutCsvImport({
              text: fixture.text,
              timeZone: "America/Chicago",
              source: fixture.source,
            })
          : plan;
        assert.equal(plan.sessions.length, fixture.legacyOccurredAts.length);
        const legacyResourceIds = plan.sessions.map((session, index) => {
          const legacyOccurredAt = fixture.legacyOccurredAts[index];
          assert.ok(legacyOccurredAt);
          assert.notEqual(session.occurredAt, legacyOccurredAt);
          return `${legacyOccurredAt}::${session.title}`;
        });
        const legacy = await coreRuntime.importEventBatch({
          vaultRoot: tempDir,
          decisions: legacyPlan.sessions.map((session, index) => {
            const legacyOccurredAt = fixture.legacyOccurredAts[index];
            const legacyResourceId = legacyResourceIds[index];
            assert.ok(legacyOccurredAt);
            assert.ok(legacyResourceId);
            const draft = workoutModule.buildStructuredWorkoutActivitySessionDraft({
              payload: {
                title: session.title,
                occurredAt: legacyOccurredAt,
                timeZone: "UTC",
                source: "import",
                activityType: "strength-training",
                ...(session.durationMinutes ? { durationMinutes: session.durationMinutes } : {}),
                ...(session.distanceKm ? { distanceKm: session.distanceKm } : {}),
                ...(session.note ? { note: session.note } : {}),
                rawRefs: [rawFile],
                externalRef: {
                  system: fixture.source,
                  resourceType: "workout-session",
                  resourceId: legacyResourceId,
                  ...(fixture.legacyVersion ? { version: fixture.legacyVersion } : {}),
                },
                workout: {
                  ...session.workout,
                  startedAt: legacyOccurredAt,
                },
              } as JsonObject,
              source: "import",
            });
            return { action: "upsert", payload: { kind: "activity_session", ...draft } };
          }),
          apply: true,
        });
        const legacyEventIds = legacy.eventIds;
        assert.equal(legacyEventIds.length, plan.sessions.length);
        if (fixture.legacyUnitless) {
          await editEventRecord({
            vault: tempDir,
            lookup: legacyEventIds[0]!,
            entityLabel: "workout session",
            expectedKinds: ["activity_session"],
            set: [
              'tags=["member-edit"]',
              'workout.media=[{"kind":"photo","relativePath":"raw/workouts/member-edit.jpg"}]',
            ],
          });
        }
        const rawFilesBefore = await coreRuntime.walkVaultFiles(tempDir, "raw/workouts");
        const expandedText = [
          fixture.text.trimEnd().replaceAll("10:00:00", "10:00"),
          fixture.source === "strong"
            ? "2026-05-01 09:00:00,New Session,30m,Press,1,50,8,0,0,,,"
            : "New Session,2026-05-01,09:00:00,30,Press,1,50,kg,8,,,normal,0,0,0",
          "",
        ].join("\n");
        const expandedPath = path.join(tempDir, `${fixture.source}-expanded.csv`);
        await writeFile(expandedPath, expandedText, "utf8");

        const workoutImportModule = (await importWithMocks(
          "../src/usecases/workout-import.ts",
          {
            "../src/runtime-import.js": () => ({
              loadRuntimeModule: vi.fn(async (specifier: string) => {
                if (specifier === "@murphai/core") return coreRuntime;
                if (specifier === "@murphai/importers") return importersRuntime;
                if (specifier === "@murphai/runtime-state") {
                  return { generateUlid: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
                }
                throw new Error(`Unexpected runtime module: ${specifier}`);
              }),
            }),
          },
        )) as typeof import("../src/usecases/workout-import.ts");

        const migrationInput = {
          vault: tempDir,
          file: csvPath,
          source: fixture.source,
          ...(fixture.weightUnit ? { weightUnit: fixture.weightUnit } : {}),
          ...(fixture.distanceUnit ? { distanceUnit: fixture.distanceUnit } : {}),
        };
        if (fixture.legacyUnitless) {
          const auditRowsBeforeRejectedExpansion = await countAuditRows(tempDir);
          const eventRowsBeforeRejectedExpansion = await coreRuntime.readJsonlRecords({
            vaultRoot: tempDir,
            relativePath: legacy.eventShardPaths[0]!,
          });
          await assert.rejects(
            workoutImportModule.importWorkoutCsv({
              ...migrationInput,
              file: expandedPath,
            }),
            /exact original CSV with --correct-units/u,
          );
          assert.equal(await countAuditRows(tempDir), auditRowsBeforeRejectedExpansion);
          assert.equal((await coreRuntime.readJsonlRecords({
            vaultRoot: tempDir,
            relativePath: legacy.eventShardPaths[0]!,
          })).length, eventRowsBeforeRejectedExpansion.length);
          assert.deepEqual(
            await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
            rawFilesBefore,
          );
          await assert.rejects(
            workoutImportModule.importWorkoutCsv(migrationInput),
            /rerun with --correct-units/u,
          );
        }
        const migrated = await workoutImportModule.importWorkoutCsv({
          ...migrationInput,
          ...(fixture.legacyUnitless ? { correctUnits: true } : {}),
        });
        assert.equal(migrated.createdCount, 0);
        assert.equal(migrated.supersededCount, plan.sessions.length);
        assert.equal(migrated.rawStored, false);
        assert.equal(migrated.rawFile, rawFile);
        assert.equal(migrated.manifestFile, null);
        assert.deepEqual(migrated.lookupIds, legacyEventIds);
        assert.deepEqual(
          await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
          rawFilesBefore,
        );
        if (fixture.legacyUnitless) {
          const correctedLegacy = await coreRuntime.findEventByExternalRef({
            vaultRoot: tempDir,
            system: fixture.source,
            resourceType: "workout-session",
            resourceId: legacyResourceIds[0]!,
          });
          assert.equal(
            correctedLegacy?.kind === "activity_session"
              ? correctedLegacy.workout.exercises[0]?.sets[0]?.weightUnit
              : undefined,
            "lb",
          );
          assert.equal(
            correctedLegacy?.kind === "activity_session"
              ? correctedLegacy.distanceKm
              : undefined,
            2.414016,
          );
          assert.deepEqual(correctedLegacy?.tags, ["member-edit"]);
          assert.deepEqual(
            correctedLegacy?.kind === "activity_session"
              ? correctedLegacy.workout.media
              : undefined,
            [{
              kind: "photo",
              relativePath: "raw/workouts/member-edit.jpg",
            }],
          );
        }

        const replay = await workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          source: fixture.source,
          ...(fixture.weightUnit ? { weightUnit: fixture.weightUnit } : {}),
          ...(fixture.distanceUnit ? { distanceUnit: fixture.distanceUnit } : {}),
        });
        assert.equal(replay.importedCount, 0);
        assert.equal(replay.skippedExistingCount, plan.sessions.length);
        assert.equal(replay.rawStored, false);
        await coreRuntime.updateVaultSummary({
          vaultRoot: tempDir,
          timezone: "America/Los_Angeles",
        });
        const replayAfterTimezoneChange = await workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          source: fixture.source,
          ...(fixture.weightUnit ? { weightUnit: fixture.weightUnit } : {}),
          ...(fixture.distanceUnit ? { distanceUnit: fixture.distanceUnit } : {}),
        });
        assert.equal(replayAfterTimezoneChange.importedCount, 0);
        assert.equal(replayAfterTimezoneChange.skippedExistingCount, plan.sessions.length);
        assert.equal(replayAfterTimezoneChange.rawStored, false);
        assert.deepEqual(
          await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
          rawFilesBefore,
        );
        await coreRuntime.updateVaultSummary({
          vaultRoot: tempDir,
          timezone: "Europe/London",
        });
        const replayAfterSecondTimezoneChange = await workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: csvPath,
          source: fixture.source,
          ...(fixture.weightUnit ? { weightUnit: fixture.weightUnit } : {}),
          ...(fixture.distanceUnit ? { distanceUnit: fixture.distanceUnit } : {}),
        });
        assert.equal(replayAfterSecondTimezoneChange.importedCount, 0);
        assert.equal(
          replayAfterSecondTimezoneChange.skippedExistingCount,
          plan.sessions.length,
        );
        assert.equal(replayAfterSecondTimezoneChange.rawStored, false);
        assert.deepEqual(
          await coreRuntime.walkVaultFiles(tempDir, "raw/workouts"),
          rawFilesBefore,
        );
        const currentRecords = await Promise.all(legacyResourceIds.map((resourceId) =>
          coreRuntime.findEventByExternalRef({
            vaultRoot: tempDir,
            system: fixture.source,
            resourceType: "workout-session",
            resourceId,
          })));
        assert.deepEqual(currentRecords.map((record) => record?.id), legacyEventIds);
        const duplicateRecords = await Promise.all(plan.sessions.map((session) =>
          coreRuntime.findEventByExternalRef({
            vaultRoot: tempDir,
            system: fixture.source,
            resourceType: "workout-session",
            resourceId: session.sourceWorkoutId,
          })));
        assert.deepEqual(duplicateRecords, plan.sessions.map(() => null));

        const expanded = await workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: expandedPath,
          source: fixture.source,
          ...(fixture.weightUnit ? { weightUnit: fixture.weightUnit } : {}),
          ...(fixture.distanceUnit ? { distanceUnit: fixture.distanceUnit } : {}),
        });
        assert.equal(expanded.createdCount, 1);
        assert.equal(expanded.supersededCount, 0);
        assert.equal(expanded.skippedExistingCount, plan.sessions.length);
        assert.equal(expanded.rawStored, true);
        const expandedReplay = await workoutImportModule.importWorkoutCsv({
          vault: tempDir,
          file: expandedPath,
          source: fixture.source,
          ...(fixture.weightUnit ? { weightUnit: fixture.weightUnit } : {}),
          ...(fixture.distanceUnit ? { distanceUnit: fixture.distanceUnit } : {}),
        });
        assert.equal(expandedReplay.importedCount, 0);
        assert.equal(expandedReplay.skippedExistingCount, plan.sessions.length + 1);
        assert.equal(expandedReplay.rawStored, false);
        const retainedRecords = await Promise.all(legacyResourceIds.map((resourceId) =>
          coreRuntime.findEventByExternalRef({
            vaultRoot: tempDir,
            system: fixture.source,
            resourceType: "workout-session",
            resourceId,
          })));
        assert.deepEqual(retainedRecords.map((record) => record?.id), legacyEventIds);
        if (fixture.source === "hevy") {
          const current = currentRecords[0];
          if (!current || current.kind !== "activity_session") {
            throw new Error("Expected the reconciled Hevy event to be an activity session.");
          }
          assert.equal(current?.workout?.exercises[0]?.note, "Controlled");
          assert.equal(current.distanceKm, 1);
          assert.equal(current.workout?.exercises[0]?.sets[0]?.bodyweightKg, 80);
          assert.equal(current.workout?.exercises[0]?.sets[0]?.assistanceKg, 10);
          assert.deepEqual(
            current?.workout?.exercises[0]?.sets.map((set) => [set.order, set.type]),
            [[2, "warmup"], [1, "dropset"]],
          );
        }
      });
    }
  });
});
