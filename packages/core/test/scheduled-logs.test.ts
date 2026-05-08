import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import {
  buildScheduledLogMarkdownPreview,
  executeScheduledLogOccurrence,
  findEventByExternalRef,
  initializeVault,
  listScheduledLogs,
  readScheduledLog,
  readScheduledLogMarkdown,
  scaffoldScheduledLogPayload,
  setScheduledLogStatus,
  showScheduledLog,
  upsertFood,
  upsertScheduledLog,
  VaultError,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await fs.writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

test("scheduled logs support preview, filters, renames, conflicts, and status changes", async () => {
  const vaultRoot = await makeTempDirectory("murph-scheduled-logs");
  await initializeVault({ vaultRoot });

  const preview = buildScheduledLogMarkdownPreview(scaffoldScheduledLogPayload());
  assert.match(preview, /schemaVersion: murph\.frontmatter\.scheduled-log\.v1/);
  assert.match(preview, /docType: scheduled_log/);
  assert.match(preview, /scheduledLogId: slog_00000000000000000000000000/);
  assert.match(preview, /title: "Daily sauna"/);

  const hydration = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V1QY2M5ZBV64ZP4N1DRB1",
    title: "Morning Hydration Check",
    slug: "morning-hydration-check",
    status: "active",
    summary: "Log hydration and recovery status.",
    schedule: {
      kind: "at",
      at: "2026-04-22T06:45:00.000Z",
    },
    action: {
      kind: "measurement.add",
      title: "Morning hydration",
      measurements: [
        {
          metric: "body-weight",
          value: 181.2,
          unit: "lb",
        },
      ],
    },
    tags: ["hydration", "recovery"],
    body: "Check hydration before coffee.",
  });

  const sauna = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V2QY2M5ZBV64ZP4N1DRB2",
    title: "Evening Sauna",
    slug: "evening-sauna",
    status: "active",
    schedule: {
      kind: "every",
      everyMs: 43_200_000,
    },
    action: {
      kind: "intervention_session.add",
      title: "Sauna",
      interventionType: "sauna",
      durationMinutes: 20,
      protocolId: "prot_01JX8V99QXQXQXQXQXQXQXQXQX",
    },
    tags: ["heat", "recovery"],
    body: "Write a sauna intervention event.",
  });

  const mobility = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V3QY2M5ZBV64ZP4N1DRB3",
    title: "Daily Mobility",
    slug: "daily-mobility",
    status: "paused",
    schedule: {
      kind: "cron",
      expression: "0 7 * * 1-5",
    },
    action: {
      kind: "activity_session.add",
      title: "Mobility",
      activityType: "mobility",
      durationMinutes: 15,
      note: "Simple movement flow.",
      tags: ["movement"],
    },
    body: "Preserve the weekday mobility routine.",
  });

  const listed = await listScheduledLogs({ vaultRoot });
  const activeOnly = await listScheduledLogs({
    vaultRoot,
    status: "active",
  });
  const movementOnly = await listScheduledLogs({
    vaultRoot,
    text: "movement",
  });
  const readById = await readScheduledLog({
    vaultRoot,
    scheduledLogId: hydration.record.scheduledLogId,
  });
  const shownBySlug = await showScheduledLog({
    vaultRoot,
    slug: mobility.record.slug,
  });
  const renamedHydration = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: hydration.record.scheduledLogId,
    title: hydration.record.title,
    slug: "morning-water-check",
    status: hydration.record.status,
    summary: hydration.record.summary ?? undefined,
    schedule: hydration.record.schedule,
    action: hydration.record.action,
    tags: hydration.record.tags,
    body: hydration.record.body,
    allowSlugRename: true,
  });
  const archivedSauna = await setScheduledLogStatus({
    vaultRoot,
    scheduledLogId: sauna.record.scheduledLogId,
    status: "archived",
  });
  const renamedMarkdown = await readScheduledLogMarkdown(
    vaultRoot,
    hydration.record.scheduledLogId,
  );

  assert.equal(hydration.created, true);
  assert.equal(sauna.created, true);
  assert.equal(mobility.created, true);
  assert.deepEqual(
    listed.items.map((record) => record.title),
    ["Daily Mobility", "Evening Sauna", "Morning Hydration Check"],
  );
  assert.deepEqual(
    activeOnly.items.map((record) => record.slug),
    ["evening-sauna", "morning-hydration-check"],
  );
  assert.deepEqual(
    movementOnly.items.map((record) => record.slug),
    ["daily-mobility"],
  );
  assert.equal(readById.summary, "Log hydration and recovery status.");
  assert.equal(shownBySlug?.status, "paused");
  assert.equal(renamedHydration.created, false);
  assert.equal(renamedHydration.record.slug, "morning-water-check");
  assert.equal(
    renamedHydration.record.relativePath,
    "bank/scheduled-logs/morning-water-check.md",
  );
  assert.equal(archivedSauna.record.status, "archived");
  assert.match(renamedMarkdown, /slug: morning-water-check/);

  await assert.rejects(
    () =>
      showScheduledLog({
        vaultRoot,
        scheduledLogId: renamedHydration.record.scheduledLogId,
        slug: mobility.record.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_SCHEDULED_LOG_CONFLICT" &&
      error.message === "Scheduled log id and slug resolve to different records.",
  );

  await assert.rejects(
    () =>
      readScheduledLog({
        vaultRoot,
        scheduledLogId: "slog_missing",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_SCHEDULED_LOG_MISSING" &&
      error.message === "Scheduled log was not found.",
  );
});

test("scheduled log upserts resolve creates and updates under one registry lock", async () => {
  const vaultRoot = await makeTempDirectory("murph-scheduled-logs-concurrent");
  await initializeVault({ vaultRoot });

  const [first, second] = await Promise.all([
    upsertScheduledLog({
      vaultRoot,
      title: "Morning Check",
      slug: "morning-check",
      status: "active",
      schedule: {
        kind: "dailyLocal",
        localTime: "08:00",
      },
      action: {
        kind: "measurement.add",
        title: "Morning check",
        measurements: [{ metric: "body-weight", value: 180, unit: "lb" }],
      },
      body: "Log the morning check.",
    }),
    upsertScheduledLog({
      vaultRoot,
      title: "Morning Check",
      slug: "morning-check",
      status: "active",
      schedule: {
        kind: "dailyLocal",
        localTime: "08:00",
      },
      action: {
        kind: "measurement.add",
        title: "Morning check",
        measurements: [{ metric: "body-weight", value: 181, unit: "lb" }],
      },
      body: "Log the morning check.",
    }),
  ]);

  assert.deepEqual([first.created, second.created].sort(), [false, true]);
  const records = await listScheduledLogs({ vaultRoot });
  assert.equal(records.items.length, 1);
  assert.equal(records.items[0]?.slug, "morning-check");
});

test("scheduled log execution inherits food details and is idempotent per occurrence", async () => {
  const vaultRoot = await makeTempDirectory("murph-scheduled-logs-meal");
  await initializeVault({ vaultRoot });

  const food = await upsertFood({
    vaultRoot,
    title: "Recovery Smoothie",
    summary: "Post-workout smoothie.",
    serving: "1 glass",
    ingredients: ["banana", "berries"],
    note: "Blend until cold.",
    nutrition: {
      perServing: {
        calories: 420,
        proteinGrams: 30,
        carbsGrams: 45,
      },
      provenance: {
        source: "estimated",
        confidence: "medium",
      },
    },
  });

  const scheduledLog = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V4QY2M5ZBV64ZP4N1DRB4",
    title: "Recovery Smoothie",
    slug: "recovery-smoothie",
    status: "active",
    schedule: {
      kind: "dailyLocal",
      localTime: "09:00",
    },
    action: {
      kind: "meal.add",
      foodId: food.record.foodId,
      tags: ["post-workout"],
    },
    body: "Write the recovery smoothie meal event.",
  });

  const occurrenceAt = "2026-04-22T09:00:00.000Z";
  const firstRun = await executeScheduledLogOccurrence({
    vaultRoot,
    scheduledLogId: scheduledLog.record.scheduledLogId,
    occurrenceAt,
  });
  await setScheduledLogStatus({
    vaultRoot,
    scheduledLogId: scheduledLog.record.scheduledLogId,
    status: "paused",
  });
  const secondRun = await executeScheduledLogOccurrence({
    vaultRoot,
    scheduledLogId: scheduledLog.record.scheduledLogId,
    occurrenceAt,
  });
  const mealEvent = await findEventByExternalRef({
    vaultRoot,
    system: "murph-scheduled-log",
    resourceType: "occurrence",
    resourceId: `${scheduledLog.record.scheduledLogId}:${occurrenceAt}`,
  });

  assert.equal(firstRun.idempotent, false);
  assert.equal(firstRun.skipped, false);
  assert.equal(firstRun.eventKind, "meal");
  assert.equal(secondRun.idempotent, true);
  assert.equal(secondRun.skipped, true);
  assert.equal(secondRun.eventId, firstRun.eventId);
  assert.ok(mealEvent);
  assert.equal(mealEvent?.kind, "meal");

  if (!mealEvent || mealEvent.kind !== "meal") {
    throw new Error("Expected a meal event for the scheduled occurrence.");
  }

  assert.match(mealEvent.note ?? "", /Auto-logged saved food: Recovery Smoothie/);
  assert.match(mealEvent.note ?? "", /Serving: 1 glass/);
  assert.deepEqual(mealEvent.ingredients, ["banana", "berries"]);
  assert.deepEqual(mealEvent.tags, ["post-workout"]);
  assert.deepEqual(mealEvent.nutrition, {
    totals: {
      calories: 420,
      proteinGrams: 30,
      carbsGrams: 45,
    },
    provenance: {
      source: "inherited",
      confidence: "medium",
      sourceDetail: 'Copied from saved food "Recovery Smoothie".',
    },
  });
});

test("scheduled log execution covers activity, intervention, measurement, and inactive branches", async () => {
  const vaultRoot = await makeTempDirectory("murph-scheduled-logs-actions");
  await initializeVault({ vaultRoot });

  const activity = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V5QY2M5ZBV64ZP4N1DRB5",
    title: "Mobility flow",
    slug: "mobility-flow",
    status: "active",
    schedule: {
      kind: "every",
      everyMs: 3_600_000,
    },
    action: {
      kind: "activity_session.add",
      title: "Mobility flow",
      activityType: "mobility",
      durationMinutes: 15,
      note: "Keep it easy.",
      tags: ["movement"],
    },
    body: "Write the mobility session event.",
  });

  const intervention = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V6QY2M5ZBV64ZP4N1DRB6",
    title: "Light therapy",
    slug: "light-therapy",
    status: "active",
    schedule: {
      kind: "cron",
      expression: "0 8 * * *",
    },
    action: {
      kind: "intervention_session.add",
      title: "Light therapy",
      interventionType: "light-therapy",
      durationMinutes: 10,
      protocolId: "prot_01JX8VB9QXQXQXQXQXQXQXQXQX",
      tags: ["light"],
    },
    body: "Write the light therapy intervention.",
  });

  const measurement = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V7QY2M5ZBV64ZP4N1DRB7",
    title: "Weekly check-in",
    slug: "weekly-check-in",
    status: "active",
    schedule: {
      kind: "dailyLocal",
      localTime: "07:15",
    },
    action: {
      kind: "measurement.add",
      measurements: [
        {
          metric: "body-fat",
          value: 17.2,
          unit: "percent",
        },
      ],
      tags: ["check-in"],
    },
    body: "Write the weekly measurement event.",
  });

  const paused = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V8QY2M5ZBV64ZP4N1DRB8",
    title: "Paused check-in",
    slug: "paused-check-in",
    status: "paused",
    schedule: {
      kind: "dailyLocal",
      localTime: "08:00",
    },
    action: {
      kind: "measurement.add",
      measurements: [
        {
          metric: "body-weight",
          value: 180,
          unit: "lb",
        },
      ],
    },
    body: "Leave this paused until it is resumed.",
  });

  const archived = await upsertScheduledLog({
    vaultRoot,
    scheduledLogId: "slog_01JX8V9QY2M5ZBV64ZP4N1DRB9",
    title: "Archived check-in",
    slug: "archived-check-in",
    status: "archived",
    schedule: {
      kind: "dailyLocal",
      localTime: "09:00",
    },
    action: {
      kind: "measurement.add",
      measurements: [
        {
          metric: "resting-heart-rate",
          value: 56,
          unit: "bpm",
        },
      ],
    },
    body: "Keep this archived.",
  });

  const activityResult = await executeScheduledLogOccurrence({
    vaultRoot,
    scheduledLogId: activity.record.scheduledLogId,
    occurrenceAt: "2026-04-22T08:00:00.000Z",
  });
  const interventionResult = await executeScheduledLogOccurrence({
    vaultRoot,
    scheduledLogId: intervention.record.scheduledLogId,
    occurrenceAt: "2026-04-22T08:10:00.000Z",
  });
  const measurementResult = await executeScheduledLogOccurrence({
    vaultRoot,
    scheduledLogId: measurement.record.scheduledLogId,
    occurrenceAt: "2026-04-22T07:15:00.000Z",
  });

  assert.equal(activityResult.eventKind, "activity_session");
  assert.equal(interventionResult.eventKind, "intervention_session");
  assert.equal(measurementResult.eventKind, "measurement");

  const pausedResult = await executeScheduledLogOccurrence({
    vaultRoot,
    scheduledLogId: paused.record.scheduledLogId,
    occurrenceAt: "2026-04-22T08:00:00.000Z",
  });
  const archivedResult = await executeScheduledLogOccurrence({
    vaultRoot,
    scheduledLogId: archived.record.scheduledLogId,
    occurrenceAt: "2026-04-22T09:00:00.000Z",
  });

  assert.deepEqual(pausedResult, {
    actionKind: "measurement.add",
    eventId: null,
    eventKind: null,
    idempotent: false,
    message: 'Skipped scheduled log "Paused check-in" because it is paused.',
    scheduledLogId: paused.record.scheduledLogId,
    skipped: true,
  });
  assert.deepEqual(archivedResult, {
    actionKind: "measurement.add",
    eventId: null,
    eventKind: null,
    idempotent: false,
    message: 'Skipped scheduled log "Archived check-in" because it is archived.',
    scheduledLogId: archived.record.scheduledLogId,
    skipped: true,
  });

  await assert.rejects(
    () =>
      executeScheduledLogOccurrence({
        vaultRoot,
        scheduledLogId: measurement.record.scheduledLogId,
        occurrenceAt: "not-a-timestamp",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "occurrenceAt must be a valid ISO timestamp.",
  );
});

test("scheduled logs reject malformed previews and broken registry documents", async () => {
  const previewPayload = scaffoldScheduledLogPayload();

  assert.throws(
    () =>
      buildScheduledLogMarkdownPreview({
        ...previewPayload,
        tags: ["NotSlug"],
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "tags must be lowercase slug strings.",
  );

  assert.throws(
    () =>
      buildScheduledLogMarkdownPreview({
        ...previewPayload,
        schedule: {
          kind: "dailyLocal",
          localTime: "24:00",
        },
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "schedule.localTime must use HH:MM format.",
  );

  const badShapeVault = await makeTempDirectory("murph-scheduled-logs-bad-shape");
  await initializeVault({ vaultRoot: badShapeVault });
  await writeVaultFile(
    badShapeVault,
    "bank/scheduled-logs/bad-shape.md",
    [
      "---",
      "schemaVersion: murph.frontmatter.goal.v1",
      "docType: scheduled_log",
      "scheduledLogId: slog_01JX8V9QY2M5ZBV64ZP4N1DRB9",
      "slug: bad-shape",
      "title: Bad shape",
      "schedule:",
      "  kind: dailyLocal",
      "  localTime: 07:00",
      "action:",
      "  kind: intervention_session.add",
      "  title: Bad shape",
      "  interventionType: sauna",
      "createdAt: 2026-04-22T07:00:00.000Z",
      "updatedAt: 2026-04-22T07:00:00.000Z",
      "---",
    ].join("\n"),
  );

  await assert.rejects(
    () => listScheduledLogs({ vaultRoot: badShapeVault }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_SCHEDULED_LOG" &&
      error.message === "Scheduled log registry document has an unexpected shape.",
  );

  const badScheduleVault = await makeTempDirectory("murph-scheduled-logs-bad-schedule");
  await initializeVault({ vaultRoot: badScheduleVault });
  await writeVaultFile(
    badScheduleVault,
    "bank/scheduled-logs/bad-schedule.md",
    [
      "---",
      "schemaVersion: murph.frontmatter.scheduled-log.v1",
      "docType: scheduled_log",
      "scheduledLogId: slog_01JX8VAQY2M5ZBV64ZP4N1DRBA",
      "slug: bad-schedule",
      "title: Bad schedule",
      "schedule:",
      "  kind: weekly",
      "action:",
      "  kind: intervention_session.add",
      "  title: Bad schedule",
      "  interventionType: sauna",
      "createdAt: 2026-04-22T07:00:00.000Z",
      "updatedAt: 2026-04-22T07:00:00.000Z",
      "---",
    ].join("\n"),
  );

  await assert.rejects(
    () => listScheduledLogs({ vaultRoot: badScheduleVault }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "schedule.kind must match a supported scheduled-log schedule.",
  );

  await fs.rm(path.join(badScheduleVault, "bank/scheduled-logs/bad-schedule.md"), {
    force: true,
  });

  await writeVaultFile(
    badScheduleVault,
    "bank/scheduled-logs/non-object-schedule.md",
    [
      "---",
      "schemaVersion: murph.frontmatter.scheduled-log.v1",
      "docType: scheduled_log",
      "scheduledLogId: slog_01JX8VBQY2M5ZBV64ZP4N1DRBB",
      "slug: non-object-schedule",
      "title: Non-object schedule",
      "schedule: invalid",
      "action:",
      "  kind: intervention_session.add",
      "  title: Non-object schedule",
      "  interventionType: sauna",
      "createdAt: 2026-04-22T07:00:00.000Z",
      "updatedAt: 2026-04-22T07:00:00.000Z",
      "---",
    ].join("\n"),
  );

  await assert.rejects(
    () => listScheduledLogs({ vaultRoot: badScheduleVault }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "schedule must be an object.",
  );
});
