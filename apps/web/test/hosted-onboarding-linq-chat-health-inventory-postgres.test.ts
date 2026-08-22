import { Buffer } from "node:buffer";
import { randomInt, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  prepareHostedLinqChatHealthInventoryProjection,
  projectHostedLinqChatHealthInventoryChunk,
} from "@/src/lib/hosted-onboarding/linq-provider-health-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const TEST_KEYRING_ENTRIES = {
  v1: Buffer.from("1".repeat(32), "utf8").toString("base64"),
  v2: Buffer.from("2".repeat(32), "utf8").toString("base64"),
};

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Hosted Linq chat-health inventory proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted Linq chat-health inventory PostgreSQL proof",
  () => {
    it("preserves line freshness and converges duplicate, stale, equal, newer, legacy, and ambiguous projections", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const chatId = `pg-chat-health-${randomUUID()}`;
      const phoneNumber = buildSyntheticProofPhoneNumber();
      const initialProviderUpdatedAt = new Date("2026-08-11T10:00:00.000Z");
      const restoreV1 = configureHostedContactPrivacyKeyringForTest({
        currentVersion: "v1",
        entries: { v1: TEST_KEYRING_ENTRIES.v1 },
      });
      const legacyChatLookupKey = createHostedLinqChatLookupKey(chatId);
      const legacyLineLookupKey = createHostedPhoneLookupKey(phoneNumber);
      restoreV1();
      const restoreV2 = configureHostedContactPrivacyKeyringForTest({
        currentVersion: "v2",
        entries: TEST_KEYRING_ENTRIES,
      });
      const currentChatLookupKey = createHostedLinqChatLookupKey(chatId);
      const currentLineLookupKey = createHostedPhoneLookupKey(phoneNumber);

      if (
        !legacyChatLookupKey
        || !legacyLineLookupKey
        || !currentChatLookupKey
        || !currentLineLookupKey
      ) {
        restoreV2();
        await prisma.$disconnect();
        throw new Error("Expected versioned Hosted Linq lookup keys.");
      }

      const chatLookupKeys = [legacyChatLookupKey, currentChatLookupKey];
      const lineLookupKeys = [legacyLineLookupKey, currentLineLookupKey];

      try {
        await prisma.hostedLinqLine.create({
          data: {
            assignmentWeight: 100,
            configuredAt: new Date("2026-08-11T09:00:00.000Z"),
            egressPolicy: "enabled",
            healthStatus: "unknown",
            phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
            phoneNumberLookupKey: legacyLineLookupKey,
            source: "configured",
          },
        });
        await prisma.hostedLinqChatHealth.create({
          data: {
            isGroup: false,
            linqChatLookupKey: legacyChatLookupKey,
            phoneNumberLookupKey: legacyLineLookupKey,
            providerObservedAt: new Date("2026-08-11T10:01:00.000Z"),
            providerStatus: "HEALTHY",
            providerUpdatedAt: initialProviderUpdatedAt,
            service: "iMessage",
          },
        });

        const staleObservedAt = new Date("2026-08-11T11:00:00.000Z");
        await expect(applyProjection({
          chatId,
          linePhoneNumber: phoneNumber,
          observedAt: staleObservedAt,
          prisma,
          providerStatus: "CRITICAL",
          providerUpdatedAt: new Date("2026-08-11T09:59:00.000Z"),
        })).resolves.toBe(0);

        expect(await prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: legacyChatLookupKey },
          select: {
            phoneNumberLookupKey: true,
            providerStatus: true,
            providerUpdatedAt: true,
          },
        })).toEqual({
          phoneNumberLookupKey: legacyLineLookupKey,
          providerStatus: "HEALTHY",
          providerUpdatedAt: initialProviderUpdatedAt,
        });
        expect(await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: legacyLineLookupKey },
          select: {
            providerFirstSeenAt: true,
            providerLastSeenAt: true,
            providerSeenAt: true,
            source: true,
          },
        })).toEqual({
          providerFirstSeenAt: staleObservedAt,
          providerLastSeenAt: staleObservedAt,
          providerSeenAt: staleObservedAt,
          source: "configured",
        });

        const equalObservedAt = new Date("2026-08-11T11:05:00.000Z");
        await expect(applyProjection({
          chatId,
          linePhoneNumber: phoneNumber,
          observedAt: equalObservedAt,
          prisma,
          providerStatus: "AT_RISK",
          providerUpdatedAt: initialProviderUpdatedAt,
        })).resolves.toBe(1);

        expect(await prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: currentChatLookupKey },
          select: {
            phoneNumberLookupKey: true,
            providerObservedAt: true,
            providerStatus: true,
            providerUpdatedAt: true,
          },
        })).toEqual({
          phoneNumberLookupKey: legacyLineLookupKey,
          providerObservedAt: equalObservedAt,
          providerStatus: "AT_RISK",
          providerUpdatedAt: initialProviderUpdatedAt,
        });
        expect(await prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: legacyChatLookupKey },
        })).toBeNull();

        const newerProviderUpdatedAt = new Date("2026-08-11T12:00:00.000Z");
        await expect(applyProjection({
          chatId,
          linePhoneNumber: phoneNumber,
          observedAt: new Date("2026-08-11T12:01:00.000Z"),
          prisma,
          providerStatus: "CRITICAL",
          providerUpdatedAt: newerProviderUpdatedAt,
        })).resolves.toBe(1);
        expect(await prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: currentChatLookupKey },
          select: {
            phoneNumberLookupKey: true,
            providerStatus: true,
            providerUpdatedAt: true,
          },
        })).toEqual({
          phoneNumberLookupKey: legacyLineLookupKey,
          providerStatus: "CRITICAL",
          providerUpdatedAt: newerProviderUpdatedAt,
        });

        const duplicateProviderUpdatedAt = new Date("2026-08-11T12:30:00.000Z");
        await expect(projectHostedLinqChatHealthInventoryChunk({
          chats: prepareHostedLinqChatHealthInventoryProjection([
            {
              chatId,
              isGroup: true,
              linePhoneNumber: null,
              providerStatus: "AT_RISK",
              providerUpdatedAt: duplicateProviderUpdatedAt,
              service: "first-equal",
            },
            {
              chatId,
              isGroup: true,
              linePhoneNumber: null,
              providerStatus: "OPTED_OUT",
              providerUpdatedAt: new Date("2026-08-11T12:15:00.000Z"),
              service: "stale-duplicate",
            },
            {
              chatId,
              isGroup: false,
              linePhoneNumber: phoneNumber,
              providerStatus: "HEALTHY",
              providerUpdatedAt: duplicateProviderUpdatedAt,
              service: "later-equal",
            },
          ]),
          observedAt: new Date("2026-08-11T12:31:00.000Z"),
          prisma,
        })).resolves.toBe(1);
        expect(await prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: currentChatLookupKey },
          select: {
            isGroup: true,
            phoneNumberLookupKey: true,
            providerStatus: true,
            providerUpdatedAt: true,
            service: true,
          },
        })).toEqual({
          isGroup: false,
          phoneNumberLookupKey: legacyLineLookupKey,
          providerStatus: "HEALTHY",
          providerUpdatedAt: duplicateProviderUpdatedAt,
          service: "later-equal",
        });

        const ambiguousProviderUpdatedAt = new Date("2026-08-11T13:00:00.000Z");
        await expect(applyProjection({
          chatId,
          linePhoneNumber: null,
          observedAt: new Date("2026-08-11T13:01:00.000Z"),
          prisma,
          providerStatus: "OPTED_OUT",
          providerUpdatedAt: ambiguousProviderUpdatedAt,
        })).resolves.toBe(1);
        expect(await prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: currentChatLookupKey },
          select: {
            phoneNumberLookupKey: true,
            providerStatus: true,
            providerUpdatedAt: true,
          },
        })).toEqual({
          phoneNumberLookupKey: null,
          providerStatus: "OPTED_OUT",
          providerUpdatedAt: ambiguousProviderUpdatedAt,
        });
        expect(await prisma.hostedLinqLine.count({
          where: { phoneNumberLookupKey: { in: lineLookupKeys } },
        })).toBe(1);
      } finally {
        await prisma.hostedLinqChatHealth.deleteMany({
          where: { linqChatLookupKey: { in: chatLookupKeys } },
        });
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: lineLookupKeys } },
        });
        restoreV2();
        await prisma.$disconnect();
      }
    });

    it("keeps the global duplicate winner stable when an earlier line-only chunk is replayed", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const chatId = `pg-chat-health-chunk-replay-${randomUUID()}`;
      const firstPhoneNumber = buildSyntheticProofPhoneNumber();
      const secondPhoneNumber = buildSyntheticProofPhoneNumber();
      const restore = configureHostedContactPrivacyKeyringForTest({
        currentVersion: "v1",
        entries: { v1: TEST_KEYRING_ENTRIES.v1 },
      });
      const chatLookupKey = createHostedLinqChatLookupKey(chatId);
      const firstLineLookupKey = createHostedPhoneLookupKey(firstPhoneNumber);
      const secondLineLookupKey = createHostedPhoneLookupKey(secondPhoneNumber);
      const providerUpdatedAt = new Date("2026-08-11T13:30:00.000Z");
      const prepared = prepareHostedLinqChatHealthInventoryProjection([
        {
          chatId,
          isGroup: false,
          linePhoneNumber: firstPhoneNumber,
          providerStatus: "AT_RISK",
          providerUpdatedAt,
          service: "first-equal",
        },
        {
          chatId,
          isGroup: true,
          linePhoneNumber: secondPhoneNumber,
          providerStatus: "HEALTHY",
          providerUpdatedAt,
          service: "later-equal",
        },
      ]);
      restore();

      if (!chatLookupKey || !firstLineLookupKey || !secondLineLookupKey) {
        await prisma.$disconnect();
        throw new Error("Expected Hosted Linq chat and line lookup keys.");
      }

      const firstObservedAt = new Date("2026-08-11T13:31:00.000Z");
      const replayObservedAt = new Date("2026-08-11T13:32:00.000Z");
      try {
        expect(prepared.map((chat) => chat.projectsChatHealth)).toEqual([
          false,
          true,
        ]);
        await expect(projectHostedLinqChatHealthInventoryChunk({
          chats: prepared.slice(0, 1),
          observedAt: firstObservedAt,
          prisma,
        })).resolves.toBe(0);
        await expect(projectHostedLinqChatHealthInventoryChunk({
          chats: prepared.slice(1),
          observedAt: firstObservedAt,
          prisma,
        })).resolves.toBe(1);

        await expect(prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: chatLookupKey },
          select: {
            isGroup: true,
            phoneNumberLookupKey: true,
            providerStatus: true,
            providerUpdatedAt: true,
            service: true,
          },
        })).resolves.toEqual({
          isGroup: true,
          phoneNumberLookupKey: secondLineLookupKey,
          providerStatus: "HEALTHY",
          providerUpdatedAt,
          service: "later-equal",
        });

        await expect(projectHostedLinqChatHealthInventoryChunk({
          chats: prepared.slice(0, 1),
          observedAt: replayObservedAt,
          prisma,
        })).resolves.toBe(0);
        await expect(prisma.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: chatLookupKey },
          select: {
            phoneNumberLookupKey: true,
            providerStatus: true,
            providerUpdatedAt: true,
            service: true,
          },
        })).resolves.toEqual({
          phoneNumberLookupKey: secondLineLookupKey,
          providerStatus: "HEALTHY",
          providerUpdatedAt,
          service: "later-equal",
        });
        await expect(prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: firstLineLookupKey },
          select: { providerLastSeenAt: true },
        })).resolves.toEqual({ providerLastSeenAt: replayObservedAt });
        await expect(prisma.hostedLinqLine.count({
          where: {
            phoneNumberLookupKey: {
              in: [firstLineLookupKey, secondLineLookupKey],
            },
          },
        })).resolves.toBe(2);
      } finally {
        await prisma.hostedLinqChatHealth.deleteMany({
          where: { linqChatLookupKey: chatLookupKey },
        });
        await prisma.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: {
              in: [firstLineLookupKey, secondLineLookupKey],
            },
          },
        });
        await prisma.$disconnect();
      }
    });

    it("preserves the newer projection when opposite current key versions concurrently migrate one legacy chat", async () => {
      const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const applicationSuffix = randomUUID().slice(0, 8);
      const olderApplicationName = `linq_health_older_${applicationSuffix}`;
      const newerApplicationName = `linq_health_newer_${applicationSuffix}`;
      const olderWriter = createPrismaClient({
        databaseUrl: withPostgresApplicationName(databaseUrl, olderApplicationName),
        poolMax: 1,
      });
      const newerWriter = createPrismaClient({
        databaseUrl: withPostgresApplicationName(databaseUrl, newerApplicationName),
        poolMax: 1,
      });
      const chatId = `pg-chat-health-race-${randomUUID()}`;
      const restoreV1 = configureHostedContactPrivacyKeyringForTest({
        currentVersion: "v1",
        entries: { v1: TEST_KEYRING_ENTRIES.v1 },
      });
      const legacyChatLookupKey = createHostedLinqChatLookupKey(chatId);
      restoreV1();
      const restoreV2 = configureHostedContactPrivacyKeyringForTest({
        currentVersion: "v2",
        entries: TEST_KEYRING_ENTRIES,
      });
      const currentChatLookupKey = createHostedLinqChatLookupKey(chatId);
      const olderProjection = prepareHostedLinqChatHealthInventoryProjection([{
        chatId,
        isGroup: false,
        linePhoneNumber: null,
        providerStatus: "AT_RISK",
        providerUpdatedAt: new Date("2026-08-11T14:01:00.000Z"),
        service: "older",
      }]);
      restoreV2();
      const restoreV1WithReadCandidates = configureHostedContactPrivacyKeyringForTest({
        currentVersion: "v1",
        entries: TEST_KEYRING_ENTRIES,
      });
      const newerProjection = prepareHostedLinqChatHealthInventoryProjection([{
        chatId,
        isGroup: false,
        linePhoneNumber: null,
        providerStatus: "CRITICAL",
        providerUpdatedAt: new Date("2026-08-11T14:02:00.000Z"),
        service: "newer",
      }]);
      const staleProjection = prepareHostedLinqChatHealthInventoryProjection([{
        chatId,
        isGroup: false,
        linePhoneNumber: null,
        providerStatus: "AT_RISK",
        providerUpdatedAt: new Date("2026-08-11T14:02:00.000Z"),
        service: "stale-observation",
      }]);
      restoreV1WithReadCandidates();
      if (!legacyChatLookupKey || !currentChatLookupKey) {
        await Promise.all([
          blocker.$disconnect(),
          observer.$disconnect(),
          olderWriter.$disconnect(),
          newerWriter.$disconnect(),
        ]);
        throw new Error("Expected versioned Hosted Linq chat lookup keys.");
      }

      let releaseLegacyRowLock!: () => void;
      const legacyRowLockRelease = new Promise<void>((resolve) => {
        releaseLegacyRowLock = resolve;
      });
      let legacyRowLocked!: () => void;
      const legacyRowLockAcquired = new Promise<void>((resolve) => {
        legacyRowLocked = resolve;
      });

      try {
        await blocker.hostedLinqChatHealth.create({
          data: {
            isGroup: false,
            linqChatLookupKey: legacyChatLookupKey,
            providerObservedAt: new Date("2026-08-11T14:00:00.000Z"),
            providerStatus: "HEALTHY",
            providerUpdatedAt: new Date("2026-08-11T14:00:00.000Z"),
            service: "initial",
          },
        });

        const blockerPromise = blocker.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT linq_chat_lookup_key
            FROM hosted_linq_chat_health
            WHERE linq_chat_lookup_key = ${legacyChatLookupKey}
            FOR UPDATE
          `;
          legacyRowLocked();
          await legacyRowLockRelease;
        });
        await legacyRowLockAcquired;

        const older = applyPreparedProjection({
          chats: olderProjection,
          observedAt: new Date("2026-08-11T14:01:00.000Z"),
          prisma: olderWriter,
        });
        await waitForPostgresLock({
          applicationName: olderApplicationName,
          observer,
        });
        const newer = applyPreparedProjection({
          chats: newerProjection,
          observedAt: new Date("2026-08-11T14:02:00.000Z"),
          prisma: newerWriter,
        });
        await waitForPostgresAdvisoryLock({
          applicationName: newerApplicationName,
          observer,
        });
        releaseLegacyRowLock();
        await blockerPromise;
        await expect(Promise.all([older, newer])).resolves.toEqual([
          1,
          1,
        ]);

        await expect(observer.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: legacyChatLookupKey },
          select: {
            providerStatus: true,
            providerUpdatedAt: true,
            service: true,
          },
        })).resolves.toEqual({
          providerStatus: "CRITICAL",
          providerUpdatedAt: new Date("2026-08-11T14:02:00.000Z"),
          service: "newer",
        });
        await expect(observer.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: currentChatLookupKey },
        })).resolves.toBeNull();
        await expect(applyPreparedProjection({
          chats: staleProjection,
          observedAt: new Date("2026-08-11T14:01:30.000Z"),
          prisma: olderWriter,
        })).resolves.toBe(0);
        await expect(observer.hostedLinqChatHealth.findUnique({
          where: { linqChatLookupKey: legacyChatLookupKey },
          select: {
            providerStatus: true,
            providerUpdatedAt: true,
            service: true,
          },
        })).resolves.toEqual({
          providerStatus: "CRITICAL",
          providerUpdatedAt: new Date("2026-08-11T14:02:00.000Z"),
          service: "newer",
        });
      } finally {
        releaseLegacyRowLock();
        await observer.hostedLinqChatHealth.deleteMany({
          where: {
            linqChatLookupKey: {
              in: [legacyChatLookupKey, currentChatLookupKey],
            },
          },
        });
        await Promise.all([
          blocker.$disconnect(),
          observer.$disconnect(),
          olderWriter.$disconnect(),
          newerWriter.$disconnect(),
        ]);
      }
    });
  },
);

async function waitForPostgresLock(input: {
  applicationName: string;
  observer: ReturnType<typeof createPrismaClient>;
}): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE application_name = ${input.applicationName}
        AND state = 'active'
    `;
    if (activity?.waitEventType === "Lock") {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the chat-health projection to wait on the row lock.");
}

async function waitForPostgresAdvisoryLock(input: {
  applicationName: string;
  observer: ReturnType<typeof createPrismaClient>;
}): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<
      Array<{ waiting: boolean }>
    >`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity AS activity
        INNER JOIN pg_locks AS held_lock
          ON held_lock.pid = activity.pid
        WHERE activity.application_name = ${input.applicationName}
          AND activity.state = 'active'
          AND held_lock.locktype = 'advisory'
          AND held_lock.granted = FALSE
      ) AS waiting
    `;
    if (activity?.waiting === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "Expected the chat-health projection to wait on the complete advisory lock set.",
  );
}

function withPostgresApplicationName(value: string, applicationName: string): string {
  const url = new URL(value);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

async function applyProjection(input: {
  chatId: string;
  linePhoneNumber: string | null;
  observedAt: Date;
  prisma: Parameters<typeof projectHostedLinqChatHealthInventoryChunk>[0]["prisma"];
  providerStatus: "AT_RISK" | "CRITICAL" | "OPTED_OUT";
  providerUpdatedAt: Date;
  service?: string;
}): Promise<number> {
  return projectHostedLinqChatHealthInventoryChunk({
    chats: prepareHostedLinqChatHealthInventoryProjection([{
      chatId: input.chatId,
      isGroup: false,
      linePhoneNumber: input.linePhoneNumber,
      providerStatus: input.providerStatus,
      providerUpdatedAt: input.providerUpdatedAt,
      service: input.service ?? "iMessage",
    }]),
    observedAt: input.observedAt,
    prisma: input.prisma,
  });
}

async function applyPreparedProjection(input: {
  chats: ReturnType<typeof prepareHostedLinqChatHealthInventoryProjection>;
  observedAt: Date;
  prisma: Parameters<typeof projectHostedLinqChatHealthInventoryChunk>[0]["prisma"];
}): Promise<number> {
  return projectHostedLinqChatHealthInventoryChunk(input);
}

function buildSyntheticProofPhoneNumber(): string {
  return `+1555${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
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

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
