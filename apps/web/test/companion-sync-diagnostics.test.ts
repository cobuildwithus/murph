import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import { parseCompanionSyncDiagnostic } from "../src/lib/device-sync/companion-sync-diagnostics";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), consent: vi.fn(), write: vi.fn(), ops: vi.fn(),
  connections: vi.fn(), signals: vi.fn(), logs: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuthFromBearerToken: mocks.auth,
}));
vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted: mocks.consent,
}));
vi.mock("@/src/lib/hosted-runtime-log/write", () => ({ writeHostedRuntimeLogs: mocks.write }));
vi.mock("@/src/lib/hosted-runtime-log/store", () => ({ listHostedRuntimeLogs: mocks.logs }));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.ops }));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    deviceConnection: { findMany: mocks.connections },
    deviceSyncSignal: { findMany: mocks.signals },
  }),
}));

import { POST } from "../app/api/device-sync/companion/sync-diagnostics/route";
import { GET } from "../app/api/ops/device-sync/companion-diagnostics/route";

function observation() {
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    diagnosticSessionId: "11111111-1111-4111-8111-111111111111",
    appVersion: "1.2.3", appBuild: "42", osVersion: "26.1.0",
    trigger: "manual_completed", outcome: "no_new_data",
    sdkSignedIn: true, connectionState: "connected", syncPaused: false,
    backgroundRefresh: "denied", lowPowerMode: true, protectedDataAvailable: false,
    appState: "active", resourceCount: 1,
    resources: [{
      resource: "steps", status: "expected_error", startedAt: "2026-08-01T10:00:00Z",
      endedAt: null, dataCount: 0, background: true, historical: false,
      backgroundRefreshUnavailable: true, lowPowerMode: true,
    }],
  };
}
function post(body: unknown) {
  return POST(new Request("https://app.example.test/api/device-sync/companion/sync-diagnostics", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ member: { id: "member-fixture" } });
  mocks.consent.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(1);
  mocks.ops.mockResolvedValue({});
  mocks.connections.mockResolvedValue([]);
  mocks.signals.mockResolvedValue([]);
  mocks.logs.mockResolvedValue([]);
});

describe("native sync diagnostic admission", () => {
  it("round-trips a native observation through the real hosted log parser", () => {
    const now = new Date();
    const entry = parseCompanionSyncDiagnostic(observation(), now);
    expect(parseHostedRuntimeLogRequest({ entries: [entry] }).entries[0]).toMatchObject({
      at: now.toISOString(), eventCode: "device-sync.companion_diagnostic",
      redactedJson: { evidenceOrigin: "client_observation", backgroundRefresh: "denied" },
    });
  });

  it("binds storage to verified member authority", async () => {
    expect((await post(observation())).status).toBe(200);
    expect(mocks.consent).toHaveBeenCalledWith(expect.objectContaining({ memberId: "member-fixture" }));
    expect(mocks.write).toHaveBeenCalledWith({
      userId: "member-fixture",
      entries: [expect.objectContaining({ component: "device-sync" })],
    });
  });

  it.each([
    { memberId: "different-member" }, { token: "secret-fixture" }, { message: "raw error" },
    { schemaVersion: 2 }, { appVersion: "not-a-version" }, { lowPowerMode: "yes" },
    { resourceCount: -1 }, { trigger: "arbitrary_event" }, { diagnosticSessionId: "device-identifier" },
    { observedAt: "2001-01-01T00:00:00Z" }, { resources: Array(17).fill({}) },
  ])("rejects unsupported/private input before storage: %j", async (patch) => {
    expect((await post({ ...observation(), ...patch })).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rejects nested raw payloads, unknown resources and missing required fields", () => {
    for (const patch of [{ value: 123 }, { errorDetails: "raw SDK error" }, { resource: "custom_private_type" }]) {
      const body = observation();
      expect(() => parseCompanionSyncDiagnostic({
        ...body, resources: [{ ...body.resources[0], ...patch }],
      })).toThrow();
    }
    const { sdkSignedIn: _omitted, ...body } = observation();
    expect(() => parseCompanionSyncDiagnostic(body)).toThrow();
  });

  it("does not write after auth or consent failure", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("test authentication rejection"));
    expect((await post(observation())).status).toBeGreaterThanOrEqual(400);
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.consent.mockRejectedValueOnce(new Error("test consent rejection"));
    expect((await post(observation())).status).toBeGreaterThanOrEqual(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("reports a capped/unavailable append honestly", async () => {
    mocks.write.mockResolvedValue(0);
    expect(await (await post(observation())).json()).toMatchObject({ recorded: false });
  });

  it("keeps server receipt time independent of phone time", () => {
    const body = observation();
    const now = new Date(Date.parse(body.observedAt) + 60_000);
    const entry = parseCompanionSyncDiagnostic(body, now);
    expect(entry.at).toBe(now.toISOString());
    expect(entry.redactedJson?.clientObservedAt).toBe(body.observedAt);
  });

  it("accepts Swift's omitted optional end time for an unfinished attempt", () => {
    const body = observation();
    const { endedAt: _omitted, ...attempt } = body.resources[0]!;
    const entry = parseCompanionSyncDiagnostic({ ...body, resources: [attempt] });
    expect(entry.redactedJson?.companionSyncAttempts).toEqual([
      expect.objectContaining({ endedAt: null }),
    ]);
  });
});

describe("operator sync evidence", () => {
  it("separates old source arrival from a newly completed historical import", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    const recent = new Date();
    mocks.connections.mockResolvedValue([{
      id: "connection-fixture", status: "active", sources: [{ lastDataAt: old }],
      dirtyState: { dirtyRevision: 12n, processedRevision: 10n, firstDirtyAt: recent, latestDirtyAt: recent },
    }]);
    mocks.signals.mockResolvedValue([
      { kind: "canonical_import", occurredAt: recent, createdAt: recent },
      { kind: "webhook_hint", occurredAt: recent, createdAt: recent },
    ]);
    const response = await GET(new Request("https://app.example.test/api/ops/device-sync/companion-diagnostics?memberId=member-fixture"));
    const result = await response.json();
    expect(result.lastSourceDataAt).toBe(old.toISOString());
    expect(result.lastWebhookHintReceivedAt).toBe(recent.toISOString());
    expect(result.lastCanonicalImportCompletedAt).toBe(recent.toISOString());
    expect(result.connections[0].pendingRevisions).toBe("2");
    expect(result.connections[0].id).toBeUndefined();
    expect(mocks.logs).toHaveBeenCalledWith(expect.objectContaining({
      userId: "member-fixture", eventCode: "device-sync.companion_diagnostic", limit: 50,
    }));
  });

  it("distinguishes unavailable logs from an empty history", async () => {
    mocks.logs.mockRejectedValue(new Error("test log outage"));
    const response = await GET(new Request("https://app.example.test/api/ops/device-sync/companion-diagnostics?memberId=member-fixture"));
    expect((await response.json()).observations).toEqual({ status: "unavailable", entries: [] });
  });

  it("checks operator access before reading member evidence", async () => {
    mocks.ops.mockRejectedValue(new Error("test operator denial"));
    expect((await GET(new Request("https://app.example.test/api/ops/device-sync/companion-diagnostics?memberId=member-fixture"))).status).toBeGreaterThanOrEqual(400);
    expect(mocks.connections).not.toHaveBeenCalled();
    expect(mocks.logs).not.toHaveBeenCalled();
  });
});
