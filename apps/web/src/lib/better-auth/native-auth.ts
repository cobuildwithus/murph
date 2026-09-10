import "server-only";
import type { HostedAuthRecord, HostedMemberIdentity, Prisma, PrismaClient } from "@prisma/client";
import { readHostedMemberCoreState, type HostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { assertHostedPrivyAccountDeletionNotPending } from "../hosted-onboarding/member-identity-service";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { classifyHostedNativeCredential } from "./transport";
import { requireHostedBetterAuthConfig } from "./config";
import { resolveHostedLegacyNativeMember, type HostedNativeMemberAuthOptions } from "./legacy-native";
export type { HostedNativeMemberAuthOptions, HostedNativeMemberAuthStage } from "./legacy-native";
import { assertHostedAuthSessionCurrentTx, readHostedAuthSession, type HostedAuthSessionProof } from "./session";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";

export type HostedNativeMemberAuth = { member: HostedMemberCoreState } & (
  | { kind: "better-auth"; credential: string; sessionId: string; proof: HostedAuthSessionProof }
  | { kind: "legacy"; privyUserId: string; expiresAt: Date; identityRow: HostedMemberIdentity; userRow: HostedAuthRecord | null }
);

export async function readHostedNativeMemberAuth(request: Request, prisma: PrismaClient, options: HostedNativeMemberAuthOptions = {}): Promise<HostedNativeMemberAuth> {
  const credential = classifyHostedNativeCredential({
    authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"),
    legacyAllowed: process.env.HOSTED_PRIVY_NATIVE_ENABLED !== "false",
  });
  const runStage = options.runStage ?? ((_stage, run) => run());
  if (credential.kind === "legacy") {
    const legacy = await resolveHostedLegacyNativeMember({ token: credential.token, prisma }, options);
    return { ...legacy, kind: "legacy" };
  }
  const result = await runStage("identity_token_verification", () => readHostedAuthSession({
    ...requireHostedBetterAuthConfig(), prisma, credential: credential.token, transport: "native",
  }));
  if (!result.session) throw authRequired();
  const session = result.session;
  return runStage("member_lookup", async () => ({
    kind: "better-auth", member: session.member, sessionId: session.sessionId, proof: session.proof, credential: credential.token,
  }));
}

// Reuse at authority-issuing commit boundaries; a valid initial read is not a
// substitute for checking a session revoked while external work was in flight.
export async function assertHostedNativeMemberAuthCurrentTx(auth: HostedNativeMemberAuth, prisma: Prisma.TransactionClient): Promise<void> {
  if (auth.kind === "better-auth") {
    await assertHostedAuthSessionCurrentTx({ ...auth, memberId: auth.member.id, prisma });
    return;
  }
  await lockHostedMemberRow(prisma, auth.member.id);
  if (process.env.HOSTED_PRIVY_NATIVE_ENABLED === "false" || auth.expiresAt <= new Date()) throw authRequired();
  const [identity, member] = await Promise.all([
    prisma.hostedMemberIdentity.findUnique({ where: { memberId: auth.member.id } }),
    readHostedMemberCoreState({ memberId: auth.member.id, prisma }),
  ]);
  if (!member || JSON.stringify(identity) !== JSON.stringify(auth.identityRow)) throw authRequired();
  assertHostedMemberNotSuspended(member);
  await assertHostedPrivyAccountDeletionNotPending({ prisma, privyUserId: auth.privyUserId });
  const row = await prisma.hostedAuthRecord.findUnique({ where: { model_id: { model: "user", id: auth.member.id } } });
  if (JSON.stringify(row) !== JSON.stringify(auth.userRow)) throw authRequired();
}

function authRequired() { return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." }); }
