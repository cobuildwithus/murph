import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { listScheduledLogs, readScheduledLog, showScheduledLog } from "../src/index.ts";

async function writeVaultFile(vaultRoot: string, relativePath: string, contents: string) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

test("scheduled log queries list, read, filter, and show records across schedule kinds", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-scheduled-logs-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/morning-check-in.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T1QY2M5ZBV64ZP4N1DRB1",
        "slug: morning-check-in",
        "title: Morning Check-In",
        "status: active",
        "summary: Capture a morning check-in.",
        "schedule:",
        "  kind: at",
        "  at: 2026-04-22T06:30:00.000Z",
        "action:",
        "  kind: measurement.add",
        "  measurements:",
        "    -",
        "      metric: body-weight",
        "      value: 181.4",
        "      unit: lb",
        "tags:",
        "  - hydration",
        "  - hydration",
        "  - recovery",
        "createdAt: 2026-04-21T06:00:00.000Z",
        "updatedAt: 2026-04-21T06:05:00.000Z",
        "---",
        "",
        "Morning body check-in.   ",
      ].join("\n"),
    );

    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/evening-sauna.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T2QY2M5ZBV64ZP4N1DRB2",
        "slug: evening-sauna",
        "title: Evening Sauna",
        "status: paused",
        "summary: Wind down with heat exposure.",
        "schedule:",
        "  kind: dailyLocal",
        "  localTime: 20:30",
        "action:",
        "  kind: intervention_session.add",
        "  title: Sauna",
        "  interventionType: sauna",
        "  durationMinutes: 20",
        "tags:",
        "  - heat",
        "  - recovery",
        "createdAt: 2026-04-21T20:00:00.000Z",
        "updatedAt: 2026-04-21T20:05:00.000Z",
        "---",
        "",
        "Evening sauna block.",
      ].join("\n"),
    );

    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/strength-session.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T3QY2M5ZBV64ZP4N1DRB3",
        "slug: strength-session",
        "title: Strength Session",
        "status: archived",
        "summary: Preserve the old strength automation.",
        "schedule:",
        "  kind: cron",
        "  expression: 0 7 * * 1,3,5",
        "action:",
        "  kind: activity_session.add",
        "  title: Strength Session",
        "  activityType: strength",
        "  durationMinutes: 45",
        "createdAt: 2026-04-21T07:00:00.000Z",
        "updatedAt: 2026-04-21T07:05:00.000Z",
        "---",
        "",
        "Strength automation.",
      ].join("\n"),
    );

    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/supplements.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T4QY2M5ZBV64ZP4N1DRB4",
        "slug: supplements",
        "title: Supplements",
        "schedule:",
        "  kind: every",
        "  everyMs: 43200000",
        "action:",
        "  kind: meal.add",
        "  note: Take supplements",
        "tags:",
        "  - routine",
        "createdAt: 2026-04-21T08:00:00.000Z",
        "updatedAt: 2026-04-21T08:05:00.000Z",
        "---",
        "",
        "Supplements body",
      ].join("\n"),
    );

    const listed = await listScheduledLogs(vaultRoot);
    const activeOnly = await listScheduledLogs(vaultRoot, {
      status: "active",
    });
    const heatOnly = await listScheduledLogs(vaultRoot, {
      text: "sauna",
    });
    const limited = await listScheduledLogs(vaultRoot, {
      limit: 1,
    });
    const readById = await readScheduledLog(
      vaultRoot,
      "slog_01JX8T1QY2M5ZBV64ZP4N1DRB1",
    );
    const shownBySlug = await showScheduledLog(vaultRoot, "strength-session");
    const shownByTitle = await showScheduledLog(vaultRoot, "Supplements");
    const missing = await showScheduledLog(vaultRoot, "missing");

    assert.equal(listed.length, 4);
    assert.deepEqual(
      listed.map((record) => record.title),
      ["Evening Sauna", "Morning Check-In", "Strength Session", "Supplements"],
    );
    assert.deepEqual(
      activeOnly.map((record) => record.slug),
      ["morning-check-in", "supplements"],
    );
    assert.deepEqual(
      heatOnly.map((record) => record.slug),
      ["evening-sauna"],
    );
    assert.deepEqual(
      limited.map((record) => record.slug),
      ["evening-sauna"],
    );
    assert.ok(readById);
    assert.equal(readById?.status, "active");
    assert.deepEqual(readById?.tags, ["hydration", "recovery"]);
    assert.equal(readById?.body, "Morning body check-in.");
    assert.deepEqual(readById?.schedule, {
      kind: "at",
      at: "2026-04-22T06:30:00.000Z",
    });
    assert.equal(shownBySlug?.status, "archived");
    assert.deepEqual(shownByTitle?.schedule, {
      kind: "every",
      everyMs: 43_200_000,
    });
    assert.equal(shownByTitle?.status, "active");
    assert.equal(missing, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("scheduled log queries reject malformed registry documents", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-scheduled-logs-invalid-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/bad-shape.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.goal.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T5QY2M5ZBV64ZP4N1DRB5",
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
      () => listScheduledLogs(vaultRoot),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Scheduled log registry document has an unexpected shape.",
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("scheduled log queries reject unsupported schedules and actions", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-scheduled-logs-errors-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/bad-schedule.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T6QY2M5ZBV64ZP4N1DRB6",
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
      () => readScheduledLog(vaultRoot, "slog_01JX8T6QY2M5ZBV64ZP4N1DRB6"),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "schedule.kind must match a supported scheduled-log schedule.",
    );

    await rm(path.join(vaultRoot, "bank/scheduled-logs/bad-schedule.md"), {
      force: true,
    });

    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/non-object-schedule.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T8QY2M5ZBV64ZP4N1DRB8",
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
      () => readScheduledLog(vaultRoot, "slog_01JX8T8QY2M5ZBV64ZP4N1DRB8"),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "schedule must be an object.",
    );

    await rm(path.join(vaultRoot, "bank/scheduled-logs/non-object-schedule.md"), {
      force: true,
    });

    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/bad-status.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T9QY2M5ZBV64ZP4N1DRB9",
        "slug: bad-status",
        "title: Bad status",
        "status: disabled",
        "schedule:",
        "  kind: dailyLocal",
        "  localTime: 07:00",
        "action:",
        "  kind: intervention_session.add",
        "  title: Bad status",
        "  interventionType: sauna",
        "createdAt: 2026-04-22T07:00:00.000Z",
        "updatedAt: 2026-04-22T07:00:00.000Z",
        "---",
      ].join("\n"),
    );

    await assert.rejects(
      () => listScheduledLogs(vaultRoot),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "status must be one of active, paused, archived.",
    );

    await rm(path.join(vaultRoot, "bank/scheduled-logs/bad-status.md"), {
      force: true,
    });

    await writeVaultFile(
      vaultRoot,
      "bank/scheduled-logs/bad-action.md",
      [
        "---",
        "schemaVersion: murph.frontmatter.scheduled-log.v1",
        "docType: scheduled_log",
        "scheduledLogId: slog_01JX8T7QY2M5ZBV64ZP4N1DRB7",
        "slug: bad-action",
        "title: Bad action",
        "schedule:",
        "  kind: dailyLocal",
        "  localTime: 07:00",
        "action:",
        "  kind: meal.add",
        "createdAt: 2026-04-22T07:00:00.000Z",
        "updatedAt: 2026-04-22T07:00:00.000Z",
        "---",
      ].join("\n"),
    );

    await assert.rejects(
      () => readScheduledLog(vaultRoot, "slog_01JX8T7QY2M5ZBV64ZP4N1DRB7"),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("meal.add scheduled logs require"),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
