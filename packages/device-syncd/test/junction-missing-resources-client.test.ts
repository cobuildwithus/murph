import assert from "node:assert/strict";
import { test } from "vitest";

import {
  JunctionClient,
  resolveJunctionTimeseriesApiResource,
} from "../src/providers/junction-client.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

function createClient(fetchImpl: typeof fetch): JunctionClient {
  return new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl,
  });
}

const WINDOW = {
  userId: "junction-user-1",
  windowStart: "2026-01-01T00:00:00.000Z",
  windowEnd: "2026-01-31T00:00:00.000Z",
};

test("Junction timeseries API mapping changes only public fat and legacy weight names", async () => {
  assert.equal(resolveJunctionTimeseriesApiResource("fat"), "body_fat");
  assert.equal(resolveJunctionTimeseriesApiResource("weight"), "body_weight");
  assert.equal(resolveJunctionTimeseriesApiResource("body_mass_index"), "body_mass_index");

  const paths: string[] = [];
  const client = createClient(async (input) => {
    paths.push(new URL(readUrl(input)).pathname);
    return createJsonResponse({ groups: {} });
  });

  await client.listTimeseries({ ...WINDOW, resource: "fat" });
  await client.listTimeseries({ ...WINDOW, resource: "body_mass_index" });

  assert.deepEqual(paths, [
    "/v2/timeseries/junction-user-1/body_fat/grouped",
    "/v2/timeseries/junction-user-1/body_mass_index/grouped",
  ]);
});

test("Junction sparse collection fetches retain the existing 100-page cap", async () => {
  let calls = 0;
  const client = createClient(async () => {
    calls += 1;
    return createJsonResponse({
      groups: {},
      next_cursor: `page-${calls + 1}`,
    });
  });

  await assert.rejects(
    client.listTimeseries({ ...WINDOW, resource: "fat" }),
    { code: "JUNCTION_API_PAGINATION_LIMIT" },
  );
  assert.equal(calls, 100);
});

test("Junction sparse collection fetches retain the existing 25,000-record cap", async () => {
  const client = createClient(async () => createJsonResponse({
    groups: {
      withings: [{
        data: Array.from({ length: 25_001 }, (_, index) => ({
          id: `fat-${index}`,
          timestamp: "2026-01-15T12:00:00.000Z",
          unit: "%",
          value: 18,
        })),
        source: { provider: "withings", type: "scale" },
      }],
    },
  }));

  await assert.rejects(
    client.listTimeseries({ ...WINDOW, resource: "fat" }),
    { code: "JUNCTION_API_RECORD_LIMIT" },
  );
});
