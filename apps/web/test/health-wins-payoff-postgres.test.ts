import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/game/v1/health/payoffs/route";
import { serializeHostedNativeSessionToken } from "@/src/lib/better-auth/transport";
import { toPrismaJsonObject } from "@/src/lib/device-sync/prisma-store/prisma-json";
import * as gameCrypto from "@/src/lib/game/crypto";
import { assertPayoffCurrentTx, preparePayoffSelection } from "@/src/lib/health-wins/payoff";
import { recordHostedLaunchRequiredConsent } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { seedHealthPayoff } from "./support/health-payoff-fixture";
import { issueHostedAppSession } from "./support/hosted-auth-session";

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: Buffer.alloc(32, 43), envelope: { rootKeyId: "test-payoff-key" } }),
  unwrapHostedDomainRootForWebByRootKeyId: async () => ({ rootKey: Buffer.alloc(32, 43) }),
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Payoff tests require a local test database.");
}

describe.skipIf(!enabled)("settled pair payoff offers", () => {
  let winnerId: string, debtorId: string;
  const tokens = new Map<string, string>();
  const ids: string[] = [];
  const request = (id = winnerId) => new Request("https://example.test/api/game/v1/health/payoffs", {
    headers: { authorization: `Bearer ${tokens.get(id)}` },
  });
  const list = async (viewer = winnerId) => {
    const response = await GET(request(viewer));
    expect(response.status).toBe(200);
    return response.json();
  };
  const seed = (options?: Pick<Parameters<typeof seedHealthPayoff>[0], "kind" | "settledAt">) =>
    seedHealthPayoff({ winnerId, debtorId, ...options });
  beforeEach(async () => {
    winnerId = `hbm_payoff_${randomUUID()}`;
    debtorId = `hbm_payoff_${randomUUID()}`;
    ids.push(winnerId, debtorId);
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 93).toString("base64url"));
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 94).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://example.test");
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "*");
    vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", "*");
    await getPrisma().hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "active" })) });
    for (const memberId of ids) {
      for (const scope of ["launch.legal", "launch.health-data"] as const) {
        await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: getPrisma() });
      }
      const { token } = await issueHostedAppSession({ memberId });
      tokens.set(memberId, serializeHostedNativeSessionToken(token));
    }
  });
  afterEach(async () => {
    await cleanupGameFixtures(getPrisma(), ids);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: ids.splice(0) } } });
    tokens.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["dare", "prize"] as const)("offers only the winner a %s, using each player's own first name", async kind => {
    const { gameId, ticketId } = await seed({ kind });
    await getPrisma().gameContactLabel.create({ data: { ownerMemberId: winnerId, subjectMemberId: debtorId,
      nameEncrypted: await gameCrypto.sealGameText(gameCrypto.labelTarget(winnerId, "name"), "Private trail alias") } });
    const response = await GET(request());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const offered = await response.json();
    expect(offered).toMatchObject({ cards: [{ id: `game:${gameId}`, kind: "game_result", specRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      title: { number: "5–3" }, chart: { type: "game_result", contest: "Relay warmups", lengthDays: 7,
        players: [{ memberId: winnerId, firstName: "Vela", score: 5, won: true }, { memberId: debtorId, firstName: "Miro", score: 3, won: false }],
        stake: { kind, item: "Sketch a trail map" }, paid: true }, change_options: [{ id: "original" }] }] });
    expect(JSON.stringify(offered)).not.toMatch(/private trail alias|loser|lost|avatar/i);
    expect(await list(debtorId)).toEqual({ cards: [] });
    await getPrisma().gameTicket.update({ where: { id: ticketId }, data: { status: "redeemed", redeemedAt: new Date() } });
    expect(await list()).toEqual(offered);
  });

  it("returns an empty payoff list when the payoff flag is off", async () => {
    await seed();
    vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", "");
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [] });
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "");
    expect((await GET(request())).status).toBe(404);
  });

  it("opens only the 24 newest eligible games in one bounded batch", async () => {
    const gameIds: string[] = [];
    const now = Date.now();
    for (let minutesAgo = 25; minutesAgo >= 1; minutesAgo--) {
      const { gameId } = await seed({ settledAt: new Date(now - minutesAgo * 60_000) });
      gameIds.push(gameId);
    }
    const open = vi.spyOn(gameCrypto, "openGameTexts");
    const { cards } = await list();
    const newest = gameIds.slice(1).reverse();
    expect(cards.map((card: { id: string }) => card.id)).toEqual(newest.map(id => `game:${id}`));
    expect(open).toHaveBeenCalledTimes(1);
    const [fields] = open.mock.calls[0]!;
    expect(fields.length).toBeLessThanOrEqual(72);
    expect(fields.filter(field => field.table === "game").map(field => field.rowId)).toEqual(newest);
  });

  it("withholds a preview after a player blocks the viewer during decryption", async () => {
    await seed();
    const open = gameCrypto.openGameTexts;
    vi.spyOn(gameCrypto, "openGameTexts").mockImplementationOnce(async (...args) => {
      const words = await open(...args);
      await getPrisma().gameBlock.create({ data: { blockerMemberId: debtorId, blockedMemberId: winnerId } });
      return words;
    });
    expect(await list()).toEqual({ cards: [] });
  });

  it.each(["tie", "perfect"] as const)("excludes a %s even with a ticket", async outcome => {
    const { gameId, result } = await seed();
    const scores = result.scores.map(score => outcome === "tie" ? { ...score, score: 4 } : { ...score, misses: 0 });
    await getPrisma().game.update({ where: { id: gameId }, data: { result: toPrismaJsonObject({ ...result, scores }) } });
    expect(await list()).toEqual({ cards: [] });
  });

  it.each(["both_get", "winner_gets", "per_miss", "multiple"] as const)("excludes %s terms", async kind => {
    const { gameId, terms, stakeKey } = await seed();
    const stakes = kind === "multiple"
      ? [{ key: stakeKey, kind: "prize" }, { key: "second_key", kind: "dare" }]
      : [{ key: stakeKey, kind }];
    const versions = [...terms.versions, { ...terms.versions[0], n: 2, stakes }];
    await getPrisma().game.update({ where: { id: gameId }, data: { terms: toPrismaJsonObject({ v: 1, versions }) } });
    expect(await list()).toEqual({ cards: [] });
  });

  it("requires a settled pair, a current settlement, and a matching open or redeemed obligation", async () => {
    const { gameId, ticketId } = await seed();
    const db = getPrisma();
    for (const data of [{ status: "live" }, { status: "settled", maxPlayers: 10 },
      { maxPlayers: 2, settledAt: new Date(Date.now() - 8 * 86400_000) }]) {
      await db.game.update({ where: { id: gameId }, data });
      expect(await list()).toEqual({ cards: [] });
    }
    await db.game.update({ where: { id: gameId }, data: { settledAt: new Date(Date.now() - 7 * 86400_000 + 60_000) } });
    expect((await list()).cards).toHaveLength(1);
    for (const data of [{ owedToSeats: [1], owedBySeats: [0] }, { owedToSeats: [0], owedBySeats: [2] },
      { owedBySeats: [1], stakeKey: "another_stake" }]) {
      await db.gameTicket.update({ where: { id: ticketId }, data });
      expect(await list()).toEqual({ cards: [] });
    }
  });

  it("requires both current players and excludes either direction of block and a live payoff", async () => {
    const { gameId } = await seed();
    const db = getPrisma();
    for (const memberId of [winnerId, debtorId]) {
      const where = { gameId_memberId: { gameId, memberId } };
      await db.gamePlayer.update({ where, data: { leftAt: new Date() } });
      expect(await list()).toEqual({ cards: [] });
      await db.gamePlayer.update({ where, data: { leftAt: null } });
    }
    for (const [blockerMemberId, blockedMemberId] of [[winnerId, debtorId], [debtorId, winnerId]]) {
      await db.gameBlock.create({ data: { blockerMemberId, blockedMemberId } });
      expect(await list()).toEqual({ cards: [] });
      await db.gameBlock.delete({ where: { blockerMemberId_blockedMemberId: { blockerMemberId, blockedMemberId } } });
    }
    const post = await db.healthPost.create({ data: { id: randomUUID(), gameId, authorMemberId: winnerId } });
    expect(await list()).toEqual({ cards: [] });
    await db.healthPost.update({ where: { id: post.id }, data: { deletedAt: new Date() } });
    expect((await list()).cards).toHaveLength(1);
  });

  it("rechecks both a changed profile and revoked ticket authority before publication", async () => {
    const { ticketId } = await seed();
    const [preview] = (await list()).cards;
    const pick = { candidateId: preview!.candidateId, option: "original", specRevision: preview!.specRevision };
    const prepared = await preparePayoffSelection(winnerId, pick);
    const db = getPrisma();
    const firstNameEncrypted = await gameCrypto.sealGameText({ memberId: debtorId, rowId: debtorId, table: "game_profile", field: "first_name" }, "Sora");
    await db.gameProfile.update({ where: { memberId: debtorId }, data: { firstNameEncrypted: firstNameEncrypted! } });
    await expect(db.$transaction(tx => assertPayoffCurrentTx(tx, winnerId, prepared)))
      .rejects.toMatchObject({ code: "HEALTH_PAYOFF_CHANGED", httpStatus: 409 });
    await expect(preparePayoffSelection(winnerId, pick)).rejects.toMatchObject({ code: "HEALTH_PAYOFF_CHANGED", httpStatus: 409 });
    await db.gameTicket.delete({ where: { id: ticketId } });
    await expect(db.$transaction(tx => assertPayoffCurrentTx(tx, winnerId, prepared))).rejects.toMatchObject({ httpStatus: 404 });
  });
});
