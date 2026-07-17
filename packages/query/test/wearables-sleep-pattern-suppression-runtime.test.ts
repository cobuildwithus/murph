import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  rebuildQueryProjection,
  summarizeWearableSleepPatternRuntime,
} from "../src/query-projection.ts";
import {
  listWearableSleepNights,
  summarizeWearableSleepPattern,
} from "../src/wearables.ts";

interface SleepEventFixture {
  durationMinutes: number;
  endAt: string;
  id: string;
  startAt: string;
}

const SLEEP_EVENTS: readonly SleepEventFixture[] = [
  {
    durationMinutes: 480,
    endAt: "2026-07-10T07:00:00.000Z",
    id: "main",
    startAt: "2026-07-09T23:00:00.000Z",
  },
  {
    durationMinutes: 480,
    endAt: "2026-07-10T07:00:00.000Z",
    id: "main-duplicate",
    startAt: "2026-07-09T23:00:00.000Z",
  },
  {
    durationMinutes: 360,
    endAt: "2026-07-10T06:00:00.000Z",
    id: "overlap",
    startAt: "2026-07-10T00:00:00.000Z",
  },
  {
    durationMinutes: 120,
    endAt: "2026-07-10T10:00:00.000Z",
    id: "same-date-split",
    startAt: "2026-07-10T08:00:00.000Z",
  },
];

function eventPayload(event: SleepEventFixture) {
  return {
    dayKey: "2026-07-10",
    durationMinutes: event.durationMinutes,
    endAt: event.endAt,
    externalRef: {
      resourceId: event.id,
      resourceType: "sleep",
      system: "oura",
    },
    id: `evt_sleep_suppression_${event.id.replaceAll("-", "_")}`,
    kind: "sleep_session",
    occurredAt: event.startAt,
    recordedAt: "2026-07-10T10:05:00.000Z",
    schemaVersion: "murph.event.v1",
    sleepType: "main_sleep",
    source: "device",
    startAt: event.startAt,
    timeZone: "UTC",
    title: "Provider sleep session",
  };
}

function canonicalEvent(event: SleepEventFixture): CanonicalEntity {
  const payload = eventPayload(event);
  return {
    attributes: payload,
    body: null,
    date: payload.dayKey,
    entityId: payload.id,
    experimentSlug: null,
    family: "event",
    frontmatter: null,
    kind: payload.kind,
    links: [],
    lookupIds: [payload.id],
    occurredAt: payload.occurredAt,
    path: `ledger/events/2026/${payload.id}.jsonl`,
    primaryLookupId: payload.id,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: payload.title,
  };
}

function assertSuppressionCounts(summary: {
  overlappingNightCount: number;
  sameDateSessionSuppressedCount: number;
  suppressedExactDuplicateCount: number;
  validNightCount: number;
}): void {
  assert.equal(summary.suppressedExactDuplicateCount, 1);
  assert.equal(summary.overlappingNightCount, 1);
  assert.equal(summary.sameDateSessionSuppressedCount, 1);
  assert.equal(summary.validNightCount, 1);
}

test("sleep-window support evidence is bounded per stored nightly summary", () => {
  const windows = Array.from({ length: 70 }, (_, index): SleepEventFixture => {
    const start = new Date(Date.UTC(2026, 6, 10, 0, index * 5));
    const end = new Date(start.getTime() + 60_000);
    return {
      durationMinutes: 1,
      endAt: end.toISOString(),
      id: `bounded-${index}`,
      startAt: start.toISOString(),
    };
  });
  const model = createVaultReadModel({
    entities: windows.map(canonicalEvent),
    metadata: { timezone: "UTC" },
    vaultRoot: "/virtual/sleep-evidence-bound",
  });
  const nights = listWearableSleepNights(model, { date: "2026-07-10" });

  assert.equal(nights.length, 1);
  assert.equal(nights[0]?.sleepWindowEvidence?.length, 64);
  assert.equal(nights[0]?.sleepWindowEvidenceOmittedCount, 6);

  const summary = summarizeWearableSleepPattern(model, {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
    timeZone: "UTC",
  });
  assert.equal(summary.sameDateSessionSuppressedCount, 63);
  assert.equal(summary.notes.some((note) => note.includes("capped per stored summary")), true);
});

test("direct and projected sleep patterns retain upstream suppression evidence", async () => {
  const filters = {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
    timeZone: "UTC",
  } as const;
  const direct = summarizeWearableSleepPattern(
    createVaultReadModel({
      entities: SLEEP_EVENTS.map(canonicalEvent),
      metadata: { timezone: "UTC" },
      vaultRoot: "/virtual/sleep-suppression",
    }),
    filters,
  );
  assertSuppressionCounts(direct);

  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-suppression-runtime-"));
  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-07-01T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Sleep suppression runtime fixture",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-07.jsonl"),
      `${SLEEP_EVENTS.map((event) => JSON.stringify(eventPayload(event))).join("\n")}\n`,
      "utf8",
    );

    await rebuildQueryProjection(vaultRoot);
    const projected = await summarizeWearableSleepPatternRuntime(vaultRoot, filters);
    assertSuppressionCounts(projected);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("bounded runtime reads retain source freshness older than the sleep window", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-stale-source-runtime-"));
  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-05-01T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Stale sleep source runtime fixture",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl"),
      `${JSON.stringify({
        dayKey: "2026-05-01",
        durationMinutes: 480,
        endAt: "2026-05-01T07:00:00.000Z",
        externalRef: {
          resourceId: "stale-sleep-source",
          resourceType: "sleep",
          system: "oura",
        },
        id: "evt_stale_sleep_source_01",
        kind: "sleep_session",
        occurredAt: "2026-04-30T23:00:00.000Z",
        recordedAt: "2026-05-01T07:05:00.000Z",
        schemaVersion: "murph.event.v1",
        sleepType: "main_sleep",
        source: "device",
        startAt: "2026-04-30T23:00:00.000Z",
        timeZone: "UTC",
        title: "Old provider sleep session",
      })}\n`,
      "utf8",
    );

    await rebuildQueryProjection(vaultRoot);
    const summary = await summarizeWearableSleepPatternRuntime(vaultRoot, {
      now: "2026-07-16T12:00:00.000Z",
      timeZone: "UTC",
    });

    assert.equal(summary.validNightCount, 0);
    assert.deepEqual(summary.sourceFreshness, [{
      lastSleepEvidenceDate: "2026-05-01",
      provider: "oura",
      stalenessVsNewestDays: 0,
      stalenessVsNowDays: 76,
    }]);
    assert.equal(summary.allSourcesStale, true);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});
