import { beforeEach, describe, expect, it, vi } from "vitest";

import { HostedBillingStatus } from "@prisma/client";
import type { SharePack } from "@healthybob/contracts";

const mocks = vi.hoisted(() => ({
  dispatchHostedExecutionStatus: vi.fn(),
  issueHostedInviteForPhone: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecutionStatus: mocks.dispatchHostedExecutionStatus,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingSecretCodec: () => ({
    keyVersion: "v1",
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace(/^enc:/u, ""),
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/hosted-onboarding/service", () => ({
  issueHostedInviteForPhone: mocks.issueHostedInviteForPhone,
}));

import { acceptHostedShareLink, buildHostedSharePageData, createHostedShareLink } from "@/src/lib/hosted-share/service";

function buildPack(): SharePack {
  return {
    schemaVersion: "hb.share-pack.v1",
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
    mocks.dispatchHostedExecutionStatus.mockResolvedValue({
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: "vault.share.accepted:seed",
      lastRunAt: "2026-03-26T12:00:00.000Z",
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    });
  });

  it("creates a hosted share link and threads a recipient invite into the final url", async () => {
    const prisma = createHostedSharePrisma();
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
  });

  it("imports a hosted share link for an active hosted member", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    mocks.dispatchHostedExecutionStatus.mockImplementation(async ({ eventId }) => ({
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: eventId,
      lastRunAt: "2026-03-26T12:00:00.000Z",
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    }));

    const result = await acceptHostedShareLink({
      prisma: prisma as never,
      shareCode: created.shareCode,
      sessionRecord: {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
        },
        session: {
          expiresAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      } as never,
    });
    const pageData = await buildHostedSharePageData({
      prisma: prisma as never,
      shareCode: created.shareCode,
      sessionRecord: {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
        },
        session: {
          expiresAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      } as never,
    });

    expect(result.imported).toBe(true);
    expect(result.alreadyImported).toBe(false);
    expect(pageData.stage).toBe("consumed");
    expect(pageData.share?.acceptedByCurrentMember).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");
  });

  it("keeps the hosted share claim and reuses the same event id after a transport failure", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });
    const dispatchEventIds: string[] = [];

    mocks.dispatchHostedExecutionStatus
      .mockImplementationOnce(async ({ eventId }) => {
        dispatchEventIds.push(eventId);
        throw new Error("socket hang up");
      })
      .mockImplementationOnce(async ({ eventId }) => {
        dispatchEventIds.push(eventId);
        return {
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          inFlight: false,
          lastError: null,
          lastEventId: eventId,
          lastRunAt: "2026-03-26T12:00:00.000Z",
          nextWakeAt: null,
          pendingEventCount: 0,
          poisonedEventIds: [],
          retryingEventId: null,
          userId: "member_123",
        };
      });

    await expect(() =>
      acceptHostedShareLink({
        prisma: prisma as never,
        shareCode: created.shareCode,
        sessionRecord: {
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_123",
          },
          session: {
            expiresAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        } as never,
      })
    ).rejects.toMatchObject({
      code: "HOSTED_SHARE_IMPORT_PENDING",
    });
    expect(prisma.rows[0]?.acceptedByMemberId).toBe("member_123");
    expect(prisma.rows[0]?.consumedAt).toBeNull();

    const retried = await acceptHostedShareLink({
      prisma: prisma as never,
      shareCode: created.shareCode,
      sessionRecord: {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
        },
        session: {
          expiresAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      } as never,
    });

    expect(retried.imported).toBe(true);
    expect(dispatchEventIds).toHaveLength(2);
    expect(dispatchEventIds[0]).toBe(dispatchEventIds[1]);
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
  encryptedPayload: string;
  encryptionKeyVersion: string;
  expiresAt: Date;
  id: string;
  lastEventId: string | null;
  previewJson: Record<string, unknown> | null;
  previewTitle: string;
  senderMemberId: string | null;
  updatedAt: Date;
};

function createHostedSharePrisma() {
  const rows: HostedShareRow[] = [];

  return {
    rows,
    hostedShareLink: {
      create: async ({ data }: { data: Omit<HostedShareRow, "acceptedAt" | "acceptedByMemberId" | "consumedAt" | "consumedByMemberId" | "lastEventId" | "updatedAt"> }) => {
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
      findUnique: async ({ where }: { where: { codeHash: string } }) => rows.find((row) => row.codeHash === where.codeHash) ?? null,
      updateMany: async ({ data, where }: { data: Partial<HostedShareRow>; where: { codeHash: string; consumedAt?: null; acceptedByMemberId?: string; OR?: Array<{ acceptedAt?: null; acceptedByMemberId?: string }> } }) => {
        const row = rows.find((entry) => entry.codeHash === where.codeHash);

        if (!row) {
          return { count: 0 };
        }

        if (where.consumedAt === null && row.consumedAt !== null) {
          return { count: 0 };
        }

        if (where.acceptedByMemberId && row.acceptedByMemberId !== where.acceptedByMemberId) {
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
      update: async ({ data, where }: { data: Partial<HostedShareRow>; where: { codeHash: string } }) => {
        const row = rows.find((entry) => entry.codeHash === where.codeHash);
        if (!row) {
          throw new Error("row missing");
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
  };
}
