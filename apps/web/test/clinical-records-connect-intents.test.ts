import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  deleteMany: vi.fn(),
  executeRaw: vi.fn(),
  findUnique: vi.fn(),
  oauthUpdateMany: vi.fn(),
  resolveClinicalProviderDirectoryEntry: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => {
    const clinicalRecordConnectIntent = {
      create: mocks.create,
      deleteMany: mocks.deleteMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    };
    return {
      clinicalRecordConnectIntent,
      $executeRaw: mocks.executeRaw,
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        $executeRaw: mocks.executeRaw,
        clinicalRecordConnectIntent,
        clinicalRecordOauthSession: { updateMany: mocks.oauthUpdateMany },
      }),
    };
  },
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

vi.mock("@/src/lib/clinical-records/provider-directory-store", () => ({
  resolveClinicalProviderDirectoryEntry: mocks.resolveClinicalProviderDirectoryEntry,
}));

describe("Clinical Records connect intents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.oauthUpdateMany.mockResolvedValue({ count: 0 });
    mocks.executeRaw.mockResolvedValue(0);
    mocks.findUnique.mockResolvedValue(null);
    mocks.resolveClinicalProviderDirectoryEntry.mockImplementation((id: string) => ({ id }));
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("replaces every prior incomplete intent for the same member inside the create transaction", async () => {
    const { createClinicalRecordConnectIntent } = await import(
      "@/src/lib/clinical-records/connect-intents"
    );
    const now = new Date("2026-07-10T12:00:00.000Z");
    const result = await createClinicalRecordConnectIntent({
      memberId: "member_clinical_1",
      now,
      request: new Request("https://join.example.test/api/clinical-records/connect-intents"),
    });

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          {
            completedAt: null,
            memberId: "member_clinical_1",
          },
        ],
      },
    });
    expect(mocks.oauthUpdateMany).toHaveBeenCalledWith({
      data: { consumedAt: now },
      where: { consumedAt: null, memberId: "member_clinical_1" },
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(new URL(result.connectUrl).pathname).toBe("/records/connect");
    expect(new URL(result.connectUrl).hash).toContain("clinicalRecordsIntent=cr_");
  });

  it("lets a started intent complete during its still-valid OAuth continuation", async () => {
    const { completeClinicalRecordConnectIntent } = await import(
      "@/src/lib/clinical-records/connect-intents"
    );
    const now = new Date("2026-07-10T12:05:00.000Z");
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(completeClinicalRecordConnectIntent({
      claimHash: "claim-hash",
      memberId: "member_clinical_1",
      now,
    })).rejects.toMatchObject({
      code: "CLINICAL_RECORD_CONNECT_INTENT_SUPERSEDED",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      data: { completedAt: now },
      where: {
        claimHash: "claim-hash",
        completedAt: null,
        memberId: "member_clinical_1",
        startedAt: { not: null },
      },
    });
  });

  it("claims the member-bound browser handoff once without persisting its bearer", async () => {
    const { claimClinicalRecordConnectIntentForStart } = await import(
      "@/src/lib/clinical-records/connect-intents"
    );
    const claim = `cr_${"A".repeat(32)}`;
    const claimHash = createHash("sha256").update(claim).digest("hex");
    const now = new Date("2026-07-10T12:02:00.000Z");
    mocks.findUnique.mockResolvedValue({
      claimHash,
      completedAt: null,
      createdAt: new Date("2026-07-10T12:00:00.000Z"),
      expiresAt: new Date("2026-07-10T12:15:00.000Z"),
      memberId: "member_clinical_1",
      providerDirectoryEntryId: null,
      startedAt: null,
    });

    await expect(claimClinicalRecordConnectIntentForStart({
      claim,
      memberId: "member_clinical_1",
      now,
      providerDirectoryEntryId: "epic-test",
    })).resolves.toMatchObject({
      claimHash,
      providerDirectoryEntryId: "epic-test",
      startedAt: now,
    });

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { claimHash } });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      data: { providerDirectoryEntryId: "epic-test", startedAt: now },
      where: {
        claimHash,
        completedAt: null,
        expiresAt: { gt: now },
        memberId: "member_clinical_1",
        startedAt: null,
      },
    });
    expect(JSON.stringify([mocks.findUnique.mock.calls, mocks.updateMany.mock.calls])).not.toContain(claim);

    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(claimClinicalRecordConnectIntentForStart({
      claim,
      memberId: "member_clinical_1",
      now,
      providerDirectoryEntryId: "epic-test",
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_CONNECT_INTENT_USED" });
  });

  it("rejects a claim bound to another member or provider before mutating it", async () => {
    const { claimClinicalRecordConnectIntentForStart } = await import(
      "@/src/lib/clinical-records/connect-intents"
    );
    const claim = `cr_${"B".repeat(32)}`;
    const claimHash = createHash("sha256").update(claim).digest("hex");
    const record = {
      claimHash,
      completedAt: null,
      createdAt: new Date("2026-07-10T12:00:00.000Z"),
      expiresAt: new Date("2026-07-10T12:15:00.000Z"),
      memberId: "member_clinical_other",
      providerDirectoryEntryId: "epic-bound-provider",
      startedAt: null,
    };
    mocks.findUnique.mockResolvedValue(record);

    await expect(claimClinicalRecordConnectIntentForStart({
      claim,
      memberId: "member_clinical_1",
      now: new Date("2026-07-10T12:02:00.000Z"),
      providerDirectoryEntryId: "epic-bound-provider",
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_CONNECT_INTENT_INVALID" });

    mocks.findUnique.mockResolvedValue({ ...record, memberId: "member_clinical_1" });
    await expect(claimClinicalRecordConnectIntentForStart({
      claim,
      memberId: "member_clinical_1",
      now: new Date("2026-07-10T12:02:00.000Z"),
      providerDirectoryEntryId: "epic-other-provider",
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_CONNECT_INTENT_INVALID" });

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("maps a concurrent live-intent uniqueness race to a stable retryable conflict", async () => {
    const { createClinicalRecordConnectIntent } = await import(
      "@/src/lib/clinical-records/connect-intents"
    );
    mocks.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(createClinicalRecordConnectIntent({
      memberId: "member_clinical_1",
      now: new Date("2026-07-10T12:00:00.000Z"),
      request: new Request("https://join.example.test/api/clinical-records/connect-intents"),
    })).rejects.toMatchObject({
      code: "CLINICAL_RECORD_CONNECT_INTENT_CONFLICT",
      httpStatus: 409,
      retryable: true,
    });
  });

  it("enforces the one-live-intent bound in the additive migration", () => {
    const migration = readFileSync(new URL(
      "../prisma/migrations/20260710160000_clinical_records_control_plane/migration.sql",
      import.meta.url,
    ), "utf8");

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "clinical_record_connect_intent_member_id_live_key"',
    );
    expect(migration).toContain(
      'ON "clinical_record_connect_intent"("member_id") WHERE "completed_at" IS NULL',
    );
  });
});
