import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHostedEmailLookupKey } from "../src/lib/hosted-onboarding/contact-privacy";
import {
  bindHostedMemberLinqEmailHandleTx,
  lookupHostedMemberIdentityByLinqEmailHandle,
} from "../src/lib/hosted-onboarding/hosted-member-identity-store";
import { syncHostedMemberVerifiedEmailAuthorization } from "../src/lib/hosted-onboarding/hosted-member-store";
import { ensureHostedMemberForPrivyIdentityResolutionTx } from "../src/lib/hosted-onboarding/member-identity-service";
import {
  buildHostedMemberRoutingPrivateColumns,
  HOSTED_MEMBER_LINQ_PARTICIPANT_CONTACT_FIELD,
} from "../src/lib/hosted-onboarding/member-private-codecs";
import { decryptHostedWebNullableString } from "../src/lib/hosted-web/encryption";

const now = new Date("2026-08-10T12:00:00Z");
const member = {
  id: "member_email_owner",
  billingStatus: HostedBillingStatus.not_started,
  createdAt: now,
  updatedAt: now,
  suspendedAt: null,
};
const address = "handle@example.test";

describe("Linq email identity authority", () => {
  beforeEach(() => setKeys("v1"));
  afterEach(() => vi.unstubAllEnvs());

  it("rejects canonical verified-email writes before any member or email mutation", async () => {
    const prisma = ownerClient();
    await expect(syncHostedMemberVerifiedEmailAuthorization({
      address,
      memberId: "member_other",
      preparedReplyAlias: {
        memberId: "member_other", generation: 0, lookupKey: null,
        verifiedEmailLookupKeys: [key(address)],
      },
      prisma: prisma as never,
      verifiedAt: now,
    })).rejects.toMatchObject({ code: "HOSTED_LINQ_EMAIL_HANDLE_IDENTITY_CONFLICT" });
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.updateMany).not.toHaveBeenCalled();
  });

  it("rejects bearer/live email drift to an existing handle before creating a member", async () => {
    const prisma = ownerClient();
    const principal = { userId: "did:privy:synthetic", phone: null, telegram: null };
    await expect(ensureHostedMemberForPrivyIdentityResolutionTx({
      allowVerifiedEmailRebinding: true,
      authMethod: "email",
      identity: { ...principal, email: { address: "unclaimed@example.test", verifiedAt: 1 } },
      preparedLiveIdentity: { ...principal, email: { address, verifiedAt: 1 } },
      preparedExistingMemberId: null,
      now,
      prisma: prisma as never,
    })).rejects.toMatchObject({ code: "HOSTED_LINQ_EMAIL_HANDLE_IDENTITY_CONFLICT" });
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMemberEmailAuthorization.upsert).not.toHaveBeenCalled();
  });

  it("retains the pending ciphertext context and re-derives identity after prior-key retirement", async () => {
    const prisma = ownerClient();
    const pending = await buildHostedMemberRoutingPrivateColumns({
      memberId: member.id,
      linqChatId: null,
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: address,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      prisma: prisma as never,
    });
    // The SQL migration copies the source on the same member; promotion can
    // then clear pending routing without losing the identity's raw source.
    const encrypted = pending.pendingLinqParticipantContactEncrypted;
    const source = await decryptHostedWebNullableString({
      field: HOSTED_MEMBER_LINQ_PARTICIPANT_CONTACT_FIELD,
      memberId: member.id,
      prisma: prisma as never,
      value: encrypted,
    });
    expect(source).toBe(address);
    if (!source) throw new Error("Expected encrypted participant source.");
    const priorKey = key(address);
    setKeys("v2");
    await bindHostedMemberLinqEmailHandleTx({
      emailAddress: source, lookupKey: key(source), memberId: member.id, prisma: prisma as never,
    });
    expect(prisma.record.linqEmailHandleLookupKey).not.toBe(priorKey);
    expect(prisma.record.linqEmailHandleEncrypted).toEqual(expect.any(String));
    setKeys("v2", false);
    await expect(lookupHostedMemberIdentityByLinqEmailHandle({
      emailAddress: address, prisma: prisma as never, projection: "core",
    })).resolves.toMatchObject({ core: { id: member.id } });
  });
});

function key(value: string): string {
  const result = createHostedEmailLookupKey(value);
  if (!result) throw new Error("Expected synthetic email lookup key.");
  return result;
}

function setKeys(current: "v1" | "v2", retainPrior = true): void {
  const v1 = `v1:${Buffer.alloc(32, 3).toString("base64")}`;
  const v2 = `v2:${Buffer.alloc(32, 4).toString("base64")}`;
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", current === "v1" ? v1 : retainPrior ? `${v2},${v1}` : v2);
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", current);
}

function ownerClient() {
  const record = {
    memberId: member.id, member,
    linqEmailHandleLookupKey: key(address),
    linqEmailHandleEncrypted: null as string | null,
  };
  return {
    record,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedAccountDeletionCleanup: { findFirst: vi.fn().mockResolvedValue(null) },
    hostedMember: { create: vi.fn() },
    hostedMemberEmailAuthorization: {
      findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(),
    },
    hostedMemberIdentity: {
      findMany: vi.fn(async ({ where }: { where: { linqEmailHandleLookupKey?: { in: string[] } } }) =>
        where.linqEmailHandleLookupKey?.in.includes(record.linqEmailHandleLookupKey) ? [record] : []),
      upsert: vi.fn(),
      updateMany: vi.fn(async ({ data }: {
        data: { linqEmailHandleLookupKey: string; linqEmailHandleEncrypted: string | null };
      }) => {
        Object.assign(record, data);
        return { count: 1 };
      }),
    },
  };
}
