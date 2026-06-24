import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const encryptionMocks = vi.hoisted(() => ({
  decryptHostedWebNullableString: vi.fn(),
  encryptHostedWebNullableString: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: encryptionMocks.decryptHostedWebNullableString,
  encryptHostedWebNullableString: encryptionMocks.encryptHostedWebNullableString,
}));

import {
  readHostedFamilyInviteAcceptanceView,
  readHostedFamilyOwnerSnapshotForMember,
  revokeHostedFamilyInviteTx,
} from "@/src/lib/hosted-onboarding/family-plan";

const RAW_PHONE = "+48600000000";
const NOW = new Date("2026-06-24T00:00:00.000Z");
const FUTURE = new Date("2026-07-01T00:00:00.000Z");
const PAST = new Date("2026-06-01T00:00:00.000Z");

const previousTelegramBotUsername = process.env.TELEGRAM_BOT_USERNAME;
const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
const previousContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
const previousContactPrivacyVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_USERNAME = "withmurph_bot";
  process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://app.murph.test";
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = "v1:MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
  encryptionMocks.decryptHostedWebNullableString.mockResolvedValue(RAW_PHONE);
});

afterEach(() => {
  restoreEnv("TELEGRAM_BOT_USERNAME", previousTelegramBotUsername);
  restoreEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", previousPublicBaseUrl);
  restoreEnv("HOSTED_CONTACT_PRIVACY_KEYS", previousContactPrivacyKeys);
  restoreEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousContactPrivacyVersion);
});

const GROUP = {
  billingStatus: HostedBillingStatus.active,
  displayName: "Kim Family",
  id: "hbag_1",
  ownerMemberId: "m_owner",
  suspendedAt: null,
};

function ownerSnapshotPrisma() {
  return {
    hostedAccountGroup: {
      findUnique: vi.fn().mockResolvedValue(GROUP),
    },
    hostedAccountGroupInvite: {
      findMany: vi.fn(({ where }: { where: { status: string } }) =>
        where.status === "accepted"
          ? Promise.resolve([
              { acceptedByMemberId: "m_mom", group: GROUP, targetLabel: "Mom" },
            ])
          : Promise.resolve([
              {
                channel: "family",
                expiresAt: FUTURE,
                group: GROUP,
                id: "inv_dad",
                inviteCode: "CODEDAD",
                status: "pending",
                targetLabel: "Dad",
                targetPhoneNumberEncrypted: "enc:dad",
              },
            ]),
      ),
    },
    hostedAccountGroupMembership: {
      findMany: vi.fn().mockResolvedValue([
        { joinedAt: NOW, memberId: "m_owner", role: "owner", status: "active" },
        { joinedAt: FUTURE, memberId: "m_mom", role: "member", status: "active" },
      ]),
    },
  };
}

test("owner snapshot maps seats, member labels, masked phone, and share links", async () => {
  const prisma = ownerSnapshotPrisma();
  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    // @ts-expect-error: focused prisma double exposes only the methods under test
    prisma,
    memberId: "m_owner",
    now: NOW,
  });

  expect(snapshot).not.toBeNull();
  expect(snapshot?.billingActive).toBe(true);
  expect(snapshot?.seats).toEqual({ active: 2, invited: 1, max: 4, remaining: 1, used: 3 });

  const owner = snapshot?.members.find((member) => member.memberId === "m_owner");
  expect(owner).toMatchObject({ isOwner: true, label: null });
  const mom = snapshot?.members.find((member) => member.memberId === "m_mom");
  expect(mom).toMatchObject({ isOwner: false, label: "Mom" });

  const invite = snapshot?.invites[0];
  expect(invite?.targetLabel).toBe("Dad");
  expect(invite?.targetPhoneHint).toBeTruthy();
  expect(invite?.targetPhoneHint).not.toBe(RAW_PHONE);
  expect(invite?.telegramInviteUrl).toBe("https://t.me/withmurph_bot?start=family_CODEDAD");
  expect(invite?.acceptUrl).toBe("https://app.murph.test/family/accept/CODEDAD");
});

test("active member identity falls back to the invited email when there is no label", async () => {
  encryptionMocks.decryptHostedWebNullableString.mockImplementation(async ({ field }) =>
    field === "hosted-account-group-invite.target-email" ? "dad@example.com" : null,
  );
  const prisma = {
    hostedAccountGroup: { findUnique: vi.fn().mockResolvedValue(GROUP) },
    hostedAccountGroupInvite: {
      findMany: vi.fn(({ where }: { where: { status: string } }) =>
        where.status === "accepted"
          ? Promise.resolve([
              {
                acceptedByMemberId: "m_dad",
                group: GROUP,
                targetEmailEncrypted: "enc:dad",
                targetLabel: null,
              },
            ])
          : Promise.resolve([]),
      ),
    },
    hostedAccountGroupMembership: {
      findMany: vi.fn().mockResolvedValue([
        { joinedAt: NOW, memberId: "m_owner", role: "owner", status: "active" },
        { joinedAt: FUTURE, memberId: "m_dad", role: "member", status: "active" },
      ]),
    },
  };

  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    // @ts-expect-error: focused prisma double
    prisma,
    memberId: "m_owner",
    now: NOW,
  });

  const dad = snapshot?.members.find((member) => member.memberId === "m_dad");
  expect(dad?.label).toBe("dad@example.com");
});

test("owner snapshot is null when the member owns no family group", async () => {
  const prisma = ownerSnapshotPrisma();
  prisma.hostedAccountGroup.findUnique.mockResolvedValueOnce(null);

  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    // @ts-expect-error: focused prisma double
    prisma,
    memberId: "m_not_owner",
    now: NOW,
  });

  expect(snapshot).toBeNull();
});

function acceptanceViewPrisma(input: {
  activeMemberships: number;
  expiresAt: Date;
  group?: {
    billingStatus: HostedBillingStatus;
    displayName: string | null;
    id: string;
    ownerMemberId: string;
    suspendedAt: Date | null;
  };
  pendingInvites: number;
  status: string;
  targetEmailLookupKey?: string | null;
  targetPhoneLookupKey: string | null;
}) {
  return {
    hostedAccountGroupInvite: {
      count: vi.fn().mockResolvedValue(input.pendingInvites),
      findUnique: vi.fn().mockResolvedValue({
        expiresAt: input.expiresAt,
        group: input.group ?? GROUP,
        inviteCode: "CODEDAD",
        status: input.status,
        targetEmailLookupKey: input.targetEmailLookupKey ?? null,
        targetLabel: "Dad",
        targetPhoneLookupKey: input.targetPhoneLookupKey,
      }),
    },
    hostedAccountGroupMembership: {
      count: vi.fn().mockResolvedValue(input.activeMemberships),
    },
  };
}

test("phone-bound invite to an active group is web-acceptable", async () => {
  const prisma = acceptanceViewPrisma({
    activeMemberships: 2,
    expiresAt: FUTURE,
    pendingInvites: 1,
    status: "pending",
    targetPhoneLookupKey: "lookup_dad",
  });

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma,
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view).toMatchObject({
    groupActive: true,
    isPhoneBound: true,
    seatAvailable: true,
    status: "pending",
    webAcceptable: true,
  });
});

test("email-bound invite to an active group is web-acceptable", async () => {
  const prisma = acceptanceViewPrisma({
    activeMemberships: 2,
    expiresAt: FUTURE,
    pendingInvites: 1,
    status: "pending",
    targetEmailLookupKey: "lookup_email_dad",
    targetPhoneLookupKey: null,
  });

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma,
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view).toMatchObject({
    groupActive: true,
    isEmailBound: true,
    isPhoneBound: false,
    seatAvailable: true,
    webAcceptable: true,
  });
});

test("Telegram/label-only invite is NOT web-acceptable (must use the chat link)", async () => {
  const prisma = acceptanceViewPrisma({
    activeMemberships: 2,
    expiresAt: FUTURE,
    pendingInvites: 1,
    status: "pending",
    targetPhoneLookupKey: null,
  });

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma,
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view?.isPhoneBound).toBe(false);
  expect(view?.webAcceptable).toBe(false);
  expect(view?.telegramInviteUrl).toBe("https://t.me/withmurph_bot?start=family_CODEDAD");
});

test("invite to an inactive (canceled) group is not web-acceptable", async () => {
  const prisma = acceptanceViewPrisma({
    activeMemberships: 1,
    expiresAt: FUTURE,
    group: { ...GROUP, billingStatus: HostedBillingStatus.canceled },
    pendingInvites: 1,
    status: "pending",
    targetPhoneLookupKey: "lookup_dad",
  });

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma,
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view?.groupActive).toBe(false);
  expect(view?.webAcceptable).toBe(false);
});

test("acceptance view reports expired and drops the Telegram link", async () => {
  const prisma = acceptanceViewPrisma({
    activeMemberships: 1,
    expiresAt: PAST,
    pendingInvites: 0,
    status: "pending",
    targetPhoneLookupKey: "lookup_dad",
  });

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma,
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view?.status).toBe("expired");
  expect(view?.webAcceptable).toBe(false);
  expect(view?.telegramInviteUrl).toBeNull();
});

test("phone-bound invite to a full plan is not web-acceptable", async () => {
  const prisma = acceptanceViewPrisma({
    activeMemberships: 4,
    expiresAt: FUTURE,
    pendingInvites: 1,
    status: "pending",
    targetPhoneLookupKey: "lookup_dad",
  });

  const view = await readHostedFamilyInviteAcceptanceView({
    // @ts-expect-error: focused prisma double
    prisma,
    inviteCode: "CODEDAD",
    now: NOW,
  });

  expect(view?.isPhoneBound).toBe(true);
  expect(view?.seatAvailable).toBe(false);
  expect(view?.webAcceptable).toBe(false);
});

test("revoke cancels a pending invite for the owner", async () => {
  const tx = {
    hostedAccountGroup: {
      findUnique: vi.fn().mockResolvedValue(GROUP),
    },
    hostedAccountGroupInvite: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const revoked = await revokeHostedFamilyInviteTx({
    groupId: "hbag_1",
    inviteId: "inv_dad",
    ownerMemberId: "m_owner",
    // @ts-expect-error: focused tx double
    tx,
  });

  expect(revoked).toBe(true);
  expect(tx.hostedAccountGroupInvite.updateMany).toHaveBeenCalledWith({
    data: { status: "revoked" },
    where: { groupId: "hbag_1", id: "inv_dad", status: "pending" },
  });
});

test("revoke rejects a non-owner", async () => {
  const tx = {
    hostedAccountGroup: {
      findUnique: vi.fn().mockResolvedValue(GROUP),
    },
    hostedAccountGroupInvite: {
      updateMany: vi.fn(),
    },
  };

  await expect(
    revokeHostedFamilyInviteTx({
      groupId: "hbag_1",
      inviteId: "inv_dad",
      ownerMemberId: "m_intruder",
      // @ts-expect-error: focused tx double
      tx,
    }),
  ).rejects.toMatchObject({ code: "HOSTED_FAMILY_OWNER_REQUIRED" });
  expect(tx.hostedAccountGroupInvite.updateMany).not.toHaveBeenCalled();
});

test("revoke returns false when no pending invite matches", async () => {
  const tx = {
    hostedAccountGroup: {
      findUnique: vi.fn().mockResolvedValue(GROUP),
    },
    hostedAccountGroupInvite: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const revoked = await revokeHostedFamilyInviteTx({
    groupId: "hbag_1",
    inviteId: "inv_missing",
    ownerMemberId: "m_owner",
    // @ts-expect-error: focused tx double
    tx,
  });

  expect(revoked).toBe(false);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
