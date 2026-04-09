import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, test } from "vitest";

import {
  addActivitySession,
  addBodyMeasurement,
  addMeal,
  acquireCanonicalWriteLock,
  checkpointExperiment,
  applyCanonicalWriteBatch,
  buildActivitySessionEventDraft,
  buildBodyMeasurementEventDraft,
  buildInterventionSessionEventDraft,
  buildMedicationIntakeEventDraft,
  buildNoteEventDraft,
  buildObservationEventDraft,
  buildPublicEventRecord,
  buildSleepSessionEventDraft,
  buildSupplementIntakeEventDraft,
  buildSymptomEventDraft,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
  createExperiment,
  deleteEvent,
  importDocument,
  initializeVault,
  listWriteOperationMetadataPaths,
  parseFrontmatterDocument,
  promoteInboxExperimentNote,
  promoteInboxJournal,
  readJsonlRecords,
  readStoredWriteOperation,
  stopExperiment,
  updateExperiment,
  upsertEvent,
  validateVault,
  VaultError,
} from "../src/index.ts";

const tempRoots: string[] = [];

async function makeTempDirectory(name: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  tempRoots.push(directory);
  return directory;
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function withEnvOverride<T>(
  name: string,
  value: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = process.env[name];

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return await operation();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((directory) =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("applyCanonicalWriteBatch records raw contents without receipts and protected deletes with receipts", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-batch");
  const receiptRoot = await makeTempDirectory("murph-core-batch-receipts");
  await initializeVault({ vaultRoot });

  const deletePath = "bank/thresholds/delete-target.md";
  const deleteAbsolutePath = path.join(vaultRoot, deletePath);
  await fs.mkdir(path.dirname(deleteAbsolutePath), { recursive: true });
  await fs.writeFile(deleteAbsolutePath, "delete me\n", "utf8");

  const rawTextPath = "raw/testing/fixed/raw-text.txt";
  const rawBytesPath = "raw/testing/fixed/raw-bytes.bin";

  const result = await withEnvOverride(
    "MURPH_CANONICAL_WRITE_GUARD_RECEIPT_DIR",
    receiptRoot,
    () =>
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "test_raw_content_and_delete_receipt_shapes",
        summary: "stage raw content and a protected delete",
        rawContents: [
          {
            targetRelativePath: rawTextPath,
            content: "raw text\n",
            originalFileName: "raw-text.txt",
            mediaType: "text/plain",
          },
          {
            targetRelativePath: rawBytesPath,
            content: Buffer.from("raw bytes\n", "utf8"),
            originalFileName: "raw-bytes.bin",
            mediaType: "application/octet-stream",
          },
        ],
        deletes: [
          {
            relativePath: deletePath,
          },
        ],
      }),
  );

  assert.deepEqual(result.rawContents, [rawTextPath, rawBytesPath]);
  assert.deepEqual(result.deletes, [deletePath]);
  assert.equal(await fs.readFile(path.join(vaultRoot, rawTextPath), "utf8"), "raw text\n");
  assert.equal((await fs.readFile(path.join(vaultRoot, rawBytesPath))).toString("utf8"), "raw bytes\n");
  await assert.rejects(() => fs.access(deleteAbsolutePath));

  const operations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );
  const operation = operations.find(
    (candidate) => candidate.operationType === "test_raw_content_and_delete_receipt_shapes",
  );

  assert.ok(operation);
  assert.equal(operation.status, "committed");
  assert.equal(operation.actions[0]?.kind, "raw_copy");
  assert.equal("committedPayloadReceipt" in (operation.actions[0] ?? {}), false);
  assert.equal(operation.actions[2]?.kind, "delete");

  const receipt = JSON.parse(
    await fs.readFile(path.join(receiptRoot, `${operation.operationId}.json`), "utf8"),
  ) as {
    actions?: Array<{ kind: string; targetRelativePath: string }>;
  };
  assert.equal(receipt.actions?.length, 1);
  assert.deepEqual(receipt.actions?.[0], {
    kind: "delete",
    targetRelativePath: deletePath,
  });
});

test("validateVault reports stale canonical-write locks", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-stale-lock");
  await initializeVault({ vaultRoot });

  const lock = await acquireCanonicalWriteLock(vaultRoot);
  const host = lock.metadata.host;
  await lock.release();

  await fs.mkdir(path.join(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
    `${JSON.stringify(
      {
        pid: 999_999,
        command: "stale-lock-holder",
        startedAt: "2026-04-08T00:00:00.000Z",
        host,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "CANONICAL_WRITE_LOCK_STALE" &&
        issue.path === CANONICAL_WRITE_LOCK_DIRECTORY &&
        issue.severity === "error",
    ),
  );
  assert.ok(validation.issues.some((issue) => issue.message.includes("no longer running")));
});

test("attachment-free and attachment-backed event writes stay honest and deleteEvent retains the backing raw path", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-event-thresholds");
  const sourceRoot = await makeTempDirectory("murph-core-event-thresholds-source");
  await initializeVault({ vaultRoot });

  const activitySession = await addActivitySession({
    vaultRoot,
    draft: buildActivitySessionEventDraft({
      occurredAt: new Date("2026-03-12T08:15:00.000Z"),
      title: "Strength session",
      activityType: "strength-training",
      durationMinutes: 45,
      workout: {
        exercises: [],
      },
    }),
  });

  assert.equal(activitySession.manifestPath, null);
  assert.deepEqual(activitySession.event.attachments ?? [], []);
  assert.deepEqual(activitySession.event.rawRefs ?? [], []);
  assert.deepEqual(activitySession.event.workout.media ?? [], []);

  const photoPath = await writeExternalFile(sourceRoot, "front.jpg", "photo");
  const bodyMeasurement = await addBodyMeasurement({
    vaultRoot,
    draft: buildBodyMeasurementEventDraft({
      occurredAt: new Date("2026-03-12T08:20:00.000Z"),
      title: "Weekly check-in",
      measurements: [
        {
          type: "weight",
          value: 182.4,
          unit: "lb",
        },
      ],
    }),
    attachments: [
      {
        role: "media_1",
        sourcePath: photoPath,
      },
    ],
  });

  const retainedPath = bodyMeasurement.event.attachments?.[0]?.relativePath;

  assert.ok(bodyMeasurement.manifestPath);
  assert.equal(bodyMeasurement.event.attachments?.length, 1);
  assert.equal(bodyMeasurement.event.rawRefs?.includes(retainedPath ?? ""), true);
  assert.equal(bodyMeasurement.event.media?.[0]?.relativePath, retainedPath);
  assert.equal(bodyMeasurement.event.media?.[0]?.kind, "photo");
  assert.ok(retainedPath);

  const deleted = await deleteEvent({
    vaultRoot,
    eventId: bodyMeasurement.event.id,
  });

  assert.equal(deleted.deleted, true);
  assert.equal(deleted.kind, "body_measurement");
  assert.deepEqual(deleted.retainedPaths, [retainedPath]);
});

test("document deletes retain canonical attachment paths and repeated deletes reject missing events", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-document-delete-thresholds");
  const sourceRoot = await makeTempDirectory("murph-core-document-delete-thresholds-source");
  await initializeVault({ vaultRoot });

  const sourcePath = await writeExternalFile(sourceRoot, "source-document.txt", "document");
  const document = await importDocument({
    vaultRoot,
    sourcePath,
    title: "Source document",
    note: "Document import for deletion coverage.",
  });

  assert.deepEqual(document.event.rawRefs, [document.raw.relativePath]);

  const deleted = await deleteEvent({
    vaultRoot,
    eventId: document.event.id,
  });

  assert.equal(deleted.deleted, true);
  assert.equal(deleted.kind, "document");
  assert.ok(deleted.retainedPaths.includes(document.raw.relativePath));

  await assert.rejects(
    () =>
      deleteEvent({
        vaultRoot,
        eventId: document.event.id,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_MISSING",
  );

  await assert.rejects(
    () =>
      deleteEvent({
        vaultRoot,
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1ZZ",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_MISSING",
  );
});

test("specialized event rewrites reject cross-kind updates and meal deletes retain canonical attachment paths", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-event-rewrite-thresholds");
  const sourceRoot = await makeTempDirectory("murph-core-event-rewrite-thresholds-source");
  await initializeVault({ vaultRoot });

  const eventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1A1";
  const activitySession = await addActivitySession({
    vaultRoot,
    draft: buildActivitySessionEventDraft({
      id: eventId,
      occurredAt: new Date("2026-03-12T08:15:00.000Z"),
      title: "Strength session",
      activityType: "strength-training",
      durationMinutes: 45,
      workout: {
        exercises: [],
      },
    }),
  });

  assert.equal(activitySession.created, true);
  assert.equal(activitySession.event.id, eventId);

  await assert.rejects(
    () =>
      addBodyMeasurement({
        vaultRoot,
        draft: buildBodyMeasurementEventDraft({
          id: eventId,
          occurredAt: new Date("2026-03-12T08:20:00.000Z"),
          title: "Weekly check-in",
          measurements: [
            {
              type: "weight",
              value: 182.4,
              unit: "lb",
            },
          ],
        }),
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_KIND_INVALID",
  );

  const photoPath = await writeExternalFile(sourceRoot, "meal-photo.jpg", "photo");
  const audioPath = await writeExternalFile(sourceRoot, "meal-audio.m4a", "audio");
  const meal = await addMeal({
    vaultRoot,
    occurredAt: "2026-03-12T12:00:00.000Z",
    note: "Lunch",
    photoPath,
    audioPath,
  });

  const mealAttachmentPaths = meal.event.attachments?.map((attachment) => attachment.relativePath) ?? [];
  const expectedRetainedPaths = [...new Set([
    ...mealAttachmentPaths,
    ...(meal.event.rawRefs ?? []),
  ])].sort((left, right) => left.localeCompare(right));

  assert.equal(meal.event.attachments?.length, 2);
  assert.equal(meal.event.rawRefs?.length, 2);

  const deleted = await deleteEvent({
    vaultRoot,
    eventId: meal.event.id,
  });

  assert.equal(deleted.deleted, true);
  assert.equal(deleted.kind, "meal");
  assert.deepEqual(deleted.retainedPaths, expectedRetainedPaths);
});

test("specialized event upserts reject cold writes and permit rewrites against an existing meal event", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-specialized-rewrite");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          kind: "meal",
          occurredAt: "2026-03-14T12:00:00.000Z",
          title: "Rejected meal",
        },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_KIND_INVALID",
  );

  const meal = await addMeal({
    vaultRoot,
    occurredAt: "2026-03-14T18:30:00.000Z",
    note: "Original dinner",
  });

  const rewritten = await upsertEvent({
    vaultRoot,
    allowSpecializedKindRewrite: true,
    payload: {
      ...meal.event,
      note: "Rewritten dinner",
    },
  });

  const rewrittenRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: meal.eventPath,
  });

  assert.equal(rewritten.created, false);
  assert.equal(rewritten.ledgerFile, meal.eventPath);
  assert.equal(rewrittenRecords.length, 2);
});

test("public event builders cover the remaining kind-specific branches and validation failures", async () => {
  const occurredAt = "2026-03-14T08:00:00.000Z";

  const note = buildPublicEventRecord(
    buildNoteEventDraft({
      occurredAt,
      title: "Morning note",
      note: "  keep  ",
    }),
  );
  const symptom = buildPublicEventRecord(
    buildSymptomEventDraft({
      occurredAt,
      title: "Headache",
      symptom: "headache",
      intensity: 3,
      bodySite: "forehead",
    }),
  );
  const observation = buildPublicEventRecord(
    buildObservationEventDraft({
      occurredAt,
      title: "Blood pressure",
      metric: "blood-pressure-systolic",
      value: 120,
      unit: "mmHg",
    }),
  );
  const medication = buildPublicEventRecord(
    buildMedicationIntakeEventDraft({
      occurredAt,
      title: "Morning meds",
      medicationName: "Metformin",
      dose: 500,
      unit: "mg",
    }),
  );
  const supplement = buildPublicEventRecord(
    buildSupplementIntakeEventDraft({
      occurredAt,
      title: "Supplement",
      supplementName: "Creatine",
      dose: 5,
      unit: "g",
    }),
  );
  const sleep = buildPublicEventRecord(
    buildSleepSessionEventDraft({
      occurredAt,
      title: "Sleep block",
      startAt: "2026-03-13T22:00:00.000Z",
      endAt: "2026-03-14T06:00:00.000Z",
      durationMinutes: 480,
    }),
  );
  const intervention = buildPublicEventRecord(
    buildInterventionSessionEventDraft({
      occurredAt,
      title: "Breathing session",
      interventionType: "breathing",
      durationMinutes: 12,
      protocolId: "prot_01JNV45XJ4M22V2PE9Q4KQ7H1X",
    }),
  );

  assert.equal(note.kind, "note");
  assert.equal(note.note, "keep");
  assert.equal(symptom.kind, "symptom");
  assert.equal(symptom.symptom, "headache");
  assert.equal(symptom.intensity, 3);
  assert.equal(observation.kind, "observation");
  assert.equal(observation.metric, "blood-pressure-systolic");
  assert.equal(observation.value, 120);
  assert.equal(medication.kind, "medication_intake");
  assert.equal(medication.medicationName, "Metformin");
  assert.equal(supplement.kind, "supplement_intake");
  assert.equal(supplement.supplementName, "Creatine");
  assert.equal(sleep.kind, "sleep_session");
  assert.equal(sleep.durationMinutes, 480);
  assert.equal(intervention.kind, "intervention_session");
  assert.equal(intervention.protocolId, "prot_01JNV45XJ4M22V2PE9Q4KQ7H1X");

  assert.throws(() => {
    buildPublicEventRecord(
      buildNoteEventDraft({
        occurredAt,
        title: "   ",
        note: "present",
      }),
    );
  }, (error: unknown) => error instanceof VaultError && error.code === "INVALID_INPUT");

  assert.throws(() => {
    buildPublicEventRecord(
      buildNoteEventDraft({
        occurredAt: "not-a-timestamp",
        title: "Bad timestamp",
        note: "present",
      }),
    );
  }, (error: unknown) => error instanceof VaultError && error.code === "INVALID_TIMESTAMP");
});

test("generic event upserts cover payload and draft writes plus validation gates", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-generic-upsert-thresholds");
  await initializeVault({ vaultRoot });

  const payloadEventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1A2";
  const payloadWrite = await upsertEvent({
    vaultRoot,
    payload: {
      id: payloadEventId,
      kind: "note",
      occurredAt: "2026-03-14T09:00:00.000Z",
      title: "Payload note",
      note: "first pass",
      tags: ["alpha", " alpha "],
    },
  });
  const payloadRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: payloadWrite.ledgerFile,
  });
  const payloadRecord = payloadRecords.find((record) => record.id === payloadEventId);

  assert.equal(payloadWrite.created, true);
  assert.ok(payloadRecord);
  assert.equal(payloadRecord?.kind, "note");
  assert.equal(payloadRecord?.note, "first pass");
  assert.deepEqual(payloadRecord?.tags, ["alpha"]);

  const payloadRewrite = await upsertEvent({
    vaultRoot,
    payload: {
      id: payloadEventId,
      kind: "note",
      occurredAt: "2026-03-14T09:15:00.000Z",
      title: "Payload note",
      note: "updated pass",
    },
  });
  const rewrittenRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: payloadRewrite.ledgerFile,
  });

  assert.equal(payloadRewrite.created, false);
  assert.equal(rewrittenRecords.filter((record) => record.id === payloadEventId).length, 2);

  const draftEventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1A3";
  const draftWrite = await upsertEvent({
    vaultRoot,
    draft: buildSleepSessionEventDraft({
      id: draftEventId,
      occurredAt: "2026-03-15T22:00:00.000Z",
      title: "Sleep session",
      startAt: "2026-03-15T22:00:00.000Z",
      endAt: "2026-03-16T06:00:00.000Z",
      durationMinutes: 480,
    }),
  });
  const draftRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: draftWrite.ledgerFile,
  });
  const draftRecord = draftRecords.find((record) => record.id === draftEventId);

  assert.equal(draftWrite.created, true);
  assert.ok(draftRecord);
  assert.equal(draftRecord?.kind, "sleep_session");
  assert.equal(draftRecord?.durationMinutes, 480);

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          kind: "bogus",
          occurredAt: "2026-03-14T10:00:00.000Z",
          title: "Bad kind",
        },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_KIND_INVALID",
  );

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          kind: "note",
          title: "Missing occurredAt",
        },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_OCCURRED_AT_MISSING",
  );

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        draft: buildNoteEventDraft({
          occurredAt: "2026-03-14T10:00:00.000Z",
          title: "   ",
          note: "present",
        }),
      }),
    (error: unknown) => error instanceof VaultError && error.code === "INVALID_INPUT",
  );
});

test("attachment-backed event writes cover raw-import and rewrite branches", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-attachment-event-thresholds");
  const sourceRoot = await makeTempDirectory("murph-core-attachment-event-thresholds-source");
  await initializeVault({ vaultRoot });

  const activityId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1AA";
  const activityPhoto = await writeExternalFile(sourceRoot, "activity-photo.jpg", "activity-photo");
  const activityVideo = await writeExternalFile(sourceRoot, "activity-video.mp4", "activity-video");
  const firstActivity = await addActivitySession({
    vaultRoot,
    draft: buildActivitySessionEventDraft({
      id: activityId,
      occurredAt: "2026-03-14T06:00:00.000Z",
      title: "Morning workout",
      activityType: "strength-training",
      durationMinutes: 55,
      workout: {
        exercises: [],
      },
    }),
    attachments: [
      {
        role: "media_1",
        sourcePath: activityPhoto,
      },
      {
        role: "media_2",
        sourcePath: activityVideo,
      },
    ],
    rawImport: {
      importId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1BA",
      importKind: "workout_batch",
      importedAt: "2026-03-14T06:05:00.000Z",
      source: "wearable",
      provenance: {
        source: "activity-feed",
        mediaCount: 2,
      },
    },
  });
  const firstActivityRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: firstActivity.ledgerFile,
  });

  assert.equal(firstActivity.created, true);
  assert.ok(firstActivity.manifestPath);
  assert.equal(firstActivity.event.attachments?.length, 2);
  assert.equal(firstActivityRecords.filter((record) => record.id === activityId).length, 1);

  const secondActivity = await addActivitySession({
    vaultRoot,
    draft: buildActivitySessionEventDraft({
      id: activityId,
      occurredAt: "2026-03-14T06:30:00.000Z",
      title: "Morning workout rewrite",
      activityType: "strength-training",
      durationMinutes: 60,
      workout: {
        exercises: [],
      },
    }),
  });
  const secondActivityRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: secondActivity.ledgerFile,
  });

  assert.equal(secondActivity.created, false);
  assert.equal(secondActivityRecords.filter((record) => record.id === activityId).length, 2);

  const measurementId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1AB";
  const measurementImage = await writeExternalFile(
    sourceRoot,
    "measurement-photo.jpg",
    "measurement-photo",
  );
  const firstMeasurement = await addBodyMeasurement({
    vaultRoot,
    draft: buildBodyMeasurementEventDraft({
      id: measurementId,
      occurredAt: "2026-03-14T07:00:00.000Z",
      title: "Weigh-in",
      measurements: [
        {
          type: "weight",
          value: 180.2,
          unit: "lb",
        },
      ],
    }),
    attachments: [
      {
        role: "media_1",
        sourcePath: measurementImage,
      },
    ],
    rawImport: {
      importId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1BB",
      importKind: "measurement_batch",
      importedAt: "2026-03-14T07:05:00.000Z",
      source: "scale",
      provenance: {
        source: "measurement-feed",
        mediaCount: 1,
      },
    },
  });
  const firstMeasurementRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: firstMeasurement.ledgerFile,
  });

  assert.equal(firstMeasurement.created, true);
  assert.ok(firstMeasurement.manifestPath);
  assert.equal(firstMeasurement.event.attachments?.length, 1);
  assert.equal(firstMeasurementRecords.filter((record) => record.id === measurementId).length, 1);

  const secondMeasurement = await addBodyMeasurement({
    vaultRoot,
    draft: buildBodyMeasurementEventDraft({
      id: measurementId,
      occurredAt: "2026-03-14T07:30:00.000Z",
      title: "Weigh-in rewrite",
      measurements: [
        {
          type: "weight",
          value: 179.8,
          unit: "lb",
        },
      ],
    }),
  });
  const secondMeasurementRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: secondMeasurement.ledgerFile,
  });

  assert.equal(secondMeasurement.created, false);
  assert.equal(secondMeasurementRecords.filter((record) => record.id === measurementId).length, 2);
});

test("promotion blocks preserve actor id fallbacks and attachment label fallbacks", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-promotion-thresholds");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "promotion-lane",
    title: "Promotion Lane",
    startedOn: "2026-03-10T08:00:00.000Z",
  });

  const capture = {
    captureId: "cap_01JQ9R7WF97M1WAB2B4QF2Q1PM",
    eventId: "evt_01JQ9R7WF97M1WAB2B4QF2Q1PM",
    source: "signal",
    occurredAt: "2026-03-13T08:30:00.000Z",
    text: "   ",
    thread: {
      id: "thread-rich",
    },
    actor: {
      id: "contact-42",
      displayName: "   ",
    },
    attachments: [
      {
        attachmentId: "att-1",
        ordinal: 1,
        kind: "document",
        fileName: "report.pdf",
      },
      {
        attachmentId: "att-2",
        ordinal: 2,
        kind: "image",
        storedPath: "raw/promotion/image.jpg",
      },
      {
        attachmentId: "att-3",
        ordinal: 3,
        kind: "audio",
        originalPath: "legacy/audio.m4a",
      },
      {
        attachmentId: "att-4",
        ordinal: 4,
        kind: "video",
        externalId: "external-4",
      },
      {
        attachmentId: "att-5",
        ordinal: 5,
        kind: "other",
      },
    ],
  } satisfies Parameters<typeof promoteInboxJournal>[0]["capture"];

  const journalPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture,
  });
  const experimentPromotion = await promoteInboxExperimentNote({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    capture,
  });

  const journalMarkdown = await fs.readFile(path.join(vaultRoot, journalPromotion.journalPath), "utf8");
  const experimentMarkdown = await fs.readFile(
    path.join(vaultRoot, created.experiment.relativePath),
    "utf8",
  );

  assert.equal(journalPromotion.appended, true);
  assert.equal(experimentPromotion.appended, true);
  assert.match(journalMarkdown, /Thread: thread-rich/u);
  assert.match(journalMarkdown, /Actor: contact-42/u);
  assert.match(journalMarkdown, /- att-1 \| document \| report\.pdf/u);
  assert.match(journalMarkdown, /- att-2 \| image \| raw\/promotion\/image\.jpg/u);
  assert.match(journalMarkdown, /- att-3 \| audio \| legacy\/audio\.m4a/u);
  assert.match(journalMarkdown, /- att-4 \| video \| external-4/u);
  assert.match(journalMarkdown, /- att-5 \| other \| attachment-5/u);
  assert.match(experimentMarkdown, /Experiment: promotion-lane/u);
});

test("experiment lifecycle variants preserve status transitions and inbox promotion rewrites stay gated", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-experiment-thresholds");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "metabolic-reset",
    title: "Metabolic Reset",
    startedOn: "2026-03-11T08:00:00.000Z",
    status: "planned",
  });
  await updateExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    body: "",
  });
  const checkpoint = await checkpointExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    occurredAt: "2026-03-11T12:00:00.000Z",
    title: "Checkpoint",
    note: "Routine is stable.",
  });
  const stopped = await stopExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    occurredAt: "2026-03-12T18:45:00.000Z",
    title: "Stopped",
    note: "The sprint is complete.",
  });

  assert.equal(created.created, true);
  assert.equal(checkpoint.status, "planned");
  assert.equal(stopped.status, "completed");

  const experimentDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, created.experiment.relativePath), "utf8"),
  );

  assert.equal(experimentDocument.attributes.status, "completed");
  assert.equal(experimentDocument.attributes.endedOn, "2026-03-12");
  assert.match(experimentDocument.body, /^## Notes\n\n### Checkpoint/u);
  assert.match(experimentDocument.body, /Checkpoint/u);
  assert.match(experimentDocument.body, /The sprint is complete\./u);

  const capture = {
    captureId: "cap_01JNV422Y2M5ZBV64ZP4N1DRB1",
    eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB2",
    source: "imessage",
    occurredAt: "2026-03-13T08:00:00.000Z",
    text: "Breakfast note from inbox",
    thread: {
      id: "thread-1",
      title: "Breakfast Thread",
    },
    actor: {
      id: "contact-1",
      displayName: "Breakfast Buddy",
    },
    attachments: [],
  };

  const firstJournalPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture,
  });
  const secondJournalPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture,
  });
  const firstExperimentPromotion = await promoteInboxExperimentNote({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    capture,
  });
  const secondExperimentPromotion = await promoteInboxExperimentNote({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    capture,
  });

  assert.equal(firstJournalPromotion.appended, true);
  assert.equal(secondJournalPromotion.appended, false);
  assert.equal(secondJournalPromotion.linked, false);
  assert.equal(firstExperimentPromotion.appended, true);
  assert.equal(secondExperimentPromotion.appended, false);

  const journalMarkdown = await fs.readFile(path.join(vaultRoot, firstJournalPromotion.journalPath), "utf8");
  const experimentMarkdown = await fs.readFile(path.join(vaultRoot, created.experiment.relativePath), "utf8");

  assert.equal(journalMarkdown.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1, 1);
  assert.equal(experimentMarkdown.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1, 1);
  assert.match(experimentMarkdown, /## Inbox Experiment Notes/u);
});

test("experiment lifecycle helpers reject invalid timestamps before appending note blocks", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-experiment-timestamp-thresholds");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "timestamp-check",
    title: "Timestamp Check",
    startedOn: "2026-03-11T08:00:00.000Z",
  });

  await assert.rejects(
    () =>
      checkpointExperiment({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        occurredAt: "not-a-timestamp",
        title: "Checkpoint",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "INVALID_TIMESTAMP",
  );

  await assert.rejects(
    () =>
      stopExperiment({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        occurredAt: "not-a-timestamp",
        title: "Stopped",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "INVALID_TIMESTAMP",
  );
});
