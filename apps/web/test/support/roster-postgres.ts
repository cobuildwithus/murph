import { randomInt } from "node:crypto";
import { localCryptoEnv } from "./local-crypto-env";
import { vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { encryptHostedLinqLinePhoneNumber } from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import { createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { buildHostedThreadDeliveryRoute, sealHostedThreadDeliveryRoute } from "@/src/lib/hosted-routing/thread-delivery-route";

export function localRosterCrypto() {
  for (const [key, value] of Object.entries({
    ...localCryptoEnv(),
    MURPH_GAME_ENABLED: "true",
    HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODE: "off",
    HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: "",
    HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://www.withmurph.ai",
    LINQ_WEBHOOK_SECRET: "synthetic-roster-secret", LINQ_API_TOKEN: "synthetic-token",
  })) vi.stubEnv(key, value);
}

export const syntheticPhone = () => `+1555${randomInt(1_000_000, 9_999_999)}`;

export async function rosterPhoneIdentity(prisma: PrismaClient, memberId: string, phoneNumber: string, verifiedAt = new Date()) {
  await upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phoneNumber), memberId, prisma,
    phoneNumberVerifiedAt: verifiedAt, signupPhoneNumber: null });
}

export async function rosterRoute(prisma: PrismaClient, room: string, chatId: string, line: string) {
  const accountLookupKey = createHostedPhoneLookupKey(line)!;
  await prisma.hostedLinqLine.create({ data: { phoneNumberLookupKey: accountLookupKey, phoneNumberHint: "synthetic", phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(line),
    configuredAt: new Date(), healthStatus: "healthy", egressPolicy: "enabled", providerReputationStatus: "HEALTHY", providerServiceStatus: "ACTIVE" } });
  await prisma.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: room, accountLookupKey,
    threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: chatId })!,
    threadLookupKey: createHostedExternalThreadLookupKey({ channel: "linq", threadId: chatId, accountLookupKey })!,
    deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({ containerMemberId: room, prisma,
      route: buildHostedThreadDeliveryRoute({ channel: "linq", threadId: chatId, accountLookupKey }) }),
  } });
  return accountLookupKey;
}
