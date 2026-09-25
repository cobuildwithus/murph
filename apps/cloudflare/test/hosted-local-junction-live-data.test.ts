import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as coreRuntime from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { buildMetricProjection, readVault, readVaultRawTolerant } from "@murphai/query";
import { createBrowserVaultReplica } from "@murphai/query/browser";
import { describe, expect, it, vi } from "vitest";

import { hasCanonicalGarminSteps, readGarminStepExpectations, waitForLiveGarminCanonicalData } from "./helpers/hosted-local-junction-live-data.js";

const window = { from: "2026-08-01", to: "2026-08-14" };
const activity = {
  calendar_date: "2026-08-12",
  date: "2026-08-12T00:00:00.000Z",
  id: "synthetic-garmin-activity",
  source: { provider: "garmin", type: "watch" },
  steps: 3456,
  timezone_offset: -14400,
};

describe("live Garmin canonical data oracle", () => {
  it("reads the independent provider day and value while excluding unrelated, empty, and open-day data", () => {
    expect(readGarminStepExpectations([
      activity,
      { ...activity, source: { provider: "oura" } },
      { ...activity, calendar_date: "2026-08-15" },
      { ...activity, calendar_date: "2026-07-31" },
      { ...activity, steps: 0 },
      { ...activity, steps: Number.NaN },
      { ...activity, steps: "3456" },
      { ...activity, source: undefined },
    ], window)).toEqual([{ date: "2026-08-12", value: 3456 }]);
    expect(readGarminStepExpectations([{
      calendarDate: "2026-08-13", source: { slug: "garmin" }, steps: 2345,
    }], window)).toEqual([{ date: "2026-08-13", value: 2345 }]);
  });

  it("requires provider values to survive the real canonical importer and member query with Garmin provenance", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-garmin-canary-oracle-"));
    try {
      const generatedAt = "2026-08-16T12:00:00.000Z";
      await coreRuntime.initializeVault({ createdAt: generatedAt, timezone: "UTC", vaultRoot });
      await importDeviceProviderSnapshot({
        provider: "junction",
        snapshot: { importedAt: generatedAt, summaries: { activity: [activity] } },
        vaultRoot,
      }, { corePort: coreRuntime });
      const projection = buildMetricProjection(await readVaultRawTolerant(vaultRoot));
      const replica = await createBrowserVaultReplica({
        generatedAt,
        metricPoints: projection.metricPoints,
        sourceBundleHash: "a".repeat(64),
        vault: await readVault(vaultRoot),
      });
      const expected = readGarminStepExpectations([activity], window);
      expect(hasCanonicalGarminSteps(replica, expected)).toBe(true);
      expect(hasCanonicalGarminSteps(replica, [{ date: activity.calendar_date, value: 3457 }])).toBe(false);
      expect(hasCanonicalGarminSteps(replica, [{ date: "2026-08-11", value: activity.steps }])).toBe(false);
      expect(hasCanonicalGarminSteps({ ...replica, metricRows: [] }, expected)).toBe(false);
      expect(hasCanonicalGarminSteps({
        ...replica,
        metricRows: replica.metricRows.map((row) => ({ ...row, unit: "minutes" })),
      }, expected)).toBe(false);
      expect(hasCanonicalGarminSteps({
        ...replica,
        metricRows: replica.metricRows.map((row) => ({ ...row, sourceLabel: "Oura" })),
      }, expected)).toBe(false);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});


describe("live Garmin empty-account boundary", () => {
  function setup() {
    const requestJson = vi.fn(async (): Promise<never> => { throw new Error("synthetic status failure"); });
    const input: Parameters<typeof waitForLiveGarminCanonicalData>[0] = {
      client: {
        resolveUser: vi.fn().mockResolvedValue({ userId: "synthetic-provider-user" }),
        listSummary: vi.fn().mockResolvedValue([]),
      },
      clientUserId: "synthetic-client-user",
      memberId: "synthetic-member",
      notBefore: Date.now(),
      scenario: { harness: { requestJson } },
      signal: new AbortController().signal,
      timeoutMs: 1000,
    };
    return { input, requestJson };
  }

  it("accepts a successful empty provider read without claiming canonical ingestion", async () => {
    const { input, requestJson } = setup();
    await expect(waitForLiveGarminCanonicalData(input)).resolves.toBe("no_provider_data");
    expect(input.client.listSummary).toHaveBeenCalledOnce();
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("does not turn provider errors or missing identities into empty-account success", async () => {
    const { input } = setup();
    vi.mocked(input.client.listSummary).mockRejectedValue(new Error("synthetic private payload"));
    await expect(waitForLiveGarminCanonicalData(input)).rejects.toThrow("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
    vi.mocked(input.client.resolveUser).mockResolvedValue(null);
    await expect(waitForLiveGarminCanonicalData(input)).rejects.toThrow("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
  });

  it("does not skip canonical checks for nonempty or malformed provider records", async () => {
    for (const records of [[activity], [{}]]) {
      const { input, requestJson } = setup();
      vi.mocked(input.client.listSummary).mockResolvedValue(records);
      await expect(waitForLiveGarminCanonicalData(input)).rejects.toThrow("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
      expect(requestJson).toHaveBeenCalledOnce();
    }
  });

  it("does not accept an empty response after cancellation", async () => {
    const { input } = setup();
    const controller = new AbortController();
    input.signal = controller.signal;
    vi.mocked(input.client.listSummary).mockImplementation(async () => {
      controller.abort();
      return [];
    });
    await expect(waitForLiveGarminCanonicalData(input)).rejects.toThrow("MURPH_E2E_GARMIN_RECENT_PROVIDER_DATA_MISSING");
  });
});
