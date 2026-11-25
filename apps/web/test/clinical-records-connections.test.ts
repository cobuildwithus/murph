import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  connectionFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  connectionUpdateMany: vi.fn(),
  oauthUpdateMany: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  runUpdateMany: vi.fn(),
  activeBearer: vi.fn(), bearer: vi.fn(), verifyNative: vi.fn(),
}));

vi.mock("@/src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: mocks.verifyNative }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActiveHostedMemberAuthFromBearerToken: mocks.activeBearer, requireHostedMemberAuthFromBearerToken: mocks.bearer,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
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
      hostedMember: { findUniqueOrThrow: vi.fn().mockResolvedValue({ clinicalRecordMessageMode: "detail" }) },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        $queryRaw: vi.fn().mockResolvedValue([]),
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
  listClinicalRecordConnectionsForMember,
} from "@/src/lib/clinical-records/connections";

describe("Clinical Records connection lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
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

  it("projects grant, activity, capacity and actions without exposing credential material", async () => {
    const { GET } = await import("../app/api/clinical-records/companion/sources/route");
    const createdAt = new Date("2030-03-10T00:00:00Z");
    const updatedAt = new Date("2030-03-10T01:00:00Z");
    mocks.activeBearer.mockResolvedValue({ member: { id: "member-a" } });
    const row = { id: "source-a", providerDirectoryEntryId: "epic-example", displayName: "Sample Portal",
      connectedAt: createdAt, lastCheckedAt: null, lastErrorCode: null, status: "active", refreshTokenEncrypted: "sealed",
      retrievalRuns: [{ status: "retrieving", createdAt, completedAt: null, outcomeCountsJson: null, requests: [{ updatedAt }] }],
    };
    mocks.connectionFindMany.mockResolvedValue([row, { ...row, retrievalRuns: [{ ...row.retrievalRuns[0], requests: [] }] }, ...Array(18).fill(row), { ...row, status: "disconnected", refreshTokenEncrypted: null }]);
    const response = await GET(new Request("https://app.example.test/api/clinical-records/companion/sources"));
    const body = await response.json();
    expect(body.messageMode).toBe("detail");
    expect(body.canAdd).toBe(false);
    expect(body.sources[0]).toEqual({ id: "source-a", providerId: "epic-example", name: "Sample Portal",
      state: "getting_records", reason: null, lastImport: null, connectedAt: createdAt.toISOString(), lastCheckedAt: null,
      lastActivityAt: updatedAt.toISOString(), updates: "daily", actions: ["start_over", "remove"] });
    expect(body.sources[1].lastActivityAt).toBe(createdAt.toISOString());
    expect(body.sources.at(-1)).toMatchObject({ state: "disconnected", updates: "one_time", lastActivityAt: null });
    expect(mocks.connectionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId: "member-a" }, orderBy: expect.arrayContaining([{ disconnectedAt: { sort: "desc", nulls: "first" } }]),
    }));
  });

  it("removes using the authority-reducing bearer route and returns the refreshed list", async () => {
    const { POST } = await import("../app/api/clinical-records/companion/sources/[id]/remove/route");
    const auth = { member: { id: "member-a" }, credential: "synthetic", sessionId: "session-a" };
    mocks.bearer.mockResolvedValue(auth);
    const response = await POST(new Request("https://app.example.test/"), { params: Promise.resolve({ id: "source-a" }) });
    expect(await response.json()).toEqual({ sources: [], canAdd: true });
    expect(mocks.activeBearer).not.toHaveBeenCalled();
    expect(mocks.verifyNative).toHaveBeenCalledWith(auth, expect.anything());
    expect(mocks.connectionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "source-a", memberId: "member-a" } }));
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
      patientBindingEncrypted: "sealed-patient-binding",
      retrievalRuns: [{
        completedAt: new Date("2026-07-10T18:05:00.000Z"),
        id: "crr_1",
        outcomeCountsJson: { createdCount: 4, reviewDecisionCount: 1 },
        status: "complete",
      }],
      sourceSystem: "epic-fhir",
      status: "active",
    }]);

    const connections = await listClinicalRecordConnections(new Request(
      "https://join.example.test/api/clinical-records/connections",
    ));

    expect(mocks.connectionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        connectedAt: true,
        displayName: true,
        retrievalRuns: expect.objectContaining({
          select: {
            completedAt: true,
            createdAt: true, generation: true,
            requests: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
            id: true,
            outcomeCountsJson: true,
            status: true,
          },
          take: 1,
        }),
      }),
      take: 100,
      where: { memberId: "member_clinical_1" },
    }));
    expect(mocks.connectionFindMany.mock.calls[0]?.[0]).not.toHaveProperty("include");
    expect(connections).toEqual([expect.objectContaining({
      connectionId: "crc_1",
      lastErrorCode: null,
      latestRun: expect.objectContaining({
        importedCount: 4, reviewCount: 1, runId: "crr_1", status: "complete",
      }),
      status: "active",
    })]);
    expect(JSON.stringify(connections)).not.toContain("sealed-");
    expect(JSON.stringify(connections)).not.toContain("patient context");
  });

  it("lets an authenticated server page reuse the member-bound safe projection", async () => {
    await expect(
      listClinicalRecordConnectionsForMember("member_server_page"),
    ).resolves.toEqual([]);

    expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.connectionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId: "member_server_page" },
    }));
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
