import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { BetterAuthOptions } from "better-auth";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import type { HostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { createHostedBetterAuth, type HostedAuthDelivery } from "./auth";
import { hostedAuthAdapter, hostedAuthTransactionAdapter } from "./adapter";
import { hostedAuthOtpIdentifier, lockHostedAuthOtpTx } from "./otp-store";
import { sendHostedAuthSmsOtp } from "./sms-otp";
import { hostedAuthSmsVerification, type HostedAuthSmsVerification } from "./twilio-verify";

export async function sendHostedAuthOtp(input: {
  baseURL: string; secret: string; prisma: PrismaClient;
  contact: HostedLinqParticipantContact; delivery: HostedAuthDelivery;
  smsVerification?: HostedAuthSmsVerification;
}): Promise<void> {
  if (input.contact.kind === "phone") {
    return sendHostedAuthSmsOtp({
      prisma: input.prisma, phoneNumber: input.contact.value,
      verification: input.smsVerification ?? hostedAuthSmsVerification(),
    });
  }
  const code = await runWithFreshHostedDomainRootUnwrapCache(async () => {
    // The email plugin reads the user after generating the code. Warm that
    // exact protected record before BEGIN; a different owner fails closed.
    await hostedAuthAdapter(input.prisma)({}).findOne({
      model: "user", where: [{ field: "email", value: input.contact.value }],
    });
    return input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      const identifier = hostedAuthOtpIdentifier(input.contact);
      await lockHostedAuthOtpTx(tx, identifier);
      const adapter = hostedAuthTransactionAdapter(input.prisma, tx, {});
      await adapter.deleteMany({ model: "verification", where: [{ field: "identifier", value: identifier }] });
      let captured: string | undefined;
      const capture = async (value: string, candidate: string) => {
        if (value !== input.contact.value || !/^\d{6}$/u.test(candidate) || captured) {
          throw new Error("OTP delivery does not match the admitted request.");
        }
        captured = candidate;
      };
      const auth = createHostedBetterAuth({
        baseURL: input.baseURL, secret: input.secret, prisma: input.prisma,
        database: (options: BetterAuthOptions) => hostedAuthTransactionAdapter(input.prisma, tx, options),
        delivery: {
          email: ({ address, code }) => capture(address, code),
        },
      });
      await auth.api.sendVerificationOTP({ body: { email: input.contact.value, type: "sign-in" } });
      if (!captured) throw new Error("OTP generation did not produce a delivery.");
      return captured;
    }), { maxWait: 5_000, timeout: 10_000 });
  });
  await input.delivery.email({ address: input.contact.value, code });
}
