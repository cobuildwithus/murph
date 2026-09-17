import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEpicBetaRetrievalPlan } from "@/src/lib/clinical-records/epic-policy";

const mocks = vi.hoisted(() => ({
  prisma: vi.fn(), access: vi.fn(), consent: vi.fn(), suspension: vi.fn(),
  append: vi.fn(), signal: vi.fn(), open: vi.fn(), seal: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.prisma }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ readHostedRuntimeAiAccessDecision: mocks.access }));
vi.mock("@/src/lib/legal/consent", () => ({ assertHostedLaunchRequiredConsentGranted: mocks.consent }));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({ lockHostedMemberRow: vi.fn(), readHostedMemberSuspensionAfterLockTx: mocks.suspension }));
vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({ runWithHostedDomainRootUnwrapCache: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({ unwrapHostedDomainRootForWeb: async () => ({ rootKey: Buffer.alloc(32) }) }));
vi.mock("@/src/lib/clinical-records/retrieval", () => ({ appendClinicalRetrievalWakeTx: mocks.append, signalClinicalRetrievalWake: mocks.signal }));
vi.mock("@/src/lib/clinical-records/secrets", () => ({ openClinicalConnectionSecret: mocks.open, sealClinicalConnectionSecret: mocks.seal }));

import { admitClinicalDailySync, runClinicalDailySyncSweep } from "@/src/lib/clinical-records/daily-sync";
import { renewClinicalAccess } from "@/src/lib/clinical-records/persistent-access";

const now = new Date("2026-09-17T12:00:00Z");
function fixture() {
  const row = {
    id: "crc_synthetic", memberId: "member_synthetic", providerDirectoryEntryId: "epic-synthetic",
    status: "active", tokenVersion: 1, retrievalGeneration: 1, nextSyncAt: now,
    refreshTokenEncrypted: "refresh-sealed", patientIdEncrypted: "patient-sealed", patientBindingEncrypted: "binding-sealed",
    accessTokenEncrypted: "access-sealed", accessTokenExpiresAt: new Date(0),
    refreshLeaseId: null as string | null, refreshLeaseExpiresAt: null as Date | null,
    retrievalRuns: [{ completedAt: new Date(now.getTime() - 86_400_000), status: "complete",
      retrievalPlanJson: buildEpicBetaRetrievalPlan({ frozenAt: now, pageCount: "100", resourceTypes: ["Patient", "DocumentReference"] }),
      grantedScopesJson: ["patient/Patient.r", "patient/DocumentReference.s", "offline_access"] }],
  };
  const connection = {
    findFirst: vi.fn(async () => ({ ...row })),
    findMany: vi.fn(async () => [{ id: row.id, memberId: row.memberId }]),
    update: vi.fn(async ({ data }: { data: object }) => Object.assign(row, data)),
    updateMany: vi.fn(async ({ where, data }: { where: { refreshLeaseId?: string }; data: object }) => {
      if (where.refreshLeaseId && where.refreshLeaseId !== row.refreshLeaseId) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    }),
  };
  const create = vi.fn();
  const tx = { clinicalRecordConnection: connection, clinicalRecordRetrievalRun: { create } };
  const prisma = { ...tx, $transaction: async <T>(fn: (value: typeof tx) => Promise<T>) => fn(tx) };
  mocks.prisma.mockReturnValue(prisma);
  return { row, connection, create };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ allowed: true });
  mocks.consent.mockResolvedValue(undefined);
  mocks.suspension.mockResolvedValue("active");
  mocks.append.mockResolvedValue({ wake: "synthetic" });
  mocks.signal.mockResolvedValue(undefined);
  mocks.seal.mockImplementation(async ({ value }: { value: string }) => `sealed:${value}`);
  mocks.open.mockImplementation(async ({ field }: { field: string }) => field === "refreshToken" ? JSON.stringify({ schemaVersion: 1,
    clientId: "client", tokenEndpoint: "https://portal.example.test/token", refreshToken: "old-refresh", grantedScopes: ["patient/Patient.r", "patient/Observation.s"] }) : "existing-access");
  vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", JSON.stringify({ "epic-synthetic": { clientId: "client", clientSecret: "secret" } }));
});

describe("daily clinical admission", () => {
  it("publishes one new generation and makes replay ineligible", async () => {
    const f = fixture();
    const input = { connectionId: f.row.id, memberId: f.row.memberId, now };
    expect(await admitClinicalDailySync(input)).toBe(true);
    expect(await admitClinicalDailySync(input)).toBe(false);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.create.mock.calls[0]![0].data).toMatchObject({ generation: 2, status: "queued" });
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.signal).toHaveBeenCalledTimes(1);
  });

  it.each(["disconnected", "needs_reauth"])("does not admit a %s connection", async (status) => {
    const f = fixture(); f.row.status = status;
    expect(await admitClinicalDailySync({ connectionId: f.row.id, memberId: f.row.memberId, now })).toBe(false);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("backs off an ineligible row so it cannot starve the bounded sweep", async () => {
    const f = fixture(); mocks.access.mockResolvedValue({ allowed: false });
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 0, failed: 0 });
    expect(f.connection.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    expect(f.row.nextSyncAt.getTime()).toBe(now.getTime() + 86_400_000);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("fails closed when consent is withdrawn", async () => {
    const f = fixture(); mocks.consent.mockRejectedValue(new Error("consent required"));
    await expect(admitClinicalDailySync({ connectionId: f.row.id, memberId: f.row.memberId, now })).rejects.toThrow("consent required");
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe("rotating clinical refresh lease", () => {
  it("renews expired access once and seals the rotated grant", async () => {
    const f = fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" }));
    expect(await renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl })).toBe("new-access");
    expect(f.row.refreshTokenEncrypted).toContain("new-refresh");
    expect(f.row.accessTokenEncrypted).toBe("sealed:new-access");
    expect(f.row.refreshLeaseId).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not replay a token while another refresh owns the lease", async () => {
    const f = fixture(); f.row.refreshLeaseId = "other"; f.row.refreshLeaseExpiresAt = new Date(now.getTime() + 60_000);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl })).rejects.toMatchObject({ retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cannot restore access after disconnect wins during the network exchange", async () => {
    const f = fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      f.row.status = "disconnected"; f.row.refreshLeaseId = null; f.row.refreshTokenEncrypted = ""; f.row.accessTokenEncrypted = "";
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" });
    });
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl })).rejects.toBeDefined();
    expect(f.row.status).toBe("disconnected"); expect(f.row.accessTokenEncrypted).toBe("");
  });

  it("clears persistent access after an ambiguous transport failure instead of replaying a rotating token", async () => {
    const f = fixture();
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("connection reset")) })).rejects.toBeDefined();
    expect(f.row.status).toBe("needs_reauth"); expect(f.row.refreshTokenEncrypted).toBeNull(); expect(f.row.nextSyncAt).toBeNull();
  });
});
