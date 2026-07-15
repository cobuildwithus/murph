import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  connectionFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  connectionUpdateMany: vi.fn(),
  oauthUpdateMany: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  runUpdateMany: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => {
    const clinicalRecordConnection = {
      findFirst: mocks.connectionFindFirst,
      findMany: mocks.connectionFindMany,
      updateMany: mocks.connectionUpdateMany,
    };
    return {
      clinicalRecordConnection,
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        clinicalRecordConnection,
      clinicalRecordOauthSession: { updateMany: mocks.oauthUpdateMany },
      clinicalRecordRetrievalRun: { updateMany: mocks.runUpdateMany },
      }),
    };
  },
}));

import {
  disconnectClinicalRecordConnection,
  listClinicalRecordConnections,
} from "@/src/lib/clinical-records/connections";

describe("Clinical Records connection lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_clinical_1" },
    });
    mocks.connectionFindFirst.mockResolvedValue({
      providerDirectoryEntryId: "epic-example",
    });
    mocks.connectionFindMany.mockResolvedValue([]);
    mocks.connectionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.oauthUpdateMany.mockResolvedValue({ count: 1 });
    mocks.runUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("clears patient credentials and invalidates older pending OAuth sessions on disconnect", async () => {
    const now = new Date("2026-07-10T18:00:00.000Z");
    const request = new Request(
      "https://join.example.test/api/clinical-records/connections/crc_1/disconnect",
      { method: "POST" },
    );

    await expect(disconnectClinicalRecordConnection({
      connectionId: "crc_1",
      now,
      request,
    })).resolves.toEqual({ connectionId: "crc_1", status: "disconnected" });

    expect(mocks.connectionUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accessTokenEncrypted: null,
        patientIdEncrypted: null,
        refreshTokenEncrypted: null,
        status: "disconnected",
      }),
      where: { id: "crc_1", memberId: "member_clinical_1" },
    });
    expect(mocks.oauthUpdateMany).toHaveBeenCalledWith({
      data: { consumedAt: now },
      where: {
        consumedAt: null,
        createdAt: { lte: now },
        memberId: "member_clinical_1",
        providerDirectoryEntryId: "epic-example",
      },
    });
  });

  it("lists only the active member's safe connection projection", async () => {
    mocks.connectionFindMany.mockResolvedValue([{
      accessTokenEncrypted: "sealed-access-token",
      connectedAt: new Date("2026-07-10T18:00:00.000Z"),
      displayName: "Example Health",
      id: "crc_1",
      lastErrorCode: "unsafe error with patient context",
      lastSyncCompletedAt: new Date("2026-07-10T18:05:00.000Z"),
      patientIdEncrypted: "sealed-patient-id",
      providerDirectoryEntryId: "epic-example",
      refreshTokenEncrypted: "sealed-refresh-token",
      retrievalRuns: [{
        completedAt: new Date("2026-07-10T18:05:00.000Z"),
        id: "crr_1",
        importedCount: 4,
        reviewCount: 1,
        status: "complete",
      }],
      sourceSystem: "epic-fhir",
      status: "active",
    }]);

    const connections = await listClinicalRecordConnections(new Request(
      "https://join.example.test/api/clinical-records/connections",
    ));

    expect(mocks.connectionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId: "member_clinical_1", status: { not: "disconnected" } },
    }));
    expect(connections).toEqual([expect.objectContaining({
      connectionId: "crc_1",
      lastErrorCode: null,
      latestRun: expect.objectContaining({ runId: "crr_1", status: "complete" }),
      status: "active",
    })]);
    expect(JSON.stringify(connections)).not.toContain("sealed-");
    expect(JSON.stringify(connections)).not.toContain("patient context");
  });

  it("rejects a disconnect for a connection outside the active member without mutation", async () => {
    mocks.connectionFindFirst.mockResolvedValue(null);

    await expect(disconnectClinicalRecordConnection({
      connectionId: "crc_other",
      now: new Date("2026-07-10T18:00:00.000Z"),
      request: new Request(
        "https://join.example.test/api/clinical-records/connections/crc_other/disconnect",
        { method: "POST" },
      ),
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_CONNECTION_NOT_FOUND" });

    expect(mocks.connectionFindFirst).toHaveBeenCalledWith({
      select: { providerDirectoryEntryId: true },
      where: { id: "crc_other", memberId: "member_clinical_1" },
    });
    expect(mocks.connectionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.oauthUpdateMany).not.toHaveBeenCalled();
    expect(mocks.runUpdateMany).not.toHaveBeenCalled();
  });
});
