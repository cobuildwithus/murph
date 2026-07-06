import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const encryptionMocks = vi.hoisted(() => ({
  decryptHostedWebNullableString: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", async (importActual) => ({
  ...(await importActual<object>()),
  decryptHostedWebNullableString: encryptionMocks.decryptHostedWebNullableString,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", async (importActual) => ({
  ...(await importActual<object>()),
  lookupHostedMemberIdentityByPhoneNumber:
    storeMocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async (importActual) => ({
  ...(await importActual<object>()),
  readHostedMemberRoutingState: storeMocks.readHostedMemberRoutingState,
}));

import {
  buildHostedFamilyInviteMessagesHref,
  parseHostedFamilyInviteStartToken,
  readHostedFamilyInviteAcceptanceView,
} from "@/src/lib/hosted-onboarding/family-plan";

const NOW = new Date("2026-06-24T00:00:00.000Z");
const FUTURE = new Date("2026-07-01T00:00:00.000Z");
const INVITED_PHONE = "+15550001111";
const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;

const GROUP = {
  billingStatus: HostedBillingStatus.active,
  displayName: "Kim Family",
  id: "hbag_1",
  ownerMemberId: "m_owner",
  suspendedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://app.murph.test";
  // The invitee's phone is resolved from the encrypted invite field.
  encryptionMocks.decryptHostedWebNullableString.mockResolvedValue(INVITED_PHONE);
});

afterEach(() => {
  if (previousPublicBaseUrl === undefined) {
    delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
  } else {
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = previousPublicBaseUrl;
  }
});

function phoneBoundPrisma() {
  return {
    hostedAccountGroupInvite: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue({
        expiresAt: FUTURE,
        group: GROUP,
        inviteCode: "CODEDAD",
        status: "pending",
        targetEmailLookupKey: null,
        targetLabel: "Dad",
        targetPhoneLookupKey: "lookup_dad",
        targetPhoneNumberEncrypted: "enc:dad-phone",
        targetTelegramUsernameLookupKey: null,
      }),
    },
    hostedAccountGroupMembership: {
      count: vi.fn().mockResolvedValue(2),
    },
    hostedAccountGroupBillingRef: {
      findUnique: vi.fn().mockResolvedValue({ billedSeatCount: 4 }),
    },
  };
}

test("prefers an existing member's home line, resolved by the decrypted phone", async () => {
  storeMocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
    core: { id: "m_dad" },
  });
  storeMocks.readHostedMemberRoutingState.mockResolvedValue({
    linqRecipientPhone: "+15551112222",
  });

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double exposes only the methods under test
    prisma: phoneBoundPrisma(),
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view?.messagesRecipientPhone).toBe("+15551112222");
  // Version-tolerant authority: it resolves the member by the raw phone (the
  // same path the accept-by-phone webhook uses), not the invite's stored key.
  expect(storeMocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith(
    expect.objectContaining({ phoneNumber: INVITED_PHONE }),
  );
  expect(storeMocks.readHostedMemberRoutingState).toHaveBeenCalledWith(
    expect.objectContaining({ memberId: "m_dad" }),
  );
});

test("returns no Messages target when the phone matches no existing member", async () => {
  storeMocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma: phoneBoundPrisma(),
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view?.messagesRecipientPhone).toBeNull();
  expect(storeMocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
});

test("degrades to no home-line target (not a page error) when resolution throws", async () => {
  storeMocks.lookupHostedMemberIdentityByPhoneNumber.mockRejectedValue(
    new Error("ambiguous phone lookup"),
  );

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma: phoneBoundPrisma(),
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view?.messagesRecipientPhone).toBeNull();
  expect(view?.isPhoneBound).toBe(true);
});

test("builds an sms deep link carrying the webhook-parseable family token", () => {
  expect(
    buildHostedFamilyInviteMessagesHref({
      inviteCode: "CODEDAD",
      murphPhoneNumber: "+15550000000",
    }),
  ).toBe("sms:+15550000000?body=family_CODEDAD");
});

test("the prefilled sms body is exactly what the accept-by-phone webhook parses", () => {
  const href = buildHostedFamilyInviteMessagesHref({
    inviteCode: "CODEDAD",
    murphPhoneNumber: "+15550000000",
  });
  const body = decodeURIComponent(href.split("?body=")[1] ?? "");

  // The invitee sends this body to Murph; the LinQ webhook must recover the
  // invite code from it, or accept-by-text silently fails.
  expect(parseHostedFamilyInviteStartToken(body)).toBe("CODEDAD");
});
