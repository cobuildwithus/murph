import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
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
      const now = new Date("2026-07-29T15:00:00.000Z");
      const cutoff = new Date("2026-07-22T15:00:00.000Z");
      const deliveryIds: string[] = [];
      const eventIds: string[] = [];

      try {
        await prisma.hostedLinqLine.createMany({
          data: [
            {
              phoneNumberHint: "*** test",
              phoneNumberLookupKey: busyLineKey,
              source: "test",
            },
            {
              phoneNumberHint: "*** test",
              phoneNumberLookupKey: quietLineKey,
              source: "test",
            },
          ],
        });

        const deliveries = [
          {
            acceptedAt: new Date("2026-07-29T14:00:00.000Z"),
            lineKey: busyLineKey,
            status: "accepted",
          },
          {
            acceptedAt: cutoff,
            lineKey: quietLineKey,
            status: "accepted",
          },
          {
            acceptedAt: now,
            lineKey: quietLineKey,
            status: "accepted",
          },
          {
            acceptedAt: new Date("2026-07-22T14:59:59.999Z"),
            lineKey: busyLineKey,
            status: "accepted",
          },
          {
            acceptedAt: new Date("2026-07-29T15:00:00.001Z"),
            lineKey: busyLineKey,
            status: "accepted",
          },
          {
            acceptedAt: null,
            lineKey: busyLineKey,
            status: "failed",
          },
          {
            acceptedAt: new Date("2026-07-29T14:00:00.000Z"),
            lineKey: null,
            status: "accepted",
          },
        ].map((delivery) => ({
          ...delivery,
          id: `test_hld_recent_load_${randomUUID()}`,
        }));
        deliveryIds.push(...deliveries.map((delivery) => delivery.id));
        await prisma.hostedLinqDelivery.createMany({
          data: deliveries.map((delivery) => ({
            acceptedAt: delivery.acceptedAt,
            attemptedAt: new Date("2026-07-29T13:59:59.000Z"),
            id: delivery.id,
            phoneNumberLookupKey: delivery.lineKey,
            source: "test_recent_message_load",
            status: delivery.status,
          })),
        });

        const providerEvents = [
          {
            direction: "inbound",
            eventType: "message.received",
            lineKey: busyLineKey,
            receivedAt: new Date("2026-07-29T14:30:00.000Z"),
          },
          {
            direction: "inbound",
            eventType: "message.received",
            lineKey: quietLineKey,
            receivedAt: cutoff,
          },
          {
            direction: "outbound",
            eventType: "message.received",
            lineKey: busyLineKey,
            receivedAt: new Date("2026-07-29T14:30:00.000Z"),
          },
          {
            direction: "inbound",
            eventType: "reaction.added",
            lineKey: busyLineKey,
            receivedAt: new Date("2026-07-29T14:30:00.000Z"),
          },
          {
            direction: "inbound",
            eventType: "message.received",
            lineKey: busyLineKey,
            receivedAt: new Date("2026-07-22T14:59:59.999Z"),
          },
          {
            direction: "inbound",
            eventType: "message.received",
            lineKey: busyLineKey,
            receivedAt: new Date("2026-07-29T15:00:00.001Z"),
          },
          {
            direction: "inbound",
            eventType: "message.received",
            lineKey: null,
            receivedAt: new Date("2026-07-29T14:30:00.000Z"),
          },
        ].map((event) => ({
          ...event,
          eventId: `test:linq-recent-load:event:${randomUUID()}`,
        }));
        eventIds.push(...providerEvents.map((event) => event.eventId));
        await prisma.hostedLinqProviderEvent.createMany({
          data: providerEvents.map((event) => ({
            direction: event.direction,
            eventId: event.eventId,
            eventType: event.eventType,
            phoneNumberLookupKey: event.lineKey,
            providerCreatedAt: event.receivedAt,
            receivedAt: event.receivedAt,
          })),
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

        const plan = await explainRecentMessageLoadQuery({
          cutoff,
          lineLookupKeys: [busyLineKey, quietLineKey],
          now,
          prisma,
        });
        expect(plan).toContain(
          "hosted_linq_delivery_line_accepted_at_idx",
        );
        expect(plan).toContain(
          "hosted_linq_provider_event_line_inbound_received_at_idx",
        );
      } finally {
        await prisma.hostedLinqProviderEvent.deleteMany({
          where: { eventId: { in: eventIds } },
        });
        await prisma.hostedLinqDelivery.deleteMany({
          where: { id: { in: deliveryIds } },
        });
        await prisma.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: {
              in: [busyLineKey, quietLineKey],
            },
          },
        });
        await prisma.$disconnect();
      }
    });
  },
);

async function explainRecentMessageLoadQuery(input: {
  cutoff: Date;
  lineLookupKeys: readonly [string, string];
  now: Date;
  prisma: PrismaClient;
}): Promise<string> {
  return input.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('enable_seqscan', 'off', true)
    `;
    const rows = await tx.$queryRaw<Array<{ "QUERY PLAN": unknown }>>`
      EXPLAIN (FORMAT JSON, COSTS OFF)
      WITH recent_line_counts AS (
        SELECT
          "phone_number_lookup_key",
          COUNT(*)::bigint AS "message_effect_count"
        FROM "hosted_linq_delivery"
        WHERE "phone_number_lookup_key" IN (
          ${input.lineLookupKeys[0]},
          ${input.lineLookupKeys[1]}
        )
          AND "accepted_at" >= ${input.cutoff}
          AND "accepted_at" <= ${input.now}
        GROUP BY "phone_number_lookup_key"

        UNION ALL

        SELECT
          "phone_number_lookup_key",
          COUNT(*)::bigint AS "message_effect_count"
        FROM "hosted_linq_provider_event"
        WHERE "phone_number_lookup_key" IN (
          ${input.lineLookupKeys[0]},
          ${input.lineLookupKeys[1]}
        )
          AND "event_type" = 'message.received'
          AND "direction" = 'inbound'
          AND "received_at" >= ${input.cutoff}
          AND "received_at" <= ${input.now}
        GROUP BY "phone_number_lookup_key"
      )
      SELECT
        "phone_number_lookup_key",
        SUM("message_effect_count")::bigint
      FROM recent_line_counts
      GROUP BY "phone_number_lookup_key"
    `;
    return JSON.stringify(rows[0]?.["QUERY PLAN"] ?? null);
  });
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
