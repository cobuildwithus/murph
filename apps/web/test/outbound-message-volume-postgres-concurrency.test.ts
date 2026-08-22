import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  recordHostedOutboundMessageVolumeReceipt,
} from "@/src/lib/hosted-ops/outbound-message-volume";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The outbound message-volume concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "outbound message-volume PostgreSQL concurrency",
  () => {
    it("returns one stable receipt for simultaneous duplicate callbacks", async () => {
      const fixtureId = randomUUID();
      const authenticatedUserId = `member_message_volume_${fixtureId}`;
      const channel = "telegram" as const;
      const dedupeKey = createHash("sha1")
        .update(`message-volume-${fixtureId}`)
        .digest("hex");
      const receiptLookupKey = createHash("sha256")
        .update(JSON.stringify([
          "murph.hosted-outbound-message-volume-receipt.v1",
          authenticatedUserId,
          channel,
          dedupeKey,
        ]))
        .digest("hex");
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const clients = [firstClient, secondClient, observer];
      const receiptWrites = [
        recordHostedOutboundMessageVolumeReceipt({
          authenticatedUserId,
          channel,
          dedupeKey,
          prisma: firstClient,
        }),
        recordHostedOutboundMessageVolumeReceipt({
          authenticatedUserId,
          channel,
          dedupeKey,
          prisma: secondClient,
        }),
      ] as const;

      try {
        const [first, second] = await Promise.all(receiptWrites);

        expect(first.recordedAt.getTime()).toBe(second.recordedAt.getTime());
        await expect(observer.hostedOutboundMessageVolumeReceipt.count({
          where: { receiptLookupKey },
        })).resolves.toBe(1);
        await expect(observer.hostedOutboundMessageVolumeReceipt.findUnique({
          select: { recordedAt: true },
          where: { receiptLookupKey },
        })).resolves.toEqual({ recordedAt: first.recordedAt });
      } finally {
        await Promise.allSettled(receiptWrites);
        try {
          await observer.hostedOutboundMessageVolumeReceipt.deleteMany({
            where: { receiptLookupKey },
          });
        } finally {
          await disconnectAll(clients);
        }
      }
    }, 15_000);
  },
);

async function disconnectAll(clients: PrismaClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.$disconnect()));
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
