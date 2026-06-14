import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
} from "@murphai/importers/device-providers/junction-resources";

import {
  assertDeviceSyncJobsReadyForFixtureExport,
  buildCaptureDeviceSyncEnv,
  buildSanitizedWearableFixtureCandidate,
  checkCaptureRequestHost,
  parseDeviceSyncJobSummary,
} from "./wearable-fixture-capture.ts";

describe("buildSanitizedWearableFixtureCandidate", () => {
  it("removes direct identifiers and shifts provider dates in captured Junction files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-wearable-capture-"));
    const vaultRoot = path.join(tempRoot, "vault");

    try {
      await writeJson(
        path.join(vaultRoot, "raw", "integrations", "junction", "snapshot.json"),
        {
          accountId: "raw-account-123",
          client_user_id: "junction-client-user-123",
          owner_id: "owner-123",
          access_token: "secret-access-token",
          email: "person@example.com",
          source: {
            id: "source-id-123",
            displayName: "Oura Source",
          },
          provider: {
            id: "provider-id-123",
            displayName: "Oura Provider",
          },
          profile: {
            displayName: "Example Person",
            sourceDeviceId: "device-abc",
            uuid: "550e8400-e29b-41d4-a716-446655440000",
          },
          importedAt: "2026-05-10T12:00:00.000Z",
          measuredAt: "2026-05-10 14:00:00",
          startTimeEpochMs: Date.parse("2026-05-10T15:00:00.000Z"),
          endTimeEpochSeconds: Math.round(Date.parse("2026-05-10T16:00:00.000Z") / 1_000),
          title: "unsafe-freeform-title",
          summaries: [
            {
              resourceType: "sleep",
              day: "2026-05-11",
              restingHeartRate: 51,
            },
          ],
        },
      );
      await writeJsonl(
        path.join(vaultRoot, "ledger", "events", "device-imports.jsonl"),
        [
          {
            id: "event-1",
            userId: "user-123",
            occurredAt: "2026-05-10T12:30:00.000Z",
            payload: {
              Authorization: "Bearer secret",
              phone: "+1 555 111 2222",
              latitude: 40.7,
              longitude: -73.9,
            },
          },
        ],
      );
      await writeJsonl(
        path.join(vaultRoot, "ledger", "metric-samples", "wearables.jsonl"),
        [
          {
            id: "metric-1",
            sourceDeviceId: "device-abc",
            observedAt: "2026-05-10T13:00:00.000Z",
            metric: "restingHeartRate",
            value: 51,
          },
        ],
      );

      const candidate = await buildSanitizedWearableFixtureCandidate({
        vaultRoot,
        generatedAt: new Date("2026-06-01T00:00:00.000Z"),
      });
      const serialized = JSON.stringify(candidate);

      expect(candidate.captureWindow.firstObservedAt).toBe("2026-04-01T00:00:00.000Z");
      expect(serialized).toContain("2026-04-01T00:30:00.000Z");
      expect(serialized).toContain("\"day\":\"2026-04-01\"");
      expect(serialized).not.toContain("2026-05-10");
      expect(serialized).not.toContain("raw-account-123");
      expect(serialized).not.toContain("secret-access-token");
      expect(serialized).not.toContain("person@example.com");
      expect(serialized).not.toContain("Example Person");
      expect(serialized).not.toContain("junction-client-user-123");
      expect(serialized).not.toContain("owner-123");
      expect(serialized).not.toContain("source-id-123");
      expect(serialized).not.toContain("provider-id-123");
      expect(serialized).not.toContain("Oura Source");
      expect(serialized).not.toContain("Oura Provider");
      expect(serialized).not.toContain("device-abc");
      expect(serialized).not.toContain("550e8400-e29b-41d4-a716-446655440000");
      expect(serialized).not.toContain("2026-05-10 14:00:00");
      expect(serialized).not.toContain(String(Date.parse("2026-05-10T15:00:00.000Z")));
      expect(serialized).not.toContain(String(Math.round(Date.parse("2026-05-10T16:00:00.000Z") / 1_000)));
      expect(serialized).not.toContain("unsafe-freeform-title");
      expect(serialized).not.toContain("Bearer secret");
      expect(serialized).not.toContain("+1 555 111 2222");
      expect(serialized).not.toContain("latitude");
      expect(serialized).not.toContain("longitude");
      expect(serialized).toContain("2026-04-01T02:00:00.000Z");
      expect(serialized).toContain(String(Date.parse("2026-04-01T03:00:00.000Z")));
      expect(serialized).toContain(String(Math.round(Date.parse("2026-04-01T04:00:00.000Z") / 1_000)));
      expect(serialized).toContain("\"email\":\"fixture-email-1\"");
      expect(serialized).toContain("\"phone\":\"fixture-phone-1\"");
      expect(serialized).toContain("\"accountId\":\"fixture-accountid-1\"");
      expect(serialized).toContain("\"sourceDeviceId\":\"fixture-sourcedeviceid-1\"");
      expect(serialized).toContain("\"client_user_id\":\"fixture-clientuserid-1\"");
      expect(serialized).toContain("\"owner_id\":\"fixture-ownerid-1\"");
      expect(serialized).toContain("\"title\":\"fixture-title-1\"");
      expect(serialized).toContain("\"id\":\"fixture-id-1\"");
      expect(serialized).not.toMatch(/fixture-email-[0-9a-f]{10}/u);
      expect(candidate.rawArtifacts).toHaveLength(1);
      expect(candidate.eventLedgers).toHaveLength(1);
      expect(candidate.metricSampleLedgers).toHaveLength(1);
      expect(candidate.redactionReport.pseudonymizedValues).toBeGreaterThan(0);
      expect(candidate.redactionReport.droppedKeys).toBeGreaterThan(0);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

describe("checkCaptureRequestHost", () => {
  it("allows equivalent loopback hosts and rejects forwarded headers", () => {
    expect(checkCaptureRequestHost({ host: "127.0.0.1:8799" }, "127.0.0.1:8799")).toEqual({
      allowed: true,
      reason: "ok",
    });
    expect(checkCaptureRequestHost({ host: "localhost:8799" }, "127.0.0.1:8799")).toEqual({
      allowed: true,
      reason: "ok",
    });
    expect(checkCaptureRequestHost({ host: "127.0.0.1:8799" }, "localhost:8799")).toEqual({
      allowed: true,
      reason: "ok",
    });
    expect(checkCaptureRequestHost({ host: "localhost:8800" }, "127.0.0.1:8799")).toEqual({
      allowed: false,
      reason: "unexpected_host",
    });
    expect(checkCaptureRequestHost({ host: "evil.example:8799" }, "127.0.0.1:8799")).toEqual({
      allowed: false,
      reason: "unexpected_host",
    });
    expect(
      checkCaptureRequestHost(
        {
          host: "127.0.0.1:8799",
          "x-forwarded-host": "evil.example",
        },
        "127.0.0.1:8799",
      ),
    ).toEqual({
      allowed: false,
      reason: "forwarded_header",
    });
  });
});

describe("buildCaptureDeviceSyncEnv", () => {
  it("pins the local capture run to all wearable targets and allowed Junction resources", () => {
    const result = buildCaptureDeviceSyncEnv({
      env: {
        DEVICE_SYNC_ALLOWED_RETURN_ORIGINS: "http://existing.local",
        JUNCTION_PROVIDER_FILTER: "oura",
        JUNCTION_SUMMARY_RESOURCES: "sleep",
        JUNCTION_TIMESERIES_RESOURCES: "hrv",
      },
      origin: "http://127.0.0.1:8799",
    });

    expect(result.env.DEVICE_SYNC_ALLOWED_RETURN_ORIGINS?.split(",")).toEqual([
      "http://existing.local",
      "http://127.0.0.1:8799",
      "http://localhost:8799",
    ]);
    expect(result.captureConfig.providerFilter).toEqual(["oura", "whoop_v2", "garmin"]);
    expect(result.env.JUNCTION_PROVIDER_FILTER).toBe("oura,whoop_v2,garmin");
    expect(result.captureConfig.summaryResources).toEqual([
      ...JUNCTION_ALLOWED_SUMMARY_RESOURCES,
    ]);
    expect(result.captureConfig.timeseriesResources).toEqual([
      ...JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
    ]);
    expect(result.env.JUNCTION_SUMMARY_RESOURCES).toBe(result.captureConfig.summaryResources.join(","));
    expect(result.env.JUNCTION_TIMESERIES_RESOURCES).toBe(result.captureConfig.timeseriesResources.join(","));
  });
});

describe("parseDeviceSyncJobSummary", () => {
  it("reads queued/running/dead job counts from daemon health responses", () => {
    expect(
      parseDeviceSyncJobSummary({
        ok: true,
        summary: {
          accountsTotal: 3,
          accountsActive: 3,
          jobsQueued: 1,
          jobsRunning: 2,
          jobsDead: 0,
        },
      }),
    ).toEqual({
      jobsQueued: 1,
      jobsRunning: 2,
      jobsDead: 0,
    });
  });

  it("rejects malformed daemon health responses", () => {
    expect(() => parseDeviceSyncJobSummary({ summary: { jobsQueued: -1, jobsRunning: 0, jobsDead: 0 } }))
      .toThrow(/jobsQueued/u);
    expect(() => parseDeviceSyncJobSummary({ ok: true })).toThrow(/summary/u);
  });
});

describe("assertDeviceSyncJobsReadyForFixtureExport", () => {
  it("allows exports only after jobs are idle and healthy", () => {
    expect(() => assertDeviceSyncJobsReadyForFixtureExport({
      idle: true,
      timedOut: false,
      summary: {
        jobsDead: 0,
        jobsQueued: 0,
        jobsRunning: 0,
      },
    })).not.toThrow();

    expect(() => assertDeviceSyncJobsReadyForFixtureExport({
      idle: false,
      timedOut: true,
      summary: {
        jobsDead: 0,
        jobsQueued: 1,
        jobsRunning: 0,
      },
    })).toThrow(/incomplete or dead/u);

    expect(() => assertDeviceSyncJobsReadyForFixtureExport({
      idle: true,
      timedOut: false,
      summary: {
        jobsDead: 1,
        jobsQueued: 0,
        jobsRunning: 0,
      },
    })).toThrow(/dead=1/u);
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath: string, records: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}
