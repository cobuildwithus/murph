import "server-only";
import { APIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import type { PrismaClient } from "@prisma/client";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { createHostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { createHostedBetterAuth, type HostedAuthDelivery } from "./auth";
import { hostedAuthTransactionAdapter } from "./adapter";
import type { prepareHostedCredentialChange, HostedCredentialChange } from "./credential-change";
import { requireHostedBetterAuthConfig } from "./config";
import { lockHostedAuthOtpTx } from "./otp-store";
import { sendHostedAuthOtp } from "./send-otp";
import { prepareHostedAuthSmsOtp, verifyHostedAuthSmsOtpTx } from "./sms-otp";
import { hostedAuthSmsVerification } from "./twilio-verify";
import { classifyHostedBrowserCredential, hostedAuthCookieName } from "./transport";

type Prepared = Awaited<ReturnType<typeof prepareHostedCredentialChange>>;
type Input = { change: HostedCredentialChange; prepared: Prepared; prisma: PrismaClient; request: Request };
const otpRejections = new Set(["INVALID_OTP", "OTP_NOT_FOUND", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);

function credentialEmailHeaders(request: Request): Headers {
  const classified = classifyHostedBrowserCredential({ authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"), production: process.env.NODE_ENV === "production" });
  if (classified.kind !== "better-auth") throw invalidCode();
  return new Headers({ cookie: `${hostedAuthCookieName(process.env.NODE_ENV === "production")}=${classified.token}` });
}

function otpIdentifier(input: Input): string {
  const { change } = input;
  if (change.operation !== "set" || !change.value || change.method === "telegram") throw invalidCode();
  if (change.method === "phone") return change.value;
  const email = input.prepared.current.user.email;
  if (typeof email !== "string") throw invalidCode();
  // The pinned email plugin binds change-email proof to both old and new email.
  return `change-email-otp-${email}-${change.value}`;
}

export async function sendHostedCredentialOtp(input: Input & { delivery: HostedAuthDelivery }): Promise<void> {
  const identifier = otpIdentifier(input);
  const config = requireHostedBetterAuthConfig();
  if (input.change.method === "phone") {
    const contact = createHostedLinqParticipantContact({ kind: "phone", value: input.change.value });
    if (!contact) throw invalidCode();
    await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(() => input.prepared.lockAndRevalidate(tx)), { maxWait: 5_000, timeout: 10_000 });
    await sendHostedAuthOtp({ ...config, prisma: input.prisma, contact, delivery: input.delivery, smsVerification: hostedAuthSmsVerification(input.request.signal) });
    return;
  }
  const code = await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await lockHostedAuthOtpTx(tx, identifier);
    await input.prepared.lockAndRevalidate(tx);
    await hostedAuthTransactionAdapter(input.prisma, tx, {}).deleteMany({ model: "verification", where: [{ field: "identifier", value: identifier }] });
    let code: string | undefined;
    const auth = createHostedBetterAuth({
      ...config, prisma: input.prisma, credentialEmailChange: true,
      database: (options: BetterAuthOptions) => hostedAuthTransactionAdapter(input.prisma, tx, options),
      delivery: {
        email: async (delivery) => {
          if (delivery.address !== input.change.value || code || !/^\d{6}$/u.test(delivery.code)) throw invalidCode();
          code = delivery.code;
        },
      },
    });
    await auth.api.requestEmailChangeEmailOTP({ headers: credentialEmailHeaders(input.request), body: { newEmail: input.change.value! } });
    if (!code) throw invalidCode();
    return code;
  }), { maxWait: 5_000, timeout: 10_000 });
  await input.delivery.email({ address: input.change.value!, code });
}

export async function commitHostedCredentialOtp(input: Input & { code: string }) {
  const identifier = otpIdentifier(input);
  const verificationId = input.change.method === "phone" ? await prepareHostedAuthSmsOtp({
    prisma: input.prisma, phoneNumber: identifier, code: input.code,
    verification: hostedAuthSmsVerification(input.request.signal),
  }) : null;
  const outcome = await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await lockHostedAuthOtpTx(tx, identifier);
    await input.prepared.lockAndRevalidate(tx);
    let proofReached = false;
    let committed = false;
    let dispatch: Awaited<ReturnType<Prepared["commit"]>> = null;
    const commit = async () => {
      proofReached = true;
      if (committed) throw new Error("Credential proof attempted a second mutation.");
      dispatch = await input.prepared.commit(tx);
      committed = true;
    };
    const auth = createHostedBetterAuth({
      ...requireHostedBetterAuthConfig(), prisma: input.prisma, credentialEmailChange: true,
      database: (options: BetterAuthOptions) => hostedAuthTransactionAdapter(input.prisma, tx, options),
      delivery: { email: async () => { throw invalidCode(); } },
      verifyPhoneOtp: async ({ phoneNumber, code }) => verificationId !== null
        && phoneNumber === identifier && code === input.code
        && verifyHostedAuthSmsOtpTx({
          adapter: hostedAuthTransactionAdapter(input.prisma, tx, {}),
          phoneNumber, code, verificationId,
        }),
      hooks: { user: { update: { before: async (user) => {
        if (input.change.method !== "email" || user.email !== input.change.value || user.emailVerified !== true) throw invalidCode();
        await commit();
      } } } },
    });
    try {
      if (input.change.method === "email") await auth.api.changeEmailEmailOTP({
        headers: credentialEmailHeaders(input.request), body: { newEmail: input.change.value!, otp: input.code },
      });
      else {
        await auth.api.consumePhoneNumberOTP({ body: { phoneNumber: input.change.value!, code: input.code } });
        await commit();
      }
      if (!committed) throw new Error("Credential proof did not commit its canonical change.");
      return { ok: true as const, dispatch };
    } catch (error) {
      if (!proofReached && error instanceof APIError && otpRejections.has(error.body?.code ?? "")) return { ok: false as const };
      throw error;
    }
  }), { maxWait: 5_000, timeout: 10_000 });
  if (!outcome.ok) throw invalidCode();
  return outcome.dispatch;
}

function invalidCode() { return hostedOnboardingError({ code: "AUTH_CODE_INVALID", httpStatus: 400, message: "That code is invalid or expired. Request a new code and try again." }); }
