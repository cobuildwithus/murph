import "server-only";
import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import type { Prisma, PrismaClient } from "@prisma/client";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { createHostedBetterAuth } from "./auth";
import { hostedAuthTransactionAdapter } from "./adapter";
import type { HostedAuthUserFields } from "./migration-source";
import { hostedAuthOtpIdentifier, lockHostedAuthOtpTx } from "./otp-store";
import { makeHostedAuthSessionRoomTx } from "./session-limit";
import { verifyHostedAuthSmsOtpTx } from "./sms-otp";

export type HostedAuthOtp = { kind: "email"; address: string; code: string }
  | { kind: "phone"; phoneNumber: string; code: string; verificationId: string };

const OTP_REJECTIONS = new Set(["INVALID_OTP", "OTP_NOT_FOUND", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);

/**
 * The pinned plugins consume a code before invoking user/session hooks. Their
 * standalone endpoints do not make subsequent canonical writes atomic. This
 * private boundary commits email wrong-code budgets, but rolls back consumption
 * and every identity/session write on failures after proof. SMS approval and its
 * attempt reservation are already durable before entry. Callers prepare crypto
 * and provider evidence before entry; the callback contains database work only.
 */
export async function commitHostedAuthOtp(input: {
  baseURL: string;
  secret: string;
  prisma: PrismaClient;
  memberId: string;
  otp: HostedAuthOtp;
  initialUser?: HostedAuthUserFields;
  commitMember(tx: Prisma.TransactionClient): Promise<void>;
}): Promise<{ memberId: string; token: string; headers: Headers }> {
  const outcome = await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await lockHostedAuthOtpTx(tx, hostedAuthOtpIdentifier({
      kind: input.otp.kind, value: input.otp.kind === "email" ? input.otp.address : input.otp.phoneNumber,
    }));
    let proofReached = false;
    let memberCommitted = false;
    const commitMember = async () => {
      proofReached = true;
      if (memberCommitted) return;
      await input.commitMember(tx);
      memberCommitted = true;
    };
    const auth = createHostedBetterAuth({
      baseURL: input.baseURL, secret: input.secret, prisma: input.prisma,
      primaryAuthenticatedAt: new Date(),
      database: (options: BetterAuthOptions) => hostedAuthTransactionAdapter(input.prisma, tx, options),
      generateId: ({ model }) => model === "user" ? input.memberId : randomUUID(),
      delivery: {
        email: async () => { throw new Error("Delivery is forbidden inside login completion."); },
      },
      verifyPhoneOtp: async ({ phoneNumber, code }) => input.otp.kind === "phone"
        && phoneNumber === input.otp.phoneNumber && code === input.otp.code
        && verifyHostedAuthSmsOtpTx({
          adapter: hostedAuthTransactionAdapter(input.prisma, tx, {}),
          phoneNumber, code, verificationId: input.otp.verificationId,
        }),
      hooks: {
        user: {
          create: { before: async () => {
            await commitMember();
            return input.initialUser ? { data: input.initialUser } : undefined;
          } },
          update: { before: async () => { await commitMember(); } },
        },
        session: { create: { before: async (session) => {
          if (session.userId !== input.memberId) throw new Error("Authentication member changed.");
          await commitMember();
          await makeHostedAuthSessionRoomTx(tx, input.memberId);
        } } },
      },
    });
    try {
      // Construct the complete plugin body here. Neither cookies, bearer tokens,
      // account-change switches nor additional user fields enter this operation.
      const result = input.otp.kind === "email"
        ? await auth.api.signInEmailOTP({
            body: { email: input.otp.address, otp: input.otp.code }, returnHeaders: true,
          })
        : await auth.api.verifyPhoneNumber({
            body: { phoneNumber: input.otp.phoneNumber, code: input.otp.code }, returnHeaders: true,
          });
      if (!memberCommitted || result.response.user?.id !== input.memberId || !result.response.token) {
        throw new Error("Authentication completion did not commit the prepared member.");
      }
      return { ok: true as const, token: result.response.token, headers: result.headers };
    } catch (error) {
      if (!proofReached && error instanceof APIError && OTP_REJECTIONS.has(error.body?.code ?? "")) {
        return { ok: false as const, error };
      }
      throw error;
    }
  }), { maxWait: 5_000, timeout: 10_000 });
  if (!outcome.ok) throw outcome.error;
  return { memberId: input.memberId, token: outcome.token, headers: outcome.headers };
}
