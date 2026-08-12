import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  hasHostedLinqInviteSignupLiveDeliveryTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  buildHostedLinqInviteSignupEffectId,
} from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  ingestHostedLinqProviderEventTx,
} from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import {
  parseHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  parseHostedLinqWebhookEvent,
} from "@/src/lib/hosted-onboarding/linq";
import { createPrismaClient } from "@/src/lib/prisma";

const LIVE_INVITE_SOURCE_REF_INDEX =
  "hosted_linq_delivery_live_invite_source_ref_pattern_idx";
const LIVE_INVITE_HISTORY_COUNT = 20_000;
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Hosted Linq live-invite proof requires a local DATABASE_URL.",
  );
}

type PostgreSqlExplainPlanNode = {
  "Actual Rows"?: number;
  "Index Cond"?: string;
  "Index Name"?: string;
  "Node Type": string;
  "Relation Name"?: string;
  Plans?: PostgreSqlExplainPlanNode[];
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

describe.skipIf(!runPostgresProof)(
  "Hosted Linq live invite source-ref PostgreSQL proof",
  () => {
    it("uses the partial pattern index before bounded existence under dominant unrelated history", async () => {
      const suffix = randomUUID();
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const planClient = new pg.Client({ connectionString: databaseUrl });
      const fixtureSource = `test_live_invite_plan:${suffix}`;
      const memberId = `member_live_invite_plan_${suffix}`;
      const dayUtc = "2026-08-01T00:00:00.000Z";
      const exactDigest = "a".repeat(32);
      const otherDigest = "b".repeat(32);
      const exactEffectId = buildHostedLinqInviteSignupEffectId({
        memberId,
        occurredAt: dayUtc,
        sourceEventDigest: exactDigest,
      });
      const otherEffectId = buildHostedLinqInviteSignupEffectId({
        memberId,
        occurredAt: dayUtc,
        sourceEventDigest: otherDigest,
      });
      const sourceRefPrefix = buildHostedLinqInviteSignupEffectId({
        memberId,
        occurredAt: dayUtc,
      });
      const exactSourceRefs = Array.from({ length: 5 }, (_, index) =>
        buildHostedLinqInviteSignupEffectId({
          attempt: index + 1,
          memberId,
          occurredAt: dayUtc,
          sourceEventDigest: exactDigest,
        })
      );
      const sourceRefLikePattern = `${escapeLikePrefix(sourceRefPrefix)}%`;
      const malformedAttemptId = `hld_live_invite_plan_${suffix}_attempt_6`;
      const otherIdentityId = `hld_live_invite_plan_${suffix}_other_identity`;

      await planClient.connect();
      try {
        const indexRows = await planClient.query<{
          indexdef: string;
          indisvalid: boolean;
        }>({
          text: `
            SELECT
              pg_get_indexdef(index_row.indexrelid) AS indexdef,
              index_row.indisvalid
            FROM pg_index AS index_row
            JOIN pg_class AS index_class
              ON index_class.oid = index_row.indexrelid
            JOIN pg_namespace AS index_namespace
              ON index_namespace.oid = index_class.relnamespace
            WHERE index_class.relname = $1
              AND index_namespace.nspname = current_schema()
          `,
          values: [LIVE_INVITE_SOURCE_REF_INDEX],
        });
        expect(indexRows.rows).toEqual([
          expect.objectContaining({
            indexdef: expect.stringContaining("text_pattern_ops"),
            indisvalid: true,
          }),
        ]);

        await planClient.query({
          text: `
            INSERT INTO "hosted_linq_delivery" (
              "id",
              "source",
              "source_ref",
              "template",
              "status",
              "attempted_at",
              "created_at",
              "updated_at"
            )
            SELECT
              $1 || ':history:' || history.ordinal::text,
              $2,
              'linq-invite-signup:history-' || $3 || '-'
                || history.ordinal::text
                || ':2026-08-01T00:00:00.000Z:e'
                || md5(history.ordinal::text),
              CASE WHEN history.ordinal % 2 = 0
                THEN 'invite_signup'
                ELSE 'invite_signup_fallback'
              END,
              CASE WHEN history.ordinal % 4 = 0
                THEN 'provider_dispatch_started'
                ELSE 'accepted'
              END,
              TIMESTAMPTZ '2026-08-01T12:00:00.000Z',
              NOW(),
              NOW()
            FROM generate_series(1, $4::integer) AS history(ordinal)
          `,
          values: [
            `hld_live_invite_plan_${suffix}`,
            fixtureSource,
            suffix,
            LIVE_INVITE_HISTORY_COUNT,
          ],
        });
        await prisma.hostedLinqDelivery.createMany({
          data: [
            {
              attemptedAt: new Date("2026-08-01T12:01:00.000Z"),
              id: malformedAttemptId,
              source: fixtureSource,
              sourceRef: `${exactEffectId}:a6`,
              status: "accepted",
              template: "invite_signup",
            },
            {
              attemptedAt: new Date("2026-08-01T12:02:00.000Z"),
              id: otherIdentityId,
              source: fixtureSource,
              sourceRef: otherEffectId,
              status: "delivered",
              template: "invite_signup_fallback",
            },
          ],
        });
        await planClient.query('ANALYZE "hosted_linq_delivery"');

        const factsSql = `
          SELECT
            EXISTS (
              SELECT 1
              FROM "hosted_linq_delivery" AS "delivery"
              WHERE "delivery"."source_ref" IS NOT NULL
                AND "delivery"."template" IN (
                  'invite_signup',
                  'invite_signup_fallback'
                )
                AND "delivery"."status" IN (
                  'attempted',
                  'provider_dispatch_started',
                  'accepted',
                  'delivered'
                )
                AND "delivery"."source_ref" IN ($1, $2, $3, $4, $5)
              LIMIT 1
            ) AS "sameIdentityStillLive",
            EXISTS (
              SELECT 1
              FROM "hosted_linq_delivery" AS "delivery"
              WHERE "delivery"."source_ref" IS NOT NULL
                AND "delivery"."template" IN (
                  'invite_signup',
                  'invite_signup_fallback'
                )
                AND "delivery"."status" IN (
                  'attempted',
                  'provider_dispatch_started',
                  'accepted',
                  'delivered'
                )
                AND "delivery"."source_ref" LIKE $6::text ESCAPE '!'
                AND substring(
                  "delivery"."source_ref"
                  FROM char_length($7::text) + 1
                ) ~ '^(?::a[2-5]|:e[0-9a-f]{32}(?::a[2-5])?)?$'
              LIMIT 1
            ) AS "anyIdentityLive"
        `;
        const values = [
          ...exactSourceRefs,
          sourceRefLikePattern,
          sourceRefPrefix,
        ];
        const facts = await planClient.query<{
          anyIdentityLive: boolean;
          sameIdentityStillLive: boolean;
        }>({ text: factsSql, values });
        expect(facts.rows).toEqual([{
          anyIdentityLive: true,
          sameIdentityStillLive: false,
        }]);

        const planResult = await planClient.query<{ "QUERY PLAN": unknown }>({
          text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${factsSql}`,
          values,
        });
        const plan = readPostgreSqlExplainRoot(planResult.rows);
        const indexNodes = collectPostgreSqlPlanNodes(
          plan,
          (node) => node["Index Name"] === LIVE_INVITE_SOURCE_REF_INDEX,
        );
        expect(indexNodes).toHaveLength(2);
        expect(indexNodes.every((node) =>
          (node["Actual Rows"] ?? 0) <= 2
        )).toBe(true);
        expect(indexNodes.some((node) =>
          node["Index Cond"]?.includes("= ANY") === true
        )).toBe(true);
        expect(indexNodes.some((node) =>
          node["Index Cond"]?.includes("~>=~") === true
          && node["Index Cond"]?.includes("~<~") === true
        )).toBe(true);
        expect(collectPostgreSqlPlanNodes(
          plan,
          (node) => node["Node Type"] === "Seq Scan"
            && node["Relation Name"] === "hosted_linq_delivery",
        )).toHaveLength(0);

        await expect(hasHostedLinqInviteSignupLiveDeliveryTx({
          dayUtc,
          memberId,
          prisma,
        })).resolves.toBe(true);
        await prisma.hostedLinqDelivery.delete({
          where: { id: otherIdentityId },
        });
        await expect(hasHostedLinqInviteSignupLiveDeliveryTx({
          dayUtc,
          memberId,
          prisma,
        })).resolves.toBe(false);
      } finally {
        await planClient.query({
          text: 'DELETE FROM "hosted_linq_delivery" WHERE "source" = $1',
          values: [fixtureSource],
        }).catch(() => undefined);
        await planClient.end();
        await prisma.$disconnect();
      }
    });

    it("serializes concurrent digest failures and releases daily suppression only after the last live identity", async () => {
      const suffix = randomUUID();
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const memberId = `member_live_invite_failure_${suffix}`;
      const dayUtc = new Date("2026-08-01T00:00:00.000Z");
      const markerAt = new Date("2026-08-01T12:00:00.000Z");
      const firstEffectId = buildHostedLinqInviteSignupEffectId({
        memberId,
        occurredAt: dayUtc,
        sourceEventDigest: "c".repeat(32),
      });
      const secondEffectId = buildHostedLinqInviteSignupEffectId({
        memberId,
        occurredAt: dayUtc,
        sourceEventDigest: "d".repeat(32),
      });
      const firstDeliveryId = `hld_live_invite_failure_${suffix}_first`;
      const secondDeliveryId = `hld_live_invite_failure_${suffix}_second`;
      const firstMessageId = `msg-live-invite-failure-first-${suffix}`;
      const secondMessageId = `msg-live-invite-failure-second-${suffix}`;
      const firstPhoneNumber = buildTestPhoneNumber(suffix, 0n);
      const secondPhoneNumber = buildTestPhoneNumber(suffix, 1n);
      const eventIds = [
        `evt-live-invite-failure-first-${suffix}`,
        `evt-live-invite-failure-second-${suffix}`,
        `evt-live-invite-delivered-first-${suffix}`,
        `evt-live-invite-stale-first-${suffix}`,
      ];
      const deliveryIds = [firstDeliveryId, secondDeliveryId];
      const providerEventLookupKeys = eventIds.map((eventId) =>
        requireLookupKey(createHostedLinqProviderEventLookupKey(eventId))
      );
      const lineLookupKeys = [firstPhoneNumber, secondPhoneNumber].map(
        (phoneNumber) => requireLookupKey(createHostedPhoneLookupKey(phoneNumber)),
      );
      const firstApplied = createDeferred<{
        blockerPid: number;
        marker: Date | null;
        status: string | null;
      }>();
      const releaseFirst = createDeferred<void>();
      const secondPidReady = createDeferred<number>();
      let firstTransaction: Promise<unknown> | null = null;
      let secondTransaction: Promise<unknown> | null = null;

      try {
        await observer.hostedMember.create({ data: { id: memberId } });
        await observer.hostedLinqDailyState.create({
          data: {
            dayUtc,
            firstSeenAt: markerAt,
            lastSeenAt: markerAt,
            memberId,
            onboardingLinkSentAt: markerAt,
          },
        });
        await observer.hostedLinqDelivery.createMany({
          data: [
            {
              acceptedAt: new Date("2026-08-01T12:01:00.000Z"),
              attemptedAt: new Date("2026-08-01T12:00:30.000Z"),
              id: firstDeliveryId,
              idempotencyKey: requireLookupKey(
                createHostedLinqDeliveryIdempotencyLookupKey(firstEffectId),
              ),
              messageLookupKey: requireLookupKey(
                createHostedLinqMessageLookupKey(firstMessageId),
              ),
              source: "test_live_invite_failure",
              sourceRef: firstEffectId,
              status: "accepted",
              targetKind: "thread",
              template: "invite_signup",
            },
            {
              acceptedAt: new Date("2026-08-01T12:02:00.000Z"),
              attemptedAt: new Date("2026-08-01T12:01:30.000Z"),
              id: secondDeliveryId,
              idempotencyKey: requireLookupKey(
                createHostedLinqDeliveryIdempotencyLookupKey(secondEffectId),
              ),
              messageLookupKey: requireLookupKey(
                createHostedLinqMessageLookupKey(secondMessageId),
              ),
              source: "test_live_invite_failure",
              sourceRef: secondEffectId,
              status: "accepted",
              targetKind: "participant",
              template: "invite_signup_fallback",
            },
          ],
        });

        const firstFailure = buildReceipt({
          eventId: eventIds[0],
          messageId: firstMessageId,
          occurredAt: new Date("2026-08-01T12:10:00.000Z"),
          phoneNumber: firstPhoneNumber,
          status: "failed",
        });
        const secondFailure = buildReceipt({
          eventId: eventIds[1],
          messageId: secondMessageId,
          occurredAt: new Date("2026-08-01T12:11:00.000Z"),
          phoneNumber: secondPhoneNumber,
          status: "failed",
        });

        const firstRun = firstClient.$transaction(async (tx) => {
          const backendRows = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          const blockerPid = backendRows[0]?.pid;
          if (blockerPid === undefined) {
            throw new Error("Expected the first failure backend pid.");
          }
          await ingestHostedLinqProviderEventTx({
            event: firstFailure,
            prisma: tx,
          });
          const [dailyState, delivery] = await Promise.all([
            tx.hostedLinqDailyState.findUnique({
              select: { onboardingLinkSentAt: true },
              where: { memberId_dayUtc: { dayUtc, memberId } },
            }),
            tx.hostedLinqDelivery.findUnique({
              select: { status: true },
              where: { id: firstDeliveryId },
            }),
          ]);
          firstApplied.resolve({
            blockerPid,
            marker: dailyState?.onboardingLinkSentAt ?? null,
            status: delivery?.status ?? null,
          });
          await releaseFirst.promise;
        }, { maxWait: 5_000, timeout: 15_000 });
        firstTransaction = firstRun;

        const firstObservation = await withTimeout(
          firstApplied.promise,
          "The first live-invite failure did not reach its held transaction.",
        );
        expect(firstObservation).toEqual({
          blockerPid: expect.any(Number),
          marker: markerAt,
          status: "failed",
        });

        const secondRun = secondClient.$transaction(async (tx) => {
          const backendRows = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          const pid = backendRows[0]?.pid;
          if (pid === undefined) {
            throw new Error("Expected the second failure backend pid.");
          }
          secondPidReady.resolve(pid);
          await ingestHostedLinqProviderEventTx({
            event: secondFailure,
            prisma: tx,
          });
        }, { maxWait: 5_000, timeout: 15_000 });
        secondTransaction = secondRun;

        const secondPid = await withTimeout(
          secondPidReady.promise,
          "The second live-invite failure did not enter its transaction.",
        );
        await waitForBlockedBackend({
          blockerPid: firstObservation.blockerPid,
          observer,
          waiterPid: secondPid,
        });

        releaseFirst.resolve(undefined);
        await withTimeout(
          Promise.all([firstRun, secondRun]),
          "Concurrent live-invite failures did not converge.",
          12_000,
        );

        await expect(Promise.all([
          observer.hostedLinqDailyState.findUnique({
            select: { onboardingLinkSentAt: true },
            where: { memberId_dayUtc: { dayUtc, memberId } },
          }),
          observer.hostedLinqDelivery.findMany({
            orderBy: { id: "asc" },
            select: { status: true },
            where: { id: { in: deliveryIds } },
          }),
        ])).resolves.toEqual([
          { onboardingLinkSentAt: null },
          [{ status: "failed" }, { status: "failed" }],
        ]);

        await observer.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildReceipt({
              chatId: `chat-live-invite-${suffix}`,
              eventId: eventIds[2],
              messageId: firstMessageId,
              occurredAt: new Date("2026-08-01T12:20:00.000Z"),
              phoneNumber: firstPhoneNumber,
              status: "delivered",
            }),
            prisma: tx,
          })
        );
        const restored = await observer.hostedLinqDailyState.findUnique({
          select: { onboardingLinkSentAt: true },
          where: { memberId_dayUtc: { dayUtc, memberId } },
        });
        expect(restored?.onboardingLinkSentAt).toBeInstanceOf(Date);

        await observer.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildReceipt({
              eventId: eventIds[3],
              messageId: firstMessageId,
              occurredAt: new Date("2026-08-01T12:19:00.000Z"),
              phoneNumber: firstPhoneNumber,
              status: "failed",
            }),
            prisma: tx,
          })
        );
        await expect(Promise.all([
          observer.hostedLinqDelivery.findUnique({
            select: { lastReceiptAt: true, status: true },
            where: { id: firstDeliveryId },
          }),
          observer.hostedLinqDailyState.findUnique({
            select: { onboardingLinkSentAt: true },
            where: { memberId_dayUtc: { dayUtc, memberId } },
          }),
        ])).resolves.toEqual([
          {
            lastReceiptAt: new Date("2026-08-01T12:20:00.000Z"),
            status: "delivered",
          },
          { onboardingLinkSentAt: restored?.onboardingLinkSentAt ?? null },
        ]);
      } finally {
        releaseFirst.resolve(undefined);
        await Promise.allSettled([
          ...(firstTransaction ? [firstTransaction] : []),
          ...(secondTransaction ? [secondTransaction] : []),
        ]);
        await observer.hostedLinqAlert.deleteMany({
          where: {
            OR: [
              { deliveryId: { in: deliveryIds } },
              { eventId: { in: providerEventLookupKeys } },
            ],
          },
        }).catch(() => undefined);
        await observer.hostedLinqDelivery.deleteMany({
          where: { id: { in: deliveryIds } },
        }).catch(() => undefined);
        await observer.hostedLinqProviderEvent.deleteMany({
          where: { eventId: { in: providerEventLookupKeys } },
        }).catch(() => undefined);
        await observer.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: lineLookupKeys } },
        }).catch(() => undefined);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        }).catch(() => undefined);
        await Promise.all([
          firstClient.$disconnect(),
          secondClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });
  },
);

function buildReceipt(input: {
  chatId?: string;
  eventId: string;
  messageId: string;
  occurredAt: Date;
  phoneNumber: string;
  status: "delivered" | "failed";
}): NonNullable<ReturnType<typeof parseHostedLinqProviderEvent>> {
  const event = parseHostedLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: input.occurredAt.toISOString(),
    data: {
      ...(input.status === "failed"
        ? {
            error: {
              code: "30007",
              message: "carrier filtered",
            },
          }
        : { chat_id: input.chatId ?? "chat-live-invite-test" }),
      message_id: input.messageId,
      phone_number: input.phoneNumber,
      service: "sms",
    },
    event_id: input.eventId,
    event_type: `message.${input.status}`,
    trace_id: `trace-${randomUUID()}`,
    webhook_version: "2026-02-03",
  }));
  const parsed = parseHostedLinqProviderEvent({
    event,
    rawBody: JSON.stringify(event),
  });
  if (!parsed) {
    throw new Error("Expected a terminal Hosted Linq receipt.");
  }
  return parsed;
}

function collectPostgreSqlPlanNodes(
  root: PostgreSqlExplainPlanNode,
  predicate: (node: PostgreSqlExplainPlanNode) => boolean,
): PostgreSqlExplainPlanNode[] {
  const matches = predicate(root) ? [root] : [];
  for (const child of root.Plans ?? []) {
    matches.push(...collectPostgreSqlPlanNodes(child, predicate));
  }
  return matches;
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

async function waitForBlockedBackend(input: {
  blockerPid: number;
  observer: PrismaClient;
  waiterPid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT ${input.blockerPid} = ANY(
        pg_blocking_pids(${input.waiterPid})
      ) AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await sleep(25);
  }
  throw new Error("The second live-invite failure did not block on the first.");
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function buildTestPhoneNumber(seed: string, offset: bigint): string {
  const numericSeed = BigInt(`0x${seed.replaceAll("-", "")}`);
  const subscriber = (numericSeed + offset) % 1_000_000_000_000n;
  return `+999${subscriber.toString().padStart(12, "0")}`;
}

function requireLookupKey(value: string | null): string {
  if (!value) {
    throw new Error("Expected a deterministic Hosted Linq lookup key.");
  }
  return value;
}

function escapeLikePrefix(value: string): string {
  return value.replace(/[!%_]/gu, (character) => `!${character}`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs = 5_000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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
