import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateHostedGroupSponsorshipMomentTx,
  assertHostedGroupSponsorshipRequestMatchesTx,
  createHostedGroupSponsorshipMomentTx,
  hasHostedGroupSponsorshipCustomizationAuthority,
  parseHostedGroupSponsorshipDraft,
  readHostedActiveGroupRunningBit,
  readHostedGroupSponsorshipDraftForCreator,
  readHostedGroupSponsorshipMomentForNotification,
} from "@/src/lib/hosted-groups/group-sponsorship-store";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";

const PAID_AT = new Date("2026-07-27T12:00:00.000Z");

beforeEach(() => {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt: ({ value }) =>
      Buffer.from(value.slice("sealed:".length), "base64url").toString("utf8"),
    encrypt: ({ value }) =>
      `sealed:${Buffer.from(value, "utf8").toString("base64url")}`,
  });
});

afterEach(() => {
  setHostedSecureBoxStringTestCodecForTests(null);
});

describe("hosted group sponsorship store", () => {
  it("normalizes bounded plain text and rejects extra or unsafe input", () => {
    expect(parseHostedGroupSponsorshipDraft({
      publicAlias: "  The Group Historian  ",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: "For whatever adventure comes next.",
    })).toEqual({
      publicAlias: "The Group Historian",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: "For whatever adventure comes next.",
    });
    expect(parseHostedGroupSponsorshipDraft({})).toBeNull();
    expect(() => parseHostedGroupSponsorshipDraft({
      publicAlias: "Sponsor",
      unexpected: true,
    })).toThrow(/short plain text/u);
    expect(() => parseHostedGroupSponsorshipDraft({
      sponsorMessage: "unsafe\u0000text",
    })).toThrow(/short plain text/u);
  });

  it("freezes encrypted content, rejects changed replay, and activates one expiring bit", async () => {
    const harness = createHarness();
    const draft = {
      publicAlias: "The Group Historian",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: "For whatever adventure comes next.",
    };

    await createHostedGroupSponsorshipMomentTx({
      authorizedDraft: draft,
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      offerCode: "usage_10_usd",
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    });

    expect(harness.row).toMatchObject({
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      purchaseId: "purchase_123",
    });
    expect(harness.row.configurationDigest).not.toContain("Group Historian");
    expect(harness.row.publicAliasEncrypted).not.toContain("Group Historian");

    await expect(assertHostedGroupSponsorshipRequestMatchesTx({
      draft,
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    })).resolves.toBeUndefined();
    await expect(assertHostedGroupSponsorshipRequestMatchesTx({
      draft: { ...draft, sponsorMessage: "Changed after payment started." },
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
    });

    await activateHostedGroupSponsorshipMomentTx({
      activatedAt: PAID_AT,
      customContentAuthorized: true,
      offerCode: "usage_10_usd",
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    });
    expect(harness.row).toMatchObject({
      activatedAt: PAID_AT,
      expiresAt: new Date("2026-07-28T12:00:00.000Z"),
    });

    await expect(readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_10_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_123",
    })).resolves.toMatchObject({
      celebrationScale: "medium",
      ...draft,
    });
    await expect(readHostedGroupSponsorshipDraftForCreator({
      creatorMemberId: "member_sponsor",
      prisma: harness.prisma as never,
      purchaseId: "purchase_123",
    })).resolves.toEqual(draft);
    await expect(readHostedActiveGroupRunningBit({
      now: new Date("2026-07-27T13:00:00.000Z"),
      prisma: harness.prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      expiresAt: "2026-07-28T12:00:00.000Z",
      publicAlias: draft.publicAlias,
      requestedBit: draft.runningBitRequest,
      schema: "murph.group-sponsorship-bit.v1",
    });
  });

  it("separates funding from customization authority and gives $5 no running bit", async () => {
    const unauthorized = createHarness({ participantAuthorized: false });
    await expect(hasHostedGroupSponsorshipCustomizationAuthority({
      containerMemberId: "member_group_runtime",
      now: PAID_AT,
      participantMemberId: "member_outsider",
      prisma: unauthorized.prisma as never,
    })).resolves.toBe(false);

    await expect(createHostedGroupSponsorshipMomentTx({
      authorizedDraft: {
        publicAlias: null,
        runningBitRequest: "Make me CFO.",
        sponsorMessage: null,
      },
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      offerCode: "usage_5_usd",
      purchaseId: "purchase_5",
      tx: unauthorized.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_SPONSORSHIP_BIT_NOT_AVAILABLE",
    });
  });
});

function createHarness(input: { participantAuthorized?: boolean } = {}) {
  const state: { row: Record<string, unknown> } = { row: {} };
  const hostedGroupSponsorshipMoment = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.row = { ...data, activatedAt: null, expiresAt: null };
      return state.row;
    }),
    findFirst: vi.fn(async () =>
      Object.keys(state.row).length > 0 ? state.row : null
    ),
    findUnique: vi.fn(async (query: {
      select?: Record<string, boolean>;
    }) => {
      if (Object.keys(state.row).length === 0) {
        return null;
      }
      return query.select
        ? Object.fromEntries(
            Object.keys(query.select).map((key) => [key, state.row[key]]),
          )
        : state.row;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (state.row.activatedAt) {
        return { count: 0 };
      }
      Object.assign(state.row, data);
      return { count: 1 };
    }),
  };
  const prisma = {
    hostedGroupSponsorshipMoment,
    hostedThreadContainer: {
      findFirst: vi.fn(async () =>
        input.participantAuthorized === false
          ? null
          : { memberId: "member_group_runtime" }
      ),
    },
  };
  return {
    get row() {
      return state.row;
    },
    prisma,
  };
}
