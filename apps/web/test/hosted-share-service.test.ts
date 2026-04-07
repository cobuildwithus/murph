import { HostedBillingStatus, type ExecutionOutbox } from "@prisma/client";
import type { SharePack } from "@murphai/contracts";
import {
  HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  type HostedExecutionDispatchRequest,
  type HostedExecutionOutboxPayload,
} from "@murphai/hosted-execution";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shareHarness = vi.hoisted(() => ({
  issueHostedInviteForPhone: vi.fn(),
  sharePacks: new Map<string, SharePack>(),
  stagedPayloads: [] as HostedExecutionDispatchRequest[],
}));

vi.mock("@/src/lib/hosted-share/pack-store", () => ({
  deleteHostedSharePackObject: async ({ ownerUserId, shareId }: { ownerUserId: string; shareId: string }) => {
    shareHarness.sharePacks.delete(`${ownerUserId}:${shareId}`);
  },
  writeHostedSharePackObject: async ({
    ownerUserId,
    pack,
    shareId,
  }: {
    ownerUserId: string;
    pack: SharePack;
    shareId: string;
  }) => {
    shareHarness.sharePacks.set(`${ownerUserId}:${shareId}`, pack);
    return pack;
  },
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  deleteHostedStoredDispatchPayloadBestEffort: async () => {},
  maybeStageHostedExecutionDispatchPayload: async (dispatch: HostedExecutionDispatchRequest) => {
    shareHarness.stagedPayloads.push(dispatch);
    return createStagedPayload(dispatch);
  },
}));
vi.mock("@/src/lib/hosted-onboarding/invite-service", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/invite-service")>(
    "@/src/lib/hosted-onboarding/invite-service",
  );

  return {
    ...actual,
    issueHostedInviteForPhone: shareHarness.issueHostedInviteForPhone,
  };
});

import {
  acceptHostedShareLink,
  buildHostedSharePageData,
  createHostedShareLink,
} from "@/src/lib/hosted-share/service";
import {
  finalizeHostedShareAcceptance,
  readHostedSharePreview,
  releaseHostedShareAcceptance,
} from "@/src/lib/hosted-share/shared";

let originalHostedOnboardingPublicBaseUrl: string | undefined;
let originalHostedContactPrivacyKey: string | undefined;
const TEST_CONTACT_PRIVACY_KEY = Buffer.alloc(32, 7).toString("base64url");

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

function createStagedPayload(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionOutboxPayload {
  return {
    dispatchRef: {
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      occurredAt: dispatch.occurredAt,
      userId: dispatch.event.userId,
    },
    payloadRef: {
      key: `transient/dispatch-payloads/${dispatch.event.userId}/${dispatch.eventId}.json`,
    },
    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
    storage: "reference",
  };
}

describe("hosted share service", () => {
  beforeEach(() => {
    shareHarness.issueHostedInviteForPhone.mockReset();
    shareHarness.issueHostedInviteForPhone.mockRejectedValue(
      new Error("Unexpected invite issuance in hosted share service test."),
    );
    shareHarness.sharePacks.clear();
    shareHarness.stagedPayloads = [];
    originalHostedOnboardingPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    originalHostedContactPrivacyKey = process.env.HOSTED_CONTACT_PRIVACY_KEY;
    process.env.HOSTED_CONTACT_PRIVACY_KEY = TEST_CONTACT_PRIVACY_KEY;
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://join.example.test";
  });

  afterEach(() => {
    if (originalHostedOnboardingPublicBaseUrl === undefined) {
      delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    } else {
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = originalHostedOnboardingPublicBaseUrl;
    }

    if (originalHostedContactPrivacyKey === undefined) {
      delete process.env.HOSTED_CONTACT_PRIVACY_KEY;
    } else {
      process.env.HOSTED_CONTACT_PRIVACY_KEY = originalHostedContactPrivacyKey;
    }
  });

  it("accepts the tiny hosted-share preview JSON shape", () => {
    expect(readHostedSharePreview({
      kinds: [],
      counts: {
        foods: 0,
        protocols: 0,
        recipes: 0,
        total: 0,
      },
      logMealAfterImport: false,
    })).toEqual({
      kinds: [],
      counts: {
        foods: 0,
        protocols: 0,
        recipes: 0,
        total: 0,
      },
      logMealAfterImport: false,
    });
  });

  it("creates a hosted share link and threads an explicit invite code into the final url", async () => {
    const prisma = createHostedSharePrisma();
    const startedAt = Date.now();
    const result = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      inviteCode: "invite_123",
      senderMemberId: "member_sender",
    });

    expect(result.joinUrl).toContain("/join/invite_123?share=");
    expect(result.shareUrl).toContain(`/share/${encodeURIComponent(result.shareCode)}?invite=invite_123`);
    expect(result.url).toBe(result.joinUrl);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]?.previewJson).toEqual({
      kinds: ["food", "protocol"],
      counts: {
        foods: 1,
        protocols: 1,
        recipes: 0,
        total: 2,
      },
      logMealAfterImport: true,
    });
    expect((prisma.rows[0]?.expiresAt?.getTime() ?? 0) - startedAt).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect((prisma.rows[0]?.expiresAt?.getTime() ?? 0) - startedAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000);
    expect(shareHarness.sharePacks.get(`member_sender:${prisma.rows[0]?.id ?? ""}`)).toEqual(buildPack());
  });

  it("issues a hosted invite when a recipient phone number is provided", async () => {
    const prisma = createHostedSharePrisma();
    shareHarness.issueHostedInviteForPhone.mockResolvedValue({
      invite: {
        inviteCode: "invite_phone_123",
      },
    });

    const result = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      recipientPhoneNumber: "+15551234567",
      senderMemberId: "member_sender",
    });

    expect(shareHarness.issueHostedInviteForPhone).toHaveBeenCalledWith({
      channel: "share",
      phoneNumber: "+15551234567",
      prisma,
    });
    expect(result.joinUrl).toContain("/join/invite_phone_123?share=");
    expect(result.shareUrl).toContain(`/share/${encodeURIComponent(result.shareCode)}?invite=invite_phone_123`);
    expect(result.url).toBe(result.joinUrl);
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
        suspendedAt: null,
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });
    const pageData = await buildHostedSharePageData({
      authenticatedMember: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
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
        suspendedAt: null,
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(finalizedPageData.stage).toBe("consumed");
    expect(finalizedPageData.share?.acceptedByCurrentMember).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");

    shareHarness.sharePacks.delete(`member_sender:${prisma.rows[0]?.id ?? ""}`);

    const consumedWithoutPackPageData = await buildHostedSharePageData({
      authenticatedMember: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(consumedWithoutPackPageData.stage).toBe("consumed");
    expect(consumedWithoutPackPageData.share?.preview).toEqual({
      kinds: [],
      counts: {
        foods: 0,
        protocols: 0,
        recipes: 0,
        total: 0,
      },
      logMealAfterImport: false,
    });
  });

  it("builds hosted share page preview metadata from Postgres even when the Cloudflare pack is gone", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    shareHarness.sharePacks.delete(`member_sender:${prisma.rows[0]?.id ?? ""}`);

    const pageData = await buildHostedSharePageData({
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(pageData.stage).toBe("signin");
    expect(pageData.share?.preview).toEqual({
      kinds: ["food", "protocol"],
      counts: {
        foods: 1,
        protocols: 1,
        recipes: 0,
        total: 2,
      },
      logMealAfterImport: true,
    });
  });

  it("accepts the share even when the Cloudflare-backed pack is already missing at claim time", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    shareHarness.sharePacks.delete(`member_sender:${prisma.rows[0]?.id ?? ""}`);

    await expect(acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      imported: false,
      pending: true,
    });

    expect(prisma.outboxRows).toHaveLength(1);
    expect(shareHarness.stagedPayloads).toHaveLength(0);
  });

  it("keeps the hosted share claim and reuses the same event id across retries before finalization", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await expect(acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      imported: false,
      pending: true,
    });
    expect(prisma.rows[0]?.acceptedByMemberId).toBe("member_123");
    expect(prisma.rows[0]?.consumedAt).toBeNull();
    expect(prisma.outboxRows).toHaveLength(1);
    expect(shareHarness.stagedPayloads).toHaveLength(0);

    const retried = await acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(retried.imported).toBe(false);
    expect(retried.pending).toBe(true);
    expect(prisma.outboxRows).toHaveLength(1);
    expect(prisma.outboxRows[0]?.eventId).toBe(prisma.rows[0]?.lastEventId);
    expect(shareHarness.stagedPayloads).toHaveLength(0);

    await finalizeHostedShareAcceptance({
      eventId: prisma.rows[0]?.lastEventId ?? "",
      memberId: "member_123",
      prisma: prisma as never,
      shareId: prisma.rows[0]?.id ?? "",
    });

    const finalized = await acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: null,
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    });

    expect(finalized.alreadyImported).toBe(true);
    expect(finalized.imported).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");
  });

  it("ignores stale release and finalize callbacks after the share is reaccepted", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
      const prisma = createHostedSharePrisma();
      const created = await createHostedShareLink({
        prisma: prisma as never,
        pack: buildPack(),
        senderMemberId: "member_sender",
      });

      await acceptHostedShareLink({
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          suspendedAt: null,
        } as never,
        prisma: prisma as never,
        shareCode: created.shareCode,
      });
      const firstEventId = prisma.rows[0]?.lastEventId;

      expect(firstEventId).toBeTruthy();
      expect(await releaseHostedShareAcceptance({
        eventId: firstEventId ?? "",
        memberId: "member_123",
        prisma: prisma as never,
        shareId: prisma.rows[0]?.id ?? "",
      })).toBe(true);

      vi.setSystemTime(new Date("2026-03-26T12:05:00.000Z"));
      await acceptHostedShareLink({
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          suspendedAt: null,
        } as never,
        prisma: prisma as never,
        shareCode: created.shareCode,
      });
      const secondEventId = prisma.rows[0]?.lastEventId;

      expect(secondEventId).toBeTruthy();
      expect(secondEventId).not.toBe(firstEventId);

      expect(await releaseHostedShareAcceptance({
        eventId: firstEventId ?? "",
        memberId: "member_123",
        prisma: prisma as never,
        shareId: prisma.rows[0]?.id ?? "",
      })).toBe(false);
      expect(await finalizeHostedShareAcceptance({
        eventId: firstEventId ?? "",
        memberId: "member_123",
        prisma: prisma as never,
        shareId: prisma.rows[0]?.id ?? "",
      })).toBe(false);

      expect(prisma.rows[0]).toMatchObject({
        acceptedByMemberId: "member_123",
        consumedAt: null,
        lastEventId: secondEventId,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats suspended members as inactive for share page access and share acceptance", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await expect(buildHostedSharePageData({
      authenticatedMember: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      session: {
        active: false,
        authenticated: true,
      },
      stage: "signin",
    });

    await expect(acceptHostedShareLink({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
      } as never,
      prisma: prisma as never,
      shareCode: created.shareCode,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("rejects hosted share creation when the sender member cannot be found", async () => {
    const prisma = createHostedSharePrisma({ hostedMembers: [] });

    await expect(createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    })).rejects.toMatchObject({
      code: "HOSTED_SHARE_SENDER_NOT_FOUND",
      httpStatus: 404,
    });

    expect(prisma.rows).toHaveLength(0);
    expect(shareHarness.sharePacks.size).toBe(0);
  });

  it("rejects hosted share creation for suspended senders", async () => {
    const prisma = createHostedSharePrisma({
      hostedMembers: [
        {
          billingStatus: HostedBillingStatus.active,
          id: "member_sender",
          suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
        },
      ],
    });

    await expect(createHostedShareLink({
      prisma: prisma as never,
      pack: buildPack(),
      senderMemberId: "member_sender",
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(prisma.rows).toHaveLength(0);
    expect(shareHarness.sharePacks.size).toBe(0);
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
  previewJson: Record<string, unknown>;
  senderMemberId: string | null;
  updatedAt: Date;
};

type HostedShareMemberRow = {
  billingStatus: HostedBillingStatus;
  id: string;
  suspendedAt: Date | null;
};

function createHostedSharePrisma(input?: {
  hostedMembers?: HostedShareMemberRow[];
}) {
  const rows: HostedShareRow[] = [];
  const outboxRows: ExecutionOutbox[] = [];
  const hostedMembers = input?.hostedMembers ?? [
    {
      billingStatus: HostedBillingStatus.active,
      id: "member_sender",
      suspendedAt: null,
    },
  ];
  const prismaLike = {
    hostedMembers,
    rows,
    outboxRows,
    hostedMember: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        hostedMembers.find((member) => member.id === where.id) ?? null,
    },
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
    executionOutbox: {
      upsert: async ({
        create,
        where,
      }: {
        create: ExecutionOutbox;
        where: { eventId: string };
      }) => {
        const existing = outboxRows.find((entry) => entry.eventId === where.eventId);

        if (existing) {
          return existing;
        }

        const row = structuredClone(create) as ExecutionOutbox;
        outboxRows.push(row);
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
