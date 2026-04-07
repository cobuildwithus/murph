import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test, vi } from "vitest";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  INBOX_DB_RELATIVE_PATH,
  QUERY_DB_RELATIVE_PATH,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
} from "@murphai/runtime-state/node";

import {
  ID_FAMILY_REGISTRY,
  buildOverviewMetrics,
  buildOverviewWeeklyStats,
  buildExportPack,
  createVaultReadModel,
  describeLookupConstraint,
  inferIdEntityKind,
  isQueryableLookupId,
  buildTimeline,
  getExperiment,
  getJournalEntry,
  getQueryProjectionStatus,
  listFamilyMembers,
  listEntities,
  listGeneticVariants,
  listExperiments,
  listJournalEntries,
  lookupEntityById,
  readVault,
  rebuildQueryProjection,
  searchVault,
  searchVaultSafe,
  searchVaultRuntime,
  summarizeCurrentOverviewProfile,
  summarizeDailySamples,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
  summarizeWearableDay,
  summarizeWearableSleep,
  summarizeWearableSourceHealth,
} from "../src/index.ts";
import {
  type CanonicalEntity,
  linkTargetIds,
  normalizeCanonicalLinks,
  resolveCanonicalRecordClass,
} from "../src/canonical-entities.ts";
import { projectProfileSnapshotEntity } from "../src/health/projectors/profile.ts";
import { ALL_QUERY_ENTITY_FAMILIES } from "../src/model.ts";
import { profileSnapshotRecordFromEntity } from "../src/health/projections.ts";
import { parseFrontmatterDocument as parseHealthFrontmatterDocument } from "../src/health/shared.ts";
import { parseMarkdownDocument } from "../src/markdown.ts";
import {
  scoreSearchDocuments,
  type SearchableDocument,
} from "../src/search.ts";

const require = createRequire(import.meta.url);

test("parseMarkdownDocument keeps tolerant parsing explicit", () => {
  const parsed = parseMarkdownDocument(`---
# comment
title: 'Flexible Title'
tags:
- alpha
---

Body line
`);

  assert.deepEqual(parsed.attributes, {
    title: "Flexible Title",
    tags: ["alpha"],
  });
  assert.equal(parsed.body, "Body line");
  assert.equal(parsed.rawFrontmatter, "# comment\ntitle: 'Flexible Title'\ntags:\n- alpha");
});

test("parseMarkdownDocument falls back to body-only content when frontmatter is malformed", () => {
  const parsed = parseMarkdownDocument(`---
title broken
---

Body line
`);

  assert.deepEqual(parsed.attributes, {});
  assert.equal(parsed.rawFrontmatter, null);
  assert.equal(parsed.body, "---\ntitle broken\n---\n\nBody line");
});

test("health frontmatter parsing keeps strict errors and trimmed bodies", () => {
  const parsed = parseHealthFrontmatterDocument(`---
title: Example
---

Body line
`);

  assert.equal(parsed.body, "Body line");
  assert.deepEqual(parsed.attributes, { title: "Example" });

  assert.throws(
    () =>
      parseHealthFrontmatterDocument(`---
title broken
---
`),
    /Expected "key: value" frontmatter at line 1\./,
  );
});

test("readVault preserves canonical event links while deriving relatedIds for compatibility", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-event-links-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
        createdAt: "2026-04-07T00:00:00.000Z",
        title: "Event links vault",
        timezone: "UTC",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_01K72NW6HB9Y8M6W6VNZG4TF4M",
        kind: "note",
        occurredAt: "2026-04-07T08:15:00.000Z",
        recordedAt: "2026-04-07T08:15:00.000Z",
        dayKey: "2026-04-07",
        source: "manual",
        title: "Morning note",
        note: "Preserve canonical links.",
        links: [
          { type: "supports_goal", targetId: "goal_01K72NWBXGH4TPP8B9X7TNF1Z9" },
          { type: "addresses_condition", targetId: "cond_01K72NWD0QQP7NFK1G06NEPG5P" },
        ],
      })}\n`,
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const event = vault.events[0];

    assert.ok(event);
    assert.deepEqual(event?.links, [
      { type: "supports_goal", targetId: "goal_01K72NWBXGH4TPP8B9X7TNF1Z9" },
      { type: "addresses_condition", targetId: "cond_01K72NWD0QQP7NFK1G06NEPG5P" },
    ]);
    assert.deepEqual(event?.relatedIds, [
      "goal_01K72NWBXGH4TPP8B9X7TNF1Z9",
      "cond_01K72NWD0QQP7NFK1G06NEPG5P",
    ]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault preserves canonical event attachments for downstream readers", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-event-attachments-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        vaultId: "vault_01K72P0M9QW0RXBJV3JQ4V0Q2N",
        createdAt: "2026-04-07T00:00:00.000Z",
        title: "Event attachments vault",
        timezone: "UTC",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_01K72P1A9SMQ8Y4VGTTRSBDR0V",
        kind: "activity_session",
        occurredAt: "2026-04-07T08:15:00.000Z",
        recordedAt: "2026-04-07T08:15:00.000Z",
        dayKey: "2026-04-07",
        source: "manual",
        title: "Lift session",
        activityType: "strength-training",
        durationMinutes: 35,
        attachments: [{
          role: "media_1",
          kind: "photo",
          relativePath: "raw/workouts/2026/04/evt_01K72P1A9SMQ8Y4VGTTRSBDR0V/photo.jpg",
          mediaType: "image/jpeg",
          sha256: "0".repeat(64),
          originalFileName: "photo.jpg",
        }],
        rawRefs: ["raw/workouts/2026/04/evt_01K72P1A9SMQ8Y4VGTTRSBDR0V/photo.jpg"],
        workout: {
          exercises: [],
        },
      })}\n`,
      "utf8",
    );

    const readModel = await readVault(vaultRoot);
    const event = lookupEntityById(readModel, "evt_01K72P1A9SMQ8Y4VGTTRSBDR0V");

    assert.ok(event);
    assert.deepEqual(event?.attributes.attachments, [{
      role: "media_1",
      kind: "photo",
      relativePath: "raw/workouts/2026/04/evt_01K72P1A9SMQ8Y4VGTTRSBDR0V/photo.jpg",
      mediaType: "image/jpeg",
      sha256: "0".repeat(64),
      originalFileName: "photo.jpg",
    }]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("id-family helpers no longer register the hard-cut legacy colon-prefixed families", () => {
  assert.deepEqual(
    ID_FAMILY_REGISTRY.filter((family) => family.family.endsWith("_legacy")).map(
      (family) => family.family,
    ),
    [],
  );
  assert.equal(isQueryableLookupId("audit:2026-03"), false);
  assert.equal(isQueryableLookupId("event:legacy"), false);
  assert.equal(isQueryableLookupId("experiment:focus"), false);
  assert.equal(isQueryableLookupId("sample:path:12"), false);
  assert.equal(isQueryableLookupId("aud_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("food_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("meal_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("doc_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("rcp_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("prov_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("wfmt_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(inferIdEntityKind("food_01JNV40W8VFYQ2H7CMJY5A9R4K"), "food");
  assert.equal(inferIdEntityKind("meal_01JNV40W8VFYQ2H7CMJY5A9R4K"), "meal");
  assert.equal(inferIdEntityKind("doc_01JNV40W8VFYQ2H7CMJY5A9R4K"), "document");
  assert.equal(inferIdEntityKind("rcp_01JNV40W8VFYQ2H7CMJY5A9R4K"), "recipe");
  assert.equal(inferIdEntityKind("prov_01JNV40W8VFYQ2H7CMJY5A9R4K"), "provider");
  assert.equal(
    inferIdEntityKind("wfmt_01JNV40W8VFYQ2H7CMJY5A9R4K"),
    "workout_format",
  );
  assert.equal(describeLookupConstraint("food_01JNV40W8VFYQ2H7CMJY5A9R4K"), null);
  assert.equal(describeLookupConstraint("meal_01JNV40W8VFYQ2H7CMJY5A9R4K"), null);
  assert.equal(describeLookupConstraint("doc_01JNV40W8VFYQ2H7CMJY5A9R4K"), null);
});

test("readVault collapses append-only event revisions to the latest active current-view record", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-events-"));

  try {
    const eventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1C1";
    const marchShard = path.join(vaultRoot, "ledger/events/2026");
    const aprilShard = path.join(vaultRoot, "ledger/events/2026");
    const mayShard = path.join(vaultRoot, "ledger/events/2026");
    await mkdir(marchShard, { recursive: true });
    await mkdir(aprilShard, { recursive: true });
    await mkdir(mayShard, { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: eventId,
        kind: "note",
        occurredAt: "2026-03-12T08:15:00.000Z",
        recordedAt: "2026-03-12T08:16:00.000Z",
        dayKey: "2026-03-12",
        source: "manual",
        title: "Original note",
        note: "First revision.",
        lifecycle: {
          revision: 1,
        },
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      [
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-04-02T07:00:00.000Z",
          recordedAt: "2026-04-02T07:05:00.000Z",
          dayKey: "2026-04-02",
          source: "manual",
          title: "Updated note",
          note: "Second revision.",
          lifecycle: {
            revision: 2,
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-04-02T07:00:00.000Z",
          recordedAt: "2026-04-02T07:10:00.000Z",
          dayKey: "2026-04-02",
          source: "manual",
          title: "Updated note",
          note: "Second revision.",
          lifecycle: {
            revision: 3,
            state: "deleted",
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: eventId,
        kind: "note",
        occurredAt: "2026-05-01T09:30:00.000Z",
        recordedAt: "2026-05-01T09:35:00.000Z",
        dayKey: "2026-05-01",
        source: "manual",
        title: "Revived note",
        note: "Latest active revision.",
        lifecycle: {
          revision: 4,
        },
      })}\n`,
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const matchingEvents = listEntities(vault, {
      families: ["event"],
    }).filter((record) => record.primaryLookupId === eventId);
    const revivedEvent = lookupEntityById(vault, eventId);

    assert.equal(matchingEvents.length, 1);
    assert.equal(revivedEvent?.family, "event");
    assert.equal(revivedEvent?.title, "Revived note");
    assert.equal(revivedEvent?.occurredAt, "2026-05-01T09:30:00.000Z");
    assert.deepEqual(revivedEvent?.attributes.lifecycle, { revision: 4 });
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("wearable source health reports derived sleep-window metrics for session-only providers", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-wearables-source-health-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_sleep_01",
        kind: "sleep_session",
        occurredAt: "2026-03-31T21:30:00Z",
        recordedAt: "2026-04-01T05:45:00Z",
        dayKey: "2026-03-31",
        source: "device",
        title: "Overnight sleep",
        startAt: "2026-03-31T21:30:00Z",
        endAt: "2026-04-01T05:45:00Z",
        durationMinutes: 495,
        externalRef: {
          system: "whoop",
          resourceType: "sleep_session",
          resourceId: "sleep_01",
        },
      })}\n`,
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const sourceHealth = summarizeWearableSourceHealth(vault);

    assert.equal(sourceHealth.length, 1);
    assert.equal(sourceHealth[0]?.provider, "whoop");
    assert.equal(sourceHealth[0]?.candidateMetrics, 1);
    assert.equal(sourceHealth[0]?.selectedMetrics, 3);
    assert.deepEqual(sourceHealth[0]?.metricsContributed, [
      "sessionMinutes",
      "timeInBedMinutes",
      "totalSleepMinutes",
    ]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("wearable source health keeps provider-scoped evidence when external provenance is partial", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-wearables-partial-provenance-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_readiness_partial_01",
        kind: "observation",
        occurredAt: "2026-04-01T07:00:00Z",
        recordedAt: "2026-04-01T07:05:00Z",
        dayKey: "2026-04-01",
        source: "device",
        title: "Readiness",
        metric: "readiness-score",
        value: 82,
        unit: "%",
        externalRef: {
          system: "oura",
        },
      })}\n`,
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const sourceHealth = summarizeWearableSourceHealth(vault);
    const filteredSourceHealth = summarizeWearableSourceHealth(vault, {
      providers: ["oura"],
    });

    assert.equal(sourceHealth.length, 1);
    assert.equal(sourceHealth[0]?.provider, "oura");
    assert.equal(sourceHealth[0]?.candidateMetrics, 1);
    assert.equal(sourceHealth[0]?.selectedMetrics, 1);
    assert.equal(filteredSourceHealth.length, 1);
    assert.equal(filteredSourceHealth[0]?.provider, "oura");
    assert.equal(
      sourceHealth[0]?.notes.some((note) => note.includes("Included 1 Oura record with incomplete provenance")),
      true,
    );
    assert.equal(
      sourceHealth[0]?.notes.some((note) => note.includes("missing resourceId, resourceType")),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("wearable source health reports excluded records when provider provenance is missing", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-wearables-provenance-diagnostics-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_sleep_missing_provider_01",
        kind: "observation",
        occurredAt: "2026-04-01T06:45:00Z",
        recordedAt: "2026-04-01T06:50:00Z",
        dayKey: "2026-04-01",
        source: "device",
        title: "Sleep total",
        metric: "sleep-total-minutes",
        value: 430,
        unit: "minutes",
        externalRef: {
          resourceType: "sleep",
          resourceId: "sleep_01",
        },
      })}\n`,
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const sourceHealth = summarizeWearableSourceHealth(vault);
    const filteredSourceHealth = summarizeWearableSourceHealth(vault, {
      providers: ["oura"],
    });
    const summary = summarizeWearableDay(vault, "2026-04-01");
    const filteredSummary = summarizeWearableDay(vault, "2026-04-01", {
      providers: ["oura"],
    });

    assert.equal(sourceHealth.length, 1);
    assert.equal(sourceHealth[0]?.provider, "unknown");
    assert.equal(sourceHealth[0]?.candidateMetrics, 1);
    assert.equal(filteredSourceHealth[0]?.provider, "unknown");
    assert.equal(
      sourceHealth[0]?.notes[0]?.includes("Excluded 1 wearable record from semantic wearables"),
      true,
    );
    assert.equal(summary?.sourceHealth[0]?.provider, "unknown");
    assert.equal(filteredSummary?.sourceHealth[0]?.provider, "unknown");
    assert.equal(
      summary?.notes.some((note) => note.includes("Excluded 1 wearable record from semantic wearables")),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("wearable metric ranking balances specificity and recency ahead of provider preference alone", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-wearables-scored-metrics-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      [
        {
          schemaVersion: "murph.event.v1",
          id: "evt_sleep_total_oura_01",
          kind: "observation",
          occurredAt: "2026-04-01T06:00:00Z",
          recordedAt: "2026-04-01T06:10:00Z",
          dayKey: "2026-04-01",
          source: "device",
          title: "Oura sleep summary",
          metric: "sleep-total-minutes",
          value: 420,
          unit: "minutes",
          externalRef: {
            system: "oura",
            resourceType: "summary",
            resourceId: "summary_01",
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: "evt_sleep_total_garmin_01",
          kind: "observation",
          occurredAt: "2026-04-01T07:00:00Z",
          recordedAt: "2026-04-01T07:20:00Z",
          dayKey: "2026-04-01",
          source: "device",
          title: "Garmin sleep",
          metric: "sleep-total-minutes",
          value: 432,
          unit: "minutes",
          externalRef: {
            system: "garmin",
            resourceType: "sleep",
            resourceId: "sleep_01",
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const sleep = summarizeWearableSleep(vault);

    assert.equal(sleep[0]?.totalSleepMinutes.selection.provider, "garmin");
    assert.equal(
      sleep[0]?.totalSleepMinutes.confidence.reasons[0]?.includes("scored highest"),
      true,
    );
    assert.equal(
      sleep[0]?.totalSleepMinutes.confidence.reasons[0]?.includes("ahead of Oura observation:sleep-total-minutes"),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("sleep-window ranking uses scored evidence and marks session-derived fallbacks explicitly", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-wearables-sleep-window-ranking-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      [
        {
          schemaVersion: "murph.event.v1",
          id: "evt_sleep_window_oura_01",
          kind: "sleep_session",
          occurredAt: "2026-03-31T22:15:00Z",
          recordedAt: "2026-04-01T05:45:00Z",
          dayKey: "2026-04-01",
          source: "device",
          title: "Oura overnight sleep",
          startAt: "2026-03-31T22:15:00Z",
          endAt: "2026-04-01T05:45:00Z",
          durationMinutes: 450,
          externalRef: {
            system: "oura",
            resourceType: "sleep_session",
            resourceId: "sleep_oura_01",
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: "evt_sleep_window_garmin_01",
          kind: "sleep_session",
          occurredAt: "2026-03-31T22:05:00Z",
          recordedAt: "2026-04-01T06:20:00Z",
          dayKey: "2026-04-01",
          source: "device",
          title: "Garmin overnight sleep",
          startAt: "2026-03-31T22:05:00Z",
          endAt: "2026-04-01T06:20:00Z",
          durationMinutes: 495,
          externalRef: {
            system: "garmin",
            resourceType: "sleep_session",
            resourceId: "sleep_garmin_01",
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const sleep = summarizeWearableSleep(vault);

    assert.equal(sleep[0]?.sleepWindowProvider, "garmin");
    assert.equal(sleep[0]?.totalSleepMinutes.selection.provider, "garmin");
    assert.equal(sleep[0]?.totalSleepMinutes.selection.resolution, "fallback");
    assert.equal(sleep[0]?.totalSleepMinutes.selection.fallbackFromMetric, "sessionMinutes");
    assert.equal(
      sleep[0]?.notes.some((note) => note.includes("Selected Garmin sleep window recorded")),
      true,
    );
    assert.equal(
      sleep[0]?.notes.some((note) => note.includes("Used the selected sleep session duration because no direct total-sleep metric was available.")),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault ignores malformed event lifecycles instead of promoting them into the current view", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-events-invalid-lifecycle-"));

  try {
    const eventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1C2";
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
      [
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-03-12T08:15:00.000Z",
          recordedAt: "2026-03-12T08:16:00.000Z",
          dayKey: "2026-03-12",
          source: "manual",
          title: "Original note",
          note: "Valid revision.",
          lifecycle: {
            revision: 1,
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-03-13T09:15:00.000Z",
          recordedAt: "2026-03-13T09:16:00.000Z",
          dayKey: "2026-03-13",
          source: "manual",
          title: "Corrupt note",
          note: "Malformed lifecycle should be ignored.",
          lifecycle: {
            revision: 0,
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const survivingEvent = lookupEntityById(vault, eventId);

    assert.equal(survivingEvent?.title, "Original note");
    assert.equal(survivingEvent?.occurredAt, "2026-03-12T08:15:00.000Z");
    assert.deepEqual(survivingEvent?.attributes.lifecycle, { revision: 1 });
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("normalizeCanonicalLinks drops blank targets and dedupes identical pairs", () => {
  const blankFiltered = normalizeCanonicalLinks([
    { type: "related_to", targetId: "" },
    { type: "related_to", targetId: "   " },
    { type: "related_to", targetId: "goal_01" },
  ]);

  assert.deepEqual(blankFiltered, [{ type: "related_to", targetId: "goal_01" }]);
  assert.deepEqual(linkTargetIds(blankFiltered), ["goal_01"]);

  const deduped = normalizeCanonicalLinks([
    { type: "related_to", targetId: "goal_01" },
    { type: "related_to", targetId: "goal_01" },
    { type: "parent_of", targetId: "goal_01" },
  ]);

  assert.deepEqual(deduped, [
    { type: "related_to", targetId: "goal_01" },
    { type: "parent_of", targetId: "goal_01" },
  ]);
  assert.deepEqual(linkTargetIds(deduped), ["goal_01"]);
});

test(
  "readVault assembles a stable read model from contract-shaped markdown and jsonl sources",
  async () => {
    const vaultRoot = await createFixtureVault();

    try {
      const vault = await readVault(vaultRoot);

      assert.equal(vault.format, "murph.query.v1");
      assert.equal(vault.metadata?.vaultId, "vault_01JNV40W8VFYQ2H7CMJY5A9R4K");
      assert.equal(vault.coreDocument?.entityId, "vault_01JNV40W8VFYQ2H7CMJY5A9R4K");
      assert.equal(vault.experiments.length, 1);
      assert.equal(vault.journalEntries.length, 2);
      assert.equal(vault.events.length, 3);
      assert.equal(vault.samples.length, 5);
      assert.equal(vault.audits.length, 1);
      assert.deepEqual(vault.byFamily.core?.map((record) => record.entityId), [
        vault.coreDocument?.entityId,
      ]);
      assert.deepEqual(
        vault.byFamily.experiment?.map((record) => record.entityId),
        vault.experiments.map((record) => record.entityId),
      );
      assert.deepEqual(
        vault.byFamily.journal?.map((record) => record.entityId),
        vault.journalEntries.map((record) => record.entityId),
      );
      assert.deepEqual(
        vault.byFamily.event?.map((record) => record.entityId),
        vault.events.map((record) => record.entityId),
      );
      assert.deepEqual(
        vault.byFamily.sample?.map((record) => record.entityId),
        vault.samples.map((record) => record.entityId),
      );
      assert.deepEqual(
        vault.byFamily.audit?.map((record) => record.entityId),
        vault.audits.map((record) => record.entityId),
      );
      assert.deepEqual(
        vault.byFamily.family?.map((record) => record.entityId),
        vault.entities
          .filter((record) => record.family === "family")
          .map((record) => record.entityId),
      );
      assert.deepEqual(
        vault.byFamily.genetics?.map((record) => record.entityId),
        vault.entities
          .filter((record) => record.family === "genetics")
          .map((record) => record.entityId),
      );

      const experiment = getExperiment(vault, "low-carb");
      assert.equal(experiment?.title, "Low Carb Trial");
      assert.equal(experiment?.attributes.startedOn, "2026-03-01");

      const journal = getJournalEntry(vault, "2026-03-10");
      assert.equal(journal?.title, "March 10");

      const mealRecord = lookupEntityById(vault, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealRecord?.family, "event");
      assert.equal(mealRecord?.entityId, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealRecord?.primaryLookupId, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealRecord?.attributes.kind, "meal");
      assert.deepEqual(mealRecord?.attributes.eventIds, ["evt_01JNV4MEAL000000000000001"]);

      const mealEventAlias = lookupEntityById(vault, "evt_01JNV4MEAL000000000000001");
      assert.equal(mealEventAlias?.entityId, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealEventAlias?.primaryLookupId, "meal_01JNV4MEAL00000000000001");

      const documentRecord = lookupEntityById(vault, "doc_01JNV4DOC0000000000000001");
      assert.equal(documentRecord?.entityId, "doc_01JNV4DOC0000000000000001");
      assert.equal(documentRecord?.primaryLookupId, "doc_01JNV4DOC0000000000000001");
      assert.equal(documentRecord?.attributes.documentId, "doc_01JNV4DOC0000000000000001");
      assert.equal(
        documentRecord?.attributes.documentPath,
        "raw/documents/2026/03/doc_01JNV4DOC0000000000000001/lab-report.pdf",
      );
      assert.equal(documentRecord?.attributes.mimeType, "application/pdf");

      const legacyJournal = getJournalEntry(vault, "2026-03-11");
      assert.deepEqual(legacyJournal?.attributes.eventIds, ["evt_01JNV4NOTE000000000000001"]);
      assert.deepEqual(legacyJournal?.attributes.sampleStreams, ["heart_rate"]);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  },
);

test("readVault keeps legacy convenience arrays isolated from byFamily buckets", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);

    assert.notStrictEqual(vault.experiments, vault.byFamily.experiment);
    assert.notStrictEqual(vault.events, vault.byFamily.event);

    vault.experiments.pop();
    vault.events.pop();

    assert.equal(vault.experiments.length, 0);
    assert.equal(vault.events.length, 2);
    assert.equal(vault.byFamily.experiment?.length, 1);
    assert.equal(vault.byFamily.event?.length, 3);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault rejects vault metadata with removed layout fields", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const metadataPath = path.join(vaultRoot, "vault.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.paths = {
      coreDocument: "CORE.md",
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    await assert.rejects(
      () => readVault(vaultRoot),
      (error) => hasErrorCode(error, "VAULT_INVALID_METADATA"),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault rejects explicit older vault format versions", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const metadataPath = path.join(vaultRoot, "vault.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.formatVersion = 0;
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    await assert.rejects(
      () => readVault(vaultRoot),
      (error) => hasErrorCode(error, "VAULT_UPGRADE_REQUIRED"),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("searchVaultRuntime rejects explicit newer vault format versions before rebuilding", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const metadataPath = path.join(vaultRoot, "vault.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.formatVersion = CURRENT_VAULT_FORMAT_VERSION + 1;
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    await assert.rejects(
      () => searchVaultRuntime(vaultRoot, "lab report"),
      (error) => hasErrorCode(error, "VAULT_UPGRADE_UNSUPPORTED"),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("list helpers apply date, tag, text, and kind filters against contract data", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);

    const marchRecords = listEntities(vault, {
      from: "2026-03-10",
      to: "2026-03-10",
    });
    assert.deepEqual(
      marchRecords.map((record) => record.entityId),
      [
        "journal:2026-03-10",
        "smp_01JNV4GLU000000000000001",
        "smp_01JNV4HR0000000000000001",
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z400",
        "meal_01JNV4MEAL00000000000001",
        "smp_01JNV4GLU000000000000002",
        "smp_01JNV4HR0000000000000002",
      ],
    );

    const mealRecords = listEntities(vault, { kinds: ["meal"] });
    assert.deepEqual(
      mealRecords.map((record) => record.entityId),
      ["meal_01JNV4MEAL00000000000001"],
    );

    const documentRecords = listEntities(vault, { ids: ["evt_01JNV4DOC000000000000001"] });
    assert.deepEqual(
      documentRecords.map((record) => record.entityId),
      ["doc_01JNV4DOC0000000000000001"],
    );

    const taggedExperiments = listExperiments(vault, { tags: ["nutrition"] });
    assert.deepEqual(
      taggedExperiments.map((record) => record.experimentSlug),
      ["low-carb"],
    );

    const matchingJournal = listJournalEntries(vault, { text: "steady energy" });
    assert.deepEqual(
      matchingJournal.map((record) => record.date),
      ["2026-03-10"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("summarizeDailySamples groups by day and stream with stable numeric aggregates", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);
    const summaries = summarizeDailySamples(vault, {
      from: "2026-03-10",
      to: "2026-03-11",
    });

    assert.deepEqual(
      summaries.map((summary) => [summary.date, summary.stream, summary.sampleCount]),
      [
        ["2026-03-10", "glucose", 2],
        ["2026-03-10", "heart_rate", 2],
        ["2026-03-11", "heart_rate", 1],
      ],
    );

    const glucoseSummary = summaries.find((summary) => summary.stream === "glucose");
    assert.equal(glucoseSummary?.averageValue, 96);
    assert.equal(glucoseSummary?.minValue, 92);
    assert.equal(glucoseSummary?.maxValue, 100);
    assert.equal(glucoseSummary?.unit, "mg_dL");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("listEntities prefers stored local day keys over UTC-derived dates", () => {
  const vault = createEmptyReadModel();
  const sample = createSampleRecord({
    id: "smp_local_day_01",
    occurredAt: "2026-03-26T21:00:00.000Z",
    date: "2026-03-27",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 94,
      unit: "mg_dL",
    },
  });

  vault.samples = [sample];
  vault.entities = [sample];
  syncVaultDerivedFields(vault);

  assert.deepEqual(
    listEntities(vault, {
      from: "2026-03-27",
      to: "2026-03-27",
    }).map((record) => record.entityId),
    ["smp_local_day_01"],
  );
  assert.deepEqual(
    listEntities(vault, {
      from: "2026-03-26",
      to: "2026-03-26",
    }).map((record) => record.entityId),
    [],
  );
});

test("createVaultReadModel keeps manual query fixtures aligned with records and byFamily", () => {
  const vault = createEmptyReadModel();
  const sample = createSampleRecord({
    id: "smp_sync_01",
    occurredAt: "2026-03-27T08:00:00.000Z",
    date: "2026-03-27",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 88,
      unit: "mg_dL",
    },
  });

  vault.samples = [sample];

  assert.deepEqual(vault.entities.map((record) => record.entityId), ["smp_sync_01"]);
  assert.deepEqual(vault.byFamily.sample?.map((record) => record.entityId), [
    "smp_sync_01",
  ]);
  assert.deepEqual(vault.samples.map((record) => record.entityId), ["smp_sync_01"]);
});

test("createVaultReadModel accepts canonical entities as the authoritative read-model input", () => {
  const entity: CanonicalEntity = {
    entityId: "goal_sleep_01",
    primaryLookupId: "improve-sleep",
    lookupIds: ["goal_sleep_01", "improve-sleep"],
    family: "goal",
    recordClass: "bank",
    kind: "goal",
    status: "active",
    occurredAt: null,
    date: "2026-03-27",
    path: "bank/goals/improve-sleep.md",
    title: "Improve sleep consistency",
    body: "Keep a stable bedtime.",
    attributes: {
      slug: "improve-sleep",
      status: "active",
    },
    frontmatter: {
      slug: "improve-sleep",
      status: "active",
      title: "Improve sleep consistency",
    },
    links: normalizeCanonicalLinks([
      {
        type: "related_to",
        targetId: "cond_sleep_01",
      },
    ]),
    relatedIds: ["cond_sleep_01"],
    stream: null,
    experimentSlug: null,
    tags: ["sleep"],
  };
  const vault = createVaultReadModel({
    vaultRoot: "/tmp/entity-vault",
    metadata: null,
    entities: [entity],
  });

  assert.deepEqual(vault.entities.map((entry) => entry.entityId), ["goal_sleep_01"]);
  assert.deepEqual(vault.entities.map((record) => record.entityId), ["goal_sleep_01"]);
  assert.deepEqual(vault.byFamily.goal?.map((record) => record.entityId), ["goal_sleep_01"]);
  assert.deepEqual(vault.goals.map((record) => record.entityId), ["goal_sleep_01"]);
  assert.equal(vault.entities[0]?.primaryLookupId, "improve-sleep");
  assert.equal(vault.entities[0]?.path, "bank/goals/improve-sleep.md");
});

test("createVaultReadModel preserves manual entity paths", () => {
  const entity = createRecord({
    id: "goal_manual_source_01",
    recordType: "goal",
    sourcePath: "bank/goals/manual-source.md",
    primaryLookupId: "manual-source",
    title: "Manual source fixture",
    data: {},
    frontmatter: {},
  });
  const vault = createVaultReadModel({
    vaultRoot: "/tmp/entity-vault",
    metadata: null,
    entities: [entity],
  });

  assert.equal(vault.entities[0]?.path, "bank/goals/manual-source.md");
  assert.equal(vault.goals[0]?.path, "bank/goals/manual-source.md");
});

test("buildExportPack produces derived exports payloads without touching the vault", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      from: "2026-03-10",
      to: "2026-03-10",
      experimentSlug: "low-carb",
      packId: "focus-pack",
      generatedAt: "2026-03-12T15:00:00.000Z",
    });

    assert.equal(pack.format, "murph.export-pack.v1");
    assert.equal(pack.basePath, "exports/packs/focus-pack");
    assert.equal(pack.manifest.recordCount, 0);
    assert.equal(pack.manifest.experimentCount, 1);
    assert.equal(pack.manifest.journalCount, 0);
    assert.equal(pack.manifest.questionCount, 4);
    assert.equal(pack.manifest.fileCount, 5);
    assert.equal(pack.files.length, 5);
    assert.ok(pack.files.every((file) => file.path.startsWith("exports/packs/focus-pack/")));

    const manifestFile = pack.files.find((file) => file.path.endsWith("manifest.json"));
    assert.ok(manifestFile);
    assert.match(manifestFile.contents, /"format": "murph.export-pack.v1"/);
    assert.match(manifestFile.contents, /"fileCount": 5/);

    const questionPackFile = pack.files.find((file) =>
      file.path.endsWith("question-pack.json"),
    );
    assert.ok(questionPackFile);
    assert.match(questionPackFile.contents, /"format": "murph.question-pack.v1"/);
    assert.match(questionPackFile.contents, /low-carb experiment/);

    const assistantFile = pack.files.find((file) =>
      file.path.endsWith("assistant-context.md"),
    );
    assert.ok(assistantFile);
    assert.match(assistantFile.contents, /Murph Export Pack/);
    assert.match(assistantFile.contents, /## Questions/);
    assert.match(assistantFile.contents, /Low Carb Trial/);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildExportPack sanitizes explicit pack ids before deriving output paths", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      packId: "../../unsafe pack",
      generatedAt: "2026-03-12T15:00:00.000Z",
    });

    assert.equal(pack.packId, "unsafe-pack");
    assert.equal(pack.basePath, "exports/packs/unsafe-pack");
    assert.ok(pack.files.every((file) => file.path.startsWith("exports/packs/unsafe-pack/")));
    assert.ok(pack.files.every((file) => !file.path.includes("..")));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault rejects alias-heavy fixtures once query reads go canonical-only", async () => {
  const vaultRoot = await createSparseVault();

  try {
    await assert.rejects(
      () => readVault(vaultRoot),
      /Missing canonical "experimentId" in experiment frontmatter at bank\/experiments\/recovery-plan\.md\./u,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("health registry queries prefer canonical fields and stable title ordering", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const family = await listFamilyMembers(vaultRoot);
    const genetics = await listGeneticVariants(vaultRoot);

    assert.deepEqual(
      family.map((record) => record.entity.id),
      [
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      ],
    );
    assert.equal(family[1]?.entity.title, "Mother");
    assert.equal(family[1]?.entity.relationship, "mother");
    assert.equal(family[1]?.entity.note, null);
    assert.deepEqual(family[0]?.entity.relatedVariantIds, ["var_01JNW7YJ7MNE7M9Q2QWQK4Z400"]);
    assert.deepEqual(family[1]?.entity.relatedVariantIds, []);

    assert.deepEqual(
      genetics.map((record) => record.entity.id),
      [
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z400",
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z401",
      ],
    );
    assert.equal(genetics[0]?.entity.title, "APOE e4 allele");
    assert.deepEqual(genetics[1]?.entity.sourceFamilyMemberIds, ["fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("summarizeDailySamples honors filters and ignores incomplete sample records", () => {
  const vault = createEmptyReadModel();
  vault.samples = [
    createSampleRecord({
      id: "smp_filter_01",
      occurredAt: null,
      date: null,
      stream: "glucose",
      sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
      data: { value: 91, unit: "mg_dL" },
    }),
    createSampleRecord({
      id: "smp_filter_02",
      stream: null,
      sourcePath: "ledger/samples/unknown/2026/2026-03.jsonl",
      data: { value: 88, unit: "mg_dL" },
    }),
    createSampleRecord({
      id: "smp_filter_03",
      occurredAt: "2026-03-10T08:00:00Z",
      stream: "glucose",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
      data: { value: 92, unit: "mg_dL" },
    }),
    createSampleRecord({
      id: "smp_filter_04",
      occurredAt: "2026-03-10T12:00:00Z",
      stream: "glucose",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
      data: { value: "n/a", unit: "mmol/L" },
    }),
    createSampleRecord({
      id: "smp_filter_05",
      occurredAt: "2026-03-10T18:00:00Z",
      stream: "glucose",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03-b.jsonl",
      data: { value: 98, unit: "mmol/L" },
    }),
    createSampleRecord({
      id: "smp_filter_06",
      occurredAt: "2026-03-10T19:00:00Z",
      stream: "heart_rate",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
      data: { value: 63, unit: "bpm" },
    }),
    createSampleRecord({
      id: "smp_filter_07",
      occurredAt: "2026-03-10T20:00:00Z",
      stream: "glucose",
      experimentSlug: "other-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03-c.jsonl",
      data: { value: 110, unit: "mg_dL" },
    }),
  ];
  syncVaultDerivedFields(vault);

  const summaries = summarizeDailySamples(vault, {
    from: "2026-03-10",
    to: "2026-03-10",
    streams: ["glucose"],
    experimentSlug: "recovery-plan",
  });

  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries[0]?.sampleIds, [
    "smp_filter_03",
  ]);
  assert.deepEqual(summaries[0]?.sourcePaths, [
    "ledger/samples/glucose/2026/2026-03.jsonl",
  ]);
  assert.deepEqual(summaries[0]?.units, ["mg_dL"]);
  assert.equal(summaries[0]?.unit, "mg_dL");
  assert.equal(summaries[0]?.minValue, 92);
  assert.equal(summaries[0]?.maxValue, 92);
  assert.equal(summaries[0]?.averageValue, 92);
  assert.equal(summaries[0]?.firstSampleAt, "2026-03-10T08:00:00Z");
  assert.equal(summaries[0]?.lastSampleAt, "2026-03-10T08:00:00Z");
  assert.deepEqual(summaries[1]?.sampleIds, [
    "smp_filter_04",
    "smp_filter_05",
  ]);
  assert.deepEqual(summaries[1]?.sourcePaths, [
    "ledger/samples/glucose/2026/2026-03-b.jsonl",
    "ledger/samples/glucose/2026/2026-03.jsonl",
  ]);
  assert.deepEqual(summaries[1]?.units, ["mmol/L"]);
  assert.equal(summaries[1]?.unit, "mmol/L");
  assert.equal(summaries[1]?.minValue, 98);
  assert.equal(summaries[1]?.maxValue, 98);
  assert.equal(summaries[1]?.averageValue, 98);
  assert.equal(summaries[1]?.firstSampleAt, "2026-03-10T12:00:00Z");
  assert.equal(summaries[1]?.lastSampleAt, "2026-03-10T18:00:00Z");
});

test("buildExportPack omits optional sections when the scoped vault is empty", () => {
  const pack = buildExportPack(createEmptyReadModel());

  assert.equal(pack.packId, "pack-start-end-all");
  assert.equal(pack.manifest.recordCount, 0);
  assert.equal(pack.manifest.questionCount, 2);
  assert.equal(pack.manifest.fileCount, 5);

  const assistantFile = pack.files.find((file) =>
    file.path.endsWith("assistant-context.md"),
  );
  const questionPackFile = pack.files.find((file) =>
    file.path.endsWith("question-pack.json"),
  );

  assert.ok(assistantFile);
  assert.ok(questionPackFile);
  assert.match(assistantFile.contents, /No sample summaries in scope/);
  assert.doesNotMatch(assistantFile.contents, /## Experiment Focus/);
  assert.doesNotMatch(assistantFile.contents, /## Journal Highlights/);

  const questionPack = JSON.parse(questionPackFile.contents) as {
    questions: string[];
    context: {
      experiment: unknown;
      journals: unknown[];
      dailySampleSummaries: unknown[];
    };
  };

  assert.deepEqual(questionPack.questions, [
    "What are the most important changes or events between the start and the end?",
    "Which entities look most actionable for follow-up, and why?",
  ]);
  assert.equal(questionPack.context.experiment, null);
  assert.deepEqual(questionPack.context.journals, []);
  assert.deepEqual(questionPack.context.dailySampleSummaries, []);
});

test("buildExportPack renders experiment, journal, timeline, and meal prompts for rich scoped packs", () => {
  const vault = createEmptyReadModel();
  const experiment = createRecord({
    id: "exp_focus",
    lookupIds: ["exp_focus", "focus"],
    recordType: "experiment",
    sourcePath: "bank/experiments/focus.md",
    occurredAt: "2026-03-09T08:00:00Z",
    date: "2026-03-09",
    kind: "experiment",
    experimentSlug: "focus",
    title: "Focus Trial",
    tags: ["focus"],
    data: {
      experimentId: "exp_focus",
      slug: "focus",
      startedOn: "2026-03-09",
    },
    body: "Experiment body",
    frontmatter: {
      experimentId: "exp_focus",
      slug: "focus",
    },
  });
  const journal = createRecord({
    id: "journal:2026-03-10",
    lookupIds: ["journal:2026-03-10", "2026-03-10"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-10.md",
    occurredAt: "2026-03-10T20:00:00Z",
    date: "2026-03-10",
    kind: "journal_day",
    experimentSlug: "focus",
    title: "March 10",
    tags: ["focus"],
    data: {
      eventIds: ["meal_focus"],
      sampleStreams: ["glucose"],
    },
    body: "Journal summary",
    frontmatter: {
      dayKey: "2026-03-10",
    },
  });
  const meal = createRecord({
    id: "meal_focus",
    lookupIds: ["meal_focus", "evt_meal_focus"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-10T12:00:00Z",
    date: "2026-03-10",
    kind: "meal",
    experimentSlug: "focus",
    title: null,
    tags: ["meal"],
    data: {
      kind: "meal",
      mealId: "meal_focus",
    },
    body: "Meal detail\nSecond line",
    frontmatter: null,
  });
  const note = createRecord({
    id: "evt_focus_note",
    lookupIds: ["evt_focus_note"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-10T18:00:00Z",
    date: "2026-03-10",
    kind: "note",
    experimentSlug: "focus",
    title: null,
    tags: [],
    data: {
      kind: "note",
    },
    body: null,
    frontmatter: null,
  });
  const sampleA = createSampleRecord({
    id: "smp_focus_01",
    occurredAt: "2026-03-10T08:00:00Z",
    experimentSlug: "focus",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: { value: 91, unit: "mg_dL" },
  });
  const sampleB = createSampleRecord({
    id: "smp_focus_02",
    occurredAt: "2026-03-10T09:00:00Z",
    experimentSlug: "focus",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: { value: 95, unit: "mg_dL" },
  });

  vault.experiments = [experiment];
  vault.journalEntries = [journal];
  vault.events = [meal, note];
  vault.samples = [sampleA, sampleB];
  vault.entities = [experiment, journal, sampleA, meal, sampleB, note];
  syncVaultDerivedFields(vault);

  const pack = buildExportPack(vault, {
    from: "2026-03-10",
    to: "2026-03-10",
    experimentSlug: "focus",
    generatedAt: "2026-03-12T15:00:00.000Z",
  });

  assert.equal(pack.packId, "pack-2026-03-10-2026-03-10-focus");
  assert.equal(pack.manifest.recordCount, 5);
  assert.equal(pack.manifest.experimentCount, 1);
  assert.equal(pack.manifest.journalCount, 1);
  assert.equal(pack.manifest.sampleSummaryCount, 1);
  assert.ok(
    pack.questionPack.questions.some((question) =>
      question.includes("focus experiment"),
    ),
  );
  assert.ok(
    pack.questionPack.questions.some((question) =>
      question.includes("meals or meal-adjacent"),
    ),
  );

  const assistantFile = pack.files.find((file) =>
    file.path.endsWith("assistant-context.md"),
  );

  assert.ok(assistantFile);
  assert.match(assistantFile.contents, /## Experiment Focus/);
  assert.match(assistantFile.contents, /## Journal Highlights/);
  assert.match(assistantFile.contents, /## Entity Timeline/);
  assert.match(assistantFile.contents, /## Daily Sample Summaries/);
  assert.match(assistantFile.contents, /Meal detail/);
  assert.match(assistantFile.contents, /note \| evt_focus_note \| note/);
});

test("model helpers return null or empty results for unmatched ids and filters", () => {
  const vault = createEmptyReadModel();
  const experiment = createRecord({
    id: "experiment:focus",
    lookupIds: ["experiment:focus", "focus"],
    recordType: "experiment",
    sourcePath: "bank/experiments/focus.md",
    experimentSlug: "focus",
    title: "Focus",
    tags: ["focus"],
    data: {},
    frontmatter: {},
  });
  const journal = createRecord({
    id: "journal:2026-03-12",
    lookupIds: ["journal:2026-03-12", "2026-03-12"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    experimentSlug: "focus",
    title: "March 12",
    tags: ["focus"],
    data: {},
    body: "Steady day",
    frontmatter: {},
  });
  const orphanEvent = createRecord({
    id: "evt_orphan",
    lookupIds: ["evt_orphan"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: null,
    date: null,
    kind: "",
    stream: null,
    title: null,
    tags: [],
    data: {},
    body: null,
    frontmatter: null,
  });

  vault.experiments = [experiment];
  vault.journalEntries = [journal];
  vault.entities = [experiment, journal, orphanEvent];
  syncVaultDerivedFields(vault);

  assert.equal(lookupEntityById(vault, "unknown-id"), null);
  assert.equal(getExperiment(vault, "missing"), null);
  assert.equal(getJournalEntry(vault, "2026-03-13"), null);
  assert.deepEqual(listExperiments(vault, { slug: "missing" }), []);
  assert.deepEqual(listJournalEntries(vault, { from: "2026-03-13" }), []);
  assert.deepEqual(listEntities(vault, { streams: ["glucose"] }), []);
  assert.deepEqual(listEntities(vault, { from: "2026-03-10" }).map((record) => record.entityId), [
    "journal:2026-03-12",
  ]);
});

test("searchVault ranks body and structured matches while excluding raw samples by default", () => {
  const vault = createEmptyReadModel();
  const journal = createRecord({
    id: "journal:2026-03-12",
    lookupIds: ["journal:2026-03-12", "2026-03-12"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    kind: "journal_day",
    title: "March 12",
    tags: ["focus"],
    body: "Steady energy. Afternoon crash after pasta lunch and coffee.",
    frontmatter: {
      dayKey: "2026-03-12",
    },
  });
  const meal = createRecord({
    id: "meal_01",
    lookupIds: ["meal_01", "evt_meal_01"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T12:15:00Z",
    date: "2026-03-12",
    kind: "meal",
    title: "Lunch",
    tags: ["meal", "lunch"],
    data: {
      mealId: "meal_01",
      note: "Afternoon crash after pasta and coffee.",
    },
    body: "Pasta with coffee at lunch.",
  });
  const sample = createSampleRecord({
    id: "smp_01",
    occurredAt: "2026-03-12T18:00:00Z",
    stream: "heart_rate",
    sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
    data: {
      value: 72,
      unit: "bpm",
      note: "brief spike",
    },
  });

  vault.journalEntries = [journal];
  vault.events = [meal];
  vault.samples = [sample];
  vault.entities = [journal, meal, sample];
  syncVaultDerivedFields(vault);

  const result = searchVault(vault, "afternoon crash pasta", {
    limit: 10,
  });

  assert.equal(result.format, "murph.search.v1");
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.hits.map((hit) => hit.recordId),
    ["journal:2026-03-12", "meal_01"],
  );
  assert.match(result.hits[0]?.snippet ?? "", /afternoon crash/i);
  assert.deepEqual(result.hits[0]?.matchedTerms, ["afternoon", "crash", "pasta"]);
});

test("searchVault includes sample rows when the caller scopes by sample record type or stream", () => {
  const vault = createEmptyReadModel();
  const sample = createSampleRecord({
    id: "smp_glucose_01",
    occurredAt: "2026-03-12T08:00:00Z",
    stream: "glucose",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 104,
      unit: "mg_dL",
      note: "post meal spike",
    },
  });

  vault.samples = [sample];
  vault.entities = [sample];
  syncVaultDerivedFields(vault);

  const result = searchVault(vault, "glucose spike", {
    streams: ["glucose"],
  });

  assert.equal(result.total, 1);
  assert.equal(result.hits[0]?.recordId, "smp_glucose_01");
  assert.equal(result.hits[0]?.recordType, "sample");
  assert.equal(result.hits[0]?.stream, "glucose");
});

test("overview selectors move cleanly onto the query read model", () => {
  const vault = createEmptyReadModel();
  const goal = createRecord({
    id: "goal_sleep_01",
    recordType: "goal",
    sourcePath: "bank/goals/protect-sleep.md",
    title: "Protect sleep consistency",
  });
  const currentProfile = createRecord({
    id: "profile_current_01",
    recordType: "current_profile",
    sourcePath: "bank/profile/current.md",
    occurredAt: "2026-03-12T14:00:00Z",
    title: "Current Profile",
    body: "# Current Profile\n- Sleep steadier and the evening routine is holding.",
    data: {},
  });
  const latestSnapshot = createRecord({
    id: "psnap_01",
    recordType: "profile_snapshot",
    sourcePath: "ledger/profile-snapshots/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T13:55:00Z",
    data: {
      profile: {
        goals: {
          topGoalIds: ["goal_sleep_01"],
        },
      },
    },
  });
  const journalNewer = createRecord({
    id: "journal:2026-03-12",
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    title: "March 12",
    tags: ["recovery"],
    body: "# March 12\nSteadier sleep after the lighter dinner.",
  });
  const journalOlder = createRecord({
    id: "journal:2026-03-10",
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-10.md",
    date: "2026-03-10",
    title: "March 10",
    body: "Earlier note.",
  });
  const activeExperiment = createRecord({
    id: "exp_sleep_reset_01",
    recordType: "experiment",
    sourcePath: "bank/experiments/sleep-reset.md",
    occurredAt: "2026-03-01T00:00:00Z",
    date: "2026-03-01",
    experimentSlug: "sleep-reset",
    title: "Sleep Reset",
    status: "active",
    tags: ["sleep"],
    body: "# Sleep Reset\nTracking sleep consistency.",
  });
  const completedExperiment = createRecord({
    id: "exp_completed_01",
    recordType: "experiment",
    sourcePath: "bank/experiments/completed.md",
    occurredAt: "2026-03-15T00:00:00Z",
    date: "2026-03-15",
    experimentSlug: "completed",
    title: "Completed Trial",
    status: "completed",
    body: "Finished and documented.",
  });

  vault.currentProfile = currentProfile;
  vault.profileSnapshots = [latestSnapshot];
  vault.goals = [goal];
  vault.journalEntries = [journalOlder, journalNewer];
  vault.experiments = [completedExperiment, activeExperiment];
  vault.entities = [
    goal,
    currentProfile,
    latestSnapshot,
    journalOlder,
    journalNewer,
    completedExperiment,
    activeExperiment,
  ];
  syncVaultDerivedFields(vault);

  assert.deepEqual(
    buildOverviewMetrics(vault).map((metric) => [metric.label, metric.value]),
    [
      ["entities", 7],
      ["events", 0],
      ["samples", 0],
      ["journal days", 2],
      ["experiments", 2],
      ["registries", 1],
    ],
  );
  assert.deepEqual(summarizeCurrentOverviewProfile(vault), {
    id: "profile_current_01",
    recordedAt: "2026-03-12T14:00:00Z",
    summary: "Sleep steadier and the evening routine is holding.",
    title: "Current Profile",
    topGoals: [
      {
        id: "goal_sleep_01",
        title: "Protect sleep consistency",
      },
    ],
  });
  assert.deepEqual(
    summarizeRecentOverviewJournals(vault).map((entry) => ({
      date: entry.date,
      summary: entry.summary,
      title: entry.title,
    })),
    [
      {
        date: "2026-03-12",
        summary: "Steadier sleep after the lighter dinner.",
        title: "March 12",
      },
      {
        date: "2026-03-10",
        summary: "Earlier note.",
        title: "March 10",
      },
    ],
  );
  assert.deepEqual(
    summarizeOverviewExperiments(vault).map((entry) => ({
      status: entry.status,
      title: entry.title,
    })),
    [
      {
        status: "active",
        title: "Sleep Reset",
      },
      {
        status: "completed",
        title: "Completed Trial",
      },
    ],
  );
});

test("profile snapshot query projections keep nested typed summary fields", () => {
  const entity = projectProfileSnapshotEntity(
    {
      id: "psnap_01",
      recordedAt: "2026-03-12T13:55:00Z",
      source: "manual",
      profile: {
        narrative: {
          summary: "Sleep steadier and the evening routine is holding.",
        },
        goals: {
          topGoalIds: ["goal_sleep_01"],
        },
      },
    },
    "ledger/profile-snapshots/2026/2026-03.jsonl",
  );

  assert.ok(entity);
  assert.equal(entity.title, "Sleep steadier and the evening routine is holding.");
  assert.equal(entity.body, "Sleep steadier and the evening routine is holding.");
  assert.equal(
    profileSnapshotRecordFromEntity(entity)?.summary,
    "Sleep steadier and the evening routine is holding.",
  );
});

test("buildOverviewWeeklyStats keeps same-stream units separate across timezone week windows", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-23T23:30:00.000Z"));

  try {
    const vault = createEmptyReadModel();
    const currentHours = createSampleRecord({
      id: "smp_sleep_hours_current",
      occurredAt: "2026-03-23T21:00:00.000Z",
      date: "2026-03-24",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 8,
        unit: "hrs",
      },
    });
    const currentMinutes = createSampleRecord({
      id: "smp_sleep_minutes_current",
      occurredAt: "2026-03-23T22:00:00.000Z",
      date: "2026-03-24",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 480,
        unit: "min",
      },
    });
    const previousHours = createSampleRecord({
      id: "smp_sleep_hours_previous",
      occurredAt: "2026-03-16T21:00:00.000Z",
      date: "2026-03-17",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 7,
        unit: "hrs",
      },
    });
    const previousMinutes = createSampleRecord({
      id: "smp_sleep_minutes_previous",
      occurredAt: "2026-03-16T22:00:00.000Z",
      date: "2026-03-17",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 420,
        unit: "min",
      },
    });

    vault.samples = [
      currentHours,
      currentMinutes,
      previousHours,
      previousMinutes,
    ];
    syncVaultDerivedFields(vault);

    assert.deepEqual(buildOverviewWeeklyStats(vault, "Australia/Melbourne"), [
      {
        currentWeekAvg: 8,
        deltaPercent: ((8 - 7) / 7) * 100,
        previousWeekAvg: 7,
        stream: "sleep",
        unit: "hrs",
      },
      {
        currentWeekAvg: 480,
        deltaPercent: ((480 - 420) / 420) * 100,
        previousWeekAvg: 420,
        stream: "sleep",
        unit: "min",
      },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("buildOverviewWeeklyStats returns null delta when previous week avg is zero", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-23T23:30:00.000Z"));

  try {
    const vault = createEmptyReadModel();
    const currentWeek = createSampleRecord({
      id: "smp_sleep_hours_current_nonzero",
      occurredAt: "2026-03-23T21:00:00.000Z",
      date: "2026-03-24",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 8,
        unit: "hrs",
      },
    });
    const previousWeek = createSampleRecord({
      id: "smp_sleep_hours_previous_zero",
      occurredAt: "2026-03-16T21:00:00.000Z",
      date: "2026-03-17",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 0,
        unit: "hrs",
      },
    });

    vault.samples = [currentWeek, previousWeek];
    syncVaultDerivedFields(vault);

    assert.deepEqual(buildOverviewWeeklyStats(vault, "Australia/Melbourne"), [
      {
        currentWeekAvg: 8,
        deltaPercent: null,
        previousWeekAvg: 0,
        stream: "sleep",
        unit: "hrs",
      },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("searchVaultSafe omits raw path terms and path fields by construction", () => {
  const vault = createEmptyReadModel();
  const pathOnly = createRecord({
    id: "evt_quiet_probe",
    recordType: "event",
    sourcePath: "bank/experiments/path-only-token-probe.md",
    occurredAt: "2026-03-12T09:00:00Z",
    date: "2026-03-12",
    kind: "note",
    title: "Quiet Probe",
    body: "Ordinary notes without the filename token.",
    data: {
      documentPath: "raw/documents/path-only-token-probe.pdf",
    },
  });
  const visible = createRecord({
    id: "evt_recovery_probe",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T10:00:00Z",
    date: "2026-03-12",
    kind: "note",
    title: "Recovery Probe",
    body: "Post-run sleep steadier after stretching.",
  });

  vault.events = [pathOnly, visible];
  vault.entities = [pathOnly, visible];
  syncVaultDerivedFields(vault);

  const fullSearch = searchVault(vault, "path-only-token-probe", {
    includeSamples: true,
  });
  const safePathSearch = searchVaultSafe(vault, "path-only-token-probe", {
    includeSamples: true,
  });
  const safeBodySearch = searchVaultSafe(vault, "post-run", {
    includeSamples: true,
  });

  assert.equal(fullSearch.total, 1);
  assert.equal(safePathSearch.total, 0);
  assert.equal(safeBodySearch.total, 1);
  assert.equal(safeBodySearch.hits[0]?.recordId, "evt_recovery_probe");
  assert.equal("path" in (safeBodySearch.hits[0] ?? {}), false);
  assert.equal("citation" in (safeBodySearch.hits[0] ?? {}), false);
});

test("buildTimeline merges journals, events, and daily sample summaries into a descending feed", () => {
  const vault = createEmptyReadModel();
  const journal = createRecord({
    id: "journal:2026-03-12",
    lookupIds: ["journal:2026-03-12", "2026-03-12"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    kind: "journal_day",
    title: "March 12",
    body: "Good day.",
    frontmatter: {
      dayKey: "2026-03-12",
    },
  });
  const event = createRecord({
    id: "evt_walk_01",
    lookupIds: ["evt_walk_01"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T18:00:00Z",
    date: "2026-03-12",
    kind: "activity_session",
    title: "Walk",
    tags: ["exercise"],
    data: {
      durationMinutes: 30,
    },
  });
  const sampleA = createSampleRecord({
    id: "smp_hr_01",
    occurredAt: "2026-03-12T07:00:00Z",
    stream: "heart_rate",
    sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
    data: {
      value: 60,
      unit: "bpm",
    },
  });
  const sampleB = createSampleRecord({
    id: "smp_hr_02",
    occurredAt: "2026-03-12T20:00:00Z",
    stream: "heart_rate",
    sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
    data: {
      value: 78,
      unit: "bpm",
    },
  });

  vault.journalEntries = [journal];
  vault.events = [event];
  vault.samples = [sampleA, sampleB];
  vault.entities = [journal, sampleA, event, sampleB];
  syncVaultDerivedFields(vault);

  const timeline = buildTimeline(vault, {
    from: "2026-03-12",
    to: "2026-03-12",
  });

  assert.deepEqual(
    timeline.map((entry) => [entry.entryType, entry.id]),
    [
      ["sample_summary", "sample-summary:2026-03-12:heart_rate:bpm"],
      ["event", "evt_walk_01"],
      ["journal", "journal:2026-03-12"],
    ],
  );
  assert.equal(timeline[0]?.kind, "sample_summary");
  assert.equal(timeline[0]?.stream, "heart_rate");
  assert.equal(timeline[0]?.data.averageValue, 69);
});

test("searchVault supports blank queries, structured-only matches, and filter normalization", () => {
  const blank = searchVault(createEmptyReadModel(), "   ");
  assert.equal(blank.total, 0);
  assert.deepEqual(blank.hits, []);

  const vault = createEmptyReadModel();
  const structuredOnly = createRecord({
    id: "evt_structured",
    lookupIds: ["evt_structured", "doc_structured"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T10:00:00Z",
    date: "2026-03-11",
    kind: "document",
    experimentSlug: "iron-study",
    title: "External report",
    tags: ["labs"],
    data: {
      provider: "Labcorp",
      ferritin: 12,
    },
  });
  const wrongExperiment = createRecord({
    id: "evt_wrong_experiment",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T09:00:00Z",
    date: "2026-03-11",
    kind: "document",
    experimentSlug: "other-study",
    title: "Mismatch",
    tags: ["labs"],
    body: "Labcorp ferritin",
  });
  const missingKind = createRecord({
    id: "evt_missing_kind",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T08:00:00Z",
    date: "2026-03-11",
    kind: "",
    experimentSlug: "iron-study",
    title: "Untyped report",
    tags: ["labs"],
    body: "Labcorp ferritin",
  });
  const wrongDate = createRecord({
    id: "evt_wrong_date",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-10T08:00:00Z",
    date: "2026-03-10",
    kind: "document",
    experimentSlug: "iron-study",
    title: "Old report",
    tags: ["labs"],
    body: "Labcorp ferritin",
  });
  const missingTag = createRecord({
    id: "evt_missing_tag",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T11:00:00Z",
    date: "2026-03-11",
    kind: "document",
    experimentSlug: "iron-study",
    title: "Tagless report",
    tags: [],
    body: "Labcorp ferritin",
  });

  vault.events = [
    structuredOnly,
    wrongExperiment,
    missingKind,
    wrongDate,
    missingTag,
  ];
  vault.entities = vault.events;
  syncVaultDerivedFields(vault);

  const result = searchVault(vault, "labcorp ferritin", {
    recordTypes: ["event"],
    kinds: ["document"],
    experimentSlug: "iron-study",
    from: "2026-03-11",
    to: "2026-03-11",
    tags: ["labs"],
    limit: 0,
  });

  assert.equal(result.total, 1);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.recordId, "evt_structured");
  assert.equal(
    result.hits[0]?.snippet,
    "External report · document · iron-study",
  );
});

test("searchVault orders equal scores by recency and trims long snippets around matches", () => {
  const vault = createEmptyReadModel();
  const longBody = `${"before ".repeat(20)}caffeine${" after".repeat(25)}`;
  const older = createRecord({
    id: "evt_caffeine_old",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T09:00:00Z",
    date: "2026-03-11",
    kind: "note",
    title: "Caffeine log",
    body: longBody,
  });
  const newer = createRecord({
    id: "evt_caffeine_new",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T09:00:00Z",
    date: "2026-03-12",
    kind: "note",
    title: "Caffeine log",
    body: longBody,
  });

  vault.events = [older, newer];
  vault.entities = [older, newer];
  syncVaultDerivedFields(vault);

  const result = searchVault(vault, "caffeine");

  assert.deepEqual(
    result.hits.map((hit) => hit.recordId),
    ["evt_caffeine_new", "evt_caffeine_old"],
  );
  assert.match(result.hits[0]?.snippet ?? "", /^\.\.\..+\.\.\.$/);
});

test("scoreSearchDocuments preserves shared hyphenated, Unicode, and one-character token behavior", () => {
  const documents: SearchableDocument[] = [
    {
      aliasIds: [],
      bodyText: "Post-run recovery note.",
      date: "2026-03-12",
      experimentSlug: null,
      kind: "note",
      occurredAt: "2026-03-12T09:00:00Z",
      recordId: "evt_post_run",
      recordType: "event",
      stream: null,
      structuredText: "",
      tags: [],
      tagsText: "",
      title: "Recovery note",
      titleText: "Recovery note",
    },
    {
      aliasIds: [],
      bodyText: "Post run recovery note.",
      date: "2026-03-11",
      experimentSlug: null,
      kind: "note",
      occurredAt: "2026-03-11T09:00:00Z",
      recordId: "evt_post_run_split",
      recordType: "event",
      stream: null,
      structuredText: "",
      tags: [],
      tagsText: "",
      title: "Recovery note",
      titleText: "Recovery note",
    },
    {
      aliasIds: [],
      bodyText: "睡眠 quality improved after the walk.",
      date: "2026-03-13",
      experimentSlug: null,
      kind: "note",
      occurredAt: "2026-03-13T09:00:00Z",
      recordId: "evt_unicode",
      recordType: "event",
      stream: null,
      structuredText: "",
      tags: [],
      tagsText: "",
      title: "Unicode note",
      titleText: "Unicode note",
    },
  ];

  const hyphenated = scoreSearchDocuments(documents, "post-run", {
    includeSamples: true,
    limit: 10,
  });
  assert.deepEqual(hyphenated.hits.map((hit) => hit.recordId), ["evt_post_run"]);
  assert.equal(hyphenated.hits[0]?.path, "");
  assert.match(hyphenated.hits[0]?.snippet ?? "", /post-run/i);

  const unicode = scoreSearchDocuments(documents, "睡眠", {
    includeSamples: true,
    limit: 10,
  });
  assert.deepEqual(unicode.hits.map((hit) => hit.recordId), ["evt_unicode"]);
  assert.deepEqual(unicode.hits[0]?.matchedTerms, ["睡眠"]);

  const oneCharacter = scoreSearchDocuments(documents, "a", {
    includeSamples: true,
    limit: 10,
  });
  assert.equal(oneCharacter.total, 0);
  assert.deepEqual(oneCharacter.hits, []);
});

test("buildTimeline applies toggles, fallback timestamps, and filter caps", () => {
  const vault = createEmptyReadModel();
  const journalFallback = createRecord({
    id: "journal:2026-03-13",
    lookupIds: ["journal:2026-03-13", "2026-03-13"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-13.md",
    occurredAt: "2026-03-13T09:00:00Z",
    date: null,
    kind: "",
    experimentSlug: "focus",
    title: null,
    data: {},
    frontmatter: {},
  });
  const journalMissingDate = createRecord({
    id: "journal:missing",
    lookupIds: ["journal:missing"],
    recordType: "journal",
    sourcePath: "journal/2026/missing.md",
    occurredAt: null,
    date: null,
    kind: "",
    title: "Skip me",
    data: {},
    frontmatter: {},
  });
  const eventFallback = createRecord({
    id: "evt_focus",
    lookupIds: ["evt_focus"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: null,
    date: "2026-03-13",
    kind: "",
    stream: "glucose",
    experimentSlug: "focus",
    title: null,
    data: {},
  });
  const eventWrongStream = createRecord({
    id: "evt_wrong_stream",
    lookupIds: ["evt_wrong_stream"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-13T10:00:00Z",
    date: "2026-03-13",
    kind: "note",
    stream: "heart_rate",
    experimentSlug: "focus",
    title: "Wrong stream",
    data: {},
  });
  const eventMissingDate = createRecord({
    id: "evt_missing_date",
    lookupIds: ["evt_missing_date"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: null,
    date: null,
    kind: "",
    stream: "glucose",
    experimentSlug: "focus",
    title: "Skip me too",
    data: {},
  });
  const sampleFallback = createSampleRecord({
    id: "smp_focus_01",
    occurredAt: null,
    date: "2026-03-13",
    stream: "glucose",
    experimentSlug: "focus",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 91,
      unit: "mg_dL",
    },
  });
  const sampleOtherExperiment = createSampleRecord({
    id: "smp_other_01",
    occurredAt: "2026-03-13T18:00:00Z",
    date: "2026-03-13",
    stream: "glucose",
    experimentSlug: "other",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 99,
      unit: "mg_dL",
    },
  });

  journalFallback.kind = "";
  journalMissingDate.kind = "";
  eventFallback.kind = "";
  eventMissingDate.kind = "";
  sampleFallback.occurredAt = null;

  vault.journalEntries = [journalFallback, journalMissingDate];
  vault.events = [eventFallback, eventWrongStream, eventMissingDate];
  vault.samples = [sampleFallback, sampleOtherExperiment];
  vault.entities = [
    journalFallback,
    journalMissingDate,
    eventFallback,
    eventWrongStream,
    eventMissingDate,
    sampleFallback,
    sampleOtherExperiment,
  ];
  syncVaultDerivedFields(vault);

  const timeline = buildTimeline(vault, {
    from: "2026-03-13",
    to: "2026-03-13",
    experimentSlug: "focus",
    kinds: ["journal_day", "event", "sample_summary"],
    streams: ["glucose"],
    limit: 999,
  });

  assert.deepEqual(
    timeline.map((entry) => [entry.entryType, entry.id]),
    [
      ["sample_summary", "sample-summary:2026-03-13:glucose:mg_dL"],
      ["journal", "journal:2026-03-13"],
      ["event", "evt_focus"],
    ],
  );
  assert.equal(timeline[0]?.occurredAt, "2026-03-13T23:59:59Z");
  assert.equal(timeline[1]?.kind, "journal_day");
  assert.equal(timeline[2]?.occurredAt, "2026-03-13T00:00:00Z");

  const summariesOnly = buildTimeline(vault, {
    experimentSlug: "focus",
    kinds: ["sample_summary"],
    streams: ["glucose"],
    includeJournal: false,
    includeEvents: false,
    limit: 0,
  });

  assert.equal(summariesOnly.length, 1);
  assert.equal(summariesOnly[0]?.entryType, "sample_summary");
});

test("buildTimeline breaks sort ties by date then id when timestamps match", () => {
  const vault = createEmptyReadModel();
  const olderDate = createRecord({
    id: "evt_tie_a",
    lookupIds: ["evt_tie_a"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-13",
    kind: "note",
    title: "Tie A",
    data: {},
  });
  const laterId = createRecord({
    id: "evt_tie_c",
    lookupIds: ["evt_tie_c"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-14",
    kind: "note",
    title: "Tie C",
    data: {},
  });
  const earlierId = createRecord({
    id: "evt_tie_b",
    lookupIds: ["evt_tie_b"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-14",
    kind: "note",
    title: "Tie B",
    data: {},
  });

  vault.events = [olderDate, laterId, earlierId];
  vault.entities = [olderDate, laterId, earlierId];
  syncVaultDerivedFields(vault);

  const timeline = buildTimeline(vault, {
    includeJournal: false,
    includeDailySampleSummaries: false,
  });

  assert.deepEqual(
    timeline.map((entry) => entry.id),
    ["evt_tie_b", "evt_tie_c", "evt_tie_a"],
  );
});

test("buildTimeline excludes records outside the requested date and experiment window", () => {
  const vault = createEmptyReadModel();
  const journal = createRecord({
    id: "journal:2026-03-14",
    lookupIds: ["journal:2026-03-14", "2026-03-14"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-14.md",
    date: "2026-03-14",
    kind: "journal_day",
    experimentSlug: "other",
    title: "March 14",
    data: {},
    frontmatter: {},
  });
  const event = createRecord({
    id: "evt_outside_window",
    lookupIds: ["evt_outside_window"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-14",
    kind: "note",
    experimentSlug: "focus",
    title: "Outside window",
    data: {},
  });
  const sample = createSampleRecord({
    id: "smp_outside_window",
    occurredAt: "2026-03-14T09:00:00Z",
    date: "2026-03-14",
    stream: "glucose",
    experimentSlug: "other",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 101,
      unit: "mg_dL",
    },
  });

  vault.journalEntries = [journal];
  vault.events = [event];
  vault.samples = [sample];
  vault.entities = [journal, event, sample];
  syncVaultDerivedFields(vault);

  const timeline = buildTimeline(vault, {
    from: "2026-03-15",
    to: "2026-03-15",
    experimentSlug: "focus",
  });

  assert.deepEqual(timeline, []);
});

async function createFixtureVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-"));

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/family"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/genetics"), { recursive: true });
  await mkdir(path.join(vaultRoot, "journal/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/samples/heart_rate/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/samples/glucose/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "audit/2026"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify(
      {
        formatVersion: 1,
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
        createdAt: "2026-03-10T06:00:00Z",
        title: "Murph Vault",
        timezone: "America/New_York",
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(vaultRoot, "bank/family/mother.md"),
    `---
schemaVersion: murph.frontmatter.family-member.v1
docType: family_member
familyMemberId: fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8
slug: mother
title: Mother
name: Alias Mother
relationship: mother
relation: alias-mother
familyMemberIds:
  - var_should_not_leak_from_wrong_field
summary: Alias summary that should not leak
updatedAt: 2026-03-12T09:00:00Z
---
# Mother

Tracked for query ordering checks.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/family/father.md"),
    `---
schemaVersion: murph.frontmatter.family-member.v1
docType: family_member
familyMemberId: fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9
slug: father
title: Father
relationship: father
relatedVariantIds:
  - var_01JNW7YJ7MNE7M9Q2QWQK4Z400
updatedAt: 2026-03-10T09:00:00Z
---
# Father

Has a linked canonical variant id.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/genetics/apoe-e4.md"),
    `---
schemaVersion: murph.frontmatter.genetic-variant.v1
docType: genetic_variant
variantId: var_01JNW7YJ7MNE7M9Q2QWQK4Z400
slug: apoe-e4
title: APOE e4 allele
label: Alias APOE label
gene: APOE
significance: risk_factor
sourceFamilyMemberIds:
  - fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9
updatedAt: 2026-03-10T10:00:00Z
---
# APOE e4 allele

Older genetics record.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/genetics/mthfr-c677t.md"),
    `---
schemaVersion: murph.frontmatter.genetic-variant.v1
docType: genetic_variant
variantId: var_01JNW7YJ7MNE7M9Q2QWQK4Z401
slug: mthfr-c677t
title: MTHFR C677T
gene: MTHFR
significance: risk_factor
sourceFamilyMemberIds:
  - fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8
updatedAt: 2026-03-12T11:00:00Z
---
# MTHFR C677T

Newer genetics record.
`,
  );

  await writeFile(
    path.join(vaultRoot, "CORE.md"),
    `---
schemaVersion: murph.frontmatter.core.v1
docType: core
vaultId: vault_01JNV40W8VFYQ2H7CMJY5A9R4K
title: Core Health Context
timezone: America/New_York
updatedAt: 2026-03-12T20:00:00Z
tags:
  - baseline
---
# Core Health Context

Summary of baseline routines.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/experiments/low-carb.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01JNV4EXP000000000000001
slug: low-carb
status: active
title: Low Carb Trial
startedOn: 2026-03-01
tags:
  - nutrition
  - glucose
---
# Low Carb Trial

Reduce breakfast carbs and observe glucose stability.
`,
  );

  await writeFile(
    path.join(vaultRoot, "journal/2026/2026-03-10.md"),
    `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
eventIds:
  - evt_01JNV4MEAL000000000000001
sampleStreams:
  - glucose
  - heart_rate
---
# March 10

Fasted longer than usual. Steady energy through the afternoon.
`,
  );

  await writeFile(
    path.join(vaultRoot, "journal/2026/2026-03-11.md"),
    `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-11
eventIds:
  - evt_01JNV4NOTE000000000000001
sampleStreams:
  - heart_rate
---
# March 11

Light walk and early bedtime.
`,
  );

  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_01JNV4MEAL000000000000001",
        kind: "meal",
        occurredAt: "2026-03-10T12:15:00Z",
        recordedAt: "2026-03-10T12:16:00Z",
        dayKey: "2026-03-10",
        source: "manual",
        title: "Lunch",
        note: "Eggs and avocado lunch.",
        tags: ["meal", "nutrition"],
        mealId: "meal_01JNV4MEAL00000000000001",
        photoPaths: ["raw/meals/2026/03/meal_01JNV4MEAL00000000000001/photo-lunch.jpg"],
        audioPaths: [],
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_01JNV4NOTE000000000000001",
        kind: "note",
        occurredAt: "2026-03-11T09:00:00Z",
        recordedAt: "2026-03-11T09:00:00Z",
        dayKey: "2026-03-11",
        source: "manual",
        title: "Morning note",
        note: "Slept well and woke up rested.",
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_01JNV4DOC000000000000001",
        kind: "document",
        occurredAt: "2026-03-12T14:00:00Z",
        recordedAt: "2026-03-12T14:02:00Z",
        dayKey: "2026-03-12",
        source: "import",
        title: "Lab report",
        relatedIds: ["doc_01JNV4DOC0000000000000001"],
        documentId: "doc_01JNV4DOC0000000000000001",
        documentPath:
          "raw/documents/2026/03/doc_01JNV4DOC0000000000000001/lab-report.pdf",
        mimeType: "application/pdf",
      }),
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(vaultRoot, "ledger/samples/glucose/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.sample.v1",
        id: "smp_01JNV4GLU000000000000001",
        stream: "glucose",
        recordedAt: "2026-03-10T08:00:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 92,
        unit: "mg_dL",
      }),
      JSON.stringify({
        schemaVersion: "murph.sample.v1",
        id: "smp_01JNV4GLU000000000000002",
        stream: "glucose",
        recordedAt: "2026-03-10T12:15:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 100,
        unit: "mg_dL",
      }),
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(vaultRoot, "ledger/samples/heart_rate/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.sample.v1",
        id: "smp_01JNV4HR0000000000000001",
        stream: "heart_rate",
        recordedAt: "2026-03-10T08:30:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 68,
        unit: "bpm",
      }),
      JSON.stringify({
        schemaVersion: "murph.sample.v1",
        id: "smp_01JNV4HR0000000000000002",
        stream: "heart_rate",
        recordedAt: "2026-03-10T21:30:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 72,
        unit: "bpm",
      }),
      JSON.stringify({
        schemaVersion: "murph.sample.v1",
        id: "smp_01JNV4HR0000000000000003",
        stream: "heart_rate",
        recordedAt: "2026-03-11T08:30:00Z",
        dayKey: "2026-03-11",
        source: "device",
        quality: "raw",
        value: 70,
        unit: "bpm",
      }),
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(vaultRoot, "audit/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.audit.v1",
        id: "aud_01JNV4AUD000000000000001",
        action: "validate",
        status: "success",
        occurredAt: "2026-03-12T07:00:00Z",
        actor: "query",
        commandName: "vault-cli validate",
        summary: "Validated fixture vault.",
        changes: [],
      }),
      "",
    ].join("\n"),
  );

  return vaultRoot;
}

async function createSparseVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-sparse-"));

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "journal/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/samples/glucose/2026"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "bank/experiments/recovery-plan.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experiment_id: exp_01JNV4ALT000000000000001
experiment_slug: recovery-plan
started_on: 2026-03-09
updated_at: 2026-03-09T09:00:00Z
tags:
  - focus
---
Hydration reset baseline.
`,
  );

  await writeFile(
    path.join(vaultRoot, "journal/2026/2026-03-09.md"),
    `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
day_key: 2026-03-09
experiment_slug: recovery-plan
event_ids:
  - evt_01JNV4ALT000000000000001
sample_streams:
  - glucose
tags:
  - focus
---
Steady energy through the afternoon.
`,
  );

  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
    `${JSON.stringify({
      schemaVersion: "murph.event.v1",
      id: "evt_01JNV4ALT000000000000001",
      kind: "note",
      occurred_at: "2026-03-09T09:15:00Z",
      recorded_at: "2026-03-09T09:15:00Z",
      day_key: "2026-03-09",
      source: "manual",
      summary: "Hydration note",
      tags: ["focus"],
    })}\n`,
  );

  await writeFile(
    path.join(vaultRoot, "ledger/samples/glucose/2026/2026-03.jsonl"),
    `${JSON.stringify({
      schemaVersion: "murph.sample.v1",
      recorded_at: "2026-03-09T10:00:00Z",
      day_key: "2026-03-09",
      source: "device",
      quality: "raw",
      value: 94,
      unit: "mg_dL",
    })}\n`,
  );

  return vaultRoot;
}

function createEmptyReadModel(): Awaited<ReturnType<typeof readVault>> {
  return createReadModelFromEntities([]);
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === expectedCode
  );
}

function createReadModelFromEntities(
  entities: Awaited<ReturnType<typeof readVault>>["entities"],
): Awaited<ReturnType<typeof readVault>> {
  return createVaultReadModel({
    vaultRoot: "/tmp/empty-vault",
    metadata: null,
    entities,
  });
}

function syncVaultDerivedFields(vault: Awaited<ReturnType<typeof readVault>>): void {
  vault.entities = vault.entities.length > 0 ? vault.entities.slice() : collectVaultEntities(vault);
}

function collectVaultEntities(
  vault: Awaited<ReturnType<typeof readVault>>,
): Awaited<ReturnType<typeof readVault>>["entities"] {
  return ALL_QUERY_ENTITY_FAMILIES.flatMap(
    (family) => vault.byFamily[family]?.slice() ?? [],
  );
}

function createSampleRecord(overrides: {
  id: string;
  occurredAt?: string | null;
  date?: string | null;
  stream?: string | null;
  experimentSlug?: string | null;
  sourcePath: string;
  data: Record<string, unknown>;
}): Awaited<ReturnType<typeof readVault>>["samples"][number] {
  const occurredAt = overrides.occurredAt ?? "2026-03-10T00:00:00Z";
  const links = normalizeCanonicalLinks([]);

  return {
    entityId: overrides.id,
    primaryLookupId: overrides.id,
    lookupIds: [overrides.id],
    family: "sample",
    recordClass: "sample",
    path: overrides.sourcePath,
    occurredAt,
    date: overrides.date ?? (occurredAt ? occurredAt.split("T", 1)[0] ?? null : null),
    kind: "sample",
    status: null,
    stream: overrides.stream ?? "glucose",
    experimentSlug: overrides.experimentSlug ?? null,
    title: "sample",
    tags: [],
    attributes: overrides.data,
    body: null,
    frontmatter: null,
    links,
    relatedIds: linkTargetIds(links),
  };
}

function createRecord(
  overrides: Omit<
    Partial<Awaited<ReturnType<typeof readVault>>["entities"][number]>,
    "kind" | "status"
  > & {
    id: string;
    recordType: Awaited<ReturnType<typeof readVault>>["entities"][number]["family"];
    sourcePath: string;
    data?: Record<string, unknown>;
    kind?: string | null;
    status?: string | null;
  } & {
    entityId?: string;
    family?: Awaited<ReturnType<typeof readVault>>["entities"][number]["family"];
    path?: string;
    attributes?: Record<string, unknown>;
  },
): Awaited<ReturnType<typeof readVault>>["entities"][number] {
  const entityId = overrides.entityId ?? overrides.id;
  const lookupIds = Array.from(
    new Set(
      overrides.lookupIds ??
        [overrides.primaryLookupId ?? entityId, entityId],
    ),
  );
  const primaryLookupId =
    overrides.primaryLookupId ??
    lookupIds.find((lookupId) => lookupId !== entityId) ??
    entityId;
  const links = normalizeCanonicalLinks(
    (overrides.relatedIds ?? []).map((targetId) => ({
      type: "related_to" as const,
      targetId,
    })),
  );

  return {
    entityId,
    primaryLookupId,
    lookupIds,
    family: overrides.family ?? overrides.recordType,
    recordClass:
      overrides.recordClass ?? resolveCanonicalRecordClass(overrides.family ?? overrides.recordType),
    path: overrides.path ?? overrides.sourcePath,
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    kind: overrides.kind ?? overrides.family ?? overrides.recordType ?? "",
    status: overrides.status ?? null,
    stream: overrides.stream ?? null,
    experimentSlug: overrides.experimentSlug ?? null,
    title: overrides.title ?? null,
    tags: overrides.tags ?? [],
    attributes: overrides.attributes ?? overrides.data ?? {},
    body: overrides.body ?? null,
    frontmatter: overrides.frontmatter ?? null,
    links,
    relatedIds: overrides.relatedIds ?? linkTargetIds(links),
  };
}

test("rebuildQueryProjection materializes the shared query projection and status stays read-only when absent", async () => {
  const vaultRoot = await createFixtureVault();
  const runtimeDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);

  try {
    assert.equal(existsSync(runtimeDatabasePath), false);

    const statusBefore = await getQueryProjectionStatus(vaultRoot);
    assert.equal(statusBefore.exists, false);
    assert.equal(statusBefore.dbPath, QUERY_DB_RELATIVE_PATH);
    assert.equal(existsSync(runtimeDatabasePath), false);

    const vault = await readVault(vaultRoot);
    const rebuilt = await rebuildQueryProjection(vaultRoot);

    assert.equal(rebuilt.exists, true);
    assert.equal(rebuilt.dbPath, QUERY_DB_RELATIVE_PATH);
    assert.equal(rebuilt.schemaVersion, "murph.query-projection.v1");
    assert.equal(rebuilt.entityCount, vault.entities.length);
    assert.equal(rebuilt.searchDocumentCount, vault.entities.length);
    assert.equal(rebuilt.fresh, true);
    assert.equal(existsSync(runtimeDatabasePath), true);

    const statusAfter = await getQueryProjectionStatus(vaultRoot);
    assert.equal(statusAfter.exists, true);
    assert.equal(statusAfter.schemaVersion, rebuilt.schemaVersion);
    assert.equal(statusAfter.entityCount, rebuilt.entityCount);
    assert.equal(statusAfter.searchDocumentCount, rebuilt.searchDocumentCount);
    assert.equal(statusAfter.fresh, true);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("rebuildQueryProjection discards unsupported local stores and recreates the current projection", async () => {
  const vaultRoot = await createFixtureVault();
  const runtimeDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);
  const database = openSqliteRuntimeDatabase(runtimeDatabasePath, { create: true });

  try {
    database.exec(`
      PRAGMA user_version = 2;

      CREATE TABLE query_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE query_entities (
        entity_id TEXT PRIMARY KEY,
        sort_rank INTEGER NOT NULL,
        primary_lookup_id TEXT NOT NULL,
        family TEXT NOT NULL,
        record_class TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT,
        stream TEXT,
        experiment_slug TEXT,
        occurred_at TEXT,
        date TEXT,
        title TEXT,
        tags_json TEXT NOT NULL,
        entity_json TEXT NOT NULL
      );

      CREATE TABLE query_lookup_ids (
        lookup_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        is_primary INTEGER NOT NULL,
        sort_rank INTEGER NOT NULL,
        PRIMARY KEY (lookup_id, entity_id)
      );

      CREATE TABLE query_source_manifest (
        relative_path TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        mtime_ms REAL NOT NULL
      );

      CREATE TABLE query_search_document (
        record_id TEXT PRIMARY KEY,
        alias_ids_json TEXT NOT NULL,
        record_type TEXT NOT NULL,
        kind TEXT,
        stream TEXT,
        title TEXT,
        occurred_at TEXT,
        date TEXT,
        experiment_slug TEXT,
        tags_json TEXT NOT NULL,
        path TEXT NOT NULL,
        title_text TEXT NOT NULL,
        body_text TEXT NOT NULL,
        tags_text TEXT NOT NULL,
        structured_text TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE query_search_fts USING fts5(
        record_id UNINDEXED,
        title_text,
        body_text,
        tags_text,
        structured_text
      );
    `);
  } finally {
    database.close();
  }

  try {
    const rebuilt = await rebuildQueryProjection(vaultRoot);
    const reopened = openSqliteRuntimeDatabase(runtimeDatabasePath, { create: false, readOnly: true });

    try {
      assert.equal(rebuilt.schemaVersion, "murph.query-projection.v1");
      assert.equal(readSqliteRuntimeUserVersion(reopened), 1);
      const legacyLookupTable = reopened
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'query_lookup_ids'
        `)
        .get() as { name?: string } | undefined;
      assert.equal(legacyLookupTable?.name ?? null, null);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("rebuildQueryProjection discards malformed local stores and recreates the current projection", async () => {
  const vaultRoot = await createFixtureVault();
  const runtimeDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);
  const database = openSqliteRuntimeDatabase(runtimeDatabasePath, { create: true });

  try {
    database.exec(`
      PRAGMA user_version = 1;

      CREATE TABLE query_entities (
        entity_id TEXT PRIMARY KEY,
        entity_json TEXT NOT NULL
      );
    `);
  } finally {
    database.close();
  }

  try {
    const rebuilt = await rebuildQueryProjection(vaultRoot);
    const reopened = openSqliteRuntimeDatabase(runtimeDatabasePath, {
      create: false,
      readOnly: true,
    });

    try {
      assert.equal(rebuilt.schemaVersion, "murph.query-projection.v1");
      assert.equal(readSqliteRuntimeUserVersion(reopened), 1);
      const queryMetaTable = reopened
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'query_meta'
        `)
        .get() as { name?: string } | undefined;
      assert.equal(queryMetaTable?.name ?? null, "query_meta");
    } finally {
      reopened.close();
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("searchVaultRuntime discards unsupported local stores before serving results", async () => {
  const vaultRoot = await createFixtureVault();
  const runtimeDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);

  try {
    await rebuildQueryProjection(vaultRoot);
    const legacyDatabase = openSqliteRuntimeDatabase(runtimeDatabasePath, { create: false });

    try {
      legacyDatabase.exec(`
        PRAGMA user_version = 2;
        CREATE TABLE IF NOT EXISTS query_lookup_ids (
          lookup_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          is_primary INTEGER NOT NULL,
          sort_rank INTEGER NOT NULL,
          PRIMARY KEY (lookup_id, entity_id)
        );
      `);
      legacyDatabase
        .prepare(`
          INSERT INTO query_meta (key, value)
          VALUES ('schema_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run("murph.query-projection.v2");
    } finally {
      legacyDatabase.close();
    }

    const statusBefore = await getQueryProjectionStatus(vaultRoot);
    assert.equal(statusBefore.schemaVersion, "murph.query-projection.v2");
    assert.equal(statusBefore.fresh, false);

    const searchResult = await searchVaultRuntime(vaultRoot, "lab report", {
      recordTypes: ["event"],
      kinds: ["document"],
    });
    assert.equal(searchResult.total, 1);

    const reopened = openSqliteRuntimeDatabase(runtimeDatabasePath, {
      create: false,
      readOnly: true,
    });

    try {
      assert.equal(readSqliteRuntimeUserVersion(reopened), 1);
      const legacyLookupTable = reopened
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'query_lookup_ids'
        `)
        .get() as { name?: string } | undefined;
      assert.equal(legacyLookupTable?.name ?? null, null);
    } finally {
      reopened.close();
    }

    const statusAfter = await getQueryProjectionStatus(vaultRoot);
    assert.equal(statusAfter.schemaVersion, "murph.query-projection.v1");
    assert.equal(statusAfter.fresh, true);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("searchVaultRuntime rebuilds the projection automatically and only returns sample rows when explicitly requested", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const eventResult = await searchVaultRuntime(vaultRoot, "lab report", {
      recordTypes: ["event"],
      kinds: ["document"],
    });

    assert.equal(eventResult.total, 1);
    assert.equal(eventResult.hits[0]?.recordId, "doc_01JNV4DOC0000000000000001");
    assert.match(eventResult.hits[0]?.snippet ?? "", /lab report/i);

    const defaultSampleResult = await searchVaultRuntime(vaultRoot, "heart_rate");
    assert.equal(
      defaultSampleResult.hits.some((hit) => hit.recordType === "sample"),
      false,
    );

    const requestedSampleResult = await searchVaultRuntime(vaultRoot, "heart_rate", {
      streams: ["heart_rate"],
    });
    assert.equal(
      requestedSampleResult.hits.some(
        (hit) => hit.recordType === "sample" && hit.stream === "heart_rate",
      ),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("query projection ignores inbox runtime state and leaves inbox sqlite untouched", async () => {
  const vaultRoot = await createFixtureVault();
  const inboxDatabasePath = path.join(vaultRoot, INBOX_DB_RELATIVE_PATH);
  const queryDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);

  await mkdir(path.dirname(inboxDatabasePath), { recursive: true });
  const inboxDatabase = openDatabaseSync(inboxDatabasePath);
  inboxDatabase.exec("CREATE TABLE inbox_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
  inboxDatabase
    .prepare("INSERT INTO inbox_state (id, value) VALUES (?, ?)")
    .run("cursor", "{\"offset\":1}");
  inboxDatabase.close();

  try {
    const statusBefore = await getQueryProjectionStatus(vaultRoot);
    assert.equal(statusBefore.exists, false);
    assert.equal(statusBefore.dbPath, QUERY_DB_RELATIVE_PATH);

    const rebuilt = await rebuildQueryProjection(vaultRoot);
    assert.equal(rebuilt.dbPath, QUERY_DB_RELATIVE_PATH);
    assert.equal(existsSync(queryDatabasePath), true);

    const queryDatabase = openDatabaseSync(queryDatabasePath, { readOnly: true });
    const queryTables = queryDatabase
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name LIKE 'query_%'
        ORDER BY name ASC
      `)
      .all() as Array<{ name: string }>;
    queryDatabase.close();

    const inboxStateDatabase = openDatabaseSync(inboxDatabasePath, { readOnly: true });
    const inboxState = inboxStateDatabase
      .prepare("SELECT value FROM inbox_state WHERE id = ?")
      .get("cursor") as { value: string } | undefined;
    const inboxQueryTables = inboxStateDatabase
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name LIKE 'query_%'
        ORDER BY name ASC
      `)
      .all() as Array<{ name: string }>;
    inboxStateDatabase.close();

    assert.equal(queryTables.some((table) => table.name === "query_entities"), true);
    assert.equal(queryTables.some((table) => table.name === "query_search_document"), true);
    assert.equal(queryTables.some((table) => table.name === "query_search_fts"), true);
    assert.equal(inboxState?.value, "{\"offset\":1}");
    assert.deepEqual(inboxQueryTables, []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("searchVaultRuntime keeps results fresh by rebuilding the projection when canonical files change", async () => {
  const vaultRoot = await createFixtureVault();
  const journalPath = path.join(vaultRoot, "journal/2026/2026-03-10.md");

  try {
    await writeFile(
      journalPath,
      `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
title: March 10
tags:
  - focus
  - hydration
eventIds:
  - evt_01JNV4MEAL000000000000001
  - evt_01JNV4DOC000000000000001
sampleStreams:
  - glucose
  - heart_rate
---
Steady energy after electrolyte drink.
`,
      "utf8",
    );

    await rebuildQueryProjection(vaultRoot);

    await writeFile(
      journalPath,
      `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
title: March 10
tags:
  - focus
  - hydration
eventIds:
  - evt_01JNV4MEAL000000000000001
  - evt_01JNV4DOC000000000000001
sampleStreams:
  - glucose
  - heart_rate
---
Steady energy after saffron tea.
`,
      "utf8",
    );

    const statusAfterEdit = await getQueryProjectionStatus(vaultRoot);
    assert.equal(statusAfterEdit.exists, true);
    assert.equal(statusAfterEdit.fresh, false);

    const searchResult = await searchVaultRuntime(vaultRoot, "saffron", {
      recordTypes: ["journal"],
    });

    assert.equal(searchResult.hits[0]?.recordId, "journal:2026-03-10");

    const statusAfterSearch = await getQueryProjectionStatus(vaultRoot);
    assert.equal(statusAfterSearch.fresh, true);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

function openDatabaseSync(
  databasePath: string,
  options?: ConstructorParameters<typeof import("node:sqlite").DatabaseSync>[1],
): DatabaseSync {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(databasePath, options ?? {});
}
