import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  resetHostedLinqFirstContactAdmissionForCanaryTx,
} from "@/src/lib/hosted-onboarding/linq-first-contact-admission";
import {
  createHostedLinqDeliverySourceRefLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Linq production-canary reset proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "Linq production-canary reset PostgreSQL proof",
  () => {
    it("clears only untouched claims and their joined admission rows", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixture = buildFixture();
      try {
        await seedAdmissionRows({
          eventIds: fixture.eventIds,
          lookupKey: fixture.participant.lookupKey,
          prisma,
        });
        await prisma.hostedLinqDelivery.createMany({
          data: [
            buildUntouchedDelivery(fixture, 0),
            buildUntouchedDelivery(fixture, 1),
            {
              acceptedAt: new Date("2026-08-01T12:00:00.000Z"),
              attemptedAt: new Date("2026-08-01T11:59:59.000Z"),
              id: fixture.deliveryIds[2],
              source: fixture.source,
              sourceRef: requireSourceRef(fixture.eventIds[2]),
              status: "accepted",
              template: "instant_first_turn_v1",
            },
          ],
        });

        await expect(prisma.$transaction((tx) =>
          resetHostedLinqFirstContactAdmissionForCanaryTx({
            participantContact: fixture.participant,
            tx,
          })
        )).resolves.toEqual({
          admissionBudgetCount: 4,
          admissionDecisionCount: 4,
          deliveryClaimCount: 2,
        });

        await expect(readFixtureCounts(prisma, fixture)).resolves.toEqual({
          budgets: 0,
          decisions: 0,
          deliveries: 1,
        });
        await expect(prisma.hostedLinqDelivery.findUnique({
          select: { id: true, status: true },
          where: { id: fixture.deliveryIds[2] },
        })).resolves.toEqual({
          id: fixture.deliveryIds[2],
          status: "accepted",
        });
      } finally {
        await cleanupFixture(prisma, fixture);
        await prisma.$disconnect();
      }
    });

    it("fails closed and preserves admission rows when a claim starts provider dispatch", async () => {
      const resetClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const providerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixture = buildFixture(1);
      const providerLocked = createDeferred<number>();
      const releaseProvider = createDeferred<void>();
      const resetPid = createDeferred<number>();
      let providerTransaction: Promise<unknown> | null = null;
      let resetTransaction: Promise<unknown> | null = null;

      try {
        await seedAdmissionRows({
          eventIds: fixture.eventIds,
          lookupKey: fixture.participant.lookupKey,
          prisma: observer,
        });
        await observer.hostedLinqDelivery.create({
          data: buildUntouchedDelivery(fixture, 0),
        });

        providerTransaction = providerClient.$transaction(async (tx) => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          await tx.$queryRaw`
            SELECT id
            FROM hosted_linq_delivery
            WHERE id = ${fixture.deliveryIds[0]}
            FOR UPDATE
          `;
          providerLocked.resolve(requirePid(backend?.pid));
          await releaseProvider.promise;
          await tx.hostedLinqDelivery.update({
            data: {
              payloadCiphertext: "sealed-test-payload",
              payloadOwnerMemberId: null,
              payloadSchema: "test-schema",
              status: "provider_dispatch_started",
            },
            where: { id: fixture.deliveryIds[0] },
          });
        }, transactionOptions);

        const blockerPid = await providerLocked.promise;
        resetTransaction = resetClient.$transaction(async (tx) => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          resetPid.resolve(requirePid(backend?.pid));
          return resetHostedLinqFirstContactAdmissionForCanaryTx({
            participantContact: fixture.participant,
            tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          blockerPid,
          observer,
          waiterPid: await resetPid.promise,
        });
        releaseProvider.resolve();
        await providerTransaction;

        await expect(resetTransaction).rejects.toMatchObject({
          code: "HOSTED_LINQ_CANARY_RESET_UNSAFE_DELIVERY",
          httpStatus: 409,
        });
        await expect(readFixtureCounts(observer, fixture)).resolves.toEqual({
          budgets: 1,
          decisions: 1,
          deliveries: 1,
        });
        await expect(observer.hostedLinqDelivery.findUnique({
          select: { status: true },
          where: { id: fixture.deliveryIds[0] },
        })).resolves.toEqual({ status: "provider_dispatch_started" });
      } finally {
        releaseProvider.resolve();
        await Promise.allSettled([
          ...(providerTransaction ? [providerTransaction] : []),
          ...(resetTransaction ? [resetTransaction] : []),
        ]);
        await cleanupFixture(observer, fixture);
        await Promise.all([
          resetClient.$disconnect(),
          providerClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });
  },
);

const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10_000,
  timeout: 20_000,
};

function buildFixture(eventCount = 4) {
  const suffix = randomUUID();
  const participant = createHostedLinqParticipantContact({
    kind: "phone",
    value: buildTestPhoneNumber(suffix),
  });
  if (!participant) {
    throw new Error("Expected a valid test participant contact.");
  }
  return {
    deliveryIds: Array.from(
      { length: Math.max(eventCount, 3) },
      (_, index) => `hld_canary_reset_${suffix}_${index}`,
    ),
    eventIds: Array.from(
      { length: eventCount },
      (_, index) => `evt_canary_reset_${suffix}_${index}`,
    ),
    participant,
    source: `test_canary_reset_${suffix}`,
  };
}

function buildUntouchedDelivery(
  fixture: ReturnType<typeof buildFixture>,
  index: number,
) {
  return {
    attemptedAt: new Date("2026-08-01T11:59:59.000Z"),
    id: fixture.deliveryIds[index],
    source: fixture.source,
    sourceRef: requireSourceRef(fixture.eventIds[index]),
    status: "attempted",
    template: "instant_first_turn_v1",
  };
}

async function seedAdmissionRows(input: {
  eventIds: readonly string[];
  lookupKey: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedLinqFirstContactAdmissionBudget.createMany({
    data: input.eventIds.map((eventId) => ({
      eventId,
      participantContactKind: "phone",
      participantContactLookupKey: input.lookupKey,
    })),
  });
  await input.prisma.hostedLinqFirstContactAdmissionDecision.createMany({
    data: input.eventIds.map((eventId) => ({
      confidence: 0.99,
      decision: "allow",
      eventId,
      source: "model",
    })),
  });
}

async function readFixtureCounts(
  prisma: PrismaClient,
  fixture: ReturnType<typeof buildFixture>,
) {
  const [budgets, decisions, deliveries] = await Promise.all([
    prisma.hostedLinqFirstContactAdmissionBudget.count({
      where: { eventId: { in: fixture.eventIds } },
    }),
    prisma.hostedLinqFirstContactAdmissionDecision.count({
      where: { eventId: { in: fixture.eventIds } },
    }),
    prisma.hostedLinqDelivery.count({
      where: { id: { in: fixture.deliveryIds } },
    }),
  ]);
  return { budgets, decisions, deliveries };
}

async function cleanupFixture(
  prisma: PrismaClient,
  fixture: ReturnType<typeof buildFixture>,
): Promise<void> {
  await prisma.$transaction([
    prisma.hostedLinqDelivery.deleteMany({
      where: { id: { in: fixture.deliveryIds } },
    }),
    prisma.hostedLinqFirstContactAdmissionDecision.deleteMany({
      where: { eventId: { in: fixture.eventIds } },
    }),
    prisma.hostedLinqFirstContactAdmissionBudget.deleteMany({
      where: { eventId: { in: fixture.eventIds } },
    }),
  ]).catch(() => undefined);
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The canary reset did not block on the provider transition.");
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function requirePid(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value)) {
    throw new Error("Expected a PostgreSQL backend process id.");
  }
  return value;
}

function requireSourceRef(value: string | undefined): string {
  const sourceRef = value
    ? createHostedLinqDeliverySourceRefLookupKey(value)
    : null;
  if (!sourceRef) {
    throw new Error("Expected a delivery source-reference lookup key.");
  }
  return sourceRef;
}

function buildTestPhoneNumber(seed: string): string {
  const subscriber = BigInt(`0x${seed.replaceAll("-", "")}`)
    % 1_000_000_000n;
  return `+1555${subscriber.toString().padStart(9, "0")}`;
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
