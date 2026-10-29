import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PUT as profile } from "../app/api/game/v1/me/profile/route";
import { POST as create } from "../app/api/game/v1/games/route";
import { POST as accept } from "../app/api/game/v1/invites/[token]/accept/route";
import { POST as start } from "../app/api/game/v1/dev/games/[id]/start-now/route";
import { POST as advance } from "../app/api/game/v1/dev/games/[id]/advance-day/route";
import { POST as settle } from "../app/api/game/v1/dev/games/[id]/settle/route";
import { POST as upload } from "../app/api/game/v1/media/route";
import { POST as post } from "../app/api/game/v1/games/[id]/entries/route";
import { GET as read } from "../app/api/game/v1/games/[id]/route";
import { GET as home } from "../app/api/game/v1/home/route";
import { DELETE as unblockRoute, PUT as blockRoute } from "../app/api/game/v1/blocks/[memberId]/route";
import { PUT as blockInviteRoute } from "../app/api/game/v1/invites/[token]/block/route";
import { POST as reportRoute } from "../app/api/game/v1/games/[id]/reports/route";
import { GET as media } from "../app/api/game/v1/media/[...key]/route";
import { POST as redeem } from "../app/api/game/v1/tickets/[id]/redeem/route";
import { POST as proposeChange } from "../app/api/game/v1/games/[id]/changes/route";
import { DELETE as cancelChange } from "../app/api/game/v1/games/[id]/changes/[proposalId]/route";
import { POST as agree } from "../app/api/device-sync/companion/legal-consent/route";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { serializeHostedNativeSessionToken } from "../src/lib/better-auth/transport";
import type { GameHomeView, GameView } from "../src/lib/game/contract";
import { getPrisma } from "../src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("The game API smoke requires an isolated loopback test database.");
  }
}
const memberIds: string[] = [];
const tokenMember = new Map<string, string>();
let mediaDir: string;
const request = (token: string, body?: unknown, method = "POST", heldInvite?: string) => new Request("http://localhost/api/game/v1", {
  method, headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}`, "content-type": "application/json",
    ...(heldInvite ? { "x-murph-game-invite": heldInvite } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function game(response: Promise<Response>): Promise<GameView> {
  const result = await response;
  const body = await result.json();
  expect(result.status, JSON.stringify(body)).toBe(200);
  expect(body.ok).toBe(true);
  return body.game;
}
async function member(firstName: string) {
  const { id, token } = await account();
  const response = await profile(request(token, { firstName, timeZone: "UTC" }, "PUT"));
  expect(response.status).toBe(200);
  tokenMember.set(token, id);
  return token;
}
/** A signed-in member with no game profile yet, like someone who just signed up from a link. */
async function account() {
  const id = `game-api-${randomUUID()}`;
  const token = randomUUID().replaceAll("-", "");
  memberIds.push(id);
  await getPrisma().hostedMember.create({ data: { id } });
  const adapter = hostedAuthAdapter(getPrisma())({});
  const dates = { createdAt: new Date(), updatedAt: new Date() };
  await adapter.create({ model: "user", forceAllowId: true,
    data: { id, email: `${id}@example.test`, emailVerified: true, name: "", ...dates } });
  await adapter.create({ model: "session", forceAllowId: true, data: {
    id: `session-${id}`, userId: id, token, expiresAt: new Date(Date.now() + 3_600_000), ...dates,
  } });
  return { id, token };
}
async function refused(response: Promise<Response>, code = "GAME_DISABLED") {
  const result = await response;
  expect(result.status).toBe(404);
  expect((await result.json()).error.code).toBe(code);
}
async function imageKey(token: string, suffix: number): Promise<string> {
  const uploaded = await upload(new Request("http://localhost/api/game/v1/media", {
    method: "POST", headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}`, "content-type": "image/jpeg" },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9, suffix]),
  }));
  expect(uploaded.status).toBe(200);
  const { mediaKey } = await uploaded.json();
  return mediaKey;
}
async function photo(token: string, id: string, suffix: number) {
  const mediaKey = await imageKey(token, suffix);
  return game(post(request(token, { entryId: randomUUID(), kind: "photo", mediaKeys: [mediaKey] }), { params: Promise.resolve({ id }) }));
}

async function mediaStatus(token: string, key: string): Promise<number> {
  const response = await media(new Request(`http://localhost/api/game/v1/media/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}` } }), { params: Promise.resolve({ key: key.split("/") }) });
  return response.status;
}

// Exercise the actual Request/Response handlers, authentication adapter, command
// parsing and PostgreSQL service together. Only secure-box uses the shared test codec.
describe.skipIf(!enabled)("game v1 local API smoke", () => {
  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "game-api-"));
    vi.stubEnv("MURPH_GAME_MEDIA_DIR", mediaDir);
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 9).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "http://localhost:3237");
  });
  afterAll(async () => {
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
    await rm(mediaDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("creates a long dare, accepts, posts, advances and settles with the new app fields", async () => {
    const challenger = await member("Challenger");
    const invitee = await member("Invitee");
    const id = randomUUID();
    const context = { params: Promise.resolve({ id }) };
    const created = await game(create(request(challenger, {
      gameId: id, inviteeFirstName: "Invitee", terms: {
        startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
        lengthDays: 75, schedule: { count: 50 }, stakes: [{ kind: "dare", item: "Sing at karaoke" }],
        tasks: [{ seat: 0, text: "Take a walk" }, { seat: 1, text: "Take a walk" }],
      },
    })));
    expect(created.lengthDays).toBe(75);
    const joined = await game(accept(request(invitee, { termsVersion: 1, timeZone: "UTC" }), {
      params: Promise.resolve({ token: created.inviteToken! }),
    }));
    expect(joined.status).toBe("live");
    expect(joined.changeControls).toMatchObject({ canEditTasks: false, canEditStakes: false });
    await game(start(request(challenger), context));
    await photo(challenger, id, 1);
    const both = await photo(invitee, id, 2);
    expect(both.players.map((player) => player.streak)).toEqual([1, 1]);
    await game(advance(request(challenger, { days: 1 }), context));
    const dayTwo = await photo(challenger, id, 3);
    expect(dayTwo.players.find((player) => player.isMe)?.streak).toBe(2);
    const homeResponse = await home(request(challenger, undefined, "GET"));
    expect(homeResponse.status).toBe(200);
    const homeView: GameHomeView = await homeResponse.json();
    expect(homeView.me.usualKind).toBe("photo");
    const recap = await game(settle(request(challenger), context));
    expect(recap.status).toBe("settled");
    expect(recap.tickets).toHaveLength(1);
    expect(recap.tickets[0]).toMatchObject({ kind: "dare", youHold: true, what: "Sing at karaoke" });
    expect(recap.days[0]?.others[0]?.entry?.kind).toBe("photo");
  }, 30_000);

  it("reports a photo, hides it and its upload from the reporter, then blocks and unblocks over HTTP", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const id = randomUUID();
    const context = { params: Promise.resolve({ id }) };
    const created = await game(create(request(leo, { gameId: id, inviteeFirstName: "Ava", terms: {
      startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Choose a book" }],
      tasks: [{ seat: 0, text: "Move" }, { seat: 1, text: "Move" }],
    } })));
    await game(accept(request(ava, { termsVersion: 1, timeZone: "UTC" }), { params: Promise.resolve({ token: created.inviteToken! }) }));
    await game(start(request(leo), context));
    const avaPosted = await photo(ava, id, 41);
    const key = decodeURIComponent(avaPosted.days[0].mine!.mediaUrls[0].split("/media/")[1]!);
    await photo(leo, id, 42);
    expect(await mediaStatus(leo, key)).toBe(200);
    const entryId = avaPosted.days[0].mine!.entryId;

    const reported = await game(reportRoute(request(leo, { reportId: randomUUID(), entryId, reason: "sexual", note: "Not okay" }), context));
    expect(reported.days[0].others[0]).toEqual({ entry: null, hidden: true, seat: 1, status: "posted" });
    expect(await mediaStatus(leo, key)).toBe(404);
    expect(await mediaStatus(ava, key)).toBe(200);
    const bad = await reportRoute(request(leo, { reportId: randomUUID(), reason: "rude" }), context);
    expect(bad.status).toBe(400);

    const avaId = tokenMember.get(ava)!;
    const blocked = await blockRoute(request(leo, undefined, "PUT"), { params: Promise.resolve({ memberId: avaId }) });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({ ok: true, game: null });
    const leoHome: GameHomeView = await (await home(request(leo, undefined, "GET"))).json();
    expect(leoHome.blocked).toEqual([{ firstName: "Ava", memberId: avaId }]);
    expect(leoHome.games.map((view) => view.id)).not.toContain(id);
    const avaView = await game(read(request(ava, undefined, "GET"), context));
    expect(avaView).toMatchObject({ status: "void" });
    expect(avaView.players.find((player) => !player.isMe)).toMatchObject({ left: true, memberId: null });
    const unblocked = await unblockRoute(request(leo, undefined, "DELETE"), { params: Promise.resolve({ memberId: avaId }) });
    expect(unblocked.status).toBe(200);
    expect((await (await home(request(leo, undefined, "GET"))).json()).blocked).toEqual([]);
  }, 30_000);

  it("asks for Murph's current Terms before create, accept and post only while the switch is on, then plays on", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    // Both agreed to an older Terms; the flag alone decides whether that still plays.
    for (const token of [leo, ava]) {
      await getPrisma().hostedConsentGrant.create({ data: { memberId: tokenMember.get(token)!, scope: "launch.legal",
        documentVersionsJson: { "terms-of-service": "2020-01-01", "privacy-policy": "2020-01-01", "health-ai-safety-disclosure": "2020-01-01" },
        grantedAt: new Date(), source: "test" } });
    }
    const terms = { startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Choose a book" }],
      tasks: [{ seat: 0, text: "Move" }, { seat: 1, text: "Move" }] };
    const off = await game(create(request(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms })));
    expect(off.status).toBe("invited");

    vi.stubEnv("MURPH_GAME_REQUIRE_CURRENT_TERMS", "true");
    try {
      const id = randomUUID();
      const context = { params: Promise.resolve({ id }) };
      const refusal = async (response: Promise<Response>) => {
        const result = await response;
        const body = await result.json();
        expect(result.status, JSON.stringify(body)).toBe(403);
        expect(body.error).toMatchObject({ code: "TERMS_REQUIRED", details: { scope: "launch.legal" } });
        return Object.fromEntries((body.error.details.documents as { id: string; version: string }[])
          .map((document) => [document.id, document.version]));
      };
      const agreeTo = async (token: string, acceptedDocumentVersions: Record<string, string>) => {
        const agreed = await agree(request(token, { scope: "launch.legal", acceptedDocumentVersions }));
        expect(agreed.status).toBe(200);
      };
      // The versions the refusal names are the ones that unblock it.
      await agreeTo(leo, await refusal(create(request(leo, { gameId: id, inviteeFirstName: "Ava", terms }))));
      const created = await game(create(request(leo, { gameId: id, inviteeFirstName: "Ava", terms })));
      const invite = { params: Promise.resolve({ token: created.inviteToken! }) };
      const versions = await refusal(accept(request(ava, { termsVersion: 1, timeZone: "UTC" }), invite));
      // Reading, reporting and taking things back stay open meanwhile.
      expect((await home(request(ava, undefined, "GET"))).status).toBe(200);
      expect((await game(read(request(leo, undefined, "GET"), context))).status).toBe("invited");
      await agreeTo(ava, versions);
      expect((await game(accept(request(ava, { termsVersion: 1, timeZone: "UTC" }), invite))).status).toBe("live");
      await game(start(request(leo), context));
      await photo(ava, id, 61);

      // Leo's grant goes stale mid-game: his post waits, Ava's game reads on.
      await getPrisma().hostedConsentGrant.update({ where: { memberId_scope: { memberId: tokenMember.get(leo)!, scope: "launch.legal" } },
        data: { documentVersionsJson: { "terms-of-service": "2020-01-01" } } });
      const mediaKey = await imageKey(leo, 62);
      const entry = { entryId: randomUUID(), kind: "photo", mediaKeys: [mediaKey] };
      await agreeTo(leo, await refusal(post(request(leo, entry), context)));
      const posted = await game(post(request(leo, entry), context));
      expect(posted.days[0].mine?.entryId).toBe(entry.entryId);
    } finally {
      vi.stubEnv("MURPH_GAME_REQUIRE_CURRENT_TERMS", "");
    }
  }, 30_000);

  it("posts every summary kind through dev days and reveals the untouched partner days only in recap", async () => {
    const poster = await member("Poster");
    const viewer = await member("Viewer");
    const id = randomUUID();
    const context = { params: Promise.resolve({ id }) };
    const created = await game(create(request(poster, { gameId: id, inviteeFirstName: "Viewer", terms: {
      startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      schedule: { count: 4 }, stakes: [{ kind: "prize", item: "Choose a book" }],
      tasks: [{ seat: 0, text: "Move" }, { seat: 1, text: "Move" }],
    } })));
    await game(accept(request(viewer, { termsVersion: 1, timeZone: "UTC" }), { params: Promise.resolve({ token: created.inviteToken! }) }));
    await game(start(request(poster), context));
    const artifacts = [
      { kind: "words", text: "A walk outside" },
      { kind: "heart_rate", data: { durationSec: 60, avgBpm: 120, lowBpm: 100, peakBpm: 140 } },
      { kind: "route", data: { activity: "walk", distanceM: 1200.5, durationSec: 600 } },
      { kind: "reps", data: { exercise: "pushups", count: 1, reps: [{ tMs: 100, depth: 0.9 }] } },
    ];
    for (const [day, artifact] of artifacts.entries()) {
      if (day > 0) await game(advance(request(poster, { days: 1 }), context));
      const mediaKeys = artifact.kind === "words" ? [] : [await imageKey(poster, day + 10)];
      if (artifact.kind === "heart_rate") {
        const invalid = await post(request(poster, { entryId: randomUUID(), kind: "heart_rate", mediaKeys }), context);
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
      }
      const posted = await game(post(request(poster, { ...artifact, entryId: randomUUID(), mediaKeys, blurHash: "synthetic-blur" }), context));
      expect(posted.days[day].mine).toMatchObject({ kind: artifact.kind, data: artifact.data ?? null });
      const locked = await game(read(request(viewer, undefined, "GET"), context));
      expect(locked.days[day].others[0]).toEqual({ seat: 0, status: "locked", entry: null,
        postedAt: expect.any(String), blurHash: "synthetic-blur" });
    }
    await game(advance(request(poster, { days: 1 }), context));
    await game(post(request(poster, { entryId: randomUUID(), kind: "words", text: "First" }), context));
    // The shared cap still counts attempts across different artifact kinds.
    await game(post(request(poster, { entryId: randomUUID(), kind: "words", text: "Retake" }), context));
    const third = await post(request(poster, { entryId: randomUUID(), kind: "route",
      mediaKeys: [await imageKey(poster, 30)], data: { activity: "run", distanceM: 10, durationSec: 10 } }), context);
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: { code: "RETAKE_USED" } });
    const recap = await game(settle(request(viewer), context));
    for (const [day, artifact] of artifacts.entries()) {
      expect(recap.days[day].others[0].entry).toMatchObject({ kind: artifact.kind, data: artifact.data ?? null });
      // Open now: no posted time, and the blur stays for while the picture loads.
      expect(recap.days[day].others[0]).not.toHaveProperty("postedAt");
      expect(recap.days[day].others[0].blurHash).toBe("synthetic-blur");
    }
  }, 30_000);
  describe("invite-only allowlist", () => {
    const terms = { schedule: { count: 7 }, stakes: [{ kind: "dare", item: "Sing at karaoke" }],
      tasks: [{ seat: 0, text: "Take a walk" }, { seat: 1, text: "Take a walk" }] };
    afterAll(() => vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", ""));
    // Accepting from 8pm local starts day 1 tomorrow, so play where it is midday now.
    const middayZone = () => {
      const offset = ((12 - new Date().getUTCHours() + 36) % 24) - 12;
      return offset === 0 ? "UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    };

    it.each([false, true])("keeps unblocking reachable after the only opponent is blocked (joined: %s)", async (joined) => {
      const listed = await account();
      const invitee = await account();
      const stranger = await account();
      vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", listed.id);
      expect((await profile(request(listed.token, { firstName: "Ava", timeZone: "UTC" }, "PUT"))).status).toBe(200);
      const created = await game(create(request(listed.token, { gameId: randomUUID(), inviteeFirstName: "Leo", terms })));
      const token = created.inviteToken!;
      expect((await profile(request(invitee.token, { firstName: "Leo", timeZone: "UTC" }, "PUT", token))).status).toBe(200);
      if (joined) {
        await game(accept(request(invitee.token, { termsVersion: 1, timeZone: "UTC" }), { params: Promise.resolve({ token }) }));
        expect((await blockRoute(request(invitee.token, undefined, "PUT"), { params: Promise.resolve({ memberId: listed.id }) })).status).toBe(200);
      } else {
        expect((await blockInviteRoute(request(invitee.token, undefined, "PUT"), { params: Promise.resolve({ token }) })).status).toBe(200);
      }
      // No held link is needed to reach You > Blocked people after blocking.
      const response = await home(request(invitee.token, undefined, "GET"));
      expect(response.status).toBe(200);
      expect((await response.json()).blocked).toEqual([{ firstName: "Ava", memberId: listed.id }]);
      await refused(create(request(invitee.token, { gameId: randomUUID(), inviteeFirstName: "Sam", terms })));
      await refused(home(request(stranger.token, undefined, "GET")));
      vi.stubEnv("MURPH_GAME_ENABLED", "false");
      try {
        await refused(home(request(invitee.token, undefined, "GET")));
        await refused(unblockRoute(request(invitee.token, undefined, "DELETE"), { params: Promise.resolve({ memberId: listed.id }) }));
      } finally {
        vi.stubEnv("MURPH_GAME_ENABLED", "true");
      }
      expect((await unblockRoute(request(invitee.token, undefined, "DELETE"), { params: Promise.resolve({ memberId: listed.id }) })).status).toBe(200);
      expect(await getPrisma().gameBlock.count({ where: { blockerMemberId: invitee.id } })).toBe(0);
      await refused(create(request(invitee.token, { gameId: randomUUID(), inviteeFirstName: "Sam", terms })));
    });

    it("lets a new unlisted invitee in through a listed member's invite to play, settle, cash in and rematch, but never start fresh", async () => {
      const listed = await account();
      const invitee = await account();
      const stranger = await account();
      vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", listed.id);
      const timeZone = middayZone();
      expect((await profile(request(listed.token, { firstName: "Listed", timeZone }, "PUT"))).status).toBe(200);
      const id = randomUUID();
      const context = { params: Promise.resolve({ id }) };
      const created = await game(create(request(listed.token, { gameId: id, inviteeFirstName: "Invitee", terms })));
      const token = created.inviteToken!;

      // Before the invite, the routes are missing for the unlisted, as for everyone else.
      await refused(home(request(invitee.token, undefined, "GET")));
      await refused(profile(request(invitee.token, { firstName: "Invitee", timeZone: "UTC" }, "PUT")));
      // Holding the open invite lets them look and set up; Home says they can't start one.
      const held = await home(request(invitee.token, undefined, "GET", token));
      expect(held.status).toBe(200);
      expect(await held.json()).toMatchObject({ canStartGames: false });
      expect((await profile(request(invitee.token, { firstName: "Invitee", timeZone }, "PUT", token))).status).toBe(200);
      // The accept route vouches with its own token; no header needed.
      expect((await game(accept(request(invitee.token, { termsVersion: 1, timeZone }), { params: Promise.resolve({ token }) }))).status).toBe("live");

      const homeView: GameHomeView = await (await home(request(invitee.token, undefined, "GET"))).json();
      expect(homeView.games.map((shown) => shown.id)).toEqual([id]);
      expect(homeView.canStartGames).toBe(false);
      const listedHome: GameHomeView = await (await home(request(listed.token, undefined, "GET"))).json();
      expect(listedHome.canStartGames).toBe(true);

      await photo(invitee.token, id, 41);
      await photo(listed.token, id, 42);
      expect((await game(read(request(invitee.token, undefined, "GET"), context))).days[0].others[0].entry?.kind).toBe("photo");
      const proposalId = randomUUID();
      const proposed = await game(proposeChange(request(invitee.token, { proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 } }), context));
      expect(proposed.pendingChange?.id).toBe(proposalId);
      expect((await game(cancelChange(request(invitee.token, undefined, "DELETE"), { params: Promise.resolve({ id, proposalId }) }))).pendingChange).toBeNull();
      for (let day = 1; day < 7; day += 1) {
        await game(advance(request(invitee.token, { days: 1 }), context));
        await photo(invitee.token, id, 42 + day);
      }
      const recap = await game(settle(request(invitee.token), context));
      expect(recap.status).toBe("settled");
      const won = recap.tickets.find((ticket) => ticket.youHold);
      expect(won).toBeDefined();
      expect((await redeem(request(invitee.token), { params: Promise.resolve({ id: won!.id }) })).status).toBe(200);

      // A settled game stays on: Home still answers with it and its IOUs.
      const afterwards: GameHomeView = await (await home(request(invitee.token, undefined, "GET"))).json();
      expect(afterwards.games.map((shown) => shown.id)).toContain(id);
      expect(afterwards.wallet.redeemed.map((ticket) => ticket.id)).toContain(won!.id);

      // No fresh game, with anyone.
      await refused(create(request(invitee.token, { gameId: randomUUID(), inviteeFirstName: "Anyone", terms })));
      // A rematch goes to the listed player, who answers it by accepting.
      const rematch = await game(create(request(invitee.token, { gameId: randomUUID(), inviteeFirstName: "Listed", previousGameId: id, terms })));
      expect(rematch).toMatchObject({ status: "invited", round: 2 });
      const theirs: GameHomeView = await (await home(request(listed.token, undefined, "GET"))).json();
      const addressed = theirs.games.find((shown) => shown.id === rematch.id);
      expect(addressed?.inviteToken).toBeTruthy();
      expect((await game(accept(request(listed.token, { termsVersion: 1, timeZone: "UTC" }), { params: Promise.resolve({ token: addressed!.inviteToken! }) }))).status).toBe("live");

      // A stranger holding a used link, or nothing, still sees no game.
      await refused(home(request(stranger.token, undefined, "GET", token)));
      await refused(home(request(stranger.token, undefined, "GET")));
      await refused(accept(request(stranger.token, { termsVersion: 1, timeZone: "UTC" }), { params: Promise.resolve({ token }) }));
    }, 60_000);

    it("keeps two unlisted members, a listed member's invite to them when the switch is off, and the other direction of a rematch in step", async () => {
      const listed = await account();
      const unlisted = await account();
      const other = await account();
      vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", listed.id);
      expect((await profile(request(listed.token, { firstName: "Listed", timeZone: "UTC" }, "PUT"))).status).toBe(200);
      const id = randomUUID();
      const context = { params: Promise.resolve({ id }) };
      const created = await game(create(request(listed.token, { gameId: id, inviteeFirstName: "Unlisted", terms })));
      expect((await profile(request(unlisted.token, { firstName: "Unlisted", timeZone: "UTC" }, "PUT", created.inviteToken!))).status).toBe(200);
      await game(accept(request(unlisted.token, { termsVersion: 1, timeZone: "UTC" }), { params: Promise.resolve({ token: created.inviteToken! }) }));
      await game(settle(request(listed.token), context));

      // The listed player rematches the unlisted one; the unlisted one answers.
      const rematch = await game(create(request(listed.token, { gameId: randomUUID(), inviteeFirstName: "Unlisted", previousGameId: id, terms })));
      const shown: GameHomeView = await (await home(request(unlisted.token, undefined, "GET"))).json();
      expect(shown.games.find((candidate) => candidate.id === rematch.id)?.status).toBe("invited");

      // Two unlisted members: the other one never gets in, even with a profile request.
      await refused(home(request(other.token, undefined, "GET")));
      await refused(create(request(other.token, { gameId: randomUUID(), inviteeFirstName: "Unlisted", terms })));

      // Off the list entirely (the listed member removed), their games go dark.
      vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", other.id);
      await refused(home(request(unlisted.token, undefined, "GET")));
      await refused(home(request(listed.token, undefined, "GET")));
      // The global switch off hides it from everyone, the listed included.
      vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", listed.id);
      vi.stubEnv("MURPH_GAME_ENABLED", "false");
      await refused(home(request(listed.token, undefined, "GET")));
      await refused(home(request(unlisted.token, undefined, "GET")));
      vi.stubEnv("MURPH_GAME_ENABLED", "true");
      expect((await home(request(unlisted.token, undefined, "GET"))).status).toBe(200);
    }, 60_000);
  });
});
