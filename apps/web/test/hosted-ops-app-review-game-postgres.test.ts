import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn().mockResolvedValue("sent"), reviewer: vi.fn(), auth: vi.fn(), readPhoto: vi.fn() }));
vi.mock("@/src/lib/apple-push/send", async (original) => ({
  ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: mocks.push,
}));
vi.mock("@/src/lib/better-auth/review-account", async (original) => ({
  ...await original<typeof import("@/src/lib/better-auth/review-account")>(), readHostedAuthReviewMemberId: mocks.reviewer,
  isHostedAuthReviewMember: async ({ memberId }: { memberId: string }) => memberId === await mocks.reviewer(),
}));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: mocks.auth }));
vi.mock("@/app/app-review-game-photos", () => ({ readAppReviewGamePhoto: mocks.readPhoto }));
// Real roots and sealing for the crypto case; only KMS is the local provider.
vi.mock("@/src/lib/hosted-crypto/env", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { createHostedAuthorityVerifyKeyring } = await vi.importActual<typeof import("@murphai/runtime-state")>("@murphai/runtime-state");
  const { createHostedGcpKmsClientFromEnv } = await vi.importActual<typeof import("@/src/lib/hosted-crypto/gcp-kms")>("@/src/lib/hosted-crypto/gcp-kms");
  const authoritySignKeyVersionName = "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
  const authorityKey = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "jwk" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const gcpKms = createHostedGcpKmsClientFromEnv({
    HOSTED_CRYPTO_ENV: "test", HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"), NODE_ENV: "test",
  });
  return {
    getHostedWebCryptoConfig: () => ({
      authoritySignKeyVersionName, authoritySignPublicKeyPem: authorityKey.publicKey,
      authorityVerifyKeyring: createHostedAuthorityVerifyKeyring({ activeKeyVersionName: authoritySignKeyVersionName, activePublicKeyPem: authorityKey.publicKey }),
      env: "test", gcpKms, webWrapKmsKeyName: "projects/example/locations/global/keyRings/hosted/cryptoKeys/app-review-game",
    }),
  };
});

import {
  APP_REVIEW_PARTNER_MEMBER_ID,
  seedHostedOpsAppReviewGame,
  refreshAppReviewGameForHome,
} from "@/src/lib/hosted-ops/app-review-game";
import { GET as homeRoute } from "../app/api/game/v1/home/route";
import type { GameHomeView } from "@/src/lib/game/contract";
import { addDays, dayStartInstant, gameLocalDate } from "@/src/lib/game/time";
import { labelTarget, sealGameText } from "@/src/lib/game/crypto";
import { readHome, runGameCommand } from "@/src/lib/game/service";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "@/src/lib/hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
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

/** Every real member has a control root; the seed reuses the reviewer's. */
async function provisionControlRoot(userId: string) {
  await runWithHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareHostedDomainRootForWeb({ domain: "control", reason: "test", userId });
    await getPrisma().$transaction((tx) => revalidatePreparedHostedDomainRootForWebTx({ prepared, tx }));
  });
}

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

async function seedDaysAgo(days: number) {
  const [{ now }] = await getPrisma().$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const date = addDays(gameLocalDate(now, "America/Los_Angeles"), -days);
  await seedHostedOpsAppReviewGame({ mode: "apply", now: dayStartInstant(date, "America/Los_Angeles"), readPhoto });
}

function partnerGames() {
  return getPrisma().game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true, status: true }, orderBy: { id: "asc" } });
}

async function routeHome(): Promise<GameHomeView> {
  const response = await homeRoute(new Request("http://localhost/api/game/v1/home"));
  expect(response.status).toBe(200);
  return response.json();
}

function expectFreshHome(home: GameHomeView) {
  expect(home.games.map(game => game.status)).toEqual(["live", "settled"]);
  const live = home.games[0];
  expect(live.players.find(player => player.isMe)?.dayIndex).toBe(2);
  expect(live.days[2]).toMatchObject({ mine: null, others: [{ status: "locked", entry: null }] });
  expect(live.days[2].others[0].preview?.mediaUrl).toBeTruthy();
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
    mocks.readPhoto.mockReset().mockImplementation(readPhoto);
    reviewer = `hbm_reviewtest_${randomUUID().slice(0, 8)}`;
    await getPrisma().hostedMember.create({ data: { billingStatus: "active", id: reviewer } });
    await provisionControlRoot(reviewer);
    mocks.reviewer.mockResolvedValue(reviewer);
    mocks.auth.mockResolvedValue({ member: { id: reviewer } });
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await getPrisma().game.deleteMany({ where: { wordsOwnerMemberId: { in: [reviewer, partner] } } });
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: [reviewer, partner] } } });
  });

  it("dry-runs without writing and reports who the game is on for", async () => {
    const summary = await seedHostedOpsAppReviewGame({ mode: "dry-run" });

    expect(summary).toMatchObject({
      action: "dry-run",
      blockers: [],
      partner: { contactSurfaces: [], exists: false, gameEnabled: true, id: partner },
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
    // Only the partner's missing phone, email and push route keep sends away.
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

  it("shows Day 4, yesterday's locked photo and the settled IOU one game day after seeding", async () => {
    await seedDaysAgo(1);
    const home = await readHome(reviewer);
    expect(home.games.map((game) => [game.status, game.round])).toEqual([["live", 2], ["settled", 1]]);
    const live = home.games[0];
    expect(live.players.find(player => player.isMe)?.dayIndex).toBe(3);
    expect(live.days[2]).toMatchObject({ mine: null, others: [{ status: "locked", entry: null }] });
    expect(live.days[3]).toMatchObject({ mine: null, others: [{ status: "none", entry: null }] });
    expect(home.wallet.held).toEqual([expect.objectContaining({ status: "open" })]);
  });

  it.each([1, 3, 35])("refreshes Home after %s game days, then keeps the same games all day", async (days) => {
    await seedDaysAgo(days);
    const old = await partnerGames();
    const home = await routeHome();
    expectFreshHome(home);
    expect(await getPrisma().game.count({ where: { id: { in: old.map(game => game.id) } } })).toBe(0);
    const again = await routeHome();
    expect(again.games.map(game => game.id)).toEqual(home.games.map(game => game.id));
    expect(await sideEffects()).toEqual({ events: ["app_review_seeded"], linq: 0, mailbox: 0, push: 0 });
  });

  it("creates the initial seed on Home and preserves it despite unrelated seed constants changing", async () => {
    const home = await routeHome();
    expectFreshHome(home);
    const live = home.games.find(game => game.status === "live")!;
    await getPrisma().game.update({ where: { id: live.id }, data: { round: 4, lengthDays: 28, createdBy: reviewer } });
    expect((await routeHome()).games.map(game => game.id)).toEqual(home.games.map(game => game.id));
  });

  it("concurrent Home reads both return the one replacement pair", async () => {
    await seedDaysAgo(1);
    const old = await partnerGames();
    // Both requests must finish the initial freshness check before either can write.
    let arrivals = 0;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    mocks.readPhoto.mockImplementation(async (file: string) => {
      if (file.endsWith("hero-at-home-static-stretching-latest.jpeg")) {
        arrivals += 1;
        if (arrivals === 2) release();
        await ready;
      }
      return readPhoto(file);
    });
    const homes = await Promise.all([routeHome(), routeHome()]);
    expect(arrivals).toBe(2);
    homes.forEach(expectFreshHome);
    expect(homes[0].games.map(game => game.id)).toEqual(homes[1].games.map(game => game.id));
    const stored = await partnerGames();
    expect(stored.map(game => game.status).sort()).toEqual(["live", "settled"]);
    expect(stored.map(game => game.id).sort()).toEqual(homes[0].games.map(game => game.id).sort());
    expect(stored.some(game => old.some(previous => previous.id === game.id))).toBe(false);
  });

  it("re-reads an initial Home that predates another completed refresh and reports no fictional writes", async () => {
    await seedDaysAgo(1);
    const initial = await readHome(reviewer);
    const refreshed = await routeHome();
    expect(await refreshAppReviewGameForHome({ memberId: reviewer, homeGameIds: initial.games.map(game => game.id), readPhoto })).toBe(true);
    const [{ now }] = await getPrisma().$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const skipped = await seedHostedOpsAppReviewGame({ mode: "apply", onlyIfStale: true, now, readPhoto });
    expect(skipped.created).toEqual([]);
    expect(skipped.replacedGames).toEqual([]);
    expect((await routeHome()).games.map(game => game.id)).toEqual(refreshed.games.map(game => game.id));
  });

  it("an ordinary member's Home never touches the stale opponent games", async () => {
    await seedDaysAgo(1);
    const before = await partnerGames();
    const other = `hbm_review_other_${randomUUID()}`;
    await getPrisma().hostedMember.create({ data: { id: other } });
    mocks.auth.mockResolvedValue({ member: { id: other } });
    try {
      mocks.readPhoto.mockClear();
      expect((await routeHome()).games).toEqual([]);
      expect(await partnerGames()).toEqual(before);
      expect(mocks.readPhoto).not.toHaveBeenCalled();
    } finally {
      await getPrisma().hostedMember.delete({ where: { id: other } });
    }
  });

  it.each(["block", "photo", "storage"])("serves the existing Home when refresh fails because of %s", async (failure) => {
    await seedDaysAgo(1);
    const before = await partnerGames();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (failure === "block") await getPrisma().gameBlock.create({ data: { blockerMemberId: reviewer, blockedMemberId: partner } });
    if (failure === "photo") mocks.readPhoto.mockRejectedValue(new Error("Synthetic private detail must not be logged"));
    if (failure === "storage") vi.spyOn(await import("@/src/lib/game/media"), "isGameMediaStorageAvailable").mockReturnValue(false);
    const expected = await readHome(reviewer);
    const home = await routeHome();
    expect(home.games.map(game => game.id)).toEqual(expected.games.map(game => game.id));
    expect(await partnerGames()).toEqual(before);
    expect(warning).toHaveBeenCalledExactlyOnceWith("App Review game refresh failed", failure === "photo" ? "Error" : "APP_REVIEW_GAME_BLOCKED");
  });

  it("replaces the partner's games on every run and keeps the reviewer's own name", async () => {
    await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
    await runGameCommand({ actorMemberId: reviewer, command: { firstName: "Robin", type: "setProfile" } });
    await getPrisma().gameContactLabel.create({ data: { nameEncrypted: await sealGameText(labelTarget(reviewer, "name"), "Bestie"),
      ownerMemberId: reviewer, subjectMemberId: partner } });
    const first = await getPrisma().game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true } });

    const again = await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });

    expect(again.replacedGames.map((game) => game.id).sort()).toEqual(first.map((game) => game.id).sort());
    const now = await getPrisma().game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true, status: true } });
    expect(now.map((game) => game.status).sort()).toEqual(["live", "settled"]);
    expect(now.some((game) => first.some((old) => old.id === game.id))).toBe(false);
    const home = await readHome(reviewer);
    expect(home.me.firstName).toBe("Robin");
    expect(home.games).toHaveLength(2);
    expect(home.games[0].players.find((player) => !player.isMe)?.firstName).toBe("Sam");
  });

  it("provisions the partner's own encryption root on the first apply and reuses it after", async () => {
    const holder = globalThis as typeof globalThis & { __murphHostedSecureBoxStringTestCodec?: Parameters<typeof setHostedSecureBoxStringTestCodecForTests>[0] };
    const codec = holder.__murphHostedSecureBoxStringTestCodec ?? null;
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      const roots = () => getPrisma().hostedUserCryptoEnvelope.findMany({ where: { userId: partner, domain: "control" }, select: { rootKeyId: true } });
      expect(await roots()).toEqual([]);

      await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
      const [root] = await roots();
      expect(root?.rootKeyId).toBeTruthy();
      const home = await readHome(reviewer);
      expect(home.me.firstName).toBe("Alex");
      expect(home.games[0].players.map((player) => player.firstName)).toEqual(["Sam", "Alex"]);
      expect(home.games[0].terms.tasks[1].text).toBe("20 pushups or a short walk");
      expect(home.games[0].days[1].others[0].entry?.text).toBe("30 minutes in the rain. Still counts.");
      expect(home.wallet.held[0].what).toBe("Coffee of your choice");

      await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
      expect(await roots()).toEqual([root]);
      expect((await readHome(reviewer)).games[0].players[0].firstName).toBe("Sam");
    } finally {
      setHostedSecureBoxStringTestCodecForTests(codec);
    }
  });

  it.each(["reviewer", "partner"])("refuses to reseed across a block owned by the %s", async (owner) => {
    await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
    const prisma = getPrisma();
    const before = await prisma.game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true }, orderBy: { id: "asc" } });
    await prisma.gameBlock.create({ data: {
      blockerMemberId: owner === "reviewer" ? reviewer : partner,
      blockedMemberId: owner === "reviewer" ? partner : reviewer,
    } });
    expect((await seedHostedOpsAppReviewGame({ mode: "dry-run" })).blockers).toEqual(["review_partner_blocked"]);
    await expect(seedHostedOpsAppReviewGame({ mode: "apply", readPhoto })).rejects.toMatchObject({ code: "APP_REVIEW_GAME_BLOCKED" });
    expect(await prisma.game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.gameBlock.count({ where: { OR: [{ blockerMemberId: reviewer }, { blockerMemberId: partner }] } })).toBe(1);
  });

  it("rechecks a block created while photos are being prepared", async () => {
    await seedHostedOpsAppReviewGame({ mode: "apply", readPhoto });
    const prisma = getPrisma();
    const before = await prisma.game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true }, orderBy: { id: "asc" } });
    let blocked = false;
    await expect(seedHostedOpsAppReviewGame({ mode: "apply", readPhoto: async (publicPath) => {
      if (!blocked) {
        blocked = true;
        await prisma.gameBlock.create({ data: { blockerMemberId: reviewer, blockedMemberId: partner } });
      }
      return readPhoto(publicPath);
    } })).rejects.toMatchObject({ code: "APP_REVIEW_GAME_BLOCKED" });
    expect(await prisma.game.findMany({ where: { players: { some: { memberId: partner } } }, select: { id: true }, orderBy: { id: "asc" } })).toEqual(before);
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
