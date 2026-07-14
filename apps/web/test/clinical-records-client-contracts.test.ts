import { describe, expect, it } from "vitest";

import {
  CLINICAL_RECORD_CONNECT_START_PATH,
  parseClinicalProviderSearchResponse,
  parseClinicalRecordCallbackMarker,
  parseClinicalRecordConnectIntentResponse,
  parseClinicalRecordConnectStartRequest,
  parseClinicalRecordConnectionsResponse,
} from "@/src/lib/clinical-records/client-contracts";

describe("Clinical Records client contracts", () => {
  it("parses the safe provider and connection projections", () => {
    expect(parseClinicalProviderSearchResponse({
      directoryVersion: "2026-07-10.epic-brands-r4",
      ok: true,
      providers: [{
        brandName: "Example Health",
        facilities: [{ city: "Atlanta", name: "Example Hospital", postalCode: "30309", state: "GA" }],
        id: "epic-example",
        sourceSystem: "epic-fhir",
      }],
    }).providers[0]?.brandName).toBe("Example Health");

    expect(parseClinicalRecordConnectionsResponse({
      connections: [{
        connectedAt: "2026-07-10T12:00:00.000Z",
        connectionId: "crc_123",
        displayName: "Example Health",
        lastErrorCode: null,
        lastSyncCompletedAt: null,
        latestRun: {
          completedAt: null,
          importedCount: 0,
          reviewCount: 0,
          runId: "crr_123",
          status: "queued",
        },
        providerDirectoryEntryId: "epic-example",
        sourceSystem: "epic-fhir",
        status: "active",
      }],
      ok: true,
    }).connections[0]?.latestRun?.status).toBe("queued");
  });

  it("parses intent and callback markers", () => {
    expect(parseClinicalRecordConnectIntentResponse({
      claim: `cr_${"a".repeat(32)}`,
      expiresAt: "2026-07-10T12:15:00.000Z",
      ok: true,
    }).claim).toHaveLength(35);
    expect(parseClinicalRecordCallbackMarker("connected")).toBe("connected");
  });

  it("keeps the connect-start bearer in the bounded request body, not the route", () => {
    const claim = `cr_${"b".repeat(32)}`;
    expect(CLINICAL_RECORD_CONNECT_START_PATH).toBe(
      "/api/clinical-records/connect-intents/start",
    );
    expect(CLINICAL_RECORD_CONNECT_START_PATH).not.toContain(claim);
    expect(parseClinicalRecordConnectStartRequest({
      claim,
      providerDirectoryEntryId: "epic-example",
    })).toEqual({ claim, providerDirectoryEntryId: "epic-example" });
    expect(() => parseClinicalRecordConnectStartRequest({
      claim,
      providerDirectoryEntryId: "epic-example",
      redirect: "/records",
    })).toThrow(/client contract/u);
  });

  it("fails closed on extra fields and unknown statuses", () => {
    expect(() => parseClinicalRecordConnectionsResponse({
      connections: [{
        connectedAt: "2026-07-10T12:00:00.000Z",
        connectionId: "crc_123",
        displayName: "Example Health",
        lastErrorCode: null,
        lastSyncCompletedAt: null,
        latestRun: null,
        providerDirectoryEntryId: "epic-example",
        sourceSystem: "epic-fhir",
        status: "disconnected",
      }],
      ok: true,
    })).toThrow(/client contract/u);
  });
});
