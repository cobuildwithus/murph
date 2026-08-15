import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isDeletedEventLifecycle, type EventRecord } from "@murphai/contracts";
import {
  findEventByExternalRef,
  importDeviceBatch,
  initializeVault,
  readJsonlRecords,
} from "@murphai/core";
import { summarizeWearableSourceHealthRuntime } from "@murphai/query";
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
    dataOrigin: {
      version: 1 as const,
      sourceProviderSlug: "whoop",
      sourceType: "watch",
      observedAtRaw: "2026-06-03T06:30:00.000Z",
      timestampSemantics: "utc" as const,
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
    assert.equal(preservedEdit?.externalRef?.system, "whoop");
    assert.equal(preservedEdit?.dataOrigin?.sourceProviderSlug, "whoop");
    assert.equal(
      preservedEdit?.kind === "sleep_session" ? preservedEdit.sleepType : undefined,
      undefined,
    );
    const sourceHealth = await summarizeWearableSourceHealthRuntime(vaultRoot);
    assert.ok(sourceHealth.some((entry) => entry.provider === "whoop"));

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

test("WHOOP typed-sleep replay preserves an explicitly cleared type", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-event-edit-whoop-sleep-clear-"));

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-06-01T12:00:00.000Z",
      timezone: "UTC",
    });

    const resourceId = "typed-cleared-main-sleep";
    const typedSleep = buildWhoopSleep(resourceId, "main_sleep");
    const initial = await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-03T16:00:00.000Z",
      events: [typedSleep],
    });
    const eventId = initial.events[0]?.id;
    assert.ok(eventId);
    assert.equal(
      initial.events[0]?.kind === "sleep_session" ? initial.events[0].sleepType : undefined,
      "main_sleep",
    );

    const cleared = await editEventRecord({
      vault: vaultRoot,
      lookup: eventId,
      entityLabel: "event",
      clear: ["sleepType"],
    });
    assert.equal(cleared.eventId, eventId);

    const mixedSnapshotEvents = [typedSleep, buildWhoopRecovery()];
    const replayed = await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-04T16:00:00.000Z",
      events: mixedSnapshotEvents,
    });
    assert.equal(replayed.applied, true);

    const preservedClear = await findEventByExternalRef({
      vaultRoot,
      system: "whoop",
      resourceType: "sleep",
      resourceId,
    });
    assert.equal(preservedClear?.id, eventId);
    assert.equal(preservedClear?.lifecycle?.revision, 2);
    assert.equal(preservedClear?.source, "manual");
    assert.equal(
      preservedClear?.kind === "sleep_session" ? preservedClear.sleepType : undefined,
      undefined,
    );
    assert.ok(await findEventByExternalRef({
      vaultRoot,
      system: "whoop",
      resourceType: "recovery",
      resourceId: "sleep-enrichment-recovery",
      facet: "recovery-score",
    }));

    const eventShardPaths = [
      ...initial.eventShardPaths,
      cleared.ledgerFile,
      ...replayed.eventShardPaths,
    ];
    const beforeExactReplay = await readEventShards(vaultRoot, eventShardPaths);
    await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-05T16:00:00.000Z",
      events: mixedSnapshotEvents,
    });
    assert.deepEqual(await readEventShards(vaultRoot, eventShardPaths), beforeExactReplay);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("WHOOP typed-sleep replay preserves a source-retaining edit", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-event-edit-whoop-typed-sleep-"));

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-06-01T12:00:00.000Z",
      timezone: "UTC",
    });

    const editedResourceId = "typed-edited-main-sleep";
    const typedSleep = buildWhoopSleep(editedResourceId, "main_sleep");
    const initial = await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-03T16:00:00.000Z",
      events: [typedSleep],
    });
    const editedEventId = initial.events[0]?.id;
    assert.ok(editedEventId);

    const edit = await editEventRecord({
      vault: vaultRoot,
      lookup: editedEventId,
      entityLabel: "event",
      set: [
        "title=Corrected typed overnight sleep",
        "timeZone=America/Los_Angeles",
        "dayKey=2026-06-02",
      ],
    });
    const mixedSnapshotEvents = [typedSleep, buildWhoopRecovery()];
    const replayed = await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-04T16:00:00.000Z",
      events: mixedSnapshotEvents,
    });
    assert.equal(replayed.applied, true);

    const preservedEdit = await findEventByExternalRef({
      vaultRoot,
      system: "whoop",
      resourceType: "sleep",
      resourceId: editedResourceId,
    });
    assert.equal(preservedEdit?.id, editedEventId);
    assert.equal(preservedEdit?.lifecycle?.revision, 2);
    assert.equal(preservedEdit?.source, "manual");
    assert.equal(preservedEdit?.title, "Corrected typed overnight sleep");
    assert.equal(preservedEdit?.timeZone, "America/Los_Angeles");
    assert.equal(preservedEdit?.dayKey, "2026-06-02");
    assert.equal(
      preservedEdit?.kind === "sleep_session" ? preservedEdit.sleepType : undefined,
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
      ...initial.eventShardPaths,
      edit.ledgerFile,
      ...replayed.eventShardPaths,
    ];
    const beforeExactReplay = await readEventShards(vaultRoot, eventShardPaths);
    await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-account",
      importedAt: "2026-06-05T16:00:00.000Z",
      events: mixedSnapshotEvents,
    });
    assert.deepEqual(await readEventShards(vaultRoot, eventShardPaths), beforeExactReplay);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("a real profile edit remains live above an authoritative provider update", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-event-edit-junction-profile-"));
  const identity = {
    system: "junction",
    resourceType: "junction-apple-health-profile",
    resourceId: "stable-profile",
  } as const;
  const facet = "profile-demographics";
  const initialVersion = "2026-06-03T15:00:00.000Z";
  const dataOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "apple-health",
    sourceType: "phone",
    observedAtRaw: initialVersion,
    timestampSemantics: "offset" as const,
  };
  const initialInput = {
    vaultRoot,
    provider: "junction",
    accountId: "junction-account",
    importedAt: "2026-06-03T16:00:00.000Z",
    events: [{
      kind: "note" as const,
      occurredAt: initialVersion,
      recordedAt: initialVersion,
      dayKey: "2026-06-03",
      timeZone: "UTC",
      title: "Junction profile",
      note: "Reported gender: other.",
      externalRef: { ...identity, facet, version: initialVersion },
      dataOrigin,
      fields: { reportedGender: "other" },
    }],
    authoritativeEventSets: [{
      ...identity,
      version: initialVersion,
      facetPrefixes: [facet],
      currentFacets: [facet],
    }],
  };

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-06-01T12:00:00.000Z",
      timezone: "UTC",
    });
    const initial = await importDeviceBatch(initialInput);
    const eventId = initial.events[0]?.id;
    assert.ok(eventId);

    await editEventRecord({
      vault: vaultRoot,
      lookup: eventId,
      entityLabel: "event",
      set: [
        "title=Corrected profile context",
        "note=Member-confirmed profile context.",
      ],
    });

    const exactReplay = await importDeviceBatch(initialInput);
    assert.equal(exactReplay.applied, false);
    assert.equal(exactReplay.ingestId, null);

    const corrected = await findEventByExternalRef({
      vaultRoot,
      ...identity,
      facet,
    });
    assert.equal(corrected?.id, eventId);
    assert.equal(corrected?.lifecycle?.revision, 2);
    assert.equal(corrected?.source, "manual");
    assert.equal(corrected?.title, "Corrected profile context");
    assert.equal(corrected?.note, "Member-confirmed profile context.");
    assert.deepEqual(corrected?.externalRef, { ...identity, facet, version: initialVersion });
    assert.deepEqual(corrected?.dataOrigin, dataOrigin);

    const updatedVersion = "2026-06-04T15:00:00.000Z";
    const updatedInput = {
      vaultRoot,
      provider: "junction",
      accountId: "junction-account",
      importedAt: "2026-06-04T16:00:00.000Z",
      events: [{
        ...initialInput.events[0],
        occurredAt: updatedVersion,
        recordedAt: updatedVersion,
        note: "Reported gender: female.",
        externalRef: { ...identity, facet, version: updatedVersion },
        dataOrigin: { ...dataOrigin, observedAtRaw: updatedVersion },
        fields: { reportedGender: "female" },
      }],
      authoritativeEventSets: [{
        ...identity,
        version: updatedVersion,
        facetPrefixes: [facet],
        currentFacets: [facet],
      }],
    };
    const updated = await importDeviceBatch(updatedInput);
    assert.equal(updated.applied, true);

    const retained = await findEventByExternalRef({ vaultRoot, ...identity, facet });
    assert.equal(retained?.id, eventId);
    assert.equal(retained?.source, "manual");
    assert.equal(retained?.title, "Corrected profile context");
    assert.equal(retained?.note, "Member-confirmed profile context.");
    assert.deepEqual(retained?.externalRef, { ...identity, facet, version: initialVersion });
    assert.deepEqual(retained?.dataOrigin, dataOrigin);
    const rows = (
      await Promise.all(
        [...new Set([...initial.eventShardPaths, ...updated.eventShardPaths])]
          .map((relativePath) => readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat() as EventRecord[];
    assert.ok(rows.some((event) =>
      event.id === eventId
      && event.source === "device"
      && event.externalRef?.version === updatedVersion
      && event.kind === "note"
      && event.note === "Reported gender: female."
    ));
    assert.equal(
      (await importDeviceBatch(updatedInput)).applied,
      false,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("a real cycle edit remains live above an authoritative provider tombstone", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-event-edit-junction-cycle-"));
  const identity = {
    system: "junction",
    resourceType: "junction-apple-health-menstrual-cycle",
    resourceId: "stable-cycle",
  } as const;
  const facet = "menstrual-flow-2026-05-01-1";
  const initialVersion = "2026-06-03T15:00:00.000Z";
  const dataOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "apple-health",
    sourceType: "phone",
    observedAtRaw: "2026-05-01",
    timestampSemantics: "floating" as const,
  };
  const initialInput = {
    vaultRoot,
    provider: "junction",
    accountId: "junction-account",
    importedAt: "2026-06-03T16:00:00.000Z",
    events: [{
      kind: "measurement" as const,
      occurredAt: "2026-05-01T00:00:00.000Z",
      recordedAt: initialVersion,
      dayKey: "2026-05-01",
      timeZone: "UTC",
      title: "Junction menstrual flow",
      externalRef: { ...identity, facet, version: initialVersion },
      dataOrigin,
      fields: {
        measurements: [{
          metric: "menstrual-flow",
          value: 2,
          unit: "score",
          qualifiers: { flow: "medium" },
        }],
      },
    }],
    authoritativeEventSets: [{
      ...identity,
      version: initialVersion,
      facetPrefixes: ["menstrual-flow"],
      currentFacets: [facet],
    }],
  };

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
    });
    const initial = await importDeviceBatch(initialInput);
    const eventId = initial.events[0]?.id;
    assert.ok(eventId);

    await editEventRecord({
      vault: vaultRoot,
      lookup: eventId,
      entityLabel: "event",
      set: [
        "title=Corrected period length day",
        "timeZone=America/Chicago",
        "dayKey=2026-04-30",
        "source=device",
      ],
    });

    const exactReplay = await importDeviceBatch(initialInput);
    assert.equal(exactReplay.applied, false);
    assert.equal(exactReplay.ingestId, null);

    const corrected = await findEventByExternalRef({
      vaultRoot,
      ...identity,
      facet,
    });
    assert.equal(corrected?.id, eventId);
    assert.equal(corrected?.lifecycle?.revision, 2);
    assert.equal(corrected?.source, "manual");
    assert.equal(corrected?.title, "Corrected period length day");
    assert.equal(corrected?.dayKey, "2026-04-30");
    assert.equal(corrected?.timeZone, "America/Chicago");
    assert.deepEqual(corrected?.externalRef, { ...identity, facet, version: initialVersion });
    assert.deepEqual(corrected?.dataOrigin, dataOrigin);

    const updatedVersion = "2026-06-04T15:00:00.000Z";
    const omissionInput = {
      vaultRoot,
      provider: "junction",
      accountId: "junction-account",
      importedAt: "2026-06-04T16:00:00.000Z",
      events: [],
      evidenceParts: [{
        role: "junction-summary-menstrual-cycle",
        fileName: "menstrual-cycle.json",
        content: { cycleCount: 1, factCount: 0 },
      }],
      authoritativeEventSets: [{
        ...identity,
        version: updatedVersion,
        facetPrefixes: ["menstrual-flow"],
        currentFacets: [],
      }],
    };
    const omitted = await importDeviceBatch(omissionInput);
    assert.equal(omitted.applied, true);

    const retained = await findEventByExternalRef({ vaultRoot, ...identity, facet });
    assert.equal(retained?.id, eventId);
    assert.equal(retained?.source, "manual");
    assert.equal(retained?.title, "Corrected period length day");
    assert.equal(retained?.dayKey, "2026-04-30");
    assert.equal(retained?.timeZone, "America/Chicago");
    assert.deepEqual(retained?.externalRef, { ...identity, facet, version: initialVersion });
    assert.deepEqual(retained?.dataOrigin, dataOrigin);
    const rows = (
      await Promise.all(
        [...new Set([...initial.eventShardPaths, ...omitted.eventShardPaths])]
          .map((relativePath) => readJsonlRecords({ vaultRoot, relativePath })),
      )
    ).flat() as EventRecord[];
    assert.ok(rows.some((event) =>
      event.id === eventId
      && event.source === "device"
      && event.externalRef?.version === updatedVersion
      && isDeletedEventLifecycle(event.lifecycle)
    ));
    assert.equal(
      (await importDeviceBatch(omissionInput)).applied,
      false,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
