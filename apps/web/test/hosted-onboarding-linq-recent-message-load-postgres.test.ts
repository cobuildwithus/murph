import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildHostedLinqRecentMessageEffectCountsQuery,
  readHostedLinqRecentMessageEffectCountsTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error(
    "The Hosted Linq recent message load proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "Hosted Linq recent message load PostgreSQL proof",
  () => {
    it("counts only recent canonical effects and uses both partial indexes", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID();
      const busyLineKey = `test:linq-recent-load:busy:${suffix}`;
      const quietLineKey = `test:linq-recent-load:quiet:${suffix}`;
      const noiseLineKey = `test:linq-recent-load:noise:${suffix}`;
      const deliveryPrefix = `test:hld:linq-recent-load:${suffix}:`;
      const eventPrefix = `test:linq-recent-load:event:${suffix}:`;
      const now = at("2026-07-29T15:00:00.000Z");
      const cutoff = at("2026-07-22T15:00:00.000Z");

      const delivery = (
        label: string,
        lineKey: string | null,
        acceptedAt: Date | null,
      ) => ({
        acceptedAt,
        attemptedAt: at("2026-07-29T13:59:59.000Z"),
        id: `${deliveryPrefix}${label}`,
        phoneNumberLookupKey: lineKey,
        source: "test_recent_message_load",
        status: acceptedAt ? "accepted" : "failed",
      });
      const event = (
        label: string,
        lineKey: string | null,
        direction: string,
        eventType: string,
        receivedAt: Date,
      ) => ({
        direction,
        eventId: `${eventPrefix}${label}`,
        eventType,
        phoneNumberLookupKey: lineKey,
        providerCreatedAt: receivedAt,
        receivedAt,
      });

      try {
        await prisma.hostedLinqLine.createMany({
          data: [busyLineKey, quietLineKey, noiseLineKey].map((phoneNumberLookupKey) => ({
            phoneNumberHint: "*** test",
            phoneNumberLookupKey,
            source: "test",
          })),
        });
        await prisma.hostedLinqDelivery.createMany({
          data: [
            delivery("busy-recent", busyLineKey, at("2026-07-29T14:00:00.000Z")),
            delivery("quiet-cutoff", quietLineKey, cutoff),
            delivery("quiet-now", quietLineKey, now),
            delivery("old", busyLineKey, at("2026-07-22T14:59:59.999Z")),
            delivery("future", busyLineKey, at("2026-07-29T15:00:00.001Z")),
            delivery("failed", busyLineKey, null),
            delivery("unbound", null, at("2026-07-29T14:00:00.000Z")),
            ...Array.from({ length: 512 }, (_, index) => (
              delivery(
                `noise-recent-${index}`,
                noiseLineKey,
                at("2026-07-29T14:00:00.000Z"),
              )
            )),
          ],
        });
        await prisma.hostedLinqProviderEvent.createMany({
          data: [
            event("busy-recent", busyLineKey, "inbound", "message.received", at("2026-07-29T14:30:00.000Z")),
            event("quiet-cutoff", quietLineKey, "inbound", "message.received", cutoff),
            event("echo", busyLineKey, "outbound", "message.received", at("2026-07-29T14:30:00.000Z")),
            event("reaction", busyLineKey, "inbound", "reaction.added", at("2026-07-29T14:30:00.000Z")),
            event("old", busyLineKey, "inbound", "message.received", at("2026-07-22T14:59:59.999Z")),
            event("future", busyLineKey, "inbound", "message.received", at("2026-07-29T15:00:00.001Z")),
            event("unbound", null, "inbound", "message.received", at("2026-07-29T14:30:00.000Z")),
            ...Array.from({ length: 512 }, (_, index) => (
              event(
                `noise-recent-${index}`,
                noiseLineKey,
                "inbound",
                "message.received",
                at("2026-07-29T14:00:00.000Z"),
              )
            )),
          ],
        });

        await expect(
          readHostedLinqRecentMessageEffectCountsTx({
            lineLookupKeys: [busyLineKey, quietLineKey],
            now,
            prisma,
          }),
        ).resolves.toEqual(new Map([
          [busyLineKey, 2],
          [quietLineKey, 3],
        ]));
        await prisma.$executeRaw`ANALYZE "hosted_linq_delivery"`;
        await prisma.$executeRaw`ANALYZE "hosted_linq_provider_event"`;
        const queryPlan = await prisma.$queryRaw<Array<{ "QUERY PLAN": unknown }>>(
          Prisma.sql`
            EXPLAIN (FORMAT JSON, COSTS OFF)
            ${buildHostedLinqRecentMessageEffectCountsQuery({
              lineLookupKeys: [busyLineKey, quietLineKey],
              now,
            })}
          `,
        );
        const serializedPlan = JSON.stringify(queryPlan);
        expect(serializedPlan).toContain(
          "hosted_linq_delivery_line_accepted_at_idx",
        );
        expect(serializedPlan).toContain(
          "hosted_linq_provider_event_line_inbound_received_at_idx",
        );
      } finally {
        await prisma.hostedLinqProviderEvent.deleteMany({
          where: { eventId: { startsWith: eventPrefix } },
        });
        await prisma.hostedLinqDelivery.deleteMany({
          where: { id: { startsWith: deliveryPrefix } },
        });
        await prisma.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: {
              in: [busyLineKey, quietLineKey, noiseLineKey],
            },
          },
        });
        await prisma.$disconnect();
      }
    });
  },
);

function at(value: string): Date {
  return new Date(value);
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(parsed.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
