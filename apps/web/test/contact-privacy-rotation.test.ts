import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backfillHostedContactPrivacyRotation,
} from "../src/lib/hosted-onboarding/contact-privacy-rotation";
import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
  createHostedPrivyUserLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
  createHostedTelegramUserLookupKey,
  createHostedWalletAddressLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";
import { encryptHostedWebNullableString } from "../src/lib/hosted-web/encryption";

describe("hosted contact privacy rotation", () => {
  afterEach(() => {
    restoreHostedContactPrivacyEnv();
  });

  it("reports the planned lookup rewrites and blockers during dry-run rotation", async () => {
    configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: {
        v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
      },
    });

    const legacyPhoneLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedPhoneLookupKey("+15551234567"),
    );
    const legacyPrivyLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedPrivyUserLookupKey("did:privy:user_123"),
    );
    const legacyWalletLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedWalletAddressLookupKey("0xabc"),
    );
    const legacyLinqLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedLinqChatLookupKey("chat_123"),
    );
    const legacyTelegramLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedTelegramUserLookupKey("456"),
    );
    const legacyStripeCustomerLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedStripeCustomerLookupKey("cus_123"),
    );
    const legacyStripeSubscriptionLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedStripeSubscriptionLookupKey("sub_123"),
    );
    const billingRefUpdate = vi.fn();
    const identityUpdate = vi.fn();
    const routingUpdate = vi.fn();

    const prisma = {
      executionOutbox: {
        count: vi.fn().mockResolvedValue(2),
      },
      hostedMemberBillingRef: {
        findMany: vi.fn().mockResolvedValue([
          {
            memberId: "member_123",
            stripeCustomerIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-billing-ref.stripe-customer-id",
              memberId: "member_123",
              value: "cus_123",
            }),
            stripeCustomerLookupKey: legacyStripeCustomerLookupKey,
            stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-billing-ref.stripe-subscription-id",
              memberId: "member_123",
              value: "sub_123",
            }),
            stripeSubscriptionLookupKey: legacyStripeSubscriptionLookupKey,
          },
        ]),
        update: billingRefUpdate,
      },
      hostedMemberIdentity: {
        findMany: vi.fn().mockResolvedValue([
          {
            memberId: "member_123",
            phoneLookupKey: legacyPhoneLookupKey,
            phoneNumberEncrypted: null,
            privyUserIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-identity.privy-user-id",
              memberId: "member_123",
              value: "did:privy:user_123",
            }),
            privyUserLookupKey: legacyPrivyLookupKey,
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumberEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-identity.signup-phone-number",
              memberId: "member_123",
              value: "+15551234567",
            }),
            walletAddressEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-identity.wallet-address",
              memberId: "member_123",
              value: "0xabc",
            }),
            walletAddressLookupKey: legacyWalletLookupKey,
          },
        ]),
        update: identityUpdate,
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([
          {
            linqChatIdEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-routing.linq-chat-id",
              memberId: "member_123",
              value: "chat_123",
            }),
            linqChatLookupKey: legacyLinqLookupKey,
            memberId: "member_123",
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: legacyTelegramLookupKey,
          },
        ]),
        update: routingUpdate,
      },
    } as never;

    const result = await backfillHostedContactPrivacyRotation({
      dryRun: true,
      prisma,
    });

    expect(result.currentVersion).toBe("v2");
    expect(result.outboxBlockingEventCount).toBe(2);
    expect(result.updated).toEqual({
      billingRefs: 1,
      identities: 1,
      routings: 1,
    });
    expect(result.blockers).toEqual([
      {
        currentVersion: "v2",
        field: "telegramUserLookupKey",
        memberId: "member_123",
        owner: "routing",
        reason: "missing_raw_value",
        storedVersion: "v1",
      },
    ]);
    expect(identityUpdate).not.toHaveBeenCalled();
    expect(routingUpdate).not.toHaveBeenCalled();
    expect(billingRefUpdate).not.toHaveBeenCalled();
  });

  it("writes current-version lookup keys when encrypted raw values are available", async () => {
    configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: {
        v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
      },
    });

    const legacyPhoneLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedPhoneLookupKey("+15551234567"),
    );
    const update = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      executionOutbox: {
        count: vi.fn().mockResolvedValue(0),
      },
      hostedMemberBillingRef: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findMany: vi.fn().mockResolvedValue([
          {
            memberId: "member_123",
            phoneLookupKey: legacyPhoneLookupKey,
            phoneNumberEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-identity.phone-number",
              memberId: "member_123",
              value: "+15551234567",
            }),
            privyUserIdEncrypted: null,
            privyUserLookupKey: null,
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumberEncrypted: null,
            walletAddressEncrypted: null,
            walletAddressLookupKey: null,
          },
        ]),
        update,
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    } as never;

    const result = await backfillHostedContactPrivacyRotation({
      dryRun: false,
      prisma,
    });

    expect(result.blockers).toEqual([]);
    expect(update).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      data: {
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v2:/u),
      },
    });
  });

  it("does not partially write when write mode later discovers blockers", async () => {
    configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: {
        v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
      },
    });

    const legacyPhoneLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedPhoneLookupKey("+15551234567"),
    );
    const legacyTelegramLookupKey = withHostedContactPrivacyVersion("v1", () =>
      createHostedTelegramUserLookupKey("456"),
    );
    const identityUpdate = vi.fn().mockResolvedValue(undefined);
    const routingUpdate = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      executionOutbox: {
        count: vi.fn().mockResolvedValue(0),
      },
      hostedMemberBillingRef: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findMany: vi.fn().mockResolvedValue([
          {
            memberId: "member_123",
            phoneLookupKey: legacyPhoneLookupKey,
            phoneNumberEncrypted: encryptHostedWebNullableString({
              field: "hosted-member-identity.phone-number",
              memberId: "member_123",
              value: "+15551234567",
            }),
            privyUserIdEncrypted: null,
            privyUserLookupKey: null,
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumberEncrypted: null,
            walletAddressEncrypted: null,
            walletAddressLookupKey: null,
          },
        ]),
        update: identityUpdate,
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([
          {
            linqChatIdEncrypted: null,
            linqChatLookupKey: null,
            memberId: "member_123",
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: legacyTelegramLookupKey,
          },
        ]),
        update: routingUpdate,
      },
    } as never;

    const result = await backfillHostedContactPrivacyRotation({
      dryRun: false,
      prisma,
    });

    expect(result.updated).toEqual({
      billingRefs: 0,
      identities: 1,
      routings: 0,
    });
    expect(result.blockers).toEqual([
      {
        currentVersion: "v2",
        field: "telegramUserLookupKey",
        memberId: "member_123",
        owner: "routing",
        reason: "missing_raw_value",
        storedVersion: "v1",
      },
    ]);
    expect(identityUpdate).not.toHaveBeenCalled();
    expect(routingUpdate).not.toHaveBeenCalled();
  });
});

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  delete process.env.HOSTED_CONTACT_PRIVACY_KEY;
  clearHostedOnboardingEnvCache();
}

function restoreHostedContactPrivacyEnv(): void {
  delete process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  delete process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  delete process.env.HOSTED_CONTACT_PRIVACY_KEY;
  clearHostedOnboardingEnvCache();
}

function withHostedContactPrivacyVersion<T>(version: string, fn: () => T): T {
  const previousVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = version;
  clearHostedOnboardingEnvCache();

  try {
    return fn();
  } finally {
    if (previousVersion === undefined) {
      delete process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    } else {
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = previousVersion;
    }
    clearHostedOnboardingEnvCache();
  }
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}
