import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assembleBrowserVaultCoreReplica,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultCoreShard,
  parseBrowserVaultReplica,
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

test("a run that rounds to no distance is left out, and the replica still parses", async () => {
  const replica = await runDays([watchRun("evt_blip", "2026-11-13", "09", 0.0002), loggedRun("evt_real", "2026-11-12", 4.2)]);
  assert.deepEqual(replica.runs?.days, [{ date: "2026-11-12", km: 4.2 }]);
  assert.deepEqual(parseBrowserVaultReplica(JSON.parse(JSON.stringify(replica))).runs, replica.runs);
  const core = parseBrowserVaultCoreShard(JSON.parse(JSON.stringify((await splitBrowserVaultReplica(replica)).core)));
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

test("Running includes today's local run before UTC midnight", async () => {
  const run = loggedRun("evt_local", "2026-05-12", 2.5);
  run.occurredAt = "2026-05-11T22:00:00Z";
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-05-11T22:30:00Z", metricPoints: [], sourceBundleHash: "runs-projection",
    vault: createVaultReadModel({ entities: [run], metadata: { timezone: "Asia/Tokyo" }, vaultRoot: "browser://vault" }),
  });
  assert.deepEqual(replica.runs?.days, [{ date: "2026-05-12", km: 2.5 }]);
});

test("Running counts compact Strava sport types from saved sessions", async () => {
  const replica = await runDays([
    watchRun("evt_trail", "2026-11-10", "08", 3, "strava", { activityType: "trailrun" }),
    watchRun("evt_virtual", "2026-11-11", "08", 5, "strava", { activityType: "virtualrun" }),
  ]);
  assert.deepEqual(replica.runs?.days, [{ date: "2026-11-10", km: 3 }, { date: "2026-11-11", km: 5 }]);
});

test("Running adds a timed logged run that is separate from the day's watch runs", async () => {
  const date = "2026-11-12";
  const log = loggedRun("evt_evening", date, 5);
  log.attributes.workout = { startedAt: `${date}T19:00:00Z`, endedAt: `${date}T19:40:00Z` };
  const watch = watchRun("evt_morning", date, "08", 3);
  const mirror = loggedRun("evt_copy", date, 3);
  mirror.attributes.workout = { startedAt: `${date}T08:00:00Z`, endedAt: `${date}T08:40:00Z` };
  assert.deepEqual((await runDays([watch, log])).runs?.days, [{ date, km: 8 }]);
  assert.deepEqual((await runDays([watch, log, mirror])).runs?.days, [{ date, km: 8 }]);
  const afternoon = watchRun("evt_afternoon", date, "14", 4);
  mirror.attributes.distanceKm = 6;
  assert.deepEqual((await runDays([watch, afternoon, mirror])).runs?.days, [{ date, km: 10 }]);
  delete log.attributes.workout;
  assert.deepEqual((await runDays([watch, log])).runs?.days, [{ date, km: 5 }]);
});
