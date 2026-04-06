import { beforeEach, describe, expect, it, vi } from "vitest";

import { HostedBillingStatus } from "@prisma/client";
import type { SharePack } from "@murphai/contracts";

const mocks = vi.hoisted(() => ({
  deleteHostedSharePackFromHostedExecution: vi.fn(),
  drainHostedExecutionOutbox: vi.fn(),
  drainHostedExecutionOutboxBestEffort: vi.fn(),
  enqueueHostedExecutionOutbox: vi.fn(),
  findHostedExecutionOutboxByEventId: vi.fn(),
  issueHostedInviteForPhone: vi.fn(),
  readHostedSharePackFromHostedExecution: vi.fn(),
  readHostedExecutionOutboxOutcome: vi.fn(),
  sharePacks: new Map<string, unknown>(),
  writeHostedSharePackToHostedExecution: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutbox: mocks.drainHostedExecutionOutbox,
  drainHostedExecutionOutboxBestEffort: mocks.drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
  findHostedExecutionOutboxByEventId: mocks.findHostedExecutionOutboxByEventId,
  readHostedExecutionOutboxOutcome: mocks.readHostedExecutionOutboxOutcome,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  deleteHostedSharePackFromHostedExecution: mocks.deleteHostedSharePackFromHostedExecution,
  readHostedSharePackFromHostedExecution: mocks.readHostedSharePackFromHostedExecution,
  writeHostedSharePackToHostedExecution: mocks.writeHostedSharePackToHostedExecution,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInviteForPhone: mocks.issueHostedInviteForPhone,
}));

import {
  acceptHostedShareLink,
  buildHostedSharePageData,
  createHostedShareLink,
} from "@/src/lib/hosted-share/service";
import { finalizeHostedShareAcceptance } from "@/src/lib/hosted-share/shared";

function buildPack(): SharePack {
  return {
    schemaVersion: "murph.share-pack.v1",
    title: "Morning Smoothie",
    createdAt: "2026-03-26T12:00:00.000Z",
    entities: [
      {
        kind: "protocol",
        ref: "protocol:creatine",
        payload: {
          title: "Creatine monohydrate",
          kind: "supplement",
          status: "active",
          startedOn: "2026-03-01",
          group: "supplement",
        },
      },
      {
        kind: "food",
        ref: "food:morning-smoothie",
        payload: {
          title: "Morning Smoothie",
          status: "active",
          kind: "smoothie",
          attachedProtocolRefs: ["protocol:creatine"],
        },
      },
    ],
    afterImport: {
      logMeal: {
        foodRef: "food:morning-smoothie",
      },
    },
  };
}

describe("hosted share service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.issueHostedInviteForPhone.mockResolvedValue({
      invite: {
        inviteCode: "invite_123",
      },
    });
    mocks.drainHostedExecutionOutbox.mockResolvedValue([]);
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.findHostedExecutionOutboxByEventId.mockResolvedValue({
      lastError: null,
      status: "completed",
    });
    mocks.readHostedExecutionOutboxOutcome.mockReturnValue("completed");
    mocks.sharePacks.clear();
    mocks.writeHostedSharePackToHostedExecution.mockImplementation(async ({ pack, shareId }) => {
      mocks.sharePacks.set(shareId, pack);
      return pack;
    });
    mocks.readHostedSharePackFromHostedExecution.mockImplementation(async ({ shareId }: { shareId: string }) =>
      (mocks.sharePacks.get(shareId) as SharePack | undefined) ?? null
    );
    mocks.deleteHostedSharePackFromHostedExecution.mockImplementation(async ({ shareId }: { shareId: string }) => {
      mocks.sharePacks.delete(shareId);
    });
  });

  it("creates a hosted share link and threads a recipient invite into the final url", async () => {
    const prisma = createHostedSharePrisma();
    const startedAt = Date.now();
    const result = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      recipientPhoneNumber: "+15551234567",
      senderMemberId: "member_sender",
    });

    expect(result.joinUrl).toContain("/join/invite_123?share=");
    expect(result.shareUrl).toContain(`/share/${encodeURIComponent(result.shareCode)}?invite=invite_123`);
    expect(result.url).toBe(result.joinUrl);
    expect(result.preview.counts.foods).toBe(1);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]?.previewTitle).toBe("Shared Murph pack");
    expect((prisma.rows[0]?.expiresAt?.getTime() ?? 0) - startedAt).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect((prisma.rows[0]?.expiresAt?.getTime() ?? 0) - startedAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000);
    expect(mocks.writeHostedSharePackToHostedExecution).toHaveBeenCalledWith({
      ownerUserId: "member_sender",
      pack: buildPack(),
      shareId: prisma.rows[0]?.id,
    });
  });

  it("caps explicitly extended hosted share links to the privacy-first 24 hour window", async () => {
    const prisma = createHostedSharePrisma();
    const startedAt = Date.now();

    await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      expiresInHours: 24 * 30,
      senderMemberId: "member_sender",
    });

    const expiresAt = prisma.rows[0]?.expiresAt?.getTime();
    expect(expiresAt).toBeTypeOf("number");
    expect((expiresAt ?? 0) - startedAt).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect((expiresAt ?? 0) - startedAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000);
  });

  it("imports a hosted share link for an active hosted member", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    const result = await acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });
    const pageData = await buildHostedSharePageData({
      authenticatedMember: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(result.imported).toBe(false);
    expect(result.alreadyImported).toBe(false);
    expect(result.pending).toBe(true);
    expect(pageData.stage).toBe("processing");
    expect(pageData.share?.acceptedByCurrentMember).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBeNull();

    await finalizeHostedShareAcceptance({
      eventId: prisma.rows[0]?.lastEventId ?? "",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: prisma.rows[0]?.id ?? "",
    });
    const finalizedPageData = await buildHostedSharePageData({
      authenticatedMember: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(finalizedPageData.stage).toBe("consumed");
    expect(finalizedPageData.share?.acceptedByCurrentMember).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");

    mocks.sharePacks.delete(prisma.rows[0]?.id ?? "");

    const consumedWithoutPackPageData = await buildHostedSharePageData({
      authenticatedMember: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(consumedWithoutPackPageData.stage).toBe("consumed");
    expect(consumedWithoutPackPageData.share?.preview).toEqual({
      counts: {
        foods: 0,
        protocols: 0,
        recipes: 0,
      },
      foodTitles: [],
      protocolTitles: [],
      recipeTitles: [],
      logMealAfterImport: false,
      title: "Shared Murph pack",
    });
  });

  it("keeps share acceptance sparse even when the Cloudflare-backed pack is missing at claim time", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    mocks.sharePacks.delete(prisma.rows[0]?.id ?? "");

    await expect(acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      alreadyImported: false,
      imported: false,
      pending: true,
    });

    expect(prisma.rows[0]?.acceptedAt).toEqual(expect.any(Date));
    expect(prisma.rows[0]?.acceptedByMemberId).toBe("member_123");
    expect(prisma.rows[0]?.lastEventId).toMatch(/^vault\.share\.accepted:/u);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("keeps the hosted share claim and reuses the same event id after a transport failure", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });
    const dispatchEventIds: string[] = [];

    mocks.enqueueHostedExecutionOutbox.mockImplementation(async ({ dispatch }: { dispatch: { eventId: string } }) => {
      dispatchEventIds.push(dispatch.eventId);
      return undefined;
    });

    await expect(acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      imported: false,
      pending: true,
    });
    expect(prisma.rows[0]?.acceptedByMemberId).toBe("member_123");
    expect(prisma.rows[0]?.consumedAt).toBeNull();

    const retried = await acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(retried.imported).toBe(false);
    expect(retried.pending).toBe(true);
    expect(dispatchEventIds).toHaveLength(2);
    expect(dispatchEventIds[0]).toBe(dispatchEventIds[1]);

    await finalizeHostedShareAcceptance({
      eventId: dispatchEventIds[1] ?? "",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: prisma.rows[0]?.id ?? "",
    });

    const finalized = await acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(finalized.alreadyImported).toBe(true);
    expect(finalized.imported).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");
  });

});

type HostedShareRow = {
  acceptedAt: Date | null;
  acceptedByMemberId: string | null;
  codeHash: string;
  consumedAt: Date | null;
  consumedByMemberId: string | null;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  lastEventId: string | null;
  previewTitle: string;
  senderMemberId: string | null;
  updatedAt: Date;
};

function createHostedSharePrisma() {
  const rows: HostedShareRow[] = [];
  const prismaLike = {
    rows,
    hostedShareLink: {
      create: async ({
        data,
      }: {
        data: Omit<HostedShareRow, "acceptedAt" | "acceptedByMemberId" | "consumedAt" | "consumedByMemberId" | "lastEventId" | "updatedAt">;
      }) => {
        const row: HostedShareRow = {
          ...data,
          acceptedAt: null,
          acceptedByMemberId: null,
          consumedAt: null,
          consumedByMemberId: null,
          lastEventId: null,
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { codeHash?: string; id?: string } }) =>
        rows.find((row) =>
          (where.codeHash !== undefined && row.codeHash === where.codeHash)
          || (where.id !== undefined && row.id === where.id)
        ) ?? null,
      updateMany: async ({
        data,
        where,
      }: {
        data: Partial<HostedShareRow>;
        where: {
          acceptedByMemberId?: string;
          codeHash?: string;
          consumedAt?: null;
          id?: string;
          lastEventId?: string;
          OR?: Array<{ acceptedAt?: null; acceptedByMemberId?: string }>;
        };
      }) => {
        const row = rows.find((entry) =>
          (where.codeHash !== undefined && entry.codeHash === where.codeHash)
          || (where.id !== undefined && entry.id === where.id)
        );

        if (!row) {
          return { count: 0 };
        }

        if (where.consumedAt === null && row.consumedAt !== null) {
          return { count: 0 };
        }

        if (where.acceptedByMemberId && row.acceptedByMemberId !== where.acceptedByMemberId) {
          return { count: 0 };
        }

        if (where.lastEventId !== undefined && row.lastEventId !== where.lastEventId) {
          return { count: 0 };
        }

        if (where.OR?.length) {
          const matches = where.OR.some((entry) => {
            const acceptedAtMatch = entry.acceptedAt === undefined ? true : row.acceptedAt === entry.acceptedAt;
            const acceptedByMatch = entry.acceptedByMemberId === undefined ? true : row.acceptedByMemberId === entry.acceptedByMemberId;
            return acceptedAtMatch && acceptedByMatch;
          });

          if (!matches) {
            return { count: 0 };
          }
        }

        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
      },
      update: async ({ data, where }: { data: Partial<HostedShareRow>; where: { codeHash?: string; id?: string } }) => {
        const row = rows.find((entry) =>
          (where.codeHash !== undefined && entry.codeHash === where.codeHash)
          || (where.id !== undefined && entry.id === where.id)
        );
        if (!row) {
          throw new Error("row missing");
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
  };

  const transactionalPrisma = {
    ...prismaLike,
    $queryRaw: async () => [],
  };

  return {
    ...transactionalPrisma,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(transactionalPrisma as unknown),
  };
}
