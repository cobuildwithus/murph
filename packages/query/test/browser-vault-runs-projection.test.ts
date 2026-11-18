import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assembleBrowserVaultCoreReplica,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultCoreShard,
  splitBrowserVaultReplica,
} from "../src/browser.ts";
import { resolveCanonicalRecordClass, type CanonicalEntity } from "../src/canonical-entities.ts";
import { isRunActivity } from "../src/browser-replica/runs.ts";

function session(entityId: string, date: string, attributes: Record<string, unknown>): CanonicalEntity {
  return {
    attributes, body: null, date, entityId, experimentSlug: null, family: "event", frontmatter: null,
    kind: "activity_session", links: [], lookupIds: [entityId], occurredAt: `${date}T12:00:00.000Z`,
    path: `ledger/events/2026/${entityId}.jsonl`, primaryLookupId: entityId, recordClass: resolveCanonicalRecordClass("event"),
    relatedIds: [], status: null, stream: null, tags: [], title: null,
  };
}

function watchRun(entityId: string, date: string, start: string, km: number, provider = "garmin", extra: Record<string, unknown> = {}) {
  return session(entityId, date, {
    activityType: "Running", dayKey: date, durationMinutes: 40, startAt: `${date}T${start}:00:00.000Z`, endAt: `${date}T${start}:40:00.000Z`,
    recordedAt: `${date}T23:00:00.000Z`,
    externalRef: { facet: null, system: provider, resourceType: "activity_session", resourceId: `${entityId}-resource` },
    workout: { metrics: { distanceKm: km } }, ...extra,
  });
}

const loggedRun = (entityId: string, date: string, km: number, activityType = "run") =>
  session(entityId, date, { activityType, distanceKm: km, durationMinutes: 30, source: "manual" });

async function runDays(entities: CanonicalEntity[]) {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-11-18T12:00:00.000Z", metricPoints: [], sourceBundleHash: "runs-projection",
    vault: createVaultReadModel({ entities, metadata: { timezone: "America/Los_Angeles" }, vaultRoot: "browser://vault" }),
  });
  return replica;
}

test("run days count a watch run and its imported mirror once, add distinct runs, and keep the larger of watch and logged runs", async () => {
  const mirror = { dataOrigin: { aggregatorProvider: "junction", originConfidence: "high", sourceInstanceId: "garmin-watch",
    sourceProviderSlug: "garmin", sourceType: "watch", version: 1 } };
  const replica = await runDays([
    watchRun("evt_watch_morning", "2026-11-14", "07", 11.46),
    watchRun("evt_watch_morning_mirror", "2026-11-14", "07", 11.46, "junction", mirror),
    watchRun("evt_watch_evening", "2026-11-14", "18", 5),
    loggedRun("evt_chat_only", "2026-11-12", 5),
    loggedRun("evt_chat_same_day", "2026-11-10", 3),
    watchRun("evt_watch_same_day", "2026-11-10", "07", 4),
    loggedRun("evt_chat_walk", "2026-11-11", 6, "walk"),
    loggedRun("evt_chat_old", "2025-11-01", 10),
    session("evt_watch_no_distance", "2026-11-09", { activityType: "running", durationMinutes: 20,
      externalRef: { facet: null, system: "garmin", resourceType: "activity_session", resourceId: "nd" } }),
  ]);
  assert.deepEqual(replica.runs, { schemaVersion: 1, days: [
    { date: "2026-11-10", km: 4 }, { date: "2026-11-12", km: 5 }, { date: "2026-11-14", km: 16.46 },
  ] });

  const shards = await splitBrowserVaultReplica(replica);
  const core = parseBrowserVaultCoreShard(JSON.parse(JSON.stringify(shards.core)));
  assert.deepEqual(assembleBrowserVaultCoreReplica(core).runs, replica.runs);
});

test("an older core shard without run days parses with runs unknown", async () => {
  const replica = await runDays([]);
  assert.deepEqual(replica.runs, { schemaVersion: 1, days: [] });
  const { runs: _runs, ...older } = (await splitBrowserVaultReplica(replica)).core;
  assert.equal(parseBrowserVaultCoreShard(older).runs, undefined);
});

test("run activity names", () => {
  for (const name of ["run", "Running", "trail_running", "Treadmill Run", "virtual-run", "indoor running"]) assert.ok(isRunActivity(name), name);
  for (const name of ["walk", "rowing", "Functional strength training", "brunch", "cycling", null]) assert.ok(!isRunActivity(name), String(name));
});
