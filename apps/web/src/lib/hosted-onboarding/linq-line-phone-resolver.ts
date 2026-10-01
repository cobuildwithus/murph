import type { Prisma, PrismaClient } from "@prisma/client";

import { createHostedPhoneLookupKeyReadCandidates } from "./contact-privacy";
import { decryptHostedLinqLinePhoneNumber } from "./linq-line-phone-codec";
import { buildHostedLinqInventoryFreshnessCutoff } from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "./shared";

type HostedLinqLinePhoneResolverClient =
  | PrismaClient
  | Prisma.TransactionClient;

/**
 * Resolves a currently provider-confirmed Murph Linq line from its opaque
 * lookup key. Line phone envelopes use the local contact-privacy keyring, so
 * callers that only need a Murph destination do not need to unwrap a member
 * encryption root.
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

  const inventoryConfirmedAfter = buildHostedLinqInventoryFreshnessCutoff(
    new Date(),
  );
  const line = await input.prisma.hostedLinqLine.findUnique({
    select: {
      phoneNumberEncrypted: true,
      providerInventoryConfirmedAt: true,
      providerPhoneNumberId: true,
    },
    where: { phoneNumberLookupKey },
  });
  const inventoryConfirmedAtMs =
    line?.providerInventoryConfirmedAt?.getTime() ?? Number.NaN;
  if (
    !line?.providerPhoneNumberId
    || !Number.isFinite(inventoryConfirmedAtMs)
    || inventoryConfirmedAtMs < inventoryConfirmedAfter.getTime()
  ) {
    return null;
  }

  const phoneNumber = normalizePhoneNumber(
    decryptHostedLinqLinePhoneNumber(line?.phoneNumberEncrypted),
  );

  return phoneNumber
    && createHostedPhoneLookupKeyReadCandidates(phoneNumber)
      .includes(phoneNumberLookupKey)
    ? phoneNumber
    : null;
}
