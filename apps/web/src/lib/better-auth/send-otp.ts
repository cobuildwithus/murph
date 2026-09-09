import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { BetterAuthOptions } from "better-auth";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import type { HostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { createHostedBetterAuth, type HostedAuthDelivery } from "./auth";
import { hostedAuthAdapter, hostedAuthTransactionAdapter } from "./adapter";
import { hostedAuthOtpIdentifier, lockHostedAuthOtpTx } from "./otp-store";

export async function sendHostedAuthOtp(input: {
  baseURL: string; secret: string; prisma: PrismaClient;
  contact: HostedLinqParticipantContact; delivery: HostedAuthDelivery;
}): Promise<void> {
  const code = await runWithFreshHostedDomainRootUnwrapCache(async () => {
    // The email plugin reads the user after generating the code. Warm that
    // exact protected record before BEGIN; a different owner fails closed.
    if (input.contact.kind === "email") await hostedAuthAdapter(input.prisma)({}).findOne({
      model: "user", where: [{ field: "email", value: input.contact.value }],
    });
    return input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      const identifier = hostedAuthOtpIdentifier(input.contact);
      await lockHostedAuthOtpTx(tx, identifier);
      const adapter = hostedAuthTransactionAdapter(input.prisma, tx, {});
      await adapter.deleteMany({ model: "verification", where: [{ field: "identifier", value: identifier }] });
      let captured: string | undefined;
      const capture = async (kind: "email" | "phone", value: string, candidate: string) => {
        if (kind !== input.contact.kind || value !== input.contact.value || !/^\d{6}$/u.test(candidate) || captured) {
          throw new Error("OTP delivery does not match the admitted request.");
        }
        captured = candidate;
      };
      const auth = createHostedBetterAuth({
        baseURL: input.baseURL, secret: input.secret, prisma: input.prisma,
        database: (options: BetterAuthOptions) => hostedAuthTransactionAdapter(input.prisma, tx, options),
        delivery: {
          email: ({ address, code }) => capture("email", address, code),
          sms: ({ phoneNumber, code }) => capture("phone", phoneNumber, code),
        },
      });
      if (input.contact.kind === "email") await auth.api.sendVerificationOTP({ body: { email: input.contact.value, type: "sign-in" } });
      else await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: input.contact.value } });
      if (!captured) throw new Error("OTP generation did not produce a delivery.");
      return captured;
    }), { maxWait: 5_000, timeout: 10_000 });
  });
  if (input.contact.kind === "email") await input.delivery.email({ address: input.contact.value, code });
  else await input.delivery.sms({ phoneNumber: input.contact.value, code });
}
