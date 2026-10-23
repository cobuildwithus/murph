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
let mediaDir: string;
const request = (token: string, body?: unknown, method = "POST") => new Request("http://localhost/api/game/v1", {
  method, headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}`, "content-type": "application/json" },
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
  const response = await profile(request(token, { firstName, timeZone: "UTC" }, "PUT"));
  expect(response.status).toBe(200);
  return token;
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
      expect(recap.days[day].others[0]).not.toHaveProperty("blurHash");
    }
  }, 30_000);
});
