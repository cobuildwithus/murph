import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthWinObservations } from "../src/lib/health-wins/achievement";
import {
  claimHealthWinDayTx, finishHealthWinEvaluationTx, isHealthWinClaimCurrentTx, recordHealthWinPresentationTx,
} from "../src/lib/health-wins/nudge-state";
import { getPrisma } from "../src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Health win nudge tests require an isolated loopback test database.");
}
const db = getPrisma();
const members: string[] = [];
const day = "2035-04-03";
const startedAt = new Date(day + "T10:05:00.000Z");

function observations(...keys: string[]): HealthWinObservations {
  return { version: "fixture-v1", items: keys.map(key => ({ seenKey: key, winRef: "link-" + key, fresh: true })) };
}
async function member() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(startedAt.getTime() - 86_400_000);
  const memberId = randomUUID();
  members.push(memberId);
  await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  return memberId;
}
function present(memberId: string, batch: HealthWinObservations | null, complete = true) {
  return db.$transaction(tx => recordHealthWinPresentationTx(tx, { memberId, observations: batch, complete }));
}
function claim(memberId: string, localDay = day) {
  return db.$transaction(tx => claimHealthWinDayTx(tx, { memberId, startedAt, day: localDay }));
}
function finish(memberId: string, batch: HealthWinObservations, localDay = day) {
  return db.$transaction(tx => finishHealthWinEvaluationTx(tx, { memberId, startedAt, day: localDay, observations: batch }));
}
function current(memberId: string, version = "fixture-v1") {
  return db.$transaction(tx => isHealthWinClaimCurrentTx(tx, { memberId, startedAt, day, version }));
}

describe.skipIf(!enabled)("health win nudge enrollment, suppression, and day claims", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
  });

  it("waits for a complete nonempty baseline and retains earlier partial presentations", async () => {
    const id = await member();
    expect(await claim(id)).toBe(false);
    await present(id, observations("partial"), false);
    await present(id, observations());
    expect(await db.healthWinNudge.findUniqueOrThrow({ where: { memberId: id } })).toMatchObject({
      baselineAt: null, seenKeys: ["partial"],
    });
    await claim(id);
    expect(await finish(id, observations("baseline"))).toBeNull();
    const next = "2035-04-04";
    await claim(id, next);
    expect(await finish(id, observations("partial", "baseline", "new"), next)).toBe("link-new");
  });

  it("admits one concurrent evaluator, even after a crash, and rejects a timezone reversal", async () => {
    const id = await member();
    await present(id, observations("original"));
    expect((await Promise.all([claim(id), claim(id)])).sort()).toEqual([false, true]);
    expect(await claim(id)).toBe(false);
    expect(await claim(id, "2035-04-02")).toBe(false);
    expect(await claim(id, "2035-04-04")).toBe(true);
    expect(await finish(id, observations("late"))).toBeNull();
  });

  it("consumes the whole ranked batch, sends the first fresh key, and preserves lifetime history", async () => {
    const id = await member();
    await present(id, observations("original"));
    const later = Array.from({ length: 260 }, (_, index) => "other-" + index);
    for (let page = 0; page < later.length; page += 24) {
      await present(id, observations(...later.slice(page, page + 24)));
    }
    await claim(id);
    const batch = observations("original", "old", "top", "top", "second");
    batch.items[1]!.fresh = false;
    expect(await finish(id, batch)).toBe("link-top");
    expect(await finish(id, batch)).toBeNull();
    const row = await db.healthWinNudge.findUniqueOrThrow({ where: { memberId: id } });
    expect(row.seenKeys).toHaveLength(264);
    expect(row.seenKeys).toContain("original");
    expect(row.seenKeys).toContain("second");
  });

  it("does not reset the baseline or rewrite history on a key or identity version mismatch", async () => {
    const id = await member();
    await present(id, observations("earlier"));
    await claim(id);
    const changed = { ...observations("absent-before-rotation"), version: "fixture-v2" };
    expect(await finish(id, changed)).toBeNull();
    await present(id, changed);
    expect(await current(id, changed.version)).toBe(false);
    expect(await db.healthWinNudge.findUniqueOrThrow({ where: { memberId: id } })).toMatchObject({
      seenVersion: "fixture-v1", seenKeys: ["earlier"],
    });
    await claim(id, "2035-04-04");
    expect(await finish(id, observations("earlier"), "2035-04-04")).toBeNull();
  });

  it("a composer response during detection cancels append while consuming newly detected keys", async () => {
    const id = await member();
    await present(id, observations("initial"));
    await claim(id);
    vi.setSystemTime(startedAt); // Equality cancels too.
    await present(id, null);
    expect(await finish(id, observations("new"))).toBeNull();
    expect(await current(id)).toBe(false);
    expect((await db.healthWinNudge.findUniqueOrThrow({ where: { memberId: id } })).seenKeys).toContain("new");
  });

  it("overlapping presentations retain each response's keys and fence egress until commit", async () => {
    const id = await member();
    await present(id, observations("initial"));
    await claim(id);
    expect(await finish(id, observations("new"))).toBe("link-new");
    vi.setSystemTime(startedAt.getTime() + 1);
    let markLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>(resolve => { markLocked = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const first = db.$transaction(async tx => {
      await recordHealthWinPresentationTx(tx, { memberId: id, complete: true, observations: observations("first") });
      markLocked();
      await released;
    });
    await Promise.race([locked, first]);
    const second = present(id, observations("first", "second"));
    const accepted = current(id);
    release();
    await Promise.all([first, second]);
    expect(await accepted).toBe(false);
    expect((await db.healthWinNudge.findUniqueOrThrow({ where: { memberId: id } })).seenKeys)
      .toEqual(["initial", "new", "first", "second"]);
  });

  it.each(["presentation", "post"] as const)("a subsequent %s cancels a previously admitted delivery", async action => {
    const id = await member();
    await present(id, observations("initial"));
    await claim(id);
    expect(await finish(id, observations("new"))).toBe("link-new");
    expect(await current(id)).toBe(true);
    const after = new Date(startedAt.getTime() + 1);
    if (action === "presentation") {
      vi.setSystemTime(after);
      await present(id, observations("new"));
    } else {
      await db.healthPost.create({ data: { id: randomUUID(), authorMemberId: id, createdAt: after } });
    }
    expect(await current(id)).toBe(false);
  });

  it("rolls back consumption if the append transaction fails, and cascades enrolled state on deletion", async () => {
    const id = await member();
    await present(id, observations("initial"));
    await claim(id);
    await expect(db.$transaction(async tx => {
      expect(await finishHealthWinEvaluationTx(tx, { memberId: id, day, startedAt, observations: observations("new") })).toBe("link-new");
      throw new Error("fixture append failure");
    })).rejects.toThrow("fixture append failure");
    expect((await db.healthWinNudge.findUniqueOrThrow({ where: { memberId: id } })).seenKeys).toEqual(["initial"]);
    await db.hostedMember.delete({ where: { id } });
    expect(await db.healthWinNudge.findUnique({ where: { memberId: id } })).toBeNull();
  });
});
