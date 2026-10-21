import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { classifyHostedNativeCredential } from "./transport";
import { requireHostedBetterAuthConfig } from "./config";
import { assertHostedAuthSessionCurrentTx, readHostedAuthSession, type HostedAuthSessionProof } from "./session";

export type HostedNativeMemberAuthStage = "identity_token_verification";
export interface HostedNativeMemberAuthOptions {
  runStage?<T>(stage: HostedNativeMemberAuthStage, run: () => Promise<T>): Promise<T>;
}

export type HostedNativeMemberAuth = {
  kind: "better-auth";
  member: HostedMemberCoreState;
  credential: string;
  sessionId: string;
  proof: HostedAuthSessionProof;
};

export async function readHostedNativeMemberAuth(request: Request, prisma: PrismaClient, options: HostedNativeMemberAuthOptions = {}): Promise<HostedNativeMemberAuth> {
  const credential = classifyHostedNativeCredential({
    authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"),
  });
  const runStage = options.runStage ?? ((_stage, run) => run());
  const result = await runStage("identity_token_verification", () => readHostedAuthSession({
    ...requireHostedBetterAuthConfig(), prisma, credential: credential.token, transport: "native",
  }));
  if (!result.session) throw hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." });
  const session = result.session;
  return {
    kind: "better-auth", member: session.member, sessionId: session.sessionId, proof: session.proof, credential: credential.token,
  };
}

// Compare the authenticated session snapshot under the caller's transaction;
// initial admission cannot authorize a credential revoked during external work.
export async function assertHostedNativeMemberAuthCurrentTx(auth: HostedNativeMemberAuth, prisma: Prisma.TransactionClient): Promise<void> {
  await assertHostedAuthSessionCurrentTx({ ...auth, memberId: auth.member.id, prisma });
}
