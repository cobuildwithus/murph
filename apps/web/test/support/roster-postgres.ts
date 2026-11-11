import { generateKeyPairSync, randomInt } from "node:crypto";
import { vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { encryptHostedLinqLinePhoneNumber } from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import { createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { buildHostedThreadDeliveryRoute, sealHostedThreadDeliveryRoute } from "@/src/lib/hosted-routing/thread-delivery-route";

export function localRosterCrypto() {
  const authority = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "jwk" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const automation = generateKeyPairSync("ec", { namedCurve: "prime256v1", publicKeyEncoding: { format: "jwk" }, privateKeyEncoding: { format: "jwk" } });
  for (const [key, value] of Object.entries({
    HOSTED_CRYPTO_ENV: "test", HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/example/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authority.publicKey,
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(authority.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME: "projects/example/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "synthetic-automation",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify(automation.publicKey),
    MURPH_GAME_ENABLED: "true", MURPH_GAME_MEMBER_ALLOWLIST: "",
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
