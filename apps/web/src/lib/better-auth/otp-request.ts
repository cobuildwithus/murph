import "server-only";
import { APIError } from "better-auth/api";
import { updateHostedMemberPendingActivationTimeZoneIfActivationPending, writeHostedMemberSignupNotificationContextIfPendingTx } from "../hosted-onboarding/hosted-member-store";
import { buildHostedSignupNotificationContext } from "../hosted-onboarding/signup-notification-context";
import { isHostedSignupNotificationEmailConfigured } from "../hosted-onboarding/signup-notification-email-config";
import { getPrisma } from "../prisma";
import { runWithFreshHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { hostedAuthAdapter } from "./adapter";
import { admitHostedAuthOtpRequest, type HostedAuthTransport } from "./admission";
import { assertHostedBetterAuthIssuanceEnabled, requireHostedBetterAuthConfig } from "./config";
import { hostedAuthDelivery } from "./delivery";
import { prepareHostedAuthOtpMember } from "./member";
import { commitHostedAuthOtp } from "./otp-transaction";
import { hostedAuthOtpIdentifier } from "./otp-store";
import { sendHostedAuthOtp } from "./send-otp";
import type { AuthRecord } from "./record";
import { prepareHostedAuthSmsOtp } from "./sms-otp";
import { hostedAuthSmsVerification } from "./twilio-verify";

export async function sendHostedAuthOtpRequest(request: Request, transport: HostedAuthTransport): Promise<void> {
  assertHostedBetterAuthIssuanceEnabled();
  const prisma = getPrisma();
  const { contact } = await admitHostedAuthOtpRequest({ request, transport, operation: "send", prisma });
  await sendHostedAuthOtp({
    ...requireHostedBetterAuthConfig(), prisma, contact, delivery: hostedAuthDelivery(request.signal),
    smsVerification: hostedAuthSmsVerification(request.signal),
  });
}

export async function verifyHostedAuthOtpRequest(request: Request, transport: HostedAuthTransport) {
  assertHostedBetterAuthIssuanceEnabled();
  const prisma = getPrisma();
  const { contact, code, inviteCode, timeZone } = await admitHostedAuthOtpRequest({ request, transport, operation: "verify", prisma });
  if (!code) throw invalidCode();
  // No provider lookup or KMS preparation for an unsolicited/expired code.
  const verification = await hostedAuthAdapter(prisma)({}).findOne<AuthRecord>({
    model: "verification", where: [{ field: "identifier", value: hostedAuthOtpIdentifier(contact) }],
  });
  if (!verification || !(verification.expiresAt instanceof Date) || verification.expiresAt <= new Date()) throw invalidCode();
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareHostedAuthOtpMember({ contact, prisma, inviteCode });
    const otp = contact.kind === "email" ? { kind: "email" as const, address: contact.value, code }
      : { kind: "phone" as const, phoneNumber: contact.value, code, verificationId: await prepareHostedAuthSmsOtp({
        prisma, phoneNumber: contact.value, code, verification: hostedAuthSmsVerification(request.signal),
      }) };
    const context = isHostedSignupNotificationEmailConfigured() ? buildHostedSignupNotificationContext({
      headers: request.headers, occurredAt: new Date(), surface: transport === "browser" ? "website" : "mobile_app", timeZone,
    }) : undefined;
    try {
      return await commitHostedAuthOtp({
        ...requireHostedBetterAuthConfig(), ...prepared, prisma,
        commitMember: async (tx) => {
          await prepared.commitMember(tx);
          if (timeZone) await updateHostedMemberPendingActivationTimeZoneIfActivationPending({ memberId: prepared.memberId, pendingActivationTimeZone: timeZone, prisma: tx });
          if (context) await writeHostedMemberSignupNotificationContextIfPendingTx({ memberId: prepared.memberId, context, preparedControlRoot: prepared.preparedControlRoot, prisma: tx });
        },
        otp,
      });
    } catch (error) {
      if (error instanceof APIError && ["INVALID_OTP", "OTP_NOT_FOUND", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"].includes(error.body?.code ?? "")) throw invalidCode();
      throw error;
    }
  });
}

function invalidCode() {
  return hostedOnboardingError({ code: "AUTH_CODE_INVALID", httpStatus: 400, message: "That code is invalid or expired. Request a new code and try again." });
}
