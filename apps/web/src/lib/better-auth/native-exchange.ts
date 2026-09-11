import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { assertHostedPrivyAccountDeletionNotPending } from "../hosted-onboarding/member-identity-service";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { resolveHostedLegacyNativeMember } from "./legacy-native";
import { importHostedAuthMember } from "./import";
import { openAuthRecord, sealAuthRecord } from "./record-crypto";
import { serializeHostedNativeSessionToken } from "./transport";
import { makeHostedAuthSessionRoomTx } from "./session-limit";

// Only the native bridge calls this after explicit legacy transport admission.
// A valid existing principal selects its member; no JWT contact claim creates
// or links an identity. The independent importer may reconcile that SAME member.
export async function exchangeHostedLegacyNativeSession(input: { token: string; prisma: PrismaClient }) {
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const legacy = await resolveHostedLegacyNativeMember(input);
    const legacyExpiresAt = legacy.expiresAt;
    const memberId = legacy.member.id;
    const imported = await importHostedAuthMember({ memberId, prisma: input.prisma });
    if (imported === "unbound") throw authRequired();
    const root = await prepareHostedDomainRootForWeb({
      domain: "control", prepareMissing: false, prisma: input.prisma, userId: memberId, reason: "hosted-auth.native-exchange",
    });
    const now = new Date(); const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const token = Array.from({ length: 32 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const row = await sealAuthRecord("session", {
      id: randomUUID(), userId: memberId, token, expiresAt, createdAt: now, updatedAt: now,
      primaryAuthenticatedAt: null, ipAddress: null, userAgent: null,
    }, input.prisma);
    await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await lockHostedMemberRow(tx, memberId, { timeoutMs: 5_000 });
      const member = await readHostedMemberCoreState({ memberId, prisma: tx });
      if (!member || legacyExpiresAt <= new Date()) throw authRequired();
      assertHostedMemberNotSuspended(member);
      await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
      const identity = await readHostedMemberIdentity({ memberId, prisma: tx });
      if (identity?.privyUserId !== legacy.privyUserId) throw authRequired();
      await assertHostedPrivyAccountDeletionNotPending({ prisma: tx, privyUserId: legacy.privyUserId });
      const userRow = await tx.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: memberId } } });
      if (!userRow || (await openAuthRecord(userRow, tx)).credentialsChangedAt !== null) throw authRequired();
      await makeHostedAuthSessionRoomTx(tx, memberId);
      await tx.hostedAuthRecord.create({ data: row });
    }), { maxWait: 5_000, timeout: 10_000 });
    return { memberId, token: serializeHostedNativeSessionToken(token), expiresAt };
  });
}

function authRequired() { return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in again to continue." }); }
