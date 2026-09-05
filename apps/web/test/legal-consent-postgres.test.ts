import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { withdrawHostedHealthDataConsent } from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import {
  buildCurrentHostedConsentDocumentVersions,
  readHostedHealthDataConsentState,
  recordHostedLaunchConsentDecline,
  recordHostedLaunchRequiredConsent,
  revokeHostedConsentScope,
} from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.MURPH_CONSENT_TEST_DB_URL?.trim() ?? "";
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/(murph_consent_test|murph_dev_[a-z0-9_]+)$/u.test(url.pathname)
  ) {
    throw new Error("Consent proof requires a dedicated local test database.");
  }
}

const acceptedAt = new Date("2026-08-01T12:00:00.000Z");
const declinedAt = new Date("2026-08-02T12:00:00.000Z");
const laterAt = new Date("2026-08-03T12:00:00.000Z");
const healthScope = "launch.health-data";
const source = "consent-postgres-test";

type Fixture = {
  memberId: string;
  observer: PrismaClient;
  writer: PrismaClient;
  contender: PrismaClient;
};

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const fixture = {
    memberId: `consent-proof-${randomUUID()}`,
    observer: createPrismaClient({ databaseUrl, poolMax: 1 }),
    writer: createPrismaClient({ databaseUrl, poolMax: 1 }),
    contender: createPrismaClient({ databaseUrl, poolMax: 1 }),
  };
  try {
    await fixture.observer.hostedMember.create({ data: { id: fixture.memberId } });
    await run(fixture);
  } finally {
    try {
      await fixture.observer.hostedMember.deleteMany({ where: { id: fixture.memberId } });
    } finally {
      await Promise.all([
        fixture.observer.$disconnect(), fixture.writer.$disconnect(), fixture.contender.$disconnect(),
      ]);
    }
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Only intercept the transaction boundary. Every query and commit/rollback
// still runs through the real Prisma client and PostgreSQL connection.
function wrapTransactions(
  prisma: PrismaClient,
  run: (tx: Prisma.TransactionClient, callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => Promise<unknown>,
): PrismaClient {
  return new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number }) =>
          target.$transaction((tx) => run(tx, callback), options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function waitForBlockedBackend(observer: PrismaClient, pid: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected a real PostgreSQL uniqueness conflict to block the retry.");
}

function readLedger(f: Fixture) {
  return f.observer.hostedConsentEvent.findMany({
    orderBy: [{ createdAt: "asc" }, { scope: "asc" }],
    where: { memberId: f.memberId },
  });
}

function accept(f: Fixture, scope: "launch.legal" | "launch.health-data" = healthScope) {
  return recordHostedLaunchRequiredConsent({
    memberId: f.memberId, now: acceptedAt, prisma: f.writer, scope, source,
  });
}

describe.skipIf(!databaseUrl)("hosted consent PostgreSQL persistence", () => {
  it("deduplicates a blocked same-session decline without replacing the original audit values", async () => {
    await withFixture(async (f) => {
      const inserted = deferred();
      const release = deferred();
      const heldWriter = wrapTransactions(f.writer, async (tx, callback) => {
        const result = await callback(tx);
        inserted.resolve();
        await release.promise;
        return result;
      });
      const [{ pid }] = await f.contender.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      const input = { memberId: f.memberId, sessionId: "synthetic-session", source };
      const first = recordHostedLaunchConsentDecline({ ...input, now: declinedAt, prisma: heldWriter });
      let retry: Promise<unknown> | undefined;
      try {
        await Promise.race([inserted.promise, first.then(() => { throw new Error("Expected an uncommitted decline."); })]);
        retry = recordHostedLaunchConsentDecline({ ...input, now: laterAt, prisma: f.contender, source: "later-retry" });
        await waitForBlockedBackend(f.observer, pid);
        await expect(readLedger(f)).resolves.toEqual([]);
        release.resolve();
        await expect(Promise.all([first, retry])).resolves.toEqual([
          ["launch.legal", healthScope], ["launch.legal", healthScope],
        ]);
      } finally {
        release.resolve();
        await Promise.allSettled([first, ...(retry ? [retry] : [])]);
      }
      const events = await readLedger(f);
      expect(events).toHaveLength(2);
      expect(new Set(events.map((event) => event.id)).size).toBe(2);
      for (const event of events) {
        expect(event).toMatchObject({
          action: "declined", createdAt: declinedAt, metadataJson: null, source,
          documentVersionsJson: buildCurrentHostedConsentDocumentVersions(event.scope === healthScope ? healthScope : "launch.legal"),
        });
      }
      await expect(f.observer.hostedConsentGrant.count({ where: { memberId: f.memberId } })).resolves.toBe(0);
      await recordHostedLaunchConsentDecline({ ...input, now: laterAt, prisma: f.writer });
      await expect(readLedger(f)).resolves.toEqual(events);
      await recordHostedLaunchConsentDecline({ ...input, sessionId: "another-session", now: laterAt, prisma: f.writer });
      const laterEvents = await readLedger(f);
      expect(laterEvents).toHaveLength(4);
      expect(new Set(laterEvents.map((event) => event.id)).size).toBe(4);
    });
  });

  it("declines only pending scopes and leaves accepted grants and their events intact", async () => {
    await withFixture(async (f) => {
      await accept(f, "launch.legal");
      const grant = await f.observer.hostedConsentGrant.findUniqueOrThrow({
        where: { memberId_scope: { memberId: f.memberId, scope: "launch.legal" } },
      });
      await expect(recordHostedLaunchConsentDecline({
        memberId: f.memberId, sessionId: "partial-consent", now: declinedAt, prisma: f.writer, source,
      })).resolves.toEqual([healthScope]);
      const events = await readLedger(f);
      expect(events.map(({ action, scope }) => ({ action, scope }))).toEqual([
        { action: "accepted", scope: "launch.legal" }, { action: "declined", scope: healthScope },
      ]);
      expect(grant.lastEventId).toBe(events[0]?.id);
      await expect(f.observer.hostedConsentGrant.findUniqueOrThrow({
        where: { memberId_scope: { memberId: f.memberId, scope: "launch.legal" } },
      })).resolves.toEqual(grant);
      await accept(f);
      const acceptedLedger = await readLedger(f);
      await expect(recordHostedLaunchConsentDecline({
        memberId: f.memberId, sessionId: "fully-consented", prisma: f.writer, source,
      })).resolves.toEqual([]);
      await expect(readLedger(f)).resolves.toEqual(acceptedLedger);
    });
  });

  it("commits withdrawal authority and its event, preserves legal consent, and makes sequential retry a read", async () => {
    await withFixture(async (f) => {
      await accept(f, "launch.legal");
      await accept(f);
      const acceptedLedger = await readLedger(f);
      const healthAcceptance = acceptedLedger.find((event) => event.scope === healthScope);
      await expect(f.observer.hostedConsentGrant.findUniqueOrThrow({
        where: { memberId_scope: { memberId: f.memberId, scope: healthScope } },
      })).resolves.toMatchObject({ status: "granted", lastEventId: healthAcceptance?.id, grantedAt: acceptedAt, revokedAt: null });
      await expect(withdrawHostedHealthDataConsent({ memberId: f.memberId, prisma: f.writer, source })).resolves.toMatchObject({ launchGranted: false });
      await expect(readHostedHealthDataConsentState({ memberId: f.memberId, prisma: f.observer })).resolves.toBe("revoked");
      const ledger = await readLedger(f);
      const revocation = ledger.find((event) => event.action === "revoked");
      expect(ledger).toHaveLength(3);
      expect(revocation).toMatchObject({ scope: healthScope, source, documentVersionsJson: healthAcceptance?.documentVersionsJson });
      const grant = await f.observer.hostedConsentGrant.findUniqueOrThrow({
        where: { memberId_scope: { memberId: f.memberId, scope: healthScope } },
      });
      expect(grant).toMatchObject({ status: "revoked", lastEventId: revocation?.id, grantedAt: acceptedAt, revokedAt: revocation?.createdAt });
      await withdrawHostedHealthDataConsent({ memberId: f.memberId, prisma: f.writer, source: "sequential-retry" });
      await expect(readLedger(f)).resolves.toEqual(ledger);
      await expect(f.observer.hostedConsentGrant.findUniqueOrThrow({
        where: { memberId_scope: { memberId: f.memberId, scope: healthScope } },
      })).resolves.toEqual(grant);
      await expect(f.observer.hostedConsentGrant.findUniqueOrThrow({
        where: { memberId_scope: { memberId: f.memberId, scope: "launch.legal" } },
      })).resolves.toMatchObject({ status: "granted", revokedAt: null });
    });
  });

  it("keeps missing legacy health consent and immutable legal acceptance unchanged", async () => {
    await withFixture(async (f) => {
      await expect(withdrawHostedHealthDataConsent({ memberId: f.memberId, prisma: f.writer })).rejects.toMatchObject({
        code: "HOSTED_CONSENT_REQUIRED", httpStatus: 409,
      });
      await expect(readLedger(f)).resolves.toEqual([]);
      await expect(f.observer.hostedConsentGrant.count({ where: { memberId: f.memberId } })).resolves.toBe(0);
      await accept(f, "launch.legal");
      const before = await readLedger(f);
      await expect(revokeHostedConsentScope({ memberId: f.memberId, prisma: f.writer, scope: "launch.legal" })).rejects.toMatchObject({
        code: "CONSENT_SCOPE_NOT_REVOCABLE", httpStatus: 400,
      });
      await expect(readLedger(f)).resolves.toEqual(before);
      await expect(f.observer.hostedConsentGrant.findUniqueOrThrow({
        where: { memberId_scope: { memberId: f.memberId, scope: "launch.legal" } },
      })).resolves.toMatchObject({ status: "granted", lastEventId: before[0]?.id, revokedAt: null });
    });
  });

  it.each(["acceptance", "withdrawal"] as const)("rolls back the real event and grant after a failed %s transaction, then permits retry", async (operation) => {
    await withFixture(async (f) => {
      if (operation === "withdrawal") await accept(f);
      const before = await readLedger(f);
      const grantsBefore = await f.observer.hostedConsentGrant.findMany({ where: { memberId: f.memberId } });
      const injectedFailure = new Error("Injected failure after persisted grant write");
      const failingWriter = wrapTransactions(f.writer, async (tx, callback) => {
        await callback(tx);
        // Observe both real writes from inside the transaction before forcing rollback.
        expect(await tx.hostedConsentEvent.count({ where: { memberId: f.memberId } })).toBe(before.length + 1);
        const grant = await tx.hostedConsentGrant.findUniqueOrThrow({
          where: { memberId_scope: { memberId: f.memberId, scope: healthScope } },
        });
        expect(grant.status).toBe(operation === "acceptance" ? "granted" : "revoked");
        expect(await tx.hostedConsentEvent.findUnique({ where: { id: grant.lastEventId! } })).toMatchObject({
          action: operation === "acceptance" ? "accepted" : "revoked",
        });
        throw injectedFailure;
      });
      const run = (prisma: PrismaClient) => operation === "acceptance"
        ? recordHostedLaunchRequiredConsent({ memberId: f.memberId, now: acceptedAt, prisma, scope: healthScope, source })
        : withdrawHostedHealthDataConsent({ memberId: f.memberId, prisma, source });
      await expect(run(failingWriter)).rejects.toBe(injectedFailure);
      await expect(readLedger(f)).resolves.toEqual(before);
      await expect(f.observer.hostedConsentGrant.findMany({ where: { memberId: f.memberId } })).resolves.toEqual(grantsBefore);
      await run(f.writer);
      expect(await readLedger(f)).toHaveLength(before.length + 1);
      await expect(readHostedHealthDataConsentState({ memberId: f.memberId, prisma: f.observer })).resolves.toBe(operation === "acceptance" ? "granted" : "revoked");
    });
  });
});
