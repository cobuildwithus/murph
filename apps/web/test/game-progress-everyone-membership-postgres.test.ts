import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { runGameCommand } from "../src/lib/game/service";
import * as crypto from "../src/lib/game/crypto";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Everyone membership proof needs an isolated loopback test database.");
const db = getPrisma(), members: string[] = [];
async function member(profile = true) {
  const id = randomUUID(); members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "active" } });
  if (profile) await db.gameProfile.create({ data: { memberId: id, firstNameEncrypted: "unreadable-synthetic-name", timeZone: "UTC" } });
  return id;
}
const read = (memberId: string) => db.gameProfile.findUniqueOrThrow({ where: { memberId }, select: { everyoneJoinedAt: true } });
const join = (actorMemberId: string, everyoneJoined: boolean) => runGameCommand({ actorMemberId, command: { type: "setProfile", everyoneJoined } });
afterAll(async () => { if (enabled) await db.hostedMember.deleteMany({ where: { id: { in: members } } }); });

describe.skipIf(!enabled)("Everyone profile membership with PostgreSQL", () => {
  it("joins without name decryption, preserves the timestamp across retries and clears it on leave", async () => {
    const viewer = await member();
    const open = vi.spyOn(crypto, "openGameTexts").mockRejectedValue(new Error("Synthetic private-name dependency unavailable"));
    expect(await join(viewer, true)).toEqual({ ok: true, game: null, joined: true });
    expect((await read(viewer)).everyoneJoinedAt).toBeInstanceOf(Date);
    const initial = new Date("2025-09-04T08:00:00Z");
    await db.gameProfile.update({ where: { memberId: viewer }, data: { everyoneJoinedAt: initial } });
    await Promise.all([join(viewer, true), join(viewer, true)]);
    expect((await read(viewer)).everyoneJoinedAt).toEqual(initial);
    expect(await join(viewer, false)).toEqual({ ok: true, game: null, joined: false });
    expect((await read(viewer)).everyoneJoinedAt).toBeNull();
    expect(await join(viewer, false)).toEqual({ ok: true, game: null, joined: false });
    expect(await join(viewer, true)).toEqual({ ok: true, game: null, joined: true });
    expect((await read(viewer)).everyoneJoinedAt).not.toEqual(initial);
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps membership when ordinary profile fields change and supports a combined first save", async () => {
    const viewer = await member(false);
    const result = await runGameCommand({ actorMemberId: viewer, command: { type: "setProfile", firstName: "Maren", timeZone: "UTC", everyoneJoined: true } });
    expect(result).toMatchObject({ ok: true, joined: true, profile: { firstName: "Maren" } });
    const initial = (await read(viewer)).everyoneJoinedAt;
    await runGameCommand({ actorMemberId: viewer, command: { type: "setProfile", timeZone: "Europe/Oslo" } });
    expect((await read(viewer)).everyoneJoinedAt).toEqual(initial);
  });

  it("refuses missing profiles and runs the current-session guard before the write", async () => {
    expect(await join(await member(false), true)).toMatchObject({ ok: false, error: { code: "PROFILE_REQUIRED" } });
    const viewer = await member();
    await expect(runGameCommand({ actorMemberId: viewer, command: { type: "setProfile", everyoneJoined: true },
      beforeMutationTx: async () => { throw new Error("Synthetic expired session"); } })).rejects.toThrow("Synthetic expired session");
    expect((await read(viewer)).everyoneJoinedAt).toBeNull();
  });
});
