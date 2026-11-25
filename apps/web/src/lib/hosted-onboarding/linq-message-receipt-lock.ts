import { Prisma } from "@prisma/client";
import { sha256Hex } from "../primitives";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";

export async function lockHostedLinqProviderReceiptTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">;
}): Promise<void> {
  if (!input.event.deliveryStatus || !input.event.linqMessageId) return;
  await lockHostedLinqMessageReceiptsTx({
    messageIds: [input.event.linqMessageId], prisma: input.prisma,
  });
}

/**
 * Receipts and acceptance must see each other's committed state. Take these
 * locks before member, line or delivery writes, inside the owning transaction.
 * Hash raw provider identity independently of rotating contact-privacy keys.
 */
export async function lockHostedLinqMessageReceiptsTx(input: {
  messageIds: readonly string[];
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">;
}): Promise<void> {
  if (input.messageIds.length > 10) throw new Error("Linq message receipt lock limit exceeded.");
  const keys = [...new Set(input.messageIds.map((id) => id.trim()).filter(Boolean))]
    .map((id) => BigInt.asIntN(64, BigInt(`0x${sha256Hex(`linq-message-receipt:${id}`).slice(0, 16)}`)).toString())
    .sort();
  for (const key of keys) {
    await input.prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${key}::bigint)::text`);
  }
}
