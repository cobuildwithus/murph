import { HostedBillingStatus } from "@prisma/client";
import type { SharePack } from "@murphai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WakeDispatchRecord = {
  wakeState: "completed" | "quarantined" | "queued" | "replaced";
  eventId: string;
};

const shareHarness = vi.hoisted(() => {
  const state = {
    issueHostedInviteForPhone: vi.fn(),
    readHostedIngressLifecycleState: vi.fn(async (input: {
      eventId: string;
      prisma?: { outboxRows?: WakeDispatchRecord[] };
      userId: string;
    }) =>
      input.prisma?.outboxRows?.find((entry) => entry.eventId === input.eventId)?.wakeState ?? null),
    materializeHostedIngressEnvelopeTx: vi.fn(async (input: {
      wake: { eventId: string };
      tx?: { outboxRows?: WakeDispatchRecord[] };
    }) => {
      const outboxRows = input.tx?.outboxRows;
      if (outboxRows && !outboxRows.some((entry) => entry.eventId === input.wake.eventId)) {
        outboxRows.push({
          wakeState: "queued",
          eventId: input.wake.eventId,
        });
      }

      return {
        eventId: input.wake.eventId,
      };
    }),
    nudgeHostedRunBestEffort: vi.fn(),
  };

  return state;
});

vi.mock("@/src/lib/hosted-ingress/lifecycle", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-ingress/lifecycle")>(
    "@/src/lib/hosted-ingress/lifecycle",
  );

  return {
    ...actual,
    materializeHostedIngressEnvelopeTx: shareHarness.materializeHostedIngressEnvelopeTx,
    readHostedIngressLifecycleState: shareHarness.readHostedIngressLifecycleState,
  };
});
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-share-service.test.ts");
  }),
}));
vi.mock("@/src/lib/hosted-ingress/control", () => ({
  nudgeHostedRunBestEffort: shareHarness.nudgeHostedRunBestEffort,
}));
vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInviteForPhone: shareHarness.issueHostedInviteForPhone,
}));

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

type HostedSharePrisma = Parameters<typeof createHostedShareLink>[0]["prisma"]
  & Parameters<typeof acceptHostedShareLink>[0]["prisma"]
  & Parameters<typeof buildHostedSharePageData>[0]["prisma"]
  & Parameters<typeof finalizeHostedShareAcceptance>[0]["prisma"]
  & Parameters<typeof releaseHostedShareAcceptance>[0]["prisma"];
type HostedShareActiveMember = NonNullable<Parameters<typeof acceptHostedShareLink>[0]["member"]>;
type HostedShareAuthenticatedMember =
  NonNullable<Parameters<typeof buildHostedSharePageData>[0]["authenticatedMember"]>;

let originalHostedOnboardingPublicBaseUrl: string | undefined;
let originalHostedContactPrivacyCurrentKeyVersion: string | undefined;
let originalHostedContactPrivacyKeys: string | undefined;
const TEST_CONTACT_PRIVACY_KEY = Buffer.alloc(32, 7).toString("base64url");

function buildPack(): SharePack {
  return {
    schemaVersion: "murph.share-pack.v1",
    title: "Morning Smoothie",
    createdAt: "2026-03-26T12:00:00.000Z",
    entities: [
      {
        kind: "regimen",
        ref: "regimen:creatine",
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
          attachedRegimenRefs: ["regimen:creatine"],
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
    shareHarness.issueHostedInviteForPhone.mockReset();
    shareHarness.issueHostedInviteForPhone.mockRejectedValue(
      new Error("Unexpected invite issuance in hosted share service test."),
    );
    shareHarness.readHostedIngressLifecycleState.mockReset();
    shareHarness.readHostedIngressLifecycleState.mockImplementation(async (input: {
      eventId: string;
      prisma?: { outboxRows?: WakeDispatchRecord[] };
    }) =>
      input.prisma?.outboxRows?.find((entry) => entry.eventId === input.eventId)?.wakeState ?? null);
    shareHarness.materializeHostedIngressEnvelopeTx.mockReset();
    shareHarness.materializeHostedIngressEnvelopeTx.mockImplementation(async (input: {
      wake: { eventId: string };
      tx?: { outboxRows?: WakeDispatchRecord[] };
    }) => {
      const outboxRows = input.tx?.outboxRows;
      if (outboxRows && !outboxRows.some((entry) => entry.eventId === input.wake.eventId)) {
        outboxRows.push({
          wakeState: "queued",
          eventId: input.wake.eventId,
        });
      }

      return {
        eventId: input.wake.eventId,
      };
    });
    shareHarness.nudgeHostedRunBestEffort.mockReset();
    shareHarness.nudgeHostedRunBestEffort.mockResolvedValue(undefined);
    originalHostedOnboardingPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    originalHostedContactPrivacyCurrentKeyVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    originalHostedContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${TEST_CONTACT_PRIVACY_KEY}`;
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://join.example.test";
  });

  afterEach(() => {
    if (originalHostedOnboardingPublicBaseUrl === undefined) {
      delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    } else {
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = originalHostedOnboardingPublicBaseUrl;
    }

    if (originalHostedContactPrivacyCurrentKeyVersion === undefined) {
      delete process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    } else {
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = originalHostedContactPrivacyCurrentKeyVersion;
    }

    if (originalHostedContactPrivacyKeys === undefined) {
      delete process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    } else {
      process.env.HOSTED_CONTACT_PRIVACY_KEYS = originalHostedContactPrivacyKeys;
    }
  });

  it("accepts the tiny hosted-share preview JSON shape", () => {
    expect(readHostedSharePreview({
      kinds: [],
      counts: {
        foods: 0,
        recipes: 0,
        regimens: 0,
        total: 0,
      },
      logMealAfterImport: false,
    })).toEqual({
      kinds: [],
      counts: {
        foods: 0,
        recipes: 0,
        regimens: 0,
        total: 0,
      },
      logMealAfterImport: false,
    });
  });

  it("creates a hosted share link and threads an explicit invite code into the final url", async () => {
    const prisma = createHostedSharePrisma();
    const startedAt = Date.now();
    const result = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      inviteCode: "invite_123",
      senderMemberId: "member_sender",
    });

    expect(result.joinUrl).toContain("/join/invite_123?share=");
    expect(result.shareUrl).toContain(`/share/${encodeURIComponent(result.shareCode)}?invite=invite_123`);
    expect(result.url).toBe(result.joinUrl);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]?.previewJson).toEqual({
      kinds: ["food", "regimen"],
      counts: {
        foods: 1,
        recipes: 0,
        regimens: 1,
        total: 2,
      },
      logMealAfterImport: true,
    });
    expect((prisma.rows[0]?.expiresAt?.getTime() ?? 0) - startedAt).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect((prisma.rows[0]?.expiresAt?.getTime() ?? 0) - startedAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000);
    expect(prisma.hostedSharePayloadRows).toHaveLength(1);
    expect(prisma.hostedSharePayloadRows[0]?.shareId).toBe(prisma.rows[0]?.id);
  });

  it("issues a hosted invite when a recipient phone number is provided", async () => {
    const prisma = createHostedSharePrisma();
    shareHarness.issueHostedInviteForPhone.mockResolvedValue({
      invite: {
        inviteCode: "invite_phone_123",
      },
    });

    const result = await createHostedShareLink({
      prisma,
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
      prisma,
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
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    const result = await acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });
    const pageData = await buildHostedSharePageData({
      authenticatedMember: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    expect(result.imported).toBe(false);
    expect(result.alreadyImported).toBe(false);
    expect(result.pending).toBe(true);
    expect(pageData.stage).toBe("processing");
    expect(pageData.share?.acceptedByCurrentMember).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBeNull();
    expect(shareHarness.nudgeHostedRunBestEffort).toHaveBeenCalledWith({
      context: "hosted-share.acceptance",
      userId: "member_123",
    });

    await finalizeHostedShareAcceptance({
      eventId: prisma.rows[0]?.lastEventId ?? "",
      memberId: "member_123",
      prisma,
      shareId: prisma.rows[0]?.id ?? "",
    });
    const finalizedPageData = await buildHostedSharePageData({
      authenticatedMember: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    expect(finalizedPageData.stage).toBe("consumed");
    expect(finalizedPageData.share?.acceptedByCurrentMember).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");
    expect(prisma.hostedSharePayloadRows).toHaveLength(0);

    const consumedWithoutPackPageData = await buildHostedSharePageData({
      authenticatedMember: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    expect(consumedWithoutPackPageData.stage).toBe("consumed");
    expect(consumedWithoutPackPageData.share?.preview).toEqual({
      kinds: [],
      counts: {
        foods: 0,
        recipes: 0,
        regimens: 0,
        total: 0,
      },
      logMealAfterImport: false,
    });
  });

  it("builds hosted share page preview metadata from Postgres without any Cloudflare share-pack dependency", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    const pageData = await buildHostedSharePageData({
      prisma,
      shareCode: created.shareCode,
    });

    expect(pageData.stage).toBe("signin");
    expect(pageData.share?.preview).toEqual({
      kinds: ["food", "regimen"],
      counts: {
        foods: 1,
        recipes: 0,
        regimens: 1,
        total: 2,
      },
      logMealAfterImport: true,
    });
  });

  it("does not wait for the best-effort hosted run nudge before returning the share claim", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });
    shareHarness.nudgeHostedRunBestEffort.mockReturnValue(new Promise(() => {}));

    await expect(acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      imported: false,
      pending: true,
    });

    expect(shareHarness.nudgeHostedRunBestEffort).toHaveBeenCalledTimes(1);
  });

  it("accepts the share from the web-owned payload without a Cloudflare pack seam", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await expect(acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      imported: false,
      pending: true,
    });

    expect(prisma.outboxRows).toHaveLength(1);
    expect(shareHarness.nudgeHostedRunBestEffort).toHaveBeenCalledWith({
      context: "hosted-share.acceptance",
      userId: "member_123",
    });
  });

  it("keeps the hosted share claim and reuses the same event id across retries before finalization", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await expect(acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      imported: false,
      pending: true,
    });
    expect(prisma.rows[0]?.acceptedByMemberId).toBe("member_123");
    expect(prisma.rows[0]?.consumedAt).toBeNull();
    expect(prisma.outboxRows).toHaveLength(1);

    const retried = await acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    expect(retried.imported).toBe(false);
    expect(retried.pending).toBe(true);
    expect(prisma.outboxRows).toHaveLength(1);
    expect(prisma.outboxRows[0]?.eventId).toBe(prisma.rows[0]?.lastEventId);
    expect(shareHarness.nudgeHostedRunBestEffort).toHaveBeenCalledTimes(2);

    await finalizeHostedShareAcceptance({
      eventId: prisma.rows[0]?.lastEventId ?? "",
      memberId: "member_123",
      prisma,
      shareId: prisma.rows[0]?.id ?? "",
    });

    const finalized = await acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    expect(finalized.alreadyImported).toBe(true);
    expect(finalized.imported).toBe(true);
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");
  });

  it("reconciles a processing share from Cloudflare event status when the local outbox row is still queued", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    prisma.outboxRows[0]!.wakeState = "queued";
    prisma.outboxRows[0]!.wakeState = "completed";

    await expect(acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      alreadyImported: true,
      imported: true,
      pending: false,
    });

    await expect(buildHostedSharePageData({
      authenticatedMember: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      stage: "consumed",
    });
    expect(prisma.rows[0]?.consumedByMemberId).toBe("member_123");
  });

  it("releases a processing share when the wake lifecycle is quarantined before local reconciliation catches up", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    prisma.outboxRows[0]!.wakeState = "queued";
    prisma.outboxRows[0]!.wakeState = "quarantined";

    await expect(buildHostedSharePageData({
      authenticatedMember: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      share: {
        acceptedByCurrentMember: false,
      },
      stage: "ready",
    });
    expect(prisma.rows[0]).toMatchObject({
      acceptedAt: null,
      acceptedByMemberId: null,
      consumedAt: null,
      consumedByMemberId: null,
      lastEventId: null,
    });
  });

  it("prunes expired hosted share payloads when the share page is read", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    prisma.rows[0]!.expiresAt = new Date("2026-03-01T00:00:00.000Z");

    await expect(buildHostedSharePageData({
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      stage: "expired",
    });
    expect(prisma.hostedSharePayloadRows).toHaveLength(0);
  });

  it("prunes expired hosted share payloads when a claim arrives after expiry", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    prisma.rows[0]!.expiresAt = new Date("2026-03-01T00:00:00.000Z");

    await expect(acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).rejects.toMatchObject({
      code: "HOSTED_SHARE_EXPIRED",
      httpStatus: 410,
    });
    expect(prisma.hostedSharePayloadRows).toHaveLength(0);
  });

  it("releases a processing share when the wake lifecycle is replaced before local reconciliation catches up", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    prisma.outboxRows[0]!.wakeState = "replaced";

    await expect(buildHostedSharePageData({
      authenticatedMember: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      share: {
        acceptedByCurrentMember: false,
      },
      stage: "ready",
    });
    expect(prisma.rows[0]).toMatchObject({
      acceptedAt: null,
      acceptedByMemberId: null,
      consumedAt: null,
      consumedByMemberId: null,
      lastEventId: null,
    });
  });

  it("releases a processing share when the canonical wake row is absent", async () => {
    const prisma = createHostedSharePrisma();
    const created = await createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await acceptHostedShareLink({
      member: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    });

    prisma.outboxRows.length = 0;

    await expect(buildHostedSharePageData({
      authenticatedMember: createHostedShareMember(),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      share: {
        acceptedByCurrentMember: false,
      },
      stage: "ready",
    });
    expect(prisma.rows[0]).toMatchObject({
      acceptedAt: null,
      acceptedByMemberId: null,
      consumedAt: null,
      consumedByMemberId: null,
      lastEventId: null,
    });
  });

  it("ignores stale release and finalize callbacks after the share is reaccepted", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
      const prisma = createHostedSharePrisma();
      const created = await createHostedShareLink({
        prisma,
        pack: buildPack(),
        senderMemberId: "member_sender",
      });

      await acceptHostedShareLink({
        member: createHostedShareMember(),
        prisma,
        shareCode: created.shareCode,
      });
      const firstEventId = prisma.rows[0]?.lastEventId;

      expect(firstEventId).toBeTruthy();
      expect(await releaseHostedShareAcceptance({
        eventId: firstEventId ?? "",
        memberId: "member_123",
        prisma,
        shareId: prisma.rows[0]?.id ?? "",
      })).toBe(true);

      vi.setSystemTime(new Date("2026-03-26T12:05:00.000Z"));
      await acceptHostedShareLink({
        member: createHostedShareMember(),
        prisma,
        shareCode: created.shareCode,
      });
      const secondEventId = prisma.rows[0]?.lastEventId;

      expect(secondEventId).toBeTruthy();
      expect(secondEventId).not.toBe(firstEventId);

      expect(await releaseHostedShareAcceptance({
        eventId: firstEventId ?? "",
        memberId: "member_123",
        prisma,
        shareId: prisma.rows[0]?.id ?? "",
      })).toBe(false);
      expect(await finalizeHostedShareAcceptance({
        eventId: firstEventId ?? "",
        memberId: "member_123",
        prisma,
        shareId: prisma.rows[0]?.id ?? "",
      })).toEqual({
        finalized: false,
        shareFound: true,
        sharePackOwnerMemberId: null,
      });

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
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    });

    await expect(buildHostedSharePageData({
      authenticatedMember: createHostedShareMember({
        suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
      }),
      prisma,
      shareCode: created.shareCode,
    })).resolves.toMatchObject({
      session: {
        active: false,
        authenticated: true,
      },
      stage: "signin",
    });

    await expect(acceptHostedShareLink({
      member: createHostedShareMember({
        suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
      }),
      prisma,
      shareCode: created.shareCode,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("rejects hosted share creation when the sender member cannot be found", async () => {
    const prisma = createHostedSharePrisma({ hostedMembers: [] });

    await expect(createHostedShareLink({
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    })).rejects.toMatchObject({
      code: "HOSTED_SHARE_SENDER_NOT_FOUND",
      httpStatus: 404,
    });

    expect(prisma.rows).toHaveLength(0);
    expect(prisma.hostedSharePayloadRows).toHaveLength(0);
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
      prisma,
      pack: buildPack(),
      senderMemberId: "member_sender",
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(prisma.rows).toHaveLength(0);
    expect(prisma.hostedSharePayloadRows).toHaveLength(0);
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

type HostedSharePayloadRow = {
  createdAt: Date;
  payloadEncrypted: string;
  payloadSchema: string;
  shareId: string;
  updatedAt: Date;
};

type HostedShareMemberRow = {
  billingStatus: HostedBillingStatus;
  id: string;
  suspendedAt: Date | null;
};

type HostedSharePrismaHandle = HostedSharePrisma & {
  hostedMembers: HostedShareMemberRow[];
  hostedSharePayloadRows: HostedSharePayloadRow[];
  rows: HostedShareRow[];
  outboxRows: WakeDispatchRecord[];
};

function createHostedShareMember(
  overrides: Partial<HostedShareMemberRow> = {},
): HostedShareActiveMember & HostedShareAuthenticatedMember {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    ...overrides,
  };
}

function createHostedSharePrisma(input?: {
  hostedMembers?: HostedShareMemberRow[];
}): HostedSharePrismaHandle {
  const rows: HostedShareRow[] = [];
  const hostedSharePayloadRows: HostedSharePayloadRow[] = [];
  const outboxRows: WakeDispatchRecord[] = [];
  const hostedMembers = input?.hostedMembers ?? [
    {
      billingStatus: HostedBillingStatus.active,
      id: "member_sender",
      suspendedAt: null,
    },
  ];
  const prismaLike = {
    hostedMembers,
    hostedSharePayloadRows,
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
    hostedSharePayload: {
      findUnique: async ({ where }: { where: { shareId: string } }) =>
        hostedSharePayloadRows.find((row) => row.shareId === where.shareId) ?? null,
      deleteMany: async ({ where }: { where: { shareId: string } }) => {
        const before = hostedSharePayloadRows.length;
        for (let index = hostedSharePayloadRows.length - 1; index >= 0; index -= 1) {
          if (hostedSharePayloadRows[index]?.shareId === where.shareId) {
            hostedSharePayloadRows.splice(index, 1);
          }
        }
        return {
          count: before - hostedSharePayloadRows.length,
        };
      },
      upsert: async ({
        create,
        update,
        where,
      }: {
        create: HostedSharePayloadRow;
        update: Pick<HostedSharePayloadRow, "payloadEncrypted" | "payloadSchema">;
        where: { shareId: string };
      }) => {
        const existing = hostedSharePayloadRows.find((row) => row.shareId === where.shareId);

        if (existing) {
          existing.payloadEncrypted = update.payloadEncrypted;
          existing.payloadSchema = update.payloadSchema;
          existing.updatedAt = new Date();
          return existing;
        }

        const row: HostedSharePayloadRow = {
          ...create,
          createdAt: create.createdAt ?? new Date(),
          updatedAt: create.updatedAt ?? new Date(),
        };
        hostedSharePayloadRows.push(row);
        return row;
      },
    },
  };

  const transactionalPrisma = {
    ...prismaLike,
    $queryRaw: async () => [],
  };
  // @ts-expect-error - the share test harness only uses Prisma's callback transaction form.
  const transaction = (async <TResult>(callback: (tx: typeof transactionalPrisma) => Promise<TResult>) =>
    callback(transactionalPrisma)) as HostedSharePrisma["$transaction"];

  // @ts-expect-error - the harness provides only the Prisma surface exercised by this suite.
  return {
    ...transactionalPrisma,
    $transaction: transaction,
  };
}
