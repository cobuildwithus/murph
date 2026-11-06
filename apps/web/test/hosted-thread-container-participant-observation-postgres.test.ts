import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";
import { getHostedLinqChatSummary } from "@/src/lib/hosted-onboarding/linq-client";
import { createHostedLinqParticipantContactLookupKey } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { reconcileHostedThreadContainerParticipants } from "@/src/lib/hosted-groups/thread-container-participants";
import { observeHostedThreadContainerRosterParticipantTx } from "@/src/lib/hosted-groups/thread-container-participant-access";

const sdk = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("@linqapp/sdk", async original => ({
  ...await original<typeof import("@linqapp/sdk")>(),
  default: class { chats = { retrieve: sdk.retrieve }; },
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(databaseUrl)) {
  throw new Error("Observation proof requires its isolated local test database.");
}
const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, n));

describe.skipIf(!enabled)("participant observation ordering on migrated PostgreSQL", () => {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
  let room: string, a: string, b: string;
  let handles: string[];
  let warnings: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubEnv("LINQ_API_TOKEN", "synthetic-token");
    [room, a, b] = Array.from({ length: 3 }, () => randomUUID());
    handles = [a, b].map(id => `${id}@example.test`);
    warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    await prisma.hostedMember.createMany({ data: [room, a, b].map(id => ({ id })) });
    await prisma.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: a } });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await prisma.hostedThreadContainer.deleteMany({ where: { memberId: room } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: [room, a, b] } } });
    await prisma.hostedGroupParticipantObservation.deleteMany({ where: { contactLookupKey: { in: handles.map(handle => key(handle)) } } });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  const key = (handle: string) => createHostedLinqParticipantContactLookupKey({ kind: "email", value: handle })!;
  const row = () => prisma.hostedThreadContainerParticipant.findUnique({ where: { containerMemberId_participantMemberId: { containerMemberId: room, participantMemberId: b } } });
  const watermark = async () => (await prisma.hostedThreadContainer.findUniqueOrThrow({ where: { memberId: room } })).completeRosterObservedAt;
  const observation = (ids: string[], t: Date, complete = true, count = ids.length) => ({
    handleCount: count, handlesComplete: complete, observedAt: t,
    handles: ids.map(id => ({ handle: `${id}@example.test`, isMe: false, status: "active" })),
  });
  async function roster(ids: string[], t: Date, complete = true, count = ids.length) {
    const evidence = observation(ids, t, complete, count);
    sdk.retrieve.mockResolvedValue({ is_group: true, handles: evidence.handles.map(h => ({ handle: h.handle, is_me: false, status: h.status })) });
    await reconcileHostedThreadContainerParticipants({ chatId: room, containerMemberId: room, observation: evidence, prisma,
      resolvedParticipants: ids.map(id => ({ handle: `${id}@example.test`, participantMemberId: id })) });
  }
  async function sender(t: Date) {
    await prisma.$transaction(tx => observeHostedThreadContainerRosterParticipantTx({
      containerMemberId: room, participantMemberId: b, handleLookupKey: key(handles[1]), observedAt: t, now: at(50), prisma: tx,
    }));
  }
  async function seed(t: Date, removedAt: Date | null = null) {
    await prisma.hostedThreadContainerParticipant.create({ data: { containerMemberId: room, participantMemberId: b,
      handleLookupKey: key(handles[1]), firstSeenAt: t, lastSeenAt: t, removedAt } });
  }

  it.each([false, true])("old presence and newer removal converge, reverse=%s", async reverse => {
    await seed(at(1));
    const positive = () => roster([a, b], at(1));
    const negative = () => roster([a], at(2));
    for (const act of reverse ? [negative, positive] : [positive, negative]) await act();
    expect(await row()).toMatchObject({ lastSeenAt: at(1), removedAt: at(2) });
    expect(warnings).not.toHaveBeenCalled();
  });
  it.each([false, true])("old absence and newer presence converge, reverse=%s", async reverse => {
    await seed(at(0));
    const positive = () => roster([a, b], at(2));
    const negative = () => roster([a], at(1));
    for (const act of reverse ? [negative, positive] : [positive, negative]) await act();
    expect(await row()).toMatchObject({ lastSeenAt: at(2), removedAt: null });
  });
  it.each(["complete", "partial", "sender"])("watermark fences absent rows against older %s positives", async kind => {
    await roster([a], at(2));
    if (kind === "sender") await sender(at(1));
    else await roster([a, b], at(1), kind === "complete");
    expect(await row()).toBeNull();
    if (kind === "sender") await sender(at(3));
    else await roster([a, b], at(3), kind === "complete");
    expect(await row()).toMatchObject({ firstSeenAt: at(3), lastSeenAt: at(3), removedAt: null });
  });
  it("a second omission fences a partial positive newer than the first removal", async () => {
    await seed(at(0), at(1));
    await roster([a], at(3));
    await roster([a, b], at(2), false);
    expect(await row()).toMatchObject({ lastSeenAt: at(0), removedAt: at(1) });
    expect(await watermark()).toEqual(at(3));
  });
  it.each(["complete", "sender"])("equal-time %s presence loses to removal in either order and replay is inert", async kind => {
    for (const reverse of [false, true]) {
      await prisma.hostedThreadContainerParticipant.deleteMany({ where: { containerMemberId: room } });
      await prisma.hostedThreadContainer.update({ where: { memberId: room }, data: { completeRosterObservedAt: null } });
      await seed(at(1));
      const positive = () => kind === "sender" ? sender(at(2)) : roster([a, b], at(2));
      const negative = () => roster([a], at(2));
      for (const act of reverse ? [negative, positive] : [positive, negative]) await act();
      expect(await row()).toMatchObject({ removedAt: at(2) });
      const before = await row();
      await positive(); await negative();
      expect(await row()).toEqual(before);
    }
  });
  it("real parser retains incomplete evidence: renew and reopen, never remove or advance the watermark", async () => {
    await seed(at(0), at(1));
    await prisma.hostedThreadContainerParticipant.create({ data: { containerMemberId: room, participantMemberId: a,
      handleLookupKey: key(handles[0]), firstSeenAt: at(0), lastSeenAt: at(0) } });
    sdk.retrieve.mockResolvedValue({ is_group: true, handles: [{ handle: handles[1], is_me: false }, { handle: null }] });
    for (const t of [at(2), at(3)]) {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(t);
      const evidence = await getHostedLinqChatSummary({ chatId: room });
      expect(evidence).toMatchObject({ handlesComplete: false, handleCount: 2 });
      await reconcileHostedThreadContainerParticipants({ chatId: room, containerMemberId: room, observation: evidence, prisma,
        resolvedParticipants: [{ handle: handles[1], participantMemberId: b }] });
      expect(await row()).toMatchObject({ lastSeenAt: t, removedAt: null });
    }
    expect(await prisma.hostedThreadContainerParticipant.count({ where: { containerMemberId: room, removedAt: null } })).toBe(2);
    expect(await watermark()).toBeNull();
  });
  it("capped evidence is positive only; empty evidence writes nothing", async () => {
    await seed(at(0));
    await roster([a], at(2), true, 33);
    expect(await row()).toMatchObject({ removedAt: null, lastSeenAt: at(0) });
    expect(await watermark()).toBeNull();
    const before = await prisma.hostedThreadContainerParticipant.findMany({ where: { containerMemberId: room } });
    expect(before.find(row => row.participantMemberId === a)).toMatchObject({ firstSeenAt: at(2), lastSeenAt: at(2), removedAt: null });
    const attribution = await prisma.hostedGroupParticipantObservation.findUnique({ where: { contactLookupKey: key(handles[0]) } });
    expect(attribution).toMatchObject({ firstObservedAt: at(2) });
    await roster([], at(3));
    expect(await prisma.hostedThreadContainerParticipant.findMany({ where: { containerMemberId: room } })).toEqual(before);
    expect(await prisma.hostedGroupParticipantObservation.findUnique({ where: { contactLookupKey: key(handles[0]) } })).toEqual(attribution);
    expect(await watermark()).toBeNull();
  });
  it("records pre-read time and retains it when a cached observation is published later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at(1));
    sdk.retrieve.mockImplementation(async () => {
      vi.setSystemTime(at(2));
      return { is_group: true, handles: [{ handle: handles[1], is_me: false }] };
    });
    const evidence = await getHostedLinqChatSummary({ chatId: room });
    expect(evidence.observedAt).toEqual(at(1));
    const reconcile = () => reconcileHostedThreadContainerParticipants({ chatId: room, containerMemberId: room, observation: evidence, prisma,
      resolvedParticipants: [{ handle: handles[1], participantMemberId: b }] });
    await reconcile();
    expect(await row()).toMatchObject({ firstSeenAt: at(1), lastSeenAt: at(1) });
    vi.setSystemTime(at(20));
    await reconcile();
    expect(await row()).toMatchObject({ firstSeenAt: at(1), lastSeenAt: at(1) });
    expect(await prisma.hostedGroupParticipantObservation.findUnique({ where: { contactLookupKey: key(handles[1]) } }))
      .toMatchObject({ firstObservedAt: at(1), expiresAt: new Date(at(1).getTime() + 14 * 86_400_000) });
  });
  it("serializes racing complete observations on a pool with multiple connections", async () => {
    await seed(at(0));
    await Promise.all([roster([a], at(3)), roster([a, b], at(2)), roster([a, b], at(1))]);
    expect(await row()).toMatchObject({ removedAt: at(3) });
    expect(await watermark()).toEqual(at(3));
    expect(warnings).not.toHaveBeenCalled();
  });
});
