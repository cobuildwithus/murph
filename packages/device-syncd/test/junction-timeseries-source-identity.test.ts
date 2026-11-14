import assert from "node:assert/strict";
import { JUNCTION_KNOWN_TIMESERIES_RESOURCES } from "@murphai/contracts";
import { test } from "vitest";
import {
  createAccount,
  createConnectionSource,
  createJob,
  createJunctionJobContext,
  createJunctionProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";
import type { ProviderJobContext } from "../src/types.ts";

type ImportedSnapshot = Parameters<ProviderJobContext["importSnapshot"]>[0];

// One provider sample reaches the vault twice: once from the fetch a data
// webhook queues, and again from the daily closed-day reconcile. Every
// canonical id hashes the record's source instance id, so both paths must
// stamp the same one or the re-read stores the sample under a second id.
// Fetched per workout or recording, or from the separately named body
// endpoints, so this window fixture does not reach them.
const OTHER_FETCH_SHAPES = new Set<string>([
  "workout_stream", "electrocardiogram_voltage",
  "weight", "fat", "body_mass_index", "lean_body_mass", "waist_circumference",
]);

test.each(
  JUNCTION_KNOWN_TIMESERIES_RESOURCES.filter((resource) => !OTHER_FETCH_SHAPES.has(resource)),
)("Junction %s gets one source instance id from the webhook and reconcile paths", async (resource) => {
  const source = createConnectionSource();
  const snapshots: ImportedSnapshot[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [{
        slug: "garmin", name: "Garmin", status: "connected",
        resource_availability: { [resource]: true },
      }] });
    }
    assert.equal(url.pathname, `/v2/timeseries/junction-user-1/${resource}/grouped`);
    return createJsonResponse({ groups: { garmin: [{
      data: [{ timestamp: "2026-04-02T14:00:00.000Z", unit: "count", value: 15 }],
      // The record's own device and app ids are what an unprojected import
      // would derive its source instance id from.
      source: {
        provider: "garmin", type: "watch",
        app_id: "com.example.wearable", device_id: "synthetic-device-1",
      },
    }] } });
  }, { summaryResources: [], timeseriesResources: [resource] });
  const context = createJunctionJobContext({
    now: "2026-04-04T12:00:00.000Z",
    account: createAccount({ sources: [{ ...source, resourceCount: 1 }] }),
    connectionSourceAdmissionMode: "listed_only",
    listConnectionSources: async () => [source],
    importSnapshot: async (snapshot) => {
      snapshots.push(snapshot);
      return { imported: true };
    },
  });
  const window = {
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  };

  await executeJunctionJob(provider, context, createJob("resource", {
    resource, resourceCategory: "timeseries", sourceProviderSlug: "garmin", ...window,
  }));
  await executeJunctionJob(provider, context, createJob("reconcile", {
    sourceProviderSlug: "garmin",
    timeseriesCursor: window.windowStart,
    timeseriesResourceCursor: resource,
    ...window,
  }));

  assert.equal(snapshots.length, 2);
  const [webhookIdentity, reconcileIdentity] = snapshots.map(readSnapshotSourceInstanceIds);
  assert.equal(webhookIdentity.length, 1);
  assert.deepEqual(reconcileIdentity, webhookIdentity);
});

function readSnapshotSourceInstanceIds(snapshot: ImportedSnapshot): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === "sourceInstanceId" && typeof entry === "string") {
        ids.add(entry);
      } else {
        visit(entry);
      }
    }
  };
  visit(snapshot);
  return [...ids].sort();
}
