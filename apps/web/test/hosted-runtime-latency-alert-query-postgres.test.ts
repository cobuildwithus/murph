import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildHostedRuntimeLatencyHealthQuery,
  readHostedRuntimeLatencyHealth,
} from "@/src/lib/hosted-runtime-latency/alert-monitor";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted runtime latency candidate-query proof requires a local DATABASE_URL.",
  );
}

type PostgreSqlExplainPlanNode = {
  "Actual Rows"?: number;
  "Index Name"?: string;
  "Node Type": string;
  "Relation Name"?: string;
  Plans?: PostgreSqlExplainPlanNode[];
};

describe.skipIf(!runPostgresProof)(
  "hosted runtime latency candidate query",
  () => {
    it("uses indexed candidate branches before exact hydration under dominant stale history", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const now = new Date("2026-08-12T16:00:00.000Z");
      const windowStart = new Date(now.getTime() - 24 * 60 * 60_000);

      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_mailbox_item (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              consumed_at TIMESTAMP(3),
              ai_usage_denied_at TIMESTAMP(3)
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_linq_delivery (
              id TEXT PRIMARY KEY,
              accepted_at TIMESTAMP(3)
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_ingress_latency_trace (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              mailbox_item_id TEXT NOT NULL,
              source TEXT NOT NULL,
              accepted_at TIMESTAMP(3) NOT NULL,
              assistant_input_staged_at TIMESTAMP(3),
              provider_start_at TIMESTAMP(3),
              phase_breakdown_json JSONB,
              provider_request_ordinal INTEGER,
              runtime_attempt_id TEXT,
              linq_delivery_id TEXT
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE UNIQUE INDEX hosted_ingress_latency_trace_mailbox_item_id_key
              ON hosted_ingress_latency_trace(mailbox_item_id)
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE INDEX hosted_ingress_latency_trace_source_accepted_at_idx
              ON hosted_ingress_latency_trace(source, accepted_at)
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE INDEX hosted_ingress_latency_trace_source_staged_at_idx
              ON hosted_ingress_latency_trace(
                source,
                assistant_input_staged_at
              )
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE INDEX hosted_ingress_latency_trace_source_provider_start_at_idx
              ON hosted_ingress_latency_trace(source, provider_start_at)
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE INDEX hosted_ingress_latency_trace_linq_delivery_id_idx
              ON hosted_ingress_latency_trace(linq_delivery_id)
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE INDEX hosted_linq_delivery_accepted_at_id_idx
              ON hosted_linq_delivery(accepted_at, id)
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE INDEX hosted_mailbox_item_consumed_at_id_idx
              ON hosted_mailbox_item(consumed_at, id)
          `);

          const staleAt = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_mailbox_item (
              id,
              user_id,
              consumed_at,
              ai_usage_denied_at
            )
            SELECT
              'stale-mailbox-' || ordinal,
              'stale-member-' || ordinal,
              ${staleAt},
              NULL
            FROM generate_series(1, 50000) AS ordinal
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_linq_delivery (id, accepted_at)
            SELECT
              'stale-delivery-' || ordinal,
              ${staleAt}
            FROM generate_series(1, 50000) AS ordinal
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_ingress_latency_trace (
              id,
              user_id,
              mailbox_item_id,
              source,
              accepted_at,
              assistant_input_staged_at,
              provider_start_at,
              linq_delivery_id
            )
            SELECT
              'stale-trace-' || ordinal,
              'stale-member-' || ordinal,
              'stale-mailbox-' || ordinal,
              'linq',
              ${staleAt},
              ${staleAt},
              ${staleAt},
              'stale-delivery-' || ordinal
            FROM generate_series(1, 50000) AS ordinal
          `);

          const historicalAcceptedAt = new Date(
            now.getTime() - 8 * 24 * 60 * 60_000,
          );
          const historicalDeniedAt = new Date(
            historicalAcceptedAt.getTime() + 60_000,
          );
          const acceptedCandidateAt = new Date(now.getTime() - 2 * 60_000);
          const stagedCandidateAt = new Date(now.getTime() - 5 * 60_000);
          const providerCandidateAt = new Date(now.getTime() - 4 * 60_000);
          const deliveryCandidateAt = new Date(now.getTime() - 3 * 60_000);
          const consumedCandidateAt = new Date(now.getTime() - 2 * 60_000);

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_mailbox_item (
              id,
              user_id,
              consumed_at,
              ai_usage_denied_at
            )
            VALUES
              ('candidate-mailbox-accepted', 'candidate-member-accepted', NULL, NULL),
              ('candidate-mailbox-staged', 'candidate-member-staged', NULL, ${historicalDeniedAt}),
              ('candidate-mailbox-provider', 'candidate-member-provider', NULL, ${historicalDeniedAt}),
              ('candidate-mailbox-delivery', 'candidate-member-delivery', NULL, ${historicalDeniedAt}),
              ('candidate-mailbox-consumed', 'candidate-member-consumed', ${consumedCandidateAt}, ${historicalDeniedAt})
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_linq_delivery (id, accepted_at)
            VALUES ('candidate-delivery', ${deliveryCandidateAt})
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_ingress_latency_trace (
              id,
              user_id,
              mailbox_item_id,
              source,
              accepted_at,
              assistant_input_staged_at,
              provider_start_at,
              linq_delivery_id
            )
            VALUES
              (
                'candidate-trace-accepted',
                'candidate-member-accepted',
                'candidate-mailbox-accepted',
                'linq',
                ${acceptedCandidateAt},
                NULL,
                NULL,
                NULL
              ),
              (
                'candidate-trace-staged',
                'candidate-member-staged',
                'candidate-mailbox-staged',
                'linq',
                ${historicalAcceptedAt},
                ${stagedCandidateAt},
                NULL,
                NULL
              ),
              (
                'candidate-trace-provider',
                'candidate-member-provider',
                'candidate-mailbox-provider',
                'linq',
                ${historicalAcceptedAt},
                NULL,
                ${providerCandidateAt},
                NULL
              ),
              (
                'candidate-trace-delivery',
                'candidate-member-delivery',
                'candidate-mailbox-delivery',
                'linq',
                ${historicalAcceptedAt},
                NULL,
                NULL,
                'candidate-delivery'
              ),
              (
                'candidate-trace-consumed',
                'candidate-member-consumed',
                'candidate-mailbox-consumed',
                'linq',
                ${historicalAcceptedAt},
                NULL,
                NULL,
                NULL
              )
          `);

          await tx.$executeRaw(Prisma.sql`ANALYZE hosted_mailbox_item`);
          await tx.$executeRaw(Prisma.sql`ANALYZE hosted_linq_delivery`);
          await tx.$executeRaw(
            Prisma.sql`ANALYZE hosted_ingress_latency_trace`,
          );

          const query = buildHostedRuntimeLatencyHealthQuery({
            now,
            windowStart,
          });
          const rows = await tx.$queryRaw<Array<{ acceptedAt: Date }>>(query);
          expect(rows).toHaveLength(5);

          await expect(readHostedRuntimeLatencyHealth({
            now,
            prisma: tx,
          })).resolves.toMatchObject({
            invalidChronologyCount: 0,
            oldestUnresolvedAgeMs: 5 * 60_000,
            recentCompletedReplyCount: 1,
            scanTruncated: false,
            unresolvedReplyCount: 3,
          });

          const planRows = await tx.$queryRaw<Array<{
            "QUERY PLAN": unknown;
          }>>(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${query}
          `);
          const plan = readPostgreSqlExplainRoot(planRows);
          const candidateIndexes = [
            "hosted_ingress_latency_trace_source_accepted_at_idx",
            "hosted_ingress_latency_trace_source_staged_at_idx",
            "hosted_ingress_latency_trace_source_provider_start_at_idx",
            "hosted_linq_delivery_accepted_at_id_idx",
            "hosted_mailbox_item_consumed_at_id_idx",
          ];
          for (const indexName of candidateIndexes) {
            const indexNode = findPostgreSqlPlanNode(
              plan,
              (node) => node["Index Name"] === indexName,
            );
            expect(indexNode?.["Actual Rows"]).toBe(1);
          }
          expect(findPostgreSqlPlanNode(
            plan,
            (node) => node["Node Type"] === "Seq Scan"
              && [
                "hosted_ingress_latency_trace",
                "hosted_linq_delivery",
                "hosted_mailbox_item",
              ].includes(node["Relation Name"] ?? ""),
          )).toBeNull();

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_mailbox_item (
              id,
              user_id,
              consumed_at,
              ai_usage_denied_at
            )
            SELECT
              'cap-mailbox-' || ordinal,
              'cap-member-' || ordinal,
              NULL,
              ${historicalDeniedAt}
            FROM generate_series(1, 20001) AS ordinal
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_ingress_latency_trace (
              id,
              user_id,
              mailbox_item_id,
              source,
              accepted_at,
              assistant_input_staged_at
            )
            SELECT
              'cap-trace-' || ordinal,
              'cap-member-' || ordinal,
              'cap-mailbox-' || ordinal,
              'linq',
              ${historicalAcceptedAt},
              ${new Date(now.getTime() - 60_000)}
            FROM generate_series(1, 20001) AS ordinal
          `);
          await expect(readHostedRuntimeLatencyHealth({
            now,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            scanTruncated: true,
          });
        }, {
          maxWait: 5_000,
          timeout: 120_000,
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);

function findPostgreSqlPlanNode(
  root: PostgreSqlExplainPlanNode,
  predicate: (node: PostgreSqlExplainPlanNode) => boolean,
): PostgreSqlExplainPlanNode | null {
  if (predicate(root)) {
    return root;
  }
  for (const child of root.Plans ?? []) {
    const match = findPostgreSqlPlanNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

function readPostgreSqlExplainRoot(
  rows: Array<{ "QUERY PLAN": unknown }>,
): PostgreSqlExplainPlanNode {
  const document = rows[0]?.["QUERY PLAN"];
  if (
    !Array.isArray(document)
    || typeof document[0] !== "object"
    || document[0] === null
    || !("Plan" in document[0])
  ) {
    throw new Error("PostgreSQL EXPLAIN returned an invalid JSON document.");
  }
  return (document[0] as { Plan: PostgreSqlExplainPlanNode }).Plan;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
