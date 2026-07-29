import { randomUUID } from "node:crypto";

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
    it("counts only recent canonical effects and exposes both partial indexes", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID();
      const busyLineKey = `test:linq-recent-load:busy:${suffix}`;
      const quietLineKey = `test:linq-recent-load:quiet:${suffix}`;
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
          data: [busyLineKey, quietLineKey].map((phoneNumberLookupKey) => ({
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

        const indexes = await prisma.$queryRaw<IndexDefinition[]>`
          SELECT
            index_class.relname AS "indexName",
            pg_get_indexdef(index_metadata.indexrelid) AS "indexDefinition",
            index_metadata.indisready AS "isReady",
            index_metadata.indisvalid AS "isValid"
          FROM pg_index AS index_metadata
          INNER JOIN pg_class AS index_class
            ON index_class.oid = index_metadata.indexrelid
          WHERE index_class.relname IN (
            'hosted_linq_delivery_line_accepted_at_idx',
            'hosted_linq_provider_event_line_inbound_received_at_idx'
          )
          ORDER BY index_class.relname
        `;
        expect(indexes).toHaveLength(2);
        expect(indexes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              indexDefinition: expect.stringContaining(
                "USING btree (phone_number_lookup_key, accepted_at)",
              ),
              indexName: "hosted_linq_delivery_line_accepted_at_idx",
              isReady: true,
              isValid: true,
            }),
            expect.objectContaining({
              indexDefinition: expect.stringContaining(
                "USING btree (phone_number_lookup_key, received_at)",
              ),
              indexName:
                "hosted_linq_provider_event_line_inbound_received_at_idx",
              isReady: true,
              isValid: true,
            }),
          ]),
        );
        const deliveryIndex = indexes.find(
          ({ indexName }) =>
            indexName === "hosted_linq_delivery_line_accepted_at_idx",
        );
        expect(deliveryIndex?.indexDefinition).toContain(
          "phone_number_lookup_key IS NOT NULL",
        );
        expect(deliveryIndex?.indexDefinition).toContain(
          "accepted_at IS NOT NULL",
        );
        const inboundIndex = indexes.find(
          ({ indexName }) =>
            indexName
              === "hosted_linq_provider_event_line_inbound_received_at_idx",
        );
        expect(inboundIndex?.indexDefinition).toContain(
          "phone_number_lookup_key IS NOT NULL",
        );
        expect(inboundIndex?.indexDefinition).toContain(
          "event_type = 'message.received'::text",
        );
        expect(inboundIndex?.indexDefinition).toContain(
          "direction = 'inbound'::text",
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
              in: [busyLineKey, quietLineKey],
            },
          },
        });
        await prisma.$disconnect();
      }
    });
  },
);

type IndexDefinition = {
  indexDefinition: string;
  indexName: string;
  isReady: boolean;
  isValid: boolean;
};

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
