import { execFileSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { drainGameChatLifecycle } from "@/src/lib/game/chat-lifecycle";
import { buildHostedLinqDeliveryId } from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: vi.fn() }));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Lifecycle drain proof requires an isolated local test database.");

const receiptIds: string[] = [];

function receipt(input: { eventId: string; template: string; sourceRef: string | null; attemptedAt: Date }) {
  const key = createHostedLinqDeliveryIdempotencyLookupKey(input.eventId);
  if (!key) throw new Error("Expected a synthetic delivery key.");
  const id = buildHostedLinqDeliveryId(key);
  receiptIds.push(id);
  return { id, idempotencyKey: key, source: "game_lifecycle", sourceRef: input.sourceRef, template: input.template,
    status: "awaiting_generation", targetKind: "thread", attemptedAt: input.attemptedAt };
}

describe.skipIf(!enabled)("game lifecycle drain against PostgreSQL", () => {
  afterAll(async () => {
    await getPrisma().hostedLinqDelivery.deleteMany({ where: { id: { in: receiptIds } } });
  });

  it("never lets an older receipt it cannot process block a supported one", async () => {
    const db = getPrisma();
    const missingGameId = randomUUID();
    // Oldest due rows: a template from a newer build, and one without a source.
    const unknown = receipt({ eventId: `game-future:${randomUUID()}`, template: "game_future_notice", sourceRef: randomUUID(), attemptedAt: new Date(0) });
    const sourceless = receipt({ eventId: `game-started:${randomUUID()}`, template: "game_started", sourceRef: null, attemptedAt: new Date(1_000) });
    // Next: a supported notice for a game that no longer exists, which the
    // drain must reach and supersede.
    const supported = receipt({ eventId: `game-cancelled:${missingGameId}`, template: "game_cancelled", sourceRef: missingGameId, attemptedAt: new Date(2_000) });
    await db.hostedLinqDelivery.createMany({ data: [unknown, sourceless, supported] });

    const result = await drainGameChatLifecycle({ prisma: db, now: new Date() });

    expect(result.attempted).toBe(1);
    expect(await db.hostedLinqDelivery.findUnique({ where: { id: supported.id } })).toMatchObject({ status: "skipped", skipReason: "game_lifecycle_superseded" });
    for (const untouched of [unknown, sourceless]) {
      expect(await db.hostedLinqDelivery.findUnique({ where: { id: untouched.id } })).toMatchObject({ status: "awaiting_generation", attemptedAt: untouched.attemptedAt });
    }
  });
  // Needs git history for the base sweeper; CI checks out one commit, so this runs in the local skew lane.
  it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("keeps new resolution receipts isolated from the old sweeper, then handles them with the new one", async () => {
    const target = new URL(`../src/lib/game/.plan-a-legacy-lifecycle-${randomUUID()}.ts`, import.meta.url);
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    await writeFile(target, execFileSync("git", ["show", "b2694496c0665990fa0fd283b5041e5018a38d3e:apps/web/src/lib/game/chat-lifecycle.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
    try {
      const old = await import(target.href) as typeof import("@/src/lib/game/chat-lifecycle");
      const missing = randomUUID(), proposal = randomUUID();
      const resolved = receipt({ eventId: `game-change-resolved:${missing}:${proposal}`, template: "game_change_resolved", sourceRef: `${missing}:${proposal}`, attemptedAt: new Date(0) });
      const supported = receipt({ eventId: `game-cancelled:${missing}`, template: "game_cancelled", sourceRef: missing, attemptedAt: new Date(1_000) });
      await getPrisma().hostedLinqDelivery.createMany({ data: [resolved, supported] });
      expect((await old.drainGameChatLifecycle()).attempted).toBe(1);
      expect(await getPrisma().hostedLinqDelivery.findUnique({ where: { id: resolved.id } })).toMatchObject({ status: "awaiting_generation", attemptedAt: new Date(0) });
      expect((await drainGameChatLifecycle()).attempted).toBe(1);
      expect(await getPrisma().hostedLinqDelivery.findUnique({ where: { id: resolved.id } })).toMatchObject({ status: "skipped" });
    } finally { await rm(target, { force: true }); }
  });

});
