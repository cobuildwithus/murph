import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), signal: vi.fn(), usage: vi.fn() }));
vi.mock("@/src/lib/prisma", async original => ({ ...await original<typeof import("@/src/lib/prisma")>(), getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: mocks.signal }));
// Only the late-withdrawal race overrides the gate; all other reads use its real implementation.
vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", async original => ({
  ...await original<typeof import("@/src/lib/hosted-orchestration/runtime-usage-decision")>(), resolveHostedRuntimeAiUsageGate: mocks.usage,
}));
import { createPrismaClient } from "@/src/lib/prisma";
import { HOSTED_HEALTH_DATA_CONSENT_SCOPE } from "@/src/lib/legal/consent";
import * as access from "@/src/lib/hosted-onboarding/member-access";
import { runHostedPreferenceHandoffSweeper } from "@/src/lib/hosted-orchestration/preference-handoff-sweeper";
import { readHostedRuntimeReconciliationFacts } from "@/src/lib/hosted-orchestration/runtime-reconciliation-facts";
import { runHostedRuntimeSignalRetentionCleanup } from "@/src/lib/hosted-retention/cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname) || url.search || url.hash) {
    throw new Error("Recovery proof requires an isolated loopback test database.");
  }
}
const day = 24 * 60 * 60 * 1000;
const now = new Date("2030-06-15T12:00:00Z");
const logger = { info() {}, warn() {} };
const families = [
  ["journal.group-fact.recorded", () => `journal:${randomUUID()}`],
  ["member.channels.updated", () => `channels:${randomUUID()}`],
  ["assistant.notification.requested", () => "assistant.notification.requested:group-join:membership"],
  ["assistant.notification.requested", () => `assistant.notification.requested:group-sharing-confirmed:${"a".repeat(64)}`],
  ["assistant.notification.requested", (id: string) => `assistant.notification.requested:signup-welcome:${id}:email:${"b".repeat(64)}`],
  ["assistant.notification.requested", (id: string) => `assistant.notification.requested:signup-welcome:${id}:linq:${"c".repeat(64)}`],
] as const;

describe.skipIf(!enabled)("recovery selection and quiescent facts PostgreSQL", () => {
  let db: PrismaClient;
  const ids: string[] = [];
  beforeAll(async () => {
    db = createPrismaClient({ databaseUrl, poolMax: 1 });
    mocks.getPrisma.mockReturnValue(db);
    const actual = await vi.importActual<typeof import("@/src/lib/hosted-orchestration/runtime-usage-decision")>("@/src/lib/hosted-orchestration/runtime-usage-decision");
    mocks.usage.mockImplementation(actual.resolveHostedRuntimeAiUsageGate);
  });
  afterEach(async () => {
    await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: ids } } });
    await db.hostedMember.deleteMany({ where: { id: { in: ids.splice(0) } } });
    mocks.signal.mockReset();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function member(state: "active" | "unpaid" | "revoked" | "revoked_inactive" | "suspended" | "granted" | "missing" = "active") {
    const id = randomUUID(); ids.push(id);
    await db.hostedMember.create({ data: { id, billingStatus: ["unpaid", "missing", "revoked_inactive"].includes(state) ? "not_started" : "active", suspendedAt: state === "suspended" ? now : null } });
    if (["revoked", "revoked_inactive", "granted", "unpaid"].includes(state)) await db.hostedConsentGrant.create({ data: {
      memberId: id, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: state === "granted" || state === "unpaid" ? "granted" : "revoked", source: "synthetic", documentVersionsJson: {}, grantedAt: now,
    } });
    return id;
  }
  async function item(userId: string, age = 120_000, kind = "member.preferences.updated", dedupeKey: string = randomUUID(), laneSeq = 1n) {
    return db.hostedMailboxItem.create({ data: { id: randomUUID(), userId, kind, dedupeKey, lane: "system", laneSeq, createdAt: new Date(now.getTime() - age), occurredAt: now, payloadSchema: "synthetic" } });
  }
  async function sweep(at = now) {
    mocks.signal.mockClear().mockResolvedValue({ signalAccepted: true, workflowId: "synthetic" });
    return runHostedPreferenceHandoffSweeper({ now: at, logger });
  }

  it.each(families)("caps recent family %s (%#) without changing import or expiry ownership", async (kind, key) => {
    const id = await member();
    const row = await item(id, day + 1_000, kind, key(id));
    expect((await sweep()).candidateUsers).toBe(0);
    await db.hostedMailboxItem.update({ where: { id: row.id }, data: { createdAt: new Date(now.getTime() - day + 1_000) } });
    expect((await sweep()).handoffAccepted).toBe(1);
    expect(mocks.signal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mailboxItemId: row.id, expectedUserId: id }));
    await db.hostedMailboxItem.update({ where: { id: row.id }, data: { expiresAt: now } });
    expect((await sweep()).candidateUsers).toBe(0);
    await db.hostedMailboxItem.update({ where: { id: row.id }, data: { expiresAt: null } });
    await db.hostedWorkspace.create({ data: { userId: id, redactedStatusJson: { hostedMailboxSystemImportedSeq: "2", hostedMailboxSystemHandledThroughSeq: "0" } } });
    expect((await sweep()).candidateUsers).toBe(0);
  });

  it("keeps the six existing kinds eligible at thirteen days", async () => {
    for (const kind of ["member.preferences.updated", "member.action.requested", "device-sync.wake", "health.daily-metric.reported", "runtime.browser-vault-refresh-requested", "runtime.maintenance-requested"]) await item(await member(), 13 * day, kind);
    expect((await sweep()).handoffAccepted).toBe(6);
  });

  it("does not select unrelated or malformed notification keys", async () => {
    const id = await member();
    const prefix = "assistant.notification.requested:";
    const keys = [`signup-welcome:${id}`, `signup-welcome:${id}:linq`, `signup-welcome:another-member:email:${"a".repeat(64)}`, "group-join:membership:extra", "group-sharing-confirmed:not-hex", "phone-call-result:call", `signup-welcome:${id}:activation-event`, `group-sharing-confirmed:${"A".repeat(64)}`, "group-join:", `signup-welcome:${id}:email:${"a".repeat(64)}:extra`];
    for (const [index, key] of keys.entries()) await item(id, 120_000, "assistant.notification.requested", prefix + key, BigInt(index + 1));
    await item(id, 120_000, "assistant.notification.requested", "assistantXnotificationXrequested:group-join:membership", 20n);
    expect((await sweep()).candidateUsers).toBe(0);
  });

  it.each(["revoked", "suspended"] as const)("excludes 25 older %s members before the default limit and rediscovers a regrant", async state => {
    const excluded = [];
    for (let i = 0; i < 25; i++) excluded.push(await item(await member(state), 180_000 + i));
    const eligible = await item(await member()); // A missing historical grant remains eligible.
    expect((await sweep()).handoffAccepted).toBe(1);
    expect(mocks.signal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mailboxItemId: eligible.id, expectedUserId: eligible.userId }));
    if (state === "revoked") {
      const restored = excluded[0]!;
      await db.hostedConsentGrant.update({ where: { memberId_scope: { memberId: restored.userId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE } }, data: { status: "granted" } });
      await db.hostedWorkspace.create({ data: { userId: restored.userId } });
      expect((await sweep()).handoffAccepted).toBe(2);
      const facts = await readHostedRuntimeReconciliationFacts({ userId: restored.userId, now });
      expect(facts.mailboxLag).toContainEqual(expect.objectContaining({ lane: "system", lag: "1" }));
      expect(facts.workspace?.systemMailboxFrontier).not.toBeNull();
    }
  });

  it("applies the claim floor to the container itself, not its withdrawn owner", async () => {
    const ownerMemberId = await member("revoked"), id = await member("unpaid");
    await db.hostedThreadContainer.create({ data: { memberId: id, ownerMemberId } });
    const row = await item(id);
    expect((await sweep()).handoffAccepted).toBe(1);
    expect(mocks.signal).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: id, mailboxItemId: row.id }));
  });

  it("keeps ORM and SQL claim floors equal for suspended, revoked, granted and missing grants", async () => {
    for (const state of ["suspended", "revoked", "revoked_inactive", "granted", "active", "unpaid"] as const) await member(state);
    const orm = await db.hostedMember.findMany({ select: { id: true }, where: { id: { in: ids }, AND: [access.hostedRuntimeMemberEligibleWhere()] }, orderBy: { id: "asc" } });
    const sql = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "member"."id" FROM "hosted_member" AS "member" WHERE "member"."id" IN (${Prisma.join(ids)}) AND ${access.hostedRuntimeMemberEligibleSql()} ORDER BY "member"."id"`);
    expect(sql).toEqual(orm);
    expect(orm.map(row => row.id).sort()).toEqual(ids.slice(3).sort());
  });

  it("projects and signals only claimable retention, before the five-row limit, and preserves deadlines for restoration", async () => {
    const states = ["suspended", "revoked", "revoked_inactive", "suspended", "revoked", "revoked_inactive", "unpaid", "missing"] as const;
    const deadlines = new Map<string, Date>();
    for (const state of states) {
      const eligible = state === "unpaid" || state === "missing";
      const deadline = new Date(now.getTime() - (eligible ? 60_000 : 120_000));
      const id = await member(state);
      deadlines.set(id, deadline);
      await db.hostedWorkspace.create({ data: { userId: id, inboxMediaRetentionWakeAt: deadline } });
      const facts = await readHostedRuntimeReconciliationFacts({ userId: id, now: new Date(deadline.getTime() - 1_000) });
      expect.soft(facts.workspace?.inboxMediaRetentionWakeAt).toBe(eligible ? deadline.toISOString() : null);
      if (eligible) expect(facts.blocked?.retryAt).toBe(deadline.toISOString());
      if (!eligible) expect.soft(facts.blocked?.retryAt).toBeNull();
    }
    const signal = vi.fn(async () => {});
    const result = await runHostedRuntimeSignalRetentionCleanup({ now, prisma: db, signalRuntimeRecheck: signal });
    expect.soft(result.inboxMediaRetentionRuntimeSignalsSent).toBe(2);
    expect.soft(signal.mock.calls).toHaveLength(2);
    const stored = await db.hostedWorkspace.findMany({ where: { userId: { in: ids } } });
    for (const row of stored) {
      expect(row.inboxMediaRetentionWakeAt).toEqual(deadlines.get(row.userId));
      expect.soft(row.inboxMediaRetentionSignalAttemptedAt).toEqual(ids.slice(6).includes(row.userId) ? now : null);
    }
    await db.hostedMember.update({ where: { id: ids[0]! }, data: { suspendedAt: null } });
    await db.hostedConsentGrant.updateMany({ where: { memberId: { in: ids.slice(1, 3) } }, data: { status: "granted" } });
    signal.mockClear();
    await runHostedRuntimeSignalRetentionCleanup({ now, prisma: db, signalRuntimeRecheck: signal });
    for (const userId of ids.slice(0, 3)) {
      expect(signal).toHaveBeenCalledWith(expect.objectContaining({ userId }));
      expect(await db.hostedWorkspace.findUnique({ where: { userId } })).toMatchObject({ inboxMediaRetentionWakeAt: deadlines.get(userId), inboxMediaRetentionSignalAttemptedAt: now });
    }
  });

  it.each([false, true])("makes both revoked exits identically quiescent (generation fields: %s)", async generation => {
    const id = await member("revoked");
    await item(id, 120_000, "device-sync.wake", "device-sync:duplicate", 2n);
    // Fresh conversation lag reaches the usage gate despite the model-free wake.
    await db.hostedMailboxItem.create({ data: { id: randomUUID(), userId: id, lane: "conversation", laneSeq: 1n, kind: "conversation.message", dedupeKey: randomUUID(), createdAt: now, occurredAt: now, payloadSchema: "synthetic" } });
    const deadline = new Date(now.getTime() - 1_000);
    const stored = await db.hostedWorkspace.create({ data: { userId: id, version: 3n, nextWakeAt: deadline, nextWakeReason: "device-sync.reconcile", inboxMediaRetentionWakeAt: deadline,
      ...(generation ? { systemMailboxProgressGeneration: 2n, nextDefaultProcessingWakeAt: deadline, nextDefaultProcessingWakeReason: "assistant" } : {}),
      redactedStatusJson: { hostedMailboxSystemImportedSeq: "1", hostedMailboxSystemHandledThroughSeq: "0" },
    } });
    const grant = (status: string) => db.hostedConsentGrant.update({ where: { memberId_scope: { memberId: id, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE } }, data: { status } });
    const early = await readHostedRuntimeReconciliationFacts({ userId: id, now });
    // The early consent read passes; the withdrawal commits before the usage gate observes it.
    await grant("granted");
    mocks.usage.mockImplementationOnce(async () => {
      await grant("revoked");
      return { status: "health_data_consent_withdrawn" };
    });
    const late = await readHostedRuntimeReconciliationFacts({ userId: id, now });
    for (const facts of [early, late]) {
      expect.soft(facts.blocked).toEqual({ reason: "health_data_consent_withdrawn", retryAt: null });
      expect.soft(facts.mailboxLag).toEqual([]);
      expect.soft(Object.hasOwn(facts.workspace!, "systemMailboxFrontier")).toBe(true);
      expect.soft(facts.workspace).toMatchObject({ systemMailboxFrontier: null, inboxMediaRetentionWakeAt: null, nextWakeAt: null, nextWakeReason: null, version: "3", hostedMailboxSystemHandledThroughSeq: "0" });
      expect.soft(Object.hasOwn(facts.workspace!, "nextDefaultProcessingWakeAt")).toBe(generation);
      if (generation) expect.soft(facts.workspace).toMatchObject({ nextDefaultProcessingWakeAt: null, nextDefaultProcessingWakeReason: null, systemMailboxProgressGeneration: "2" });
    }
    expect.soft(late).toEqual(early);
    expect(await db.hostedWorkspace.findUnique({ where: { userId: id } })).toEqual(stored);
  });

  it("keeps a container's retention and model-free work when only its owner withdrew", async () => {
    const ownerMemberId = await member("revoked"), id = await member("missing");
    await db.hostedThreadContainer.create({ data: { memberId: id, ownerMemberId } });
    await item(id, 120_000, "device-sync.wake", "device-sync:container", 2n);
    await db.hostedMailboxItem.create({ data: { id: randomUUID(), userId: id, lane: "conversation", laneSeq: 1n, kind: "conversation.message", dedupeKey: randomUUID(), createdAt: now, occurredAt: now, payloadSchema: "synthetic" } });
    const deadline = new Date(now.getTime() - 1_000);
    await db.hostedWorkspace.create({ data: { userId: id, inboxMediaRetentionWakeAt: deadline, redactedStatusJson: { hostedMailboxSystemImportedSeq: "1", hostedMailboxSystemHandledThroughSeq: "1" } } });
    // The real gate reports the owner's denial; claim admits this container for both modes below.
    const facts = await readHostedRuntimeReconciliationFacts({ userId: id, now });
    expect(facts.blocked).toEqual({ reason: "health_data_consent_withdrawn", retryAt: null });
    expect(facts.mailboxLag).toContainEqual(expect.objectContaining({ lane: "system", lag: "1" }));
    expect(facts.workspace).toMatchObject({ inboxMediaRetentionWakeAt: deadline.toISOString(), systemMailboxFrontier: "model_free" });
    const signal = vi.fn(async () => {});
    await runHostedRuntimeSignalRetentionCleanup({ now, prisma: db, signalRuntimeRecheck: signal });
    expect(signal).toHaveBeenCalledWith(expect.objectContaining({ userId: id }));
  });

  it("keeps a withdrawn missing workspace null", async () => {
    const id = await member("revoked");
    expect(await readHostedRuntimeReconciliationFacts({ userId: id, now })).toEqual({ blocked: { reason: "health_data_consent_withdrawn", retryAt: null }, mailboxLag: [], workspace: null });
  });
});
