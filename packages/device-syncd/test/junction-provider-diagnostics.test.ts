import {
  assertConnectBackfillRetryWake,
  assertJunctionWindowQuery,
  buildExpectedJunctionDedupeKey,
  createAccount,
  createConnectionSource,
  createEmptyJunctionBackfillProvider,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  createStoredAccount,
  executeFullJobTimeseriesContinuations,
  executeJunctionFullJob,
  executeJunctionJob,
  executeTemporalAuthorityChildren,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import {
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
} from "@murphai/importers";
import {
  buildJunctionDailyTimeseriesAggregateResourceId,
  deriveJunctionCanonicalCoverageEvidence,
  normalizeJunctionSnapshot,
  type JunctionSnapshotInput,
} from "@murphai/importers/device-providers/junction";
import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";
import { test, vi } from "vitest";
import { DeviceSyncError } from "../src/errors.ts";
import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";
import { createJsonResponse, makeTempDirectory, readUrl, requireValue } from "./helpers.ts";
import type {
  DeviceConnectionSourceRecord,
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

test("Junction REST diagnostic probes a compact resource without returning raw records", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              timestamp: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
            provider_connection_id: "provider-garmin-1",
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T00:00:00.000Z",
    resource: "blood_oxygen",
    sourceProviderSlug: "garmin",
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  const probe = result.result as {
    request?: {
      endpoint?: string;
      queryParameterNames?: string[];
      resource?: string;
      sourceFiltered?: boolean;
      window?: Record<string, unknown>;
    };
    response?: { ok?: boolean; recordCount?: number; shape?: Record<string, unknown> };
  };

  assert.equal(result.provider, "junction");
  assert.equal(probe.request?.endpoint, "timeseries");
  assert.equal(probe.request?.resource, "blood_oxygen");
  assert.equal(probe.request?.sourceFiltered, true);
  assert.deepEqual(probe.request?.queryParameterNames, ["end_date", "provider", "start_date"]);
  assert.deepEqual(probe.request?.window, {
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  assert.equal(probe.response?.ok, true);
  assert.equal(probe.response?.recordCount, 1);
  assert.equal(probe.response?.shape?.kind, "object");
  assert.equal(seenUrls.length, 1);
  const seenUrl = requireValue(seenUrls[0], "Junction diagnostic should issue one read request.");
  assert.equal(new URL(seenUrl).pathname, "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
  assert.equal(new URL(seenUrl).searchParams.get("provider"), "garmin");
  assertJunctionWindowQuery(
    seenUrl,
    "2026-04-02T10:15:30.000Z",
    "2026-04-03T11:45:00.000Z",
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|97|garmin/u,
  );
});

test("Junction REST diagnostics dispatch a scoped historical pull trigger", async () => {
  const requests: { body: unknown; method: string; url: string }[] = [];
  const runTrigger = async (respond: () => Response) => {
    const provider = createJunctionProvider(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      return respond();
    });
    const probeRest = provider.diagnostics?.probeRest;
    assert.ok(probeRest);

    return probeRest({
      account: createAccount(),
      endpoint: "trigger_historical_pull",
      now: "2026-07-24T12:00:00.000Z",
      resource: null,
      sourceProviderSlug: "Garmin",
    });
  };
  const readResponse = (result: Awaited<ReturnType<typeof runTrigger>>) =>
    (result.result as { response?: Record<string, unknown> }).response ?? {};

  const accepted = await runTrigger(() => createJsonResponse({ success: true }, 202));
  assert.equal(readResponse(accepted).ok, true);
  assert.equal(readResponse(accepted).accepted, true);
  assert.equal(readResponse(accepted).endpointUnavailable, false);
  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      method: "POST",
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
  // The operator response must never carry the raw Junction user id.
  assert.doesNotMatch(JSON.stringify(accepted), /junction-user-1/u);

  requests.length = 0;
  const gated = await runTrigger(() => createJsonResponse({ detail: "not enabled" }, 403));
  assert.equal(readResponse(gated).ok, true);
  assert.equal(readResponse(gated).accepted, false);
  assert.equal(readResponse(gated).endpointUnavailable, true);

  requests.length = 0;
  const failed = await runTrigger(() => createJsonResponse({ detail: "boom" }, 500));
  assert.equal(readResponse(failed).ok, false);
  assert.equal(readResponse(failed).responseStatus, 500);
});

test("Junction REST diagnostics use date params for date-only summary resources", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/menstrual_cycle/junction-user-1")) {
      return createJsonResponse({ menstrual_cycle: [] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/electrocardiogram/junction-user-1")) {
      return createJsonResponse({ electrocardiogram: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["menstrual_cycle", "electrocardiogram"],
    timeseriesResources: [],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  for (const resource of ["menstrual_cycle", "electrocardiogram"]) {
    await probeRest({
      account: createAccount(),
      endpoint: "summary",
      now: "2026-04-03T12:00:00.000Z",
      resource,
      windowStart: "2026-04-02T10:15:30.000Z",
      windowEnd: "2026-04-03T11:45:00.000Z",
    });
  }

  assert.equal(seenUrls.length, 2);
  for (const url of seenUrls) {
    assertJunctionWindowQuery(
      requireValue(url, "Junction summary diagnostic should issue one read request per resource."),
      "2026-04-02",
      "2026-04-03",
    );
  }
});

test("Junction maps body timeseries resources to their documented endpoints", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (
      url.includes("/v2/timeseries/junction-user-1/body_weight/grouped")
      || url.includes("/v2/timeseries/junction-user-1/body_fat/grouped")
    ) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: [],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  for (const resource of ["weight", "fat"]) {
    await probeRest({
      account: createAccount(),
      endpoint: "timeseries",
      now: "2026-04-03T12:00:00.000Z",
      resource,
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    });
  }

  assert.deepEqual(
    seenUrls.map((seenUrl) => new URL(seenUrl).pathname),
    [
      "/v2/timeseries/junction-user-1/body_weight/grouped",
      "/v2/timeseries/junction-user-1/body_fat/grouped",
    ],
  );
  for (const seenUrl of seenUrls) {
    assertJunctionWindowQuery(
      seenUrl,
      "2026-04-02T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    );
  }
});

test("Junction REST diagnostic can force a bounded user data refresh", async () => {
  const seenRequests: Array<{ method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    seenRequests.push({
      method: init?.method ?? "GET",
      url,
    });

    if (url === "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45") {
      return createJsonResponse({
        success: true,
        refreshed_sources: ["garmin.steps", "oura.activity"],
        in_progress_sources: ["garmin.sleep"],
        failed_sources: [
          { provider: "garmin", resource: "weight" },
          { provider: "oura", resource: "hrv" },
        ],
        user_id: "junction-user-1",
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "refresh",
    now: "2026-04-03T12:00:00.000Z",
    timeoutSeconds: 45,
  });
  const probe = result.result as {
    request?: {
      endpoint?: string;
      endpointKind?: string;
      method?: string;
      queryParameterNames?: string[];
      timeoutSeconds?: number | null;
    };
    response?: {
      failedSourceCount?: number;
      failedSources?: string[];
      inProgressSourceCount?: number;
      inProgressSources?: string[];
      ok?: boolean;
      refreshedSourceCount?: number;
      refreshedSources?: string[];
      success?: boolean | null;
    };
  };

  assert.equal(probe.request?.endpoint, "refresh");
  assert.equal(probe.request?.endpointKind, "junction_user_refresh");
  assert.equal(probe.request?.method, "POST");
  assert.deepEqual(probe.request?.queryParameterNames, ["timeout"]);
  assert.equal(probe.request?.timeoutSeconds, 45);
  assert.equal(probe.response?.ok, true);
  assert.equal(probe.response?.success, true);
  assert.equal(probe.response?.refreshedSourceCount, 2);
  assert.deepEqual(probe.response?.refreshedSources, ["source_1.steps", "source_2.activity"]);
  assert.equal(probe.response?.inProgressSourceCount, 1);
  assert.deepEqual(probe.response?.inProgressSources, ["source_1.sleep"]);
  assert.equal(probe.response?.failedSourceCount, 2);
  assert.deepEqual(probe.response?.failedSources, ["source_1.weight", "source_2.hrv"]);
  assert.deepEqual(seenRequests, [{
    method: "POST",
    url: "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45",
  }]);
  assert.doesNotMatch(JSON.stringify(result), /junction-user-1|garmin|oura/u);
});

test("Junction REST diagnostic reports refresh failure details safely", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45") {
      return createJsonResponse({
        error: "invalid_request",
        message: "Refresh requires a connected source.",
        user_id: "junction-user-1",
      }, 400);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "refresh",
    now: "2026-04-03T12:00:00.000Z",
    timeoutSeconds: 45,
  });
  const probe = result.result as {
    response?: {
      diagnostics?: Record<string, unknown>;
      errorCode?: string;
      ok?: boolean;
      responseStatus?: number | null;
      retryable?: boolean;
    };
  };

  assert.equal(probe.response?.ok, false);
  assert.equal(probe.response?.errorCode, "JUNCTION_API_REQUEST_FAILED");
  assert.equal(probe.response?.responseStatus, 400);
  assert.equal(probe.response?.retryable, false);
  assert.equal(probe.response?.diagnostics?.responseErrorCode, "invalid_request");
  assert.equal(probe.response?.diagnostics?.responseErrorDescription, "Refresh requires a connected source.");
  assert.equal(probe.response?.diagnostics?.requestEndpointKind, "junction_user_refresh");
  assert.deepEqual(Object.keys(probe.response?.diagnostics ?? {}).sort().includes("user_id"), false);
  assert.doesNotMatch(JSON.stringify(result), /junction-user-1|sk_us_test_123/u);
});

test("Junction REST diagnostic matrix compares metadata, introspection, and data reads safely", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          source: {
            device_id: "source-device-1",
          },
          resource_availability: {
            steps: true,
          },
        }],
      });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/user/junction-user-1/device") {
      return createJsonResponse([{
        id: "device-row-1",
        user_id: "junction-user-1",
        provider: "garmin",
        source_type: "watch",
        device_id: "source-device-1",
        device_manufacturer: "Garmin",
        device_model: "Fenix",
      }]);
    }

    const introspectionUrl = new URL(url);
    if (
      introspectionUrl.pathname === "/v2/introspect/resources"
      && introspectionUrl.searchParams.get("user_id") === "junction-user-1"
      && introspectionUrl.searchParams.get("user_limit") === "1"
      && [null, "garmin"].includes(introspectionUrl.searchParams.get("provider"))
    ) {
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              steps: {
                sent_count: 1,
                oldest_data: "2026-04-02T00:00:00+00:00",
                newest_data: "2026-04-02T23:59:59+00:00",
                last_attempt: {
                  status: "success",
                  timestamp: "2026-04-03T00:00:00+00:00",
                },
              },
            },
          },
        }],
      });
    }

    if (
      introspectionUrl.pathname === "/v2/introspect/historical_pull"
      && introspectionUrl.searchParams.get("user_id") === "junction-user-1"
      && introspectionUrl.searchParams.get("user_limit") === "1"
      && [null, "garmin"].includes(introspectionUrl.searchParams.get("provider"))
    ) {
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              not_pulled: [],
              pulled: {
                steps: {
                  days_with_data: 1,
                  range_start: "2026-04-02T00:00:00+00:00",
                  range_end: "2026-04-02T23:59:59+00:00",
                  status: "success",
                  timeline: {
                    scheduled_at: "2026-04-03T00:00:00+00:00",
                    started_at: "2026-04-03T00:00:01+00:00",
                    ended_at: "2026-04-03T00:00:02+00:00",
                  },
                },
              },
            },
          },
        }],
      });
    }

    const parsedUrl = new URL(url);
    if (
      parsedUrl.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
      && parsedUrl.searchParams.get("start_date") === "2026-04-02T00:00:00.000Z"
      && parsedUrl.searchParams.get("end_date") === "2026-04-03T00:00:00.000Z"
      && (
        parsedUrl.searchParams.get("provider") === null
        || parsedUrl.searchParams.get("provider") === "garmin"
      )
    ) {
      return createJsonResponse({
        groups: {
          garmin: [{
            source: {
              provider: "garmin",
              type: "watch",
            },
            data: [{
              end: "2026-04-02T12:05:00+00:00",
              start: "2026-04-02T12:00:00+00:00",
              unit: "%",
              value: 97,
            }],
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  }, null);
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "matrix",
    now: "2026-04-03T12:00:00.000Z",
    resource: "blood_oxygen",
    sourceProviderSlug: "garmin",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const matrix = result.result as {
    devices?: { response?: { deviceCount?: number; devices?: Array<Record<string, unknown>> } };
    historicalPull?: Array<{ response?: { pulledCount?: number; pulled?: Array<Record<string, unknown>> } }>;
    introspection?: Array<{ response?: { resourceCount?: number; resources?: Array<Record<string, unknown>> } }>;
    providers?: { response?: { sourceCount?: number } };
    reads?: Array<{
      request?: { sourceFiltered?: boolean };
      response?: { recordCount?: number };
    }>;
    request?: { resourceCount?: number; resources?: Array<Record<string, unknown>> };
  };

  assert.equal(matrix.request?.resourceCount, 1);
  assert.deepEqual(matrix.request?.resources, [{
    configuredResource: true,
    resource: "blood_oxygen",
    resourceCategory: "timeseries",
  }]);
  assert.equal(matrix.providers?.response?.sourceCount, 1);
  assert.equal(matrix.devices?.response?.deviceCount, 1);
  assert.equal(matrix.devices?.response?.devices?.[0]?.sourceKey, "source_1");
  assert.equal(matrix.devices?.response?.devices?.[0]?.sourceType, "watch");
  assert.equal(matrix.devices?.response?.devices?.[0]?.deviceIdPresent, true);
  assert.equal(matrix.devices?.response?.devices?.[0]?.manufacturerPresent, true);
  assert.equal(matrix.introspection?.[0]?.response?.resourceCount, 1);
  assert.equal(matrix.introspection?.[1]?.response?.resources?.[0]?.sentCount, 1);
  assert.equal(matrix.historicalPull?.[0]?.response?.pulledCount, 1);
  assert.equal(matrix.historicalPull?.[1]?.response?.pulled?.[0]?.daysWithData, 1);
  assert.deepEqual(matrix.reads?.map((entry) => [
    entry.request?.sourceFiltered,
    entry.response?.recordCount,
  ]), [
    [false, 1],
    [true, 1],
  ]);
  const parsedSeenUrls = seenUrls.map((url) => new URL(url));
  assert.deepEqual(parsedSeenUrls.map((url) => url.pathname).sort(), [
    "/v2/introspect/historical_pull",
    "/v2/introspect/historical_pull",
    "/v2/introspect/resources",
    "/v2/introspect/resources",
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
    "/v2/user/junction-user-1/device",
    "/v2/user/providers/junction-user-1",
  ].sort());
  const readUrls = parsedSeenUrls.filter((url) => url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
  assert.equal(readUrls.length, 2);
  const unfilteredReadUrl = requireValue(
    readUrls.find((url) => !url.searchParams.has("provider")),
    "Junction matrix diagnostic should read the unfiltered resource.",
  );
  assertJunctionWindowQuery(
    unfilteredReadUrl.toString(),
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
  const providerReadUrl = requireValue(
    readUrls.find((url) => url.searchParams.get("provider") === "garmin"),
    "Junction matrix diagnostic should read the provider-filtered resource.",
  );
  assertJunctionWindowQuery(
    providerReadUrl.toString(),
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
  const introspectionProviders = parsedSeenUrls
    .filter((url) => url.pathname.startsWith("/v2/introspect/"))
    .map((url) => url.searchParams.get("provider") ?? "")
    .sort();
  assert.deepEqual(introspectionProviders, ["", "", "garmin", "garmin"]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|source-device-1|device-row-1|garmin|Garmin|Fenix|97/u,
  );
});

test("Junction backfill diagnostic rejects malformed requested windows without provider calls", async () => {
  const provider = createJunctionProvider(async () => {
    throw new Error("Junction diagnostic should reject malformed windows before provider calls");
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const diagnoseBackfill = provider.diagnostics?.diagnoseBackfill;
  assert.ok(diagnoseBackfill);

  await assert.rejects(
    () => diagnoseBackfill({
      account: createAccount(),
      now: "2026-04-03T00:00:00.000Z",
      windowStart: "not-a-date",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_DIAGNOSTIC_WINDOW_INVALID");
      return true;
    },
  );

});

test("Junction sparse calendar refresh threads strict completeness before canonical import", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              calendarDate: "2026-04-02",
              end: "2026-04-02T08:01:00.000Z",
              id: "water-valid",
              start: "2026-04-02T08:00:00.000Z",
              value: 250,
            }, {
              calendarDate: "2026-04-02",
              end: "2026-04-02T09:01:00.000Z",
              id: "water-malformed",
              value: 125,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  let canonicalImportCalls = 0;

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async (snapshot) => {
          canonicalImportCalls += 1;
          normalizeJunctionSnapshot(snapshot as Parameters<typeof normalizeJunctionSnapshot>[0]);
          return { durableDeliveryAccepted: true };
        },
      }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
      }),
    ),
    (error: unknown) =>
      error instanceof Error
      && error.name === "JunctionSparseCalendarRepairNormalizationError",
  );
  assert.equal(canonicalImportCalls, 1);
});

test("Junction sparse calendar refresh rejects lossy collection parsing before canonical import", async () => {
  const validRow = {
    calendarDate: "2026-04-02",
    end: "2026-04-02T08:01:00.000Z",
    id: "water-valid",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    start: "2026-04-02T08:00:00.000Z",
    value: 250,
  };
  const cases: Array<{ label: string; payload: unknown }> = [{
    label: "grouped mixed valid and non-object samples",
    payload: {
      groups: {
        garmin: [{
          data: [validRow, null],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    },
  }, {
    label: "grouped non-object group",
    payload: {
      groups: {
        garmin: [null],
      },
    },
  }, {
    label: "grouped nonempty collection with only invalid samples",
    payload: {
      groups: {
        garmin: [{
          data: [null],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    },
  }, {
    label: "ungrouped mixed valid and non-object records",
    payload: [validRow, null],
  }];

  for (const testCase of cases) {
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            name: "Garmin",
            resource_availability: { water: true },
            slug: "garmin",
            status: "connected",
          }],
        });
      }
      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
        return createJsonResponse(testCase.payload);
      }
      throw new Error(`Unexpected request: ${url}`);
    }, { timeseriesResources: ["water"] });
    let canonicalImportCalls = 0;

    await assert.rejects(
      executeJunctionJob(
        provider,
        createJunctionJobContext({
          now: "2026-04-03T12:00:00.000Z",
          importSnapshot: async () => {
            canonicalImportCalls += 1;
            return { durableDeliveryAccepted: true };
          },
        }),
        createJob("resource", {
          calendarRefreshDay: "2026-04-02",
          resource: "water",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
        }),
      ),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION"
        && error.retryable,
      testCase.label,
    );
    assert.equal(canonicalImportCalls, 0, testCase.label);
  }
});

test("Junction sparse calendar refresh admits the Apple Health alias cross-product", async () => {
  const appleHealthSlugs = ["apple_health_kit", "apple_health", "apple-healthkit"];
  for (const jobSourceProviderSlug of appleHealthSlugs) {
    for (const listedSourceProviderSlug of appleHealthSlugs) {
      for (const groupedSourceSlug of appleHealthSlugs) {
    const requests: string[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);
      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-apple-health-1",
            name: "Apple Health",
            resource_availability: { water: true },
            slug: listedSourceProviderSlug,
            status: "connected",
          }],
        });
      }
      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
        return createJsonResponse({
          groups: {
            fitbit: [{
              data: [{
                calendarDate: "2026-04-02",
                end: "2026-04-02T07:01:00.000Z",
                id: "unrelated-water",
                start: "2026-04-02T07:00:00.000Z",
                value: 999,
              }],
              source: { provider: "fitbit", type: "watch" },
            }],
            [groupedSourceSlug]: [{
              data: [{
                calendarDate: "2026-04-02",
                end: "2026-04-02T08:01:00.000Z",
                id: "apple-health-water",
                start: "2026-04-02T08:00:00.000Z",
                value: 250,
              }],
              source: { provider: groupedSourceSlug, type: "phone" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, { timeseriesResources: ["water"] });
    const importedSnapshots: unknown[] = [];
    const establishedSource = createConnectionSource({
      sourceInstanceKey: `jxn_src_${listedSourceProviderSlug.replaceAll("-", "_")}`,
      sourceProviderSlug: listedSourceProviderSlug,
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          sources: [{
            sourceProviderSlug: listedSourceProviderSlug,
            displayName: "Apple Health",
            status: "connected",
            resourceCount: 1,
            lastErrorCode: null,
            lastErrorMessage: null,
            firstSeenAt: "2026-04-01T00:00:00.000Z",
            lastSeenAt: "2026-04-03T00:00:00.000Z",
            lastDataAt: null,
          }],
        }),
        connectionSourceAdmissionMode: "listed_only",
        listConnectionSources: () => [establishedSource],
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          const normalized = normalizeJunctionSnapshot(
            snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
          );
          return {
            canonicalEventExternalRefResourceIds: (normalized.events ?? []).flatMap(
              (event) => event.externalRef ? [event.externalRef.resourceId] : [],
            ),
            durableDeliveryAccepted: true,
          };
        },
      }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: jobSourceProviderSlug,
        sourceType: "phone",
      }),
    );

    const records = (importedSnapshots[0] as {
      timeseries?: { water?: Array<Record<string, unknown>> };
    }).timeseries?.water;
    const label = `${jobSourceProviderSlug}/${listedSourceProviderSlug}/${groupedSourceSlug}`;
    assert.equal(records?.length, 1, label);
    assert.equal(records?.[0]?.value, 250, label);
    assert.equal(records?.[0]?.authoritativeEmptyCalendarSet, undefined);
    assert.equal(records?.[0]?.sourceProviderSlug, listedSourceProviderSlug.replaceAll("-", "_"));
    assert.equal(
      records?.[0]?.sourceInstanceId,
      resolveJunctionOrigin({
        sourceInstanceId: establishedSource.sourceInstanceKey,
        sourceProviderSlug: establishedSource.sourceProviderSlug,
      }).sourceInstanceId,
      label,
    );
    const timeseriesRequest = requests.find((url) => url.includes("/v2/timeseries/"));
    assert.equal(
      timeseriesRequest ? new URL(timeseriesRequest).searchParams.get("provider") : null,
      "apple_health_kit",
      label,
    );
      }
    }
  }
});

test("Junction precise sparse aliases project onto the established account source", async () => {
  const requests: string[] = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const importedSnapshots: unknown[] = [];
  const establishedSource = createConnectionSource({
    sourceInstanceKey: "jxn_src_established_apple_health",
    sourceProviderSlug: "apple_health",
    resourceAvailabilitySummary: { water: true },
  });
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: "apple-healthkit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          apple_health_kit: [{
            data: [{
              calendarDate: "2026-04-02",
              end: "2026-04-02T08:01:00.000Z",
              id: "water-alias-revision",
              start: "2026-04-02T08:00:00.000Z",
              updatedAt: "2026-04-03T08:00:00.000Z",
              value: 250,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        sources: [{
          sourceProviderSlug: establishedSource.sourceProviderSlug,
          displayName: "Apple Health",
          status: "connected",
          resourceCount: 1,
          lastErrorCode: null,
          lastErrorMessage: null,
          firstSeenAt: establishedSource.firstSeenAt,
          lastSeenAt: establishedSource.lastSeenAt,
          lastDataAt: null,
        }],
      }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        const normalized = normalizeJunctionSnapshot(
          snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
        );
        return {
          canonicalEventCount: normalized.events?.length ?? 0,
          canonicalEventDayKeys: ["2026-04-02"],
          canonicalSparseCalendarTargets: (normalized.events ?? []).flatMap((event) =>
            event.dataOrigin?.sourceProviderSlug
              ? [{
                  dayKey: "2026-04-02",
                  sourceInstanceId: event.dataOrigin.sourceInstanceId,
                  sourceProviderSlug: event.dataOrigin.sourceProviderSlug,
                  sourceType: event.dataOrigin.sourceType,
                }]
              : []
          ),
          durableDeliveryAccepted: true,
        };
      },
      listConnectionSources: () => [establishedSource],
      now: "2026-04-03T12:00:00.000Z",
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("resource", {
      resource: "water",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple-healthkit",
      windowStart: "2026-04-02T08:00:00.000Z",
      windowEnd: "2026-04-02T09:00:00.000Z",
    }),
  );

  assert.equal(upserts[0]?.sourceInstanceKey, establishedSource.sourceInstanceKey);
  assert.equal(upserts[0]?.sourceProviderSlug, "apple_health");
  const preciseRecord = (importedSnapshots[0] as {
    timeseries?: { water?: Array<Record<string, unknown>> };
  }).timeseries?.water?.[0];
  assert.equal(preciseRecord?.sourceProviderSlug, "apple_health");
  const establishedSourceInstanceId = resolveJunctionOrigin({
    sourceInstanceId: establishedSource.sourceInstanceKey,
    sourceProviderSlug: establishedSource.sourceProviderSlug,
  }).sourceInstanceId;
  assert.equal(preciseRecord?.sourceInstanceId, establishedSourceInstanceId);
  assert.equal(result.scheduledJobs?.[0]?.payload?.sourceProviderSlug, "apple_health");
  assert.equal(result.scheduledJobs?.[0]?.payload?.sourceInstanceId, establishedSourceInstanceId);
  const timeseriesRequest = requireValue(
    requests.find((url) => url.includes("/v2/timeseries/")),
  );
  assert.equal(new URL(timeseriesRequest).searchParams.get("provider"), "apple_health_kit");
});

test("Junction route-equivalent persisted sources choose the earliest keyed authority", async () => {
  const importedSnapshots: unknown[] = [];
  const earliestSource = createConnectionSource({
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    sourceInstanceKey: "jxn_src_earliest_apple_health",
    sourceProviderSlug: "apple_health",
  });
  const laterSource = createConnectionSource({
    firstSeenAt: "2026-04-02T00:00:00.000Z",
    id: "src-apple-health-kit",
    sourceInstanceKey: "jxn_src_later_apple_health",
    sourceProviderSlug: "apple_health_kit",
  });
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: "apple_health_kit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          "apple-healthkit": [{
            data: [{
              end: "2026-04-02T08:01:00.000Z",
              id: "water-duplicate-source-authority",
              start: "2026-04-02T08:00:00.000Z",
              value: 250,
            }],
            source: { provider: "apple-healthkit", type: "phone" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
      listConnectionSources: () => [laterSource, earliestSource],
    }),
    createJob("resource", {
      resource: "water",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple-healthkit",
      windowStart: "2026-04-02T08:00:00.000Z",
      windowEnd: "2026-04-02T09:00:00.000Z",
    }),
  );
  const record = (importedSnapshots[0] as {
    timeseries?: { water?: Array<Record<string, unknown>> };
  }).timeseries?.water?.[0];
  assert.equal(record?.sourceProviderSlug, earliestSource.sourceProviderSlug);
  assert.equal(
    record?.sourceInstanceId,
    resolveJunctionOrigin({
      sourceInstanceId: earliestSource.sourceInstanceKey,
      sourceProviderSlug: earliestSource.sourceProviderSlug,
    }).sourceInstanceId,
  );
});

test.each([
  { label: "newest alias first", reverse: false },
  { label: "oldest identity first", reverse: true },
])("Junction retained calendar work obeys the newest alias lifecycle ($label)", async ({ reverse }) => {
  const establishedSource = createConnectionSource({
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastErrorCode: DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
    lastErrorMessage: "Disconnected",
    lastSeenAt: "2026-04-03T12:00:00.000Z",
    sourceInstanceKey: "jxn_src_established_apple_health",
    sourceProviderSlug: "apple_health",
    status: "disconnected",
  });
  const staleAlias = createConnectionSource({
    firstSeenAt: "2026-04-02T00:00:00.000Z",
    id: "src-stale-apple-health-kit",
    lastSeenAt: "2026-04-03T11:00:00.000Z",
    sourceInstanceKey: "jxn_src_stale_apple_health_kit",
    sourceProviderSlug: "apple_health_kit",
    status: "connected",
  });
  const orderSources = (
    identity: DeviceConnectionSourceRecord,
    alias: DeviceConnectionSourceRecord,
  ) => reverse ? [alias, identity] : [identity, alias];
  let sources = orderSources(establishedSource, staleAlias);
  let responseKind: "blocked" | "empty" | "nonempty" = "blocked";
  let providerCalls = 0;
  const importedSnapshots: unknown[] = [];
  const projectedSources: DeviceConnectionSourceRecord[] = [];
  const provider = createJunctionProvider(async (input) => {
    providerCalls += 1;
    if (responseKind === "blocked") {
      throw new Error("Disconnected retained work must not call Junction.");
    }
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: "apple_health_kit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse(responseKind === "empty"
        ? { groups: {} }
        : {
            groups: {
              apple_health_kit: [{
                data: [{
                  calendarDate: "2026-04-02",
                  end: "2026-04-02T08:01:00.000Z",
                  id: "water-after-reconnect",
                  start: "2026-04-02T08:00:00.000Z",
                  value: 250,
                }],
                source: { provider: "apple_health_kit", type: "phone" },
              }],
            },
          });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  const establishedSourceInstanceId = resolveJunctionOrigin({
    sourceInstanceId: establishedSource.sourceInstanceKey,
    sourceProviderSlug: establishedSource.sourceProviderSlug,
  }).sourceInstanceId;
  const context = createJunctionJobContext({
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return {
        canonicalEventExternalRefResourceIds: [buildJunctionDailyTimeseriesAggregateResourceId({
          dayKey: "2026-04-02",
          resource: "water",
          sourceInstanceId: establishedSourceInstanceId,
          sourceProviderSlug: establishedSource.sourceProviderSlug,
          sourceType: "phone",
        })],
        durableDeliveryAccepted: true,
      };
    },
    listConnectionSources: () => sources,
    now: "2026-04-03T14:00:00.000Z",
    upsertConnectionSource: (input) => {
      const projected = createConnectionSource(input);
      projectedSources.push(projected);
      return projected;
    },
  });
  const job = createJob("resource", {
    calendarRefreshDay: "2026-04-02",
    resource: "water",
    resourceCategory: "timeseries",
    sourceInstanceId: establishedSourceInstanceId,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "phone",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });

  await assert.rejects(
    executeJunctionJob(
      provider,
      context,
      job,
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_SOURCE_AUTHORITY_UNAVAILABLE"
      && error.retryable,
  );
  assert.equal(providerCalls, 0);
  assert.equal(importedSnapshots.length, 0);

  const reconnectedAlias = createConnectionSource({
    ...staleAlias,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T13:00:00.000Z",
    status: "connected",
  });
  sources = orderSources(establishedSource, reconnectedAlias);
  responseKind = "empty";
  await executeJunctionJob(provider, context, job);
  responseKind = "nonempty";
  await executeJunctionJob(provider, context, job);

  assert.equal(providerCalls, 4);
  assert.equal(importedSnapshots.length, 2);
  assert.equal(projectedSources.length, 2);
  assert.ok(projectedSources.every((source) =>
    source.sourceInstanceKey === establishedSource.sourceInstanceKey
    && source.sourceProviderSlug === establishedSource.sourceProviderSlug
  ));
  const normalizedImports = importedSnapshots.map((snapshot) =>
    normalizeJunctionSnapshot(snapshot as Parameters<typeof normalizeJunctionSnapshot>[0])
  );
  assert.ok(normalizedImports.every((entry) =>
    entry.events?.every((event) => {
      const origin = event.dataOrigin;
      return origin !== undefined
        && origin.sourceInstanceId === establishedSourceInstanceId
        && origin.sourceProviderSlug === "apple-health";
    })
  ));
  assert.deepEqual(importedSnapshots.map((snapshot) =>
    (snapshot as { timeseries?: { water?: Array<{ value?: number }> } })
      .timeseries?.water?.map((record) => record.value)
  ), [[0], [250]]);
});

test("Junction routine, precise, and retained calendar writers share persisted source identity", async () => {
  const persistedSource = createConnectionSource({
    connectionId: "local-reminted-account",
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    sourceInstanceKey: "jxn_src_hosted_connection_apple_health",
    sourceProviderSlug: "apple_health",
    resourceAvailabilitySummary: { water: true },
  });
  const laterDuplicate = createConnectionSource({
    connectionId: "local-reminted-account",
    firstSeenAt: "2026-04-02T00:00:00.000Z",
    sourceInstanceKey: "jxn_src_later_duplicate_apple_health",
    sourceProviderSlug: "apple_healthkit",
    resourceAvailabilitySummary: { water: true },
  });
  const persistedSourceInstanceId = resolveJunctionOrigin({
    sourceInstanceId: persistedSource.sourceInstanceKey,
    sourceProviderSlug: persistedSource.sourceProviderSlug,
  }).sourceInstanceId;
  let phase: "routine" | "precise" | "repair" = "routine";
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: phase === "routine"
            ? "apple-healthkit"
            : phase === "precise"
            ? "apple_health_kit"
            : "apple_health",
          status: "connected",
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
      const requestedDay = url.searchParams.get("start_date")?.slice(0, 10);
      const dayKey = phase === "routine" ? "2026-04-01" : "2026-04-02";
      const records = phase === "repair" && requestedDay === "2026-04-01"
        ? []
        : [{
            calendarDate: dayKey,
            end: `${dayKey}T08:01:00.000Z`,
            id: "water-shared-source-spine",
            start: `${dayKey}T08:00:00.000Z`,
            updatedAt: phase === "routine"
              ? "2026-04-02T08:00:00.000Z"
              : "2026-04-03T08:00:00.000Z",
            value: phase === "routine" ? 250 : 300,
          }];
      const groupSlug = phase === "routine"
        ? "apple_health_kit"
        : phase === "precise"
        ? "apple-healthkit"
        : "apple_health";
      return createJsonResponse({
        groups: {
          [groupSlug]: [{
            data: records,
            source: { provider: groupSlug, type: "phone" },
          }],
        },
      });
    }
    if (url.pathname.startsWith("/v2/summary/")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { summaryResources: [], timeseriesResources: ["water"] });
  const context = createJunctionJobContext({
    account: createAccount({
      id: "local-reminted-account",
      sources: [{
        displayName: "Apple Health",
        firstSeenAt: persistedSource.firstSeenAt,
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: persistedSource.lastSeenAt,
        resourceCount: 1,
        sourceProviderSlug: persistedSource.sourceProviderSlug,
        status: "connected",
      }],
    }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      const normalized = normalizeJunctionSnapshot(
        snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
      );
      const dayKeys = [...new Set((normalized.events ?? []).flatMap((event) =>
        event.dayKey ? [event.dayKey] : []
      ))];
      const source = normalized.events?.[0]?.dataOrigin;
      const precise = (snapshot as { timeseriesWindowKind?: string }).timeseriesWindowKind
        === "precise";
      return {
        canonicalEventCount: normalized.events?.length ?? 0,
        canonicalEventDayKeys: precise ? ["2026-04-01", "2026-04-02"] : dayKeys,
        canonicalEventExternalRefResourceIds: (normalized.events ?? []).flatMap((event) =>
          event.externalRef ? [event.externalRef.resourceId] : []
        ),
        canonicalSparseCalendarTargets: precise && source?.sourceProviderSlug
          ? ["2026-04-01", "2026-04-02"].map((dayKey) => ({
              dayKey,
              sourceInstanceId: source.sourceInstanceId,
              sourceProviderSlug: source.sourceProviderSlug,
              sourceType: source.sourceType,
            }))
          : undefined,
        durableDeliveryAccepted: true,
      };
    },
    listConnectionSources: () => [laterDuplicate, persistedSource],
    now: "2026-04-03T12:00:00.000Z",
    upsertConnectionSource: (input) => createConnectionSource({
      ...input,
      connectionId: "local-reminted-account",
    }),
  });

  await executeJunctionFullJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-02T00:00:00.000Z",
    }),
  );
  phase = "precise";
  const preciseResult = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      resource: "water",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple-healthkit",
      windowStart: "2026-04-02T08:00:00.000Z",
      windowEnd: "2026-04-02T09:00:00.000Z",
    }),
  );
  phase = "repair";
  for (const [index, scheduledJob] of (preciseResult.scheduledJobs ?? []).entries()) {
    await executeJunctionJob(
      provider,
      context,
      createJob(scheduledJob.kind, {
        ...scheduledJob.payload,
        id: `job-retained-calendar-${index}`,
      }),
    );
  }

  const normalizedImports = importedSnapshots
    .filter((snapshot) =>
      (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries?.water
    )
    .map((snapshot) => normalizeJunctionSnapshot(
      snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
    ));
  assert.equal(normalizedImports.length, 4);
  assert.deepEqual(
    [...new Set(normalizedImports.flatMap((entry) =>
      (entry.events ?? []).map((event) => event.dataOrigin?.sourceInstanceId)
    ))],
    [persistedSourceInstanceId],
  );
  assert.deepEqual(
    [...new Set(normalizedImports.flatMap((entry) =>
      (entry.events ?? []).map((event) => event.dataOrigin?.sourceProviderSlug)
    ))],
    ["apple-health"],
  );
  const initialDailyId = normalizedImports[0]?.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "water",
  )?.externalRef?.resourceId;
  const repairedDailyId = normalizedImports[2]?.events?.find(
    (event) =>
      event.kind === "observation"
      && event.fields?.metric === "water"
      && event.dayKey === "2026-04-01",
  )?.externalRef?.resourceId;
  assert.ok(initialDailyId);
  assert.ok(repairedDailyId);
  assert.equal(repairedDailyId, initialDailyId);
  assert.deepEqual(
    (preciseResult.scheduledJobs ?? []).map((job) => job.payload?.sourceInstanceId),
    [persistedSourceInstanceId, persistedSourceInstanceId],
  );
});

const usefulHistoricalSummaryRecordByResource = {
  sleep: {
    id: "sleep-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T01:00:00.000Z",
    endAt: "2026-04-02T08:00:00.000Z",
  },
  workouts: {
    id: "workouts-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T12:00:00.000Z",
    durationMinutes: 45,
  },
  body: {
    id: "body-1",
    connectionId: "provider-garmin-1",
    weightKg: 72,
  },
} satisfies Record<"sleep" | "workouts" | "body", Record<string, unknown>>;

const usefulHistoricalSummaryCompletionCases = [
  {
    label: "activity floors",
    resource: "activity",
    record: {
      id: "activity-floors-1",
      connectionId: "provider-garmin-1",
      floorsClimbed: 8,
    },
  },
  {
    label: "body lean mass",
    resource: "body",
    record: {
      id: "body-lean-1",
      connectionId: "provider-garmin-1",
      leanBodyMassKg: 58.2,
    },
  },
  {
    label: "body waist circumference",
    resource: "body",
    record: {
      id: "body-waist-1",
      connectionId: "provider-garmin-1",
      waistCircumferenceCm: 82,
    },
  },
  {
    label: "meal raw-only",
    resource: "meal",
    record: {
      id: "meal-1",
      sourceProviderSlug: "garmin",
      mealType: "breakfast",
    },
  },
  {
    label: "menstrual cycle raw-only",
    resource: "menstrual_cycle",
    record: {
      id: "cycle-1",
      sourceProviderSlug: "garmin",
      cycleDay: 3,
    },
  },
] as const;

for (const testCase of usefulHistoricalSummaryCompletionCases) {
  test(`Junction ${testCase.label} summary historical backfill marks the historical window complete`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [testCase.resource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${testCase.resource}/junction-user-1`)) {
        return createJsonResponse({ data: [testCase.record] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [testCase.resource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

test("Junction summary reads extract the documented top-level meals envelope", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              meal: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/meal/junction-user-1")) {
      return createJsonResponse({
        meals: [{
          id: "meal-doc-envelope-1",
          mealType: "breakfast",
          sourceProviderSlug: "garmin",
        }],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["meal"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
  };
  const mealRecord = snapshot.summaries?.meal?.[0];
  assert.equal(mealRecord?.id, "meal-doc-envelope-1");
  assert.equal(Object.hasOwn(mealRecord ?? {}, "meals"), false);
});

for (const testCase of [
  {
    label: "meal identity/debug-only",
    resource: "meal",
    record: {
      id: "meal-provenance-only",
      clientId: "provider-client-1",
      debug: true,
      fullName: "Raw Member Name",
      patientName: "Raw Patient Name",
      sourceProviderSlug: "garmin",
      status: "synced",
      items: [
        {
          subjectId: "raw-meal-subject-id",
          subject: {
            id: "raw-meal-nested-subject-id",
          },
        },
      ],
    },
  },
  {
    label: "menstrual cycle identity/contact-only",
    resource: "menstrual_cycle",
    record: {
      addressLine1: "123 Private Street",
      birthDate: "1980-01-01",
      dateOfBirth: "1980-01-01",
      dob: "1980-01-01",
      id: "cycle-identity-only",
      memberName: "Raw Member Name",
      provider_connection_id: "provider-garmin-1",
      sourceProviderSlug: "garmin",
      user: {
        id: "raw-cycle-user-id",
      },
      profile: {
        patient_id: "raw-cycle-patient-id",
      },
      symptoms: [
        {
          subjectId: "raw-cycle-subject-id",
          subjects: [
            {
              id: "raw-cycle-subjects-container-id",
            },
          ],
        },
      ],
    },
  },
] as const) {
  test(`Junction ${testCase.label} raw-only summary does not create a historical obligation`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [testCase.resource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${testCase.resource}/junction-user-1`)) {
        return createJsonResponse({ data: [testCase.record] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [testCase.resource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T00:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

for (const summaryResource of ["sleep", "workouts", "body"] as const) {
  test(`Junction ${summaryResource} summary historical backfill marks the historical window complete`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [usefulHistoricalSummaryRecordByResource[summaryResource]] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

test("Junction sleep_cycle stage-count-only history stays pending without canonical evidence", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              heartrate: true,
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "sleep-cycle-stage-count-only",
          provider_connection_id: "provider-garmin-1",
          stageCount: 4,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-03T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/sleep_cycle/")),
    "Junction sleep-cycle backfill should fetch REST summary data.",
  );
  assertJunctionWindowQuery(summaryRequest, "2026-04-01", "2026-04-02");
});

for (const summaryResource of ["activity", "sleep"] as const) {
  test(`Junction ${summaryResource} id-only historical backfill keeps the summary window retrying`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [{ id: `${summaryResource}-1`, connectionId: "provider-garmin-1" }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T00:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
    assert.equal(importedSnapshots.length, 1);
  });
}

const floatingSessionOnlySummaryRecordByResource = {
  sleep: {
    id: "sleep-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T01:00:00",
    endAt: "2026-04-02T08:00:00",
  },
} satisfies Record<"sleep", Record<string, unknown>>;

for (const summaryResource of ["sleep"] as const) {
  test(`Junction ${summaryResource} floating session-only historical backfill keeps the summary window retrying`, async () => {
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [floatingSessionOnlySummaryRecordByResource[summaryResource]] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T00:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
    assert.equal(importedSnapshots.length, 1);
  });
}

test("Junction useful summary without source linkage keeps the historical window retrying", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 4321 }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction floating-provider metric-only summary keeps the historical window retrying", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "freestyle_libre",
            name: "Freestyle Libre",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", sourceProviderSlug: "freestyle_libre", steps: 4321 }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction source envelope summary historical backfill marks the historical window complete", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{
          sourceProviderSlug: "garmin",
          data: [{ id: "activity-1", steps: 4321 }],
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction compact timeseries-only historical backfill keeps the summary window retrying", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      if (new URL(url).searchParams.get("start_date") !== "2026-04-02") {
        return createJsonResponse({ groups: {} });
      }
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              start: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });

  const context = createJunctionJobContext({
    now: "2026-04-04T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(initialResult.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(initialResult.nextReconcileAt, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
  await executeTemporalAuthorityChildren({ context, initialResult, provider });
  const result = await executeFullJobTimeseriesContinuations({
    context,
    initialResult,
    provider,
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 8);
  const timeseriesSnapshot = importedSnapshots.find((snapshot) =>
    ((snapshot as { timeseries?: { blood_oxygen?: unknown[] } }).timeseries?.blood_oxygen?.length ?? 0) > 0
  ) as { summaries?: Record<string, unknown[]>; timeseries?: Record<string, unknown[]> };
  assert.deepEqual(timeseriesSnapshot.summaries, {});
  assert.equal(timeseriesSnapshot.timeseries?.blood_oxygen?.length, 1);
});

test("Junction connect-window timeseries continuation bypasses completed setup work", async () => {
  const ownerWindowStart = "2026-04-01T00:00:00.000Z";
  const ownerWindowEnd = "2026-04-03T00:00:00.000Z";
  const createProviderForRequests = (requests: string[]) =>
    createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                activity: true,
                hrv: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({
          data: [{ id: "activity-1", sourceProviderSlug: "garmin", steps: 4321 }],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/hrv/grouped")) {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                start: new URL(url).searchParams.get("start_date"),
                value: 97,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      timeseriesResources: ["hrv"],
    });

  const firstRequests: string[] = [];
  const firstImportedSnapshots: unknown[] = [];
  const initialJob = createJob("backfill", {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
  });
  const firstResult = await executeJunctionJob(
    createProviderForRequests(firstRequests),
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        firstImportedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    initialJob,
  );

  const continuation = requireValue(
    firstResult.scheduledJobs?.[0],
    "Yielded Junction backfill should schedule a continuation.",
  );
  assert.deepEqual(firstResult.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: ownerWindowStart,
    junctionHistoricalBackfillWindowEnd: ownerWindowEnd,
  });
  assert.deepEqual(continuation.payload, {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
    timeseriesCursor: ownerWindowStart,
    timeseriesResourceCursor: "hrv",
  });
  assert.equal(
    continuation.dedupeKey,
    buildExpectedJunctionDedupeKey("backfill", ownerWindowStart, ownerWindowEnd),
  );
  assert.deepEqual(
    firstRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [],
  );

  const secondRequests: string[] = [];
  const secondImportedSnapshots: unknown[] = [];
  const provider = createProviderForRequests(secondRequests);
  const context = createJunctionJobContext({
    now: "2026-04-04T00:05:00.000Z",
    importSnapshot: async (snapshot) => {
      secondImportedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const secondResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(continuation),
  );

  assert.deepEqual(
    secondRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [["2026-04-01", "2026-04-01"]],
  );
  assert.equal(
    secondRequests.some((url) =>
      url.includes("/v2/user/providers/") || url.includes("/v2/summary/")
    ),
    false,
  );
  assert.equal(secondResult.metadataPatch, undefined);
  assert.deepEqual(secondResult.scheduledJobs?.[0]?.payload, {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
    timeseriesCursor: "2026-04-02T00:00:00.000Z",
    timeseriesResourceCursor: "hrv",
  });
  assert.equal(secondImportedSnapshots.length, 1);

  const terminalResult = await executeFullJobTimeseriesContinuations({
    context,
    initialResult: secondResult,
    provider,
  });
  assert.equal(terminalResult.metadataPatch, undefined);
  assert.equal(terminalResult.scheduledJobs, undefined);
  assert.equal(secondImportedSnapshots.length, 2);
  assert.deepEqual(
    secondRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => new URL(url).searchParams.get("start_date")),
    ["2026-04-01", "2026-04-02"],
  );

  const scheduledAfterCompletion = provider.jobExecutor?.createScheduledJobs?.(
    createStoredAccount({
      metadata: firstResult.metadataPatch ?? {},
    }),
    "2026-04-04T00:10:00.000Z",
  );
  assert.equal(
    scheduledAfterCompletion?.jobs.some((job) => job.kind === "backfill"),
    false,
  );
});

test("Junction profile-only historical backfill has no historical completion obligation", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              profile: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "profile-1", email: "person@example.test" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-04T00:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 2,
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    requests.filter((url) => new URL(url).pathname.includes("/v2/summary/profile/")).length,
    1,
  );
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction profile-only backfill should fetch the profile current-state summary.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
});

test("Junction reconcile refreshes a revision-1 profile marker once", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          slug: "oura",
          name: "Oura Ring",
          status: "connected",
          resource_availability: { profile: true },
        }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        data: [{
          gender: "other",
          height: 181,
          updated_at: "2026-04-01T09:00:00Z",
          source: { provider: "oura", type: "ring" },
        }],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });
  const legacyAccount = createAccount({
    metadata: {
      junctionProfileSummaryCheckedAt: "2026-04-02T00:00:00.000Z",
      junctionProfileSummaryNormalizationRevision: 1,
    },
  });
  const job = createJob("reconcile", {
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const firstResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: legacyAccount,
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      shouldYield: () => false,
    }),
    job,
  );

  assert.deepEqual(firstResult.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T00:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 2,
  });
  assert.equal(firstResult.scheduledJobs?.[0]?.payload?.summaryPhaseComplete, true);
  const firstSnapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
  };
  assert.deepEqual(firstSnapshot.summaries?.profile, [{
    gender: "other",
    height: 181,
    sourceProviderSlug: "oura",
    sourceType: "ring",
    updated_at: "2026-04-01T09:00:00Z",
  }]);

  const secondResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          ...legacyAccount.metadata,
          ...firstResult.metadataPatch,
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      shouldYield: () => false,
    }),
    job,
  );

  assert.equal(
    requests.filter((url) => new URL(url).pathname.includes("/v2/summary/profile/")).length,
    1,
  );
  assert.equal(secondResult.metadataPatch, undefined);
});

test("Junction revision-2 reconcile preserves a no-id profile spine", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-profile-revision-2-no-id");
  const createdAt = "2026-04-01T09:00:00.000Z";
  const updatedAt = "2026-05-20T09:00:00.000Z";
  let providerHeight = 180;
  const requests: string[] = [];
  const legacyProfileSnapshot: JunctionSnapshotInput = {
    importedAt: "2026-05-20T10:00:00.000Z",
    summaries: {
      profile: {
        updated_at: updatedAt,
        birth_date: "1980-01-01",
        gender: "other",
        height: 180,
        source_device_id: "stable-profile-source",
        source: { provider: "oura", type: "ring" },
      },
    },
  };
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          slug: "oura",
          name: "Oura Ring",
          status: "connected",
          resource_availability: { profile: true },
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        data: [{
          created_at: createdAt,
          updated_at: updatedAt,
          birth_date: "1980-01-01",
          gender: "other",
          height: providerHeight,
          source_device_id: "stable-profile-source",
          source: { provider: "oura", type: "ring" },
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  try {
    const coreRuntime = await import("@murphai/core");
    await coreRuntime.initializeVault({
      createdAt: "2026-04-01T00:00:00.000Z",
      timezone: "UTC",
      vaultRoot,
    });
    const predecessor = await importDeviceProviderSnapshot<
      Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
    >({
      provider: "junction",
      snapshot: legacyProfileSnapshot,
      vaultRoot,
    }, { corePort: coreRuntime });
    const predecessorHeight = predecessor.events.find((event) =>
      event.kind === "observation" && event.metric === "height"
    );
    const predecessorDemographics = predecessor.events.find((event) =>
      event.kind === "note" && event.title === "Junction profile"
    );
    assert.ok(predecessorHeight);
    assert.ok(predecessorDemographics);
    assert.equal(predecessor.events.every((event) =>
      event.dataOrigin?.normalizerVersion === "junction-no-id-profile.v1"
      && event.occurredAt === updatedAt
      && event.externalRef?.version === updatedAt
    ), true);
    await coreRuntime.upsertEvent({
      vaultRoot,
      payload: {
        ...predecessorHeight,
        recordedAt: "2026-05-20T10:30:00.000Z",
        source: "manual",
        value: 179,
      },
    });
    await coreRuntime.deleteEvent({ vaultRoot, eventId: predecessorDemographics.id });

    const eventShardPaths = [...new Set(predecessor.eventShardPaths)];
    const readEventRecords = async () => (
      await Promise.all(eventShardPaths.map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ))
    ).flat();
    const beforeRefresh = await readEventRecords();
    const importSnapshot: ProviderJobContext["importSnapshot"] = async (snapshot) => {
      const imported = await importDeviceProviderSnapshot<
        Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
      >({ provider: "junction", snapshot, vaultRoot }, { corePort: coreRuntime });
      return {
        canonicalEventCount: imported.events.length,
        durableDeliveryAccepted: true,
      };
    };
    const revision1Account = createAccount({
      metadata: {
        junctionProfileSummaryCheckedAt: "2026-05-20T11:00:00.000Z",
        junctionProfileSummaryNormalizationRevision: 1,
      },
    });
    const job = createJob("reconcile", {
      windowStart: "2026-05-19T00:00:00.000Z",
      windowEnd: "2026-05-20T23:59:59.999Z",
    });
    const firstResult = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: revision1Account,
        importSnapshot,
        now: "2026-05-20T12:00:00.000Z",
        shouldYield: () => false,
      }),
      job,
    );
    assert.equal(firstResult.metadataPatch?.junctionProfileSummaryNormalizationRevision, 2);
    assert.equal(firstResult.scheduledJobs?.[0]?.payload?.summaryPhaseComplete, true);

    const afterRefresh = await readEventRecords();
    assert.equal(afterRefresh.length, beforeRefresh.length);
    const revisionOf = (record: Record<string, unknown>): number => {
      const lifecycle = record.lifecycle;
      return lifecycle && typeof lifecycle === "object" && !Array.isArray(lifecycle)
          && "revision" in lifecycle && typeof lifecycle.revision === "number"
        ? lifecycle.revision
        : 1;
    };
    const isDeleted = (record: Record<string, unknown>): boolean => {
      const lifecycle = record.lifecycle;
      return Boolean(
        lifecycle && typeof lifecycle === "object" && !Array.isArray(lifecycle)
        && "state" in lifecycle && lifecycle.state === "deleted",
      );
    };
    const latestById = new Map<string, Record<string, unknown>>();
    for (const record of afterRefresh) {
      if (typeof record.id !== "string") {
        continue;
      }
      const existing = latestById.get(record.id);
      if (!existing || revisionOf(record) > revisionOf(existing)) {
        latestById.set(record.id, record);
      }
    }
    const live = [...latestById.values()].filter((record) => !isDeleted(record));
    const liveHeight = latestById.get(predecessorHeight.id);
    const deletedDemographics = latestById.get(predecessorDemographics.id);
    assert.equal(live.length, 2);
    assert.equal(liveHeight?.source, "manual");
    assert.equal(liveHeight?.value, 179);
    assert.equal(isDeleted(deletedDemographics ?? {}), true);

    const requestCountAfterRefresh = requests.filter((url) =>
      new URL(url).pathname.includes("/v2/summary/profile/")
    ).length;
    const replayResult = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            ...revision1Account.metadata,
            ...firstResult.metadataPatch,
          },
        }),
        importSnapshot,
        now: "2026-05-20T12:05:00.000Z",
        shouldYield: () => false,
      }),
      job,
    );
    assert.equal(replayResult.metadataPatch, undefined);
    assert.equal(requests.filter((url) =>
      new URL(url).pathname.includes("/v2/summary/profile/")
    ).length, requestCountAfterRefresh);

    providerHeight = 181;
    await assert.rejects(
      executeJunctionJob(
        provider,
        createJunctionJobContext({
          account: revision1Account,
          importSnapshot,
          now: "2026-05-20T12:10:00.000Z",
          shouldYield: () => false,
        }),
        job,
      ),
      (error: unknown) => (error as { code?: unknown }).code === "EVENT_SOURCE_REVISION_CONFLICT",
    );
    assert.equal((await readEventRecords()).length, afterRefresh.length);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction scheduled polling skips profile after the current normalization marker", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionProfileSummaryCheckedAt: "2026-04-02T00:00:00.000Z",
          junctionProfileSummaryNormalizationRevision: 2,
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      shouldYield: () => false,
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.some((url) => new URL(url).pathname.includes("/v2/summary/profile/")), false);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(result.metadataPatch, undefined);
});

test("Junction unproven historical coverage saturates at a daily retry without a reset marker", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 4,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 4,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.status, "connected");
  assert.equal(
    upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
    false,
  );
});
