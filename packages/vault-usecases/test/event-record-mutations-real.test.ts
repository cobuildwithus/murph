import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { EventRecord } from "@murphai/contracts";
import {
  findEventByExternalRef,
  importDeviceBatch,
  initializeVault,
  readJsonlRecords,
} from "@murphai/core";
import { test } from "vitest";

import { editEventRecord } from "../src/usecases/event-record-mutations.js";

const WHOOP_SLEEP_VERSION = "2026-06-03T15:00:00.000Z";

function buildWhoopSleep(resourceId: string, sleepType?: "main_sleep") {
  return {
    kind: "sleep_session" as const,
    occurredAt: "2026-06-03T06:30:00.000Z",
    recordedAt: "2026-06-03T14:30:00.000Z",
    dayKey: "2026-06-03",
    timeZone: "UTC",
    title: "WHOOP sleep",
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId,
      version: WHOOP_SLEEP_VERSION,
    },
    fields: {
      startAt: "2026-06-03T06:30:00.000Z",
      endAt: "2026-06-03T14:30:00.000Z",
      durationMinutes: 480,
      ...(sleepType ? { sleepType } : {}),
    },
  };
}

function buildWhoopRecovery() {
  return {
    kind: "observation" as const,
    occurredAt: "2026-06-03T15:30:00.000Z",
    recordedAt: "2026-06-03T15:30:00.000Z",
    dayKey: "2026-06-03",
    timeZone: "UTC",
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "sleep-enrichment-recovery",
      version: WHOOP_SLEEP_VERSION,
      facet: "recovery-score",
    },
    fields: {
      metric: "recovery-score",
      value: 71,
      unit: "%",
    },
  };
}

async function readEventShards(vaultRoot: string, relativePaths: readonly string[]) {
  return Promise.all(
    [...new Set(relativePaths)].sort().map(async (relativePath) => ({
      relativePath,
      bytes: await readFile(path.join(vaultRoot, relativePath)),
    })),
  );
}

test("WHOOP sleep-type enrichment preserves a newer edit from the real event mutation path", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-event-edit-whoop-sleep-"));

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-06-01T12:00:00.000Z",
      timezone: "UTC",
    });

    const editedResourceId = "legacy-edited-main-sleep";
    const untouchedResourceId = "legacy-untouched-main-sleep";
    const legacy = await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-03T16:00:00.000Z",
      events: [
        buildWhoopSleep(editedResourceId),
        buildWhoopSleep(untouchedResourceId),
      ],
    });
    const editedEventId = legacy.events[0]?.id;
    const untouchedEventId = legacy.events[1]?.id;
    assert.ok(editedEventId);
    assert.ok(untouchedEventId);

    const edit = await editEventRecord({
      vault: vaultRoot,
      lookup: editedEventId,
      entityLabel: "event",
      set: [
        "source=manual",
        "title=Corrected overnight sleep",
        "timeZone=America/Los_Angeles",
        "dayKey=2026-06-02",
      ],
    });
    assert.equal(edit.eventId, editedEventId);

    const enrichedSnapshotEvents = [
      buildWhoopSleep(editedResourceId, "main_sleep"),
      buildWhoopSleep(untouchedResourceId, "main_sleep"),
      buildWhoopRecovery(),
    ];
    const enriched = await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-04T16:00:00.000Z",
      events: enrichedSnapshotEvents,
    });
    assert.equal(enriched.applied, true);

    const preservedEdit = await findEventByExternalRef({
      vaultRoot,
      system: "whoop",
      resourceType: "sleep",
      resourceId: editedResourceId,
    });
    assert.equal(preservedEdit?.id, editedEventId);
    assert.equal(preservedEdit?.lifecycle?.revision, 2);
    assert.equal(preservedEdit?.source, "manual");
    assert.equal(preservedEdit?.title, "Corrected overnight sleep");
    assert.equal(preservedEdit?.timeZone, "America/Los_Angeles");
    assert.equal(preservedEdit?.dayKey, "2026-06-02");
    assert.equal(
      preservedEdit?.kind === "sleep_session" ? preservedEdit.sleepType : undefined,
      undefined,
    );

    const enrichedUntouched = await findEventByExternalRef({
      vaultRoot,
      system: "whoop",
      resourceType: "sleep",
      resourceId: untouchedResourceId,
    });
    assert.equal(enrichedUntouched?.id, untouchedEventId);
    assert.equal(enrichedUntouched?.lifecycle?.revision, 2);
    assert.equal(
      enrichedUntouched?.kind === "sleep_session" ? enrichedUntouched.sleepType : undefined,
      "main_sleep",
    );
    assert.ok(await findEventByExternalRef({
      vaultRoot,
      system: "whoop",
      resourceType: "recovery",
      resourceId: "sleep-enrichment-recovery",
      facet: "recovery-score",
    }));

    const eventShardPaths = [
      ...legacy.eventShardPaths,
      edit.ledgerFile,
      ...enriched.eventShardPaths,
    ];
    const records = (await Promise.all(
      [...new Set(eventShardPaths)].map((relativePath) =>
        readJsonlRecords({ vaultRoot, relativePath })
      ),
    )).flat() as EventRecord[];
    assert.equal(
      records.filter((record) => record.id === editedEventId).length,
      2,
      "the supported edit must remain the latest revision without a provider-authored replacement",
    );

    const afterEnrichment = await readEventShards(vaultRoot, eventShardPaths);
    await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-05T16:00:00.000Z",
      events: enrichedSnapshotEvents,
    });
    assert.deepEqual(await readEventShards(vaultRoot, eventShardPaths), afterEnrichment);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
