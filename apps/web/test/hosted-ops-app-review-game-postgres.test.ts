import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn().mockResolvedValue("sent"), reviewer: vi.fn() }));
vi.mock("@/src/lib/apple-push/send", async (original) => ({
  ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: mocks.push,
}));
vi.mock("@/src/lib/better-auth/review-account", async (original) => ({
  ...await original<typeof import("@/src/lib/better-auth/review-account")>(), readHostedAuthReviewMemberId: mocks.reviewer,
}));

import {
  APP_REVIEW_PARTNER_MEMBER_ID,
  seedHostedOpsAppReviewGame,
} from "@/src/lib/hosted-ops/app-review-game";
import { readHome, runGameCommand } from "@/src/lib/game/service";
import { getPrisma } from "@/src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) throw new Error("App Review game proof requires an isolated local database.");
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const readPhoto = async (file: string) => new Uint8Array([...JPEG, ...new TextEncoder().encode(file)]);
const partner = APP_REVIEW_PARTNER_MEMBER_ID;
let mediaDir = "";
let reviewer = "";

async function sideEffects() {
  const prisma = getPrisma();
  const games = await prisma.game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true } });
  const ids = games.map((game) => game.id);
  const [linq, mailbox, events] = await Promise.all([
    prisma.hostedLinqDelivery.count({ where: { OR: ids.map((id) => ({ sourceRef: { startsWith: id } })) } }),
    prisma.hostedMailboxItem.count({ where: { userId: { in: [reviewer, partner] } } }),
    prisma.gameEvent.findMany({ where: { gameId: { in: ids } }, select: { type: true } }),
  ]);
  return { events: [...new Set(events.map((event) => event.type))].sort(), linq: ids.length ? linq : 0, mailbox, push: mocks.push.mock.calls.length };
}

describe.skipIf(!enabled)("App Review game seed against PostgreSQL", () => {
  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "app-review-game-media-"));
    process.env.MURPH_GAME_MEDIA_DIR = mediaDir;
  });

  afterAll(async () => {
    delete process.env.MURPH_GAME_MEDIA_DIR;
    await rm(mediaDir, { force: true, recursive: true });
    await getPrisma().$disconnect();
  });

  beforeEach(async () => {
    mocks.push.mockClear();
    reviewer = `hbm_reviewtest_${randomUUID().slice(0, 8)}`;
    await getPrisma().hostedMember.create({ data: { billingStatus: "active", id: reviewer } });
    mocks.reviewer.mockResolvedValue(reviewer);
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", reviewer);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: [reviewer, partner] } } });
  });

  it("dry-runs without writing and reports who the game is on for", async () => {
    const summary = await seedHostedOpsAppReviewGame({ mode: "dry-run" });

    expect(summary).toMatchObject({
      action: "dry-run",
      blockers: [],
      partner: { contactSurfaces: [], exists: false, gameEnabled: false, id: partner },
      plan: { live: { partnerPostedToday: true, round: 2, todayDay: 3 }, settled: { round: 1, scores: { partner: 3, reviewer: 4 } } },
      replacedGames: [],
      reviewMember: { gameEnabled: true, gameProfile: false, id: reviewer, phoneVerified: false, suspended: false },
      sends: "none",
    });
    expect(await getPrisma().hostedMember.count({ where: { id: partner } })).toBe(0);
    expect(await getPrisma().gameProfile.count({ where: { memberId: reviewer } })).toBe(0);
  });

  it("refuses to apply without a configured review account", async () => {
    mocks.reviewer.mockResolvedValue(null);

    expect((await seedHostedOpsAppReviewGame({ mode: "dry-run" })).blockers).toContain("review_account_not_found");
    await expect(seedHostedOpsAppReviewGame({ mode: "apply", readPhoto })).rejects.toMatchObject({ code: "APP_REVIEW_GAME_BLOCKED" });
    expect(await getPrisma().hostedMember.count({ where: { id: partner } })).toBe(0);
  });

  it("seeds a live game to play and a settled one with an IOU, without any send", async () => {
    // Both on the list: only the partner's missing phone, email and push route keep sends away.
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", `${reviewer},${partner}`);
    const applied = await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
    expect(applied.created?.map((game) => game.status)).toEqual(["settled", "live"]);

    const home = await readHome(reviewer);
    const [live, settled] = home.games;
    expect(home.games.map((game) => [game.status, game.round])).toEqual([["live", 2], ["settled", 1]]);
    expect(live.players.map((player) => [player.firstName, player.isMe])).toEqual([["Sam", false], ["Alex", true]]);
    expect(live.terms).toMatchObject({ checkInKind: "any", tasks: [{ seat: 0, text: "30 minute run" }, { seat: 1, text: "20 pushups or a short walk" }] });
    const me = live.players.find((player) => player.isMe)!;
    expect(me.dayIndex).toBe(2);
    expect(live.days[0].others[0]).toMatchObject({ status: "posted", entry: { kind: "photo" } });
    expect(live.days[0].others[0].entry!.mediaUrls).toHaveLength(1);
    expect(live.days[1].others[0]).toMatchObject({ status: "posted", entry: { kind: "words", text: "30 minutes in the rain. Still counts." } });
    expect(live.days[1].mine).toMatchObject({ kind: "words", text: "Short walk after lunch." });
    expect(live.days[2]).toMatchObject({ mine: null, others: [{ entry: null, status: "locked" }] });
    expect(live.days.slice(3).every((day) => day.others[0].status === "none")).toBe(true);
    expect(settled.result).toEqual({ outcome: "won", scores: [{ score: 3, seat: 0 }, { score: 4, seat: 1 }] });
    expect(settled.days.flatMap((day) => day.others.map((other) => other.status))).toEqual(["posted", "missed", "posted", "posted", "missed"]);
    expect(home.wallet.held).toEqual([expect.objectContaining({ status: "open", what: "Coffee of your choice", youHold: true })]);
    expect(await sideEffects()).toEqual({ events: ["app_review_seeded"], linq: 0, mailbox: 0, push: 0 });

    // The reviewer's own post today opens Sam's, and still reaches nobody.
    const posted = await runGameCommand({ actorMemberId: reviewer, command: {
      entryId: randomUUID(), gameId: live.id, kind: "words", text: "Pushups done.", type: "post" } });
    expect(posted.ok && posted.game?.days[2].others[0]).toMatchObject({ status: "posted", entry: { kind: "photo" } });
    const redeemed = await runGameCommand({ actorMemberId: reviewer, command: { ticketId: home.wallet.held[0].id, type: "redeem" } });
    expect(redeemed.ok).toBe(true);
    expect(await sideEffects()).toEqual({ events: ["app_review_seeded", "posted", "redeemed"], linq: 0, mailbox: 0, push: 0 });
  });

  it("replaces the partner's games on every run and keeps the reviewer's own name", async () => {
    await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
    await runGameCommand({ actorMemberId: reviewer, command: { firstName: "Robin", type: "setProfile" } });
    const first = await getPrisma().game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true } });

    const again = await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });

    expect(again.replacedGames.map((game) => game.id).sort()).toEqual(first.map((game) => game.id).sort());
    const now = await getPrisma().game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true, status: true } });
    expect(now.map((game) => game.status).sort()).toEqual(["live", "settled"]);
    expect(now.some((game) => first.some((old) => old.id === game.id))).toBe(false);
    const home = await readHome(reviewer);
    expect(home.me.firstName).toBe("Robin");
    expect(home.games).toHaveLength(2);
  });

  it("refuses when the partner could reach or be reached by a person", async () => {
    await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
    const before = await getPrisma().game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true } });
    await getPrisma().companionPushRoute.create({ data: { alertsAllowed: true, environment: "development", installationId: randomUUID(),
      token: "ab".repeat(32), topic: "ai.withmurph.app.dev", updatedAt: new Date(), userId: partner } });

    expect((await seedHostedOpsAppReviewGame({ mode: "dry-run" })).blockers).toEqual(["partner_reachable_push"]);
    await expect(seedHostedOpsAppReviewGame({ mode: "apply", readPhoto })).rejects.toMatchObject({ code: "APP_REVIEW_GAME_BLOCKED" });
    const after = await getPrisma().game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true } });
    expect(after).toEqual(before);
  });
});
