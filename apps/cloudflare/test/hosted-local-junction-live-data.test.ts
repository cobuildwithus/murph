import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as coreRuntime from "@murphai/core";
import { JunctionClient } from "@murphai/device-syncd/providers/junction-client";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { buildMetricProjection, readVault, readVaultRawTolerant } from "@murphai/query";
import { createBrowserVaultReplica } from "@murphai/query/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatLiveGarminDataFailure, hasCanonicalGarminSteps, readGarminStepExpectations, waitForLiveGarminCanonicalData } from "./helpers/hosted-local-junction-live-data.js";

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
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  function setup() {
    const requestJson = vi.fn(async (): Promise<string> => { throw new Error("synthetic status failure"); });
    const input: Parameters<typeof waitForLiveGarminCanonicalData>[0] = {
      client: {
        resolveUser: vi.fn().mockResolvedValue({ userId: "synthetic-provider-user" }),
        listSummary: vi.fn().mockResolvedValue([]),
        introspectResources: vi.fn().mockResolvedValue({ data: [] }),
        introspectHistoricalPull: vi.fn().mockResolvedValue({ matchedUser: false, sources: [] }),
      },
      clientUserId: "synthetic-client-user",
      memberId: "synthetic-member",
      notBefore: Date.now(),
      scenario: { harness: { requestJson: async <T>(): Promise<T> => JSON.parse(await requestJson()) } },
      signal: new AbortController().signal,
      timeoutMs: 1000,
    };
    return { input, requestJson };
  }

  it("requests the entire final closed day through the actual Junction client", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
    const { input } = setup();
    const urls: URL[] = [];
    const client = new JunctionClient({
      apiKey: "sk_us_synthetic", environment: "sandbox", region: "us",
      fetchImpl: async (request) => {
        urls.push(new URL(request instanceof Request ? request.url : request.toString()));
        return Response.json({ activity: [] });
      },
    });
    input.client.listSummary = client.listSummary.bind(client);
    // The deliberate status failure stops after one real provider query.
    await expect(waitForLiveGarminCanonicalData(input)).rejects.toThrow("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
    expect(urls).toHaveLength(1);
    expect(urls[0]?.pathname).toBe("/v2/summary/activity/synthetic-provider-user");
    expect(urls[0]?.searchParams.get("provider")).toBe("garmin");
    expect(urls[0]?.searchParams.get("start_date")).toBe("2026-08-01T00:00:00.000Z");
    expect(urls[0]?.searchParams.get("end_date")).toBe("2026-08-14T23:59:59.999Z");
  });

  it("fails rather than passing when provider data stays empty until the deadline", async () => {
    const { input, requestJson } = setup();
    input.timeoutMs = 30;
    requestJson.mockImplementation(async () => JSON.stringify({
      inFlight: false, mailboxLag: [], userId: input.memberId, workspace: null,
    }));
    await expect(waitForLiveGarminCanonicalData(input))
      .rejects.toThrow("MURPH_E2E_GARMIN_RECENT_PROVIDER_DATA_MISSING");
    expect(input.client.listSummary).toHaveBeenCalledTimes(4);
    expect(requestJson).toHaveBeenCalledOnce();
    expect(input.client.introspectResources).toHaveBeenCalledOnce();
    expect(input.client.introspectHistoricalPull).toHaveBeenCalledOnce();
  });

  it("polls again after an empty initial pull instead of disconnecting before data arrives", async () => {
    const { input, requestJson } = setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    input.timeoutMs = 30_000;
    vi.mocked(input.client.listSummary).mockResolvedValueOnce([]).mockResolvedValue([activity]);
    requestJson.mockImplementationOnce(async () => {
      now += 15_000;
      return JSON.stringify({
        inFlight: false, mailboxLag: [], userId: input.memberId, workspace: null,
      });
    });
    // The second status read fails deliberately: it proves that newly available
    // provider data enters the canonical check rather than accepting empty data.
    await expect(waitForLiveGarminCanonicalData(input))
      .rejects.toThrow("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
    expect(input.client.listSummary).toHaveBeenCalledTimes(2);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it("cannot use records found by broader diagnostics as canonical ingestion proof", async () => {
    const { input, requestJson } = setup();
    input.timeoutMs = 30;
    requestJson.mockResolvedValue(JSON.stringify({
      inFlight: false, mailboxLag: [], userId: input.memberId, workspace: null,
    }));
    vi.mocked(input.client.listSummary).mockResolvedValueOnce([]).mockResolvedValue([activity]);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(waitForLiveGarminCanonicalData(input))
      .rejects.toThrow("MURPH_E2E_GARMIN_RECENT_PROVIDER_DATA_MISSING");
    expect(input.client.listSummary).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(log.mock.calls)).toContain("historyRangeData");
    expect(JSON.stringify(log.mock.calls)).not.toContain("CANONICAL_DATA_MATCHED");
  });

  it("preserves the data failure when both diagnostic endpoints reject", async () => {
    const { input, requestJson } = setup();
    input.timeoutMs = 30;
    requestJson.mockResolvedValue(JSON.stringify({
      inFlight: false, mailboxLag: [], userId: input.memberId, workspace: null,
    }));
    vi.mocked(input.client.introspectResources).mockRejectedValue(new Error("private resource body"));
    vi.mocked(input.client.introspectHistoricalPull).mockRejectedValue(new Error("private history body"));
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(waitForLiveGarminCanonicalData(input))
      .rejects.toThrow("MURPH_E2E_GARMIN_RECENT_PROVIDER_DATA_MISSING");
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|synthetic-member|synthetic-provider/u);
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
    expect(input.client.introspectResources).not.toHaveBeenCalled();
  });
});


describe("live Garmin data diagnostics", () => {
  it("preserves closed failures without exposing provider or vault error content", () => {
    for (const code of [
      "MURPH_E2E_GARMIN_CANONICAL_DATA_MISSING",
      "MURPH_E2E_GARMIN_RECENT_PROVIDER_DATA_MISSING",
    ]) {
      expect(formatLiveGarminDataFailure(new Error(code))).toBe(code);
      expect(formatLiveGarminDataFailure(new Error(`${code}: synthetic private content`)))
        .toBe("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
    }
    for (const error of [new Error("synthetic private payload"), "private text", null]) {
      expect(formatLiveGarminDataFailure(error)).toBe("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
    }
  });
});
