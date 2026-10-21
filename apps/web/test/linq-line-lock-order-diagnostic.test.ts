import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  readHostedLinqDeliveryProviderDispatchIntentTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  decryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import {
  upsertHostedLinqLineForPhoneTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import {
  issueHostedLinqGroupEmailRecoveryToken,
} from "@/src/lib/hosted-onboarding/linq-group-setup";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";

const provider = vi.hoisted(() => ({ createChat: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  createHostedLinqChat: provider.createChat,
}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (runPostgresProof && !isIsolatedLoopbackDatabase(databaseUrl)) {
  throw new Error("Linq line lock-order proof requires an isolated loopback test database without overrides.");
}

const phone = "+12025550184";
const formattedPhone = "+1 (202) 555-0184";
const now = new Date("2026-01-01T12:00:00Z");
const day = new Date("2026-01-01T00:00:00Z");
const syntheticEmail = "linq-lock-order@example.test";

beforeEach(() => {
  provider.createChat.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  setPrivacyKeyVersion("v1");
  vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", Buffer.alloc(32, 9).toString("base64url"));
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://linq-lock-order.example.test");
  clearEnvironmentCache();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("External requests are forbidden in the synthetic lock-order proof.");
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearEnvironmentCache();
});

describe.skipIf(!runPostgresProof)("Linq line lock-order PostgreSQL regression", () => {
  it("completes recovery dispatch and ordinary upsert without losing quota or delivery authority", async () => {
    await withSyntheticLine(async ({ prisma, lookupKey, createEffect }) => {
      const rowHeld = deferred();
      const phoneHeld = deferred();
      const applicationName = `linq-lock-proof-${randomUUID()}`;
      const recoveryUrl = new URL(databaseUrl);
      recoveryUrl.searchParams.set("application_name", applicationName);
      const recoveryBase = createPrismaClient({ databaseUrl: recoveryUrl.toString(), poolMax: 1 });
      let capacityUpdates = 0;
      // Only scheduling is intercepted. The real capacity owner executes its
      // UPDATE on PostgreSQL and retains its row lock before the barrier opens.
      // Match createPrismaClient's query-only extension type boundary: no
      // model/client methods change, but Prisma's extension type omits $on.
      const recoveryClient = recoveryBase.$extends({
        query: {
          hostedLinqLine: {
            async updateMany({ args, query }) {
              const result = await query(args);
              if (result.count === 1 && args.data.proactiveConversationCount !== undefined) {
                capacityUpdates += 1;
                rowHeld.resolve();
                await phoneHeld.promise;
              }
              return result;
            },
          },
        },
      }) as PrismaClient;
      const scheduled: Array<() => Promise<void>> = [];
      setPrivacyKeyVersion("v2");
      const effect = createEffect();
      provider.createChat.mockImplementation(async () => {
        // Sending begins only after the dispatch transaction commits. This
        // provider stub never sends a message or makes a network request.
        const active = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count FROM pg_stat_activity
          WHERE application_name = ${applicationName} AND xact_start IS NOT NULL
        `;
        expect(active[0]?.count).toBe(0n);
        return { chatId: "synthetic-created-chat", messageId: "synthetic-provider-message" };
      });
      const currentKey = createHostedPhoneLookupKey(phone);
      expect(currentKey).not.toBe(lookupKey);
      let recovery: Promise<unknown> | undefined;
      let observation: Promise<unknown> | undefined;
      try {
        recovery = drainHostedLinqSideEffectsDirect({
          prisma: recoveryClient,
          scheduleAfterResponse: (task) => { scheduled.push(task); },
          sideEffects: [effect],
        });
        observation = prisma.$transaction(async (tx) => {
          // Surface an early dispatch error rather than waiting forever for a
          // capacity barrier that failed authorization or never reached SQL.
          await Promise.race([rowHeld.promise, recovery]);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(
            hashtext('hosted_linq_line_phone'), hashtext(${phone})
          )`;
          phoneHeld.resolve();
          return upsertHostedLinqLineForPhoneTx({
            observedAt: now, phoneNumber: formattedPhone, prisma: tx, source: "webhook",
          });
        }, { timeout: 10_000 }).finally(() => phoneHeld.resolve());
        await expect(Promise.all([recovery, observation])).resolves.toEqual([
          { sentCount: 1, skipped: [] },
          expect.objectContaining({ phoneNumberLookupKey: lookupKey }),
        ]);
        expect(capacityUpdates).toBe(1);
        expect(provider.createChat).toHaveBeenCalledOnce();
        expect(provider.createChat).toHaveBeenCalledWith(expect.objectContaining({
          from: phone, idempotencyKey: effect.effectId, to: [syntheticEmail],
        }));
        const lines = await prisma.hostedLinqLine.findMany({
          where: { phoneNumberLookupKey: { in: createHostedPhoneLookupKeyReadCandidates(phone) } },
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
          phoneNumberLookupKey: lookupKey,
          proactiveConversationCount: 4,
          proactiveConversationDayUtc: day,
        });
        expect(JSON.parse(lines[0]?.phoneNumberEncrypted ?? "{}")).toMatchObject({ version: "v2" });
        expect(decryptHostedLinqLinePhoneNumber(lines[0]?.phoneNumberEncrypted)).toBe(phone);
        await expect(readHostedLinqDeliveryProviderDispatchIntentTx({
          idempotencyKey: effect.effectId, prisma,
        })).resolves.toMatchObject({
          phoneNumberLookupKey: lookupKey, providerCorrelated: false,
          status: "attempted", targetKind: "participant", template: "group_email_recovery",
        });

        const replay = () => drainHostedLinqSideEffectsDirect({
          prisma: recoveryClient,
          scheduleAfterResponse: (task) => { scheduled.push(task); },
          sideEffects: [effect],
        });
        await expect(replay()).resolves.toMatchObject({
          sentCount: 0, skipped: [{ effectId: effect.effectId, reason: "notice_in_flight" }],
        });
        expect(scheduled).toHaveLength(1);
        await scheduled[0]?.();
        await expect(readHostedLinqDeliveryProviderDispatchIntentTx({
          idempotencyKey: effect.effectId, prisma,
        })).resolves.toMatchObject({ providerCorrelated: true, status: "accepted" });
        await expect(replay()).resolves.toMatchObject({
          sentCount: 0, skipped: [{ effectId: effect.effectId, reason: "notice_already_claimed" }],
        });
        expect(capacityUpdates).toBe(1);
        expect(provider.createChat).toHaveBeenCalledOnce();
        await expect(prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: lookupKey },
          select: { proactiveConversationCount: true, proactiveConversationDayUtc: true },
        })).resolves.toEqual({ proactiveConversationCount: 4, proactiveConversationDayUtc: day });
        await expect(prisma.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(effect.effectId)! },
          select: { status: true, deliveredAt: true },
        })).resolves.toEqual({ status: "accepted", deliveredAt: null });
      } finally {
        rowHeld.resolve();
        phoneHeld.resolve();
        await Promise.allSettled([recovery, observation]);
        await recoveryBase.$disconnect();
      }
    });
  }, 15_000);

  it("rechecks a missing phone under its lock across concurrent readable key versions", async () => {
    const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
    const bases = [0, 1].map(() => createPrismaClient({ databaseUrl, poolMax: 1 }));
    const missing = [deferred(), deferred()];
    const release = [deferred(), deferred()];
    const reads = [0, 0];
    const clients = bases.map((base, index) => base.$extends({
      query: {
        hostedLinqLine: {
          async findMany({ args, query }) {
            const result = await query(args);
            reads[index] += 1;
            if (reads[index] === 1) {
              expect(result).toHaveLength(0);
              missing[index].resolve();
              await release[index].promise;
            }
            return result;
          },
        },
      },
    }) as PrismaClient);
    setPrivacyKeyVersion("v2");
    const keys = createHostedPhoneLookupKeyReadCandidates(phone);
    setPrivacyKeyVersion("v1");
    const firstKey = createHostedPhoneLookupKey(phone);
    const creations: Array<Promise<unknown>> = [];
    let ownsCandidates = false;
    try {
      expect(await observer.hostedLinqLine.count({
        where: { phoneNumberLookupKey: { in: keys } },
      })).toBe(0);
      ownsCandidates = true;
      creations.push(upsertHostedLinqLineForPhoneTx({
        observedAt: now, phoneNumber: phone, prisma: clients[0], source: "webhook",
      }));
      await Promise.race([missing[0].promise, creations[0]]);
      setPrivacyKeyVersion("v2");
      expect(createHostedPhoneLookupKey(phone)).not.toBe(firstKey);
      creations.push(upsertHostedLinqLineForPhoneTx({
        observedAt: now, phoneNumber: formattedPhone, prisma: clients[1], source: "webhook",
      }));
      await Promise.race([missing[1].promise, creations[1]]);
      // Both legitimate calls observed absence. Let the first create before
      // the second takes the same normalized-phone lock and rechecks both keys.
      release[0].resolve();
      await expect(creations[0]).resolves.toMatchObject({ phoneNumberLookupKey: firstKey });
      release[1].resolve();
      await expect(creations[1]).resolves.toMatchObject({ phoneNumberLookupKey: firstKey });
      expect(reads).toEqual([2, 2]);
      expect(await observer.hostedLinqLine.findMany({
        where: { phoneNumberLookupKey: { in: keys } },
        select: { phoneNumberLookupKey: true },
      })).toEqual([{ phoneNumberLookupKey: firstKey }]);
    } finally {
      release.forEach((gate) => gate.resolve());
      await Promise.allSettled(creations);
      if (ownsCandidates) {
        await observer.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: { in: keys } } });
      }
      await Promise.allSettled([...bases, observer].map((client) => client.$disconnect()));
    }
  }, 15_000);

  it.each(["exhausted", "disabled", "unhealthy", "expired", "invalid token"] as const)(
    "rejects %s recovery without quota spend or a delivery intent",
    async (denial) => {
      await withSyntheticLine(async ({ prisma, lookupKey, createEffect }) => {
        await prisma.hostedLinqLine.update({
          where: { phoneNumberLookupKey: lookupKey },
          data: {
            ...(denial === "exhausted" ? { maxNewConversationsPerDay: 3 } : {}),
            ...(denial === "disabled" ? { egressPolicy: "disabled" } : {}),
            ...(denial === "unhealthy" ? { healthStatus: "unhealthy" } : {}),
          },
        });
        const effect = createEffect(denial === "expired"
          ? new Date("2025-12-30T12:00:00Z") : now);
        if (denial === "invalid token" && effect.payload.template === "group_email_recovery") {
          effect.payload.recoveryToken = "invalid-synthetic-token";
        }
        await expect(drainHostedLinqSideEffectsDirect({
          prisma, sideEffects: [effect],
        })).resolves.toMatchObject({
          sentCount: 0, skipped: [{ effectId: effect.effectId, reason: "notice_target_unauthorized" }],
        });
        expect(provider.createChat).not.toHaveBeenCalled();
        await expect(readHostedLinqDeliveryProviderDispatchIntentTx({
          idempotencyKey: effect.effectId, prisma,
        })).resolves.toBeNull();
        await expect(prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: lookupKey },
          select: { proactiveConversationCount: true },
        })).resolves.toEqual({ proactiveConversationCount: 3 });
      });
    },
  );
});

async function withSyntheticLine(run: (fixture: {
  prisma: PrismaClient;
  lookupKey: string;
  createEffect: (observedAt?: Date) => ReturnType<typeof createHostedWebhookLinqMessageSideEffect>;
}) => Promise<void>): Promise<void> {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const deliveryKeys: string[] = [];
  setPrivacyKeyVersion("v2");
  const candidates = createHostedPhoneLookupKeyReadCandidates(phone);
  setPrivacyKeyVersion("v1");
  let lookupKey: string | undefined;
  try {
    const existing = await prisma.hostedLinqLine.findMany({
      where: { phoneNumberLookupKey: { in: candidates } },
      select: { phoneNumberLookupKey: true },
    });
    expect(existing).toHaveLength(0);
    const line = await upsertHostedLinqLineForPhoneTx({
      observedAt: now, phoneNumber: phone, prisma, source: "configured",
    });
    lookupKey = line.phoneNumberLookupKey;
    await prisma.hostedLinqLine.update({
      where: { phoneNumberLookupKey: lookupKey },
      data: {
        healthStatus: "healthy", egressPolicy: "enabled", maxNewConversationsPerDay: 10,
        proactiveConversationCount: 3, proactiveConversationDayUtc: day,
      },
    });
    await run({
      prisma, lookupKey,
      createEffect(observedAt = now) {
        const suffix = randomUUID();
        const threadId = `synthetic-lock-order-${suffix}`;
        const effect = createHostedWebhookLinqMessageSideEffect({
          assignedRecipientPhone: formattedPhone,
          occurredAt: observedAt.toISOString(),
          participantContact: { kind: "email", value: syntheticEmail },
          recoveryToken: issueHostedLinqGroupEmailRecoveryToken({
            chatId: threadId, now: observedAt, observedAt,
            participantEmail: syntheticEmail, recipientPhone: phone,
          }),
          sourceEventId: `synthetic-event-${suffix}`,
          template: "group_email_recovery", threadId,
        });
        const key = createHostedLinqDeliveryIdempotencyLookupKey(effect.effectId);
        if (!key) throw new Error("Expected a synthetic delivery key.");
        deliveryKeys.push(key);
        return effect;
      },
    });
  } finally {
    if (deliveryKeys.length > 0) {
      await prisma.hostedLinqDelivery.deleteMany({ where: { idempotencyKey: { in: deliveryKeys } } });
    }
    if (lookupKey) await prisma.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: { in: candidates } } });
    await prisma.$disconnect();
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function clearEnvironmentCache(): void {
  delete (globalThis as typeof globalThis & { __murphHostedOnboardingEnv?: unknown }).__murphHostedOnboardingEnv;
}

function setPrivacyKeyVersion(version: "v1" | "v2"): void {
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", [
    `v1:${Buffer.alloc(32, 7).toString("base64url")}`,
    ...(version === "v2" ? [`v2:${Buffer.alloc(32, 8).toString("base64url")}`] : []),
  ].join(","));
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", version);
  clearEnvironmentCache();
}

function isIsolatedLoopbackDatabase(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && (/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)
        || url.pathname === "/murph_dev_linq_lock_order_20261020")
      && !url.search && !url.hash;
  } catch {
    return false;
  }
}
