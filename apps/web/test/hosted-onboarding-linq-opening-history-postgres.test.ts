import { describe, expect, it } from "vitest";

import { readHostedLinqOpeningDeliveries } from "@/src/lib/hosted-onboarding/linq-instant-first-turn";
import { createHostedLinqChatLookupKeyReadCandidates } from "@/src/lib/hosted-onboarding/contact-privacy";
import { createHostedLinqDeliverySourceRefLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Opening history proof requires local PostgreSQL.");
}

describe.skipIf(!enabled)("Linq opening history PostgreSQL proof", () => {
  it("ignores a prior account while retaining pending current claims and the three-row bound", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    const request = {
      eventId: "synthetic-current-inbound", participantContactKind: "phone" as const,
      partTypes: ["text"], service: "imessage" as const, text: "Ready", textWasTruncated: false,
    };
    const chatKey = createHostedLinqChatLookupKeyReadCandidates("synthetic-chat")[0]!;
    try {
      await prisma.$transaction(async (tx) => {
        // Connection-local fixtures execute the production query without touching
        // shared members, deliveries, credentials, or an application schema.
        await tx.$executeRawUnsafe("CREATE TEMP TABLE hosted_member (id TEXT PRIMARY KEY, created_at TIMESTAMP NOT NULL)");
        await tx.$executeRawUnsafe("CREATE TEMP TABLE hosted_linq_delivery (linq_chat_lookup_key TEXT, source_ref TEXT, template TEXT, attempted_at TIMESTAMP, accepted_at TIMESTAMP, message_lookup_key TEXT)");
        await tx.$executeRawUnsafe("SET LOCAL search_path TO pg_temp");
        await tx.$executeRaw`INSERT INTO hosted_member VALUES ('synthetic-member', '2030-01-02T00:00:00Z')`;
        const insert = async (source: string | null, attemptedAt: Date, acceptedAt: Date | null, messageKey: string | null) => {
          await tx.$executeRaw`INSERT INTO hosted_linq_delivery VALUES
            (${chatKey}, ${source}, 'instant_first_turn_v1', ${attemptedAt}, ${acceptedAt}, ${messageKey})`;
        };
        const read = () => readHostedLinqOpeningDeliveries({
          linqChatId: "synthetic-chat", memberId: "synthetic-member", prisma: tx, request,
        });
        const old = new Date("2030-01-01T00:00:00Z");
        const current = new Date("2030-01-02T00:00:01Z");
        await insert("old-welcome", old, old, "old-message");
        await insert("old-question", old, old, "old-question-message");
        await insert("current-welcome", current, current, "current-message");
        // Exact inbound replay must not consume its own allowance.
        await insert(createHostedLinqDeliverySourceRefLookupKey(request.eventId), current, null, null);
        expect(await read()).toEqual([{ acceptedAt: current, messageLookupKey: "current-message" }]);
        // Include the exact lifecycle boundary, and pending claims without an acceptance.
        await insert("concurrent-question", new Date("2030-01-02T00:00:00Z"), null, null);
        expect(await read()).toHaveLength(2);
        await insert("third-current-claim", current, null, null);
        expect(await read()).toHaveLength(3);
        await insert("fourth-current-claim", current, null, null);
        expect(await read()).toHaveLength(3);
        await tx.$executeRaw`DELETE FROM hosted_member WHERE id = 'synthetic-member'`;
        expect(await read()).toEqual([]);
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
