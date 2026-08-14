import type { Prisma, PrismaClient } from "@prisma/client";

import { createHostedPhoneLookupKeyReadCandidates } from "./contact-privacy";
import { decryptHostedLinqLinePhoneNumber } from "./linq-line-phone-codec";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "./shared";

type HostedLinqLinePhoneResolverClient =
  | PrismaClient
  | Prisma.TransactionClient;

/**
 * Resolves a Murph-owned Linq line from its opaque lookup key. Line phone
 * envelopes use the local contact-privacy keyring, so callers that only need
 * a Murph destination do not need to unwrap a member encryption root.
 */
export async function readHostedLinqLinePhoneNumberByLookupKey(input: {
  phoneNumberLookupKey: string | null | undefined;
  prisma: HostedLinqLinePhoneResolverClient;
}): Promise<string | null> {
  const phoneNumberLookupKey = normalizeNullableString(
    input.phoneNumberLookupKey,
  );
  if (!phoneNumberLookupKey) {
    return null;
  }

  const line = await input.prisma.hostedLinqLine.findUnique({
    select: { phoneNumberEncrypted: true },
    where: { phoneNumberLookupKey },
  });
  const phoneNumber = normalizePhoneNumber(
    decryptHostedLinqLinePhoneNumber(line?.phoneNumberEncrypted),
  );

  return phoneNumber
    && createHostedPhoneLookupKeyReadCandidates(phoneNumber)
      .includes(phoneNumberLookupKey)
    ? phoneNumber
    : null;
}
