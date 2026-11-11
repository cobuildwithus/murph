import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../src/lib/prisma";
import {
  PrismaComputerUseStore,
  type ComputerHandoffCreateInput,
} from "../src/lib/computer-use/store";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)
    || url.search || url.hash) {
    throw new Error("Computer handoff proof requires an isolated local Murph test database.");
  }
}

const kinds = ["pause", "attach", "replace"] as const;
type Transition = typeof kinds[number];

describe.skipIf(!enabled)("computer handoff PostgreSQL publication", () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let store: PrismaComputerUseStore;
  beforeAll(() => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
    store = new PrismaComputerUseStore(prisma);
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  async function withRun(kind: Transition, test: (fixture: Awaited<ReturnType<typeof createRun>>) => Promise<void>) {
    const fixture = await createRun(kind);
    try { await test(fixture); }
    finally { await prisma.hostedMember.delete({ where: { id: fixture.memberId } }); }
  }

  function prepareHandoff(): ComputerHandoffCreateInput {
    return {
      expiresAt: new Date(Date.now() + 1_200_000),
      id: `hch_${randomUUID()}`,
      purpose: "login",
      returnContactKind: null,
      suggestedReply: "done",
      tokenHash: randomUUID(),
    };
  }

  async function createRun(kind: Transition) {
    const memberId = `member_computer_test_${randomUUID()}`;
    await prisma.hostedMember.create({ data: { id: memberId } });
    const now = new Date();
    const run = await prisma.hostedComputerRun.create({ data: {
      awaitingReason: kind === "pause" ? null : "login_needed",
      expiresAt: new Date(now.getTime() + 3_600_000),
      id: `hcr_${randomUUID()}`,
      kernelProfileName: "synthetic-profile",
      kernelSessionId: "synthetic-browser",
      memberId,
      pausedAt: kind === "pause" ? null : now,
      status: kind === "pause" ? "running" : "awaiting_user",
    } });
    const previous = kind === "replace"
      ? await prisma.hostedComputerHandoff.create({ data: {
          ...prepareHandoff(), memberId, runId: run.id,
        } })
      : null;
    if (previous) {
      await prisma.hostedComputerRun.update({
        data: { pendingHandoffId: previous.id }, where: { id: run.id },
      });
    }
    async function transition(handoff: ComputerHandoffCreateInput) {
      const common = { handoff, memberId, now, runId: run.id };
      if (kind === "pause") {
        return store.markRunAwaitingUser({
          ...common, awaitingReason: "login_needed", checkpointContext: null, suggestedReply: "done",
        });
      }
      if (kind === "attach") {
        return store.attachAwaitingRunHandoff({
          ...common, awaitingReason: "login_needed", expectedPausedAt: now,
        });
      }
      return store.replaceAwaitingRunHandoff({
        ...common,
        expectedHandoffUpdatedAt: previous!.updatedAt,
        expectedPendingHandoffId: previous!.id,
      });
    }
    return { memberId, previous, run, transition };
  }

  it.each(kinds)("%s rolls back the run and preserves the prior capability when insertion fails", (kind) => withRun(kind, async (f) => {
    const blocker = f.previous ?? await prisma.hostedComputerHandoff.create({ data: {
      ...prepareHandoff(), memberId: f.memberId, runId: f.run.id,
    } });
    const before = await prisma.hostedComputerRun.findUniqueOrThrow({ where: { id: f.run.id } });
    const handoff = { ...prepareHandoff(), tokenHash: blocker.tokenHash };
    await expect(f.transition(handoff)).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.hostedComputerRun.findUniqueOrThrow({ where: { id: f.run.id } })).toEqual(before);
    expect(await prisma.hostedComputerHandoff.findUnique({ where: { id: handoff.id } })).toBeNull();
    expect(await prisma.hostedComputerHandoff.findUnique({ where: { id: blocker.id } })).toMatchObject({ status: "open" });
  }));

  it.each(kinds)("%s admits one competing capability and leaves no orphan", (kind) => withRun(kind, async (f) => {
    const handoffs = [prepareHandoff(), prepareHandoff()];
    const results = await Promise.allSettled(handoffs.map(f.transition));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toMatchObject([
      { reason: { code: "HOSTED_COMPUTER_RUN_STATE_CHANGED" } },
    ]);
    const current = await prisma.hostedComputerRun.findUniqueOrThrow({ where: { id: f.run.id } });
    const stored = await prisma.hostedComputerHandoff.findMany({ where: { runId: f.run.id } });
    expect(stored.filter((handoff) => handoff.status === "open").map((handoff) => handoff.id)).toEqual([current.pendingHandoffId]);
    expect(stored).toHaveLength(f.previous ? 2 : 1);
    if (f.previous) {
      expect(stored.find((handoff) => handoff.id === f.previous!.id)).toMatchObject({ status: "expired" });
    }
  }));

  it.each(kinds)("%s rejects suspended members before changing either owner", (kind) => withRun(kind, async (f) => {
    await prisma.hostedMember.update({ data: { suspendedAt: new Date() }, where: { id: f.memberId } });
    const handoff = prepareHandoff();
    const before = await prisma.hostedComputerRun.findUniqueOrThrow({ where: { id: f.run.id } });
    await expect(f.transition(handoff)).rejects.toMatchObject({ code: "HOSTED_COMPUTER_MEMBER_SUSPENDED" });
    expect(await prisma.hostedComputerRun.findUniqueOrThrow({ where: { id: f.run.id } })).toEqual(before);
    expect(await prisma.hostedComputerHandoff.findUnique({ where: { id: handoff.id } })).toBeNull();
  }));

  it("drops only the retired pause message after reader convergence, idempotently", () => withRun("pause", async (f) => {
    const migration = await readFile(new URL(
      "../prisma/contract-migrations/20261110231500_drop_computer_awaiting_message/migration.sql",
      import.meta.url,
    ), "utf8");
    await prisma.$executeRawUnsafe('ALTER TABLE "hosted_computer_run" ADD COLUMN IF NOT EXISTS "awaiting_message" TEXT');
    await prisma.$executeRaw`UPDATE hosted_computer_run SET awaiting_message = 'synthetic retired message' WHERE id = ${f.run.id}`;
    await prisma.$executeRawUnsafe(migration);
    await prisma.$executeRawUnsafe(migration);
    expect(await prisma.$queryRaw`SELECT attname FROM pg_attribute WHERE attrelid = 'hosted_computer_run'::regclass AND attname = 'awaiting_message' AND NOT attisdropped`).toEqual([]);
    expect(await prisma.hostedComputerRun.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ id: f.run.id, status: "running" });
  }));

});
