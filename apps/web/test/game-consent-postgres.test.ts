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
import { POST as agree } from "../app/api/device-sync/companion/legal-consent/route";
import { hostedAuthAdapter } from "@/src/lib/better-auth/adapter";
import { serializeHostedNativeSessionToken } from "@/src/lib/better-auth/transport";
import type { GameView } from "@/src/lib/game/contract";
import { readGameRecapMaterial } from "@/src/lib/game/service";
import * as gameCrypto from "@/src/lib/game/crypto";
import { deliverGameChatLifecycle } from "@/src/lib/game/chat-lifecycle";
import { readHostedMailboxWakeByDedupeKey } from "@/src/lib/hosted-mailbox/store";
import { claimHostedRuntime } from "@/src/lib/hosted-execution/runtime-owner";
import { readStrictHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";
import * as admission from "@/src/lib/hosted-onboarding/companion-member-access";
import * as linq from "@/src/lib/hosted-onboarding/linq-client";
import { buildCurrentHostedConsentDocumentVersions, recordHostedLaunchRequiredConsent, revokeHostedConsentScope } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { localRosterCrypto, rosterPhoneIdentity, rosterRoute, syntheticPhone } from "./support/roster-postgres";
import { linqRoster } from "./support/linq-roster";

// Keep the real admission implementation observable, and stop only the external
// runtime signal. HTTP auth, consent, game, room and mailbox writes stay real.
vi.mock("@/src/lib/hosted-onboarding/companion-member-access", { spy: true });
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: vi.fn() }));
const afterResponse = vi.hoisted(() => [] as Array<() => Promise<unknown>>);
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(),
  after: (task: () => Promise<unknown>) => { afterResponse.push(task); },
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.search || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname)) {
    throw new Error("Game consent proof requires an isolated loopback test database.");
  }
}
const members: string[] = [];
const lines: string[] = [];
let mediaDir = "";
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
  const id = randomUUID(), token = randomUUID().replaceAll("-", "");
  members.push(id);
  const db = getPrisma();
  await db.hostedMember.create({ data: { id, billingStatus: "not_started" } });
  const adapter = hostedAuthAdapter(db)({});
  const dates = { createdAt: new Date(), updatedAt: new Date() };
  await adapter.create({ model: "user", forceAllowId: true,
    data: { id, email: `${id}@example.test`, emailVerified: true, name: "", ...dates } });
  await adapter.create({ model: "session", forceAllowId: true, data: {
    id: `session-${id}`, userId: id, token, expiresAt: new Date(Date.now() + 3_600_000), ...dates,
  } });
  expect((await profile(request(token, { firstName, timeZone: "UTC" }, "PUT"))).status).toBe(200);
  expect((await agree(request(token, { scope: "launch.legal",
    acceptedDocumentVersions: buildCurrentHostedConsentDocumentVersions("launch.legal") }))).status).toBe(200);
  return { id, token };
}
async function imageKey(token: string): Promise<string> {
  const response = await upload(new Request("http://localhost/api/game/v1/media", {
    method: "POST", headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}`, "content-type": "image/jpeg" },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9]),
  }));
  expect(response.status).toBe(200);
  return (await response.json()).mediaKey;
}
async function livePair() {
  const a = await member("Player"), b = await member("Partner"), id = randomUUID();
  const context = { params: Promise.resolve({ id }) };
  const created = await game(create(request(a.token, { gameId: id, inviteeFirstName: "Partner", terms: {
    startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }],
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose a film" }],
  } })));
  expect(created.status).toBe("invited");
  expect((await game(accept(request(b.token, { termsVersion: 1, timeZone: "UTC" }), {
    params: Promise.resolve({ token: created.inviteToken! }),
  }))).status).toBe("live");
  await game(start(request(a.token), context));
  return { a, b, id, context };
}

describe.skipIf(!enabled)("game consent against PostgreSQL", () => {
  beforeAll(async () => {
    localRosterCrypto();
    mediaDir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "game-consent-"));
    vi.stubEnv("MURPH_GAME_MEDIA_DIR", mediaDir);
    vi.stubEnv("MURPH_GAME_REQUIRE_CURRENT_TERMS", "true");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 9).toString("base64url"));
  });
  afterAll(async () => {
    afterResponse.length = 0;
    const db = getPrisma();
    await cleanupGameFixtures(db, members);
    await db.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
    await db.hostedGroup.deleteMany({ where: { ownerMemberId: { in: members } } });
    await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
    await db.hostedMember.deleteMany({ where: { id: { in: members } } });
    await db.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: { in: lines } } });
    await rm(mediaDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("plays a whole pair game with legal-only members, funding only the shared room", async () => {
    const db = getPrisma();
    const { a, b, id, context } = await livePair();
    const players = [a.id, b.id];
    const phones = [syntheticPhone(), syntheticPhone()], line = syntheticPhone();
    for (const [index, player] of players.entries()) await rosterPhoneIdentity(db, player, phones[index]);
    // Accept reserves the kickoff; the lifecycle drain delivers it. Exercise
    // that service through new room creation and mailbox publication.
    expect(await deliverGameChatLifecycle(id, "started")).toBe(true);
    const room = (await db.game.findUniqueOrThrow({ where: { id } })).chatContainerMemberId;
    expect(room).not.toBeNull();
    if (!room) throw new Error("Expected game-owned chat room");
    members.push(room);
    expect(await readHostedMailboxWakeByDedupeKey({ userId: room, dedupeKey: `game-started:${id}`, prisma: db }))
      .toMatchObject({ kind: "assistant.notification.requested", notification: { gameChatBootstrap: { gameId: id } } });
    const claim = await claimHostedRuntime({ prisma: db, userId: room, now: new Date(), processingMode: "default" });
    expect(claim.status).not.toBe("blocked");
    expect(await db.hostedRuntimeOwner.findUnique({ where: { userId: room } })).toMatchObject({ allowanceBeneficiaryMemberId: room });
    // Existing support supplies the provider's resulting route and roster.
    lines.push(await rosterRoute(db, room, `synthetic-chat-${id}`, line));
    vi.spyOn(linq, "getHostedLinqChatSummary").mockResolvedValue(linqRoster({ isGroup: true, handlesComplete: true,
      handles: [{ handle: line, isMe: true, status: "active" }, ...phones.map(handle => ({ handle, isMe: false, status: "active" as const }))] }));
    for (const player of [a, b]) {
      await game(post(request(player.token, { entryId: randomUUID(), kind: "photo", mediaKeys: [await imageKey(player.token)] }), context));
    }
    await game(advance(request(a.token, { days: 1 }), context));
    await game(post(request(a.token, { entryId: randomUUID(), kind: "words", text: "Finished the walk.", mediaKeys: [] }), context));
    await game(post(request(b.token, { entryId: randomUUID(), kind: "route", mediaKeys: [await imageKey(b.token)],
      data: { activity: "walk", distanceM: 1200, durationSec: 600 } }), context));
    expect((await game(settle(request(a.token), context))).status).toBe("settled");
    const recap = await readGameRecapMaterial(id, room, players);
    expect(recap?.entries.map(entry => entry.kind).sort()).toEqual(["photo", "photo", "route", "words"]);
    expect(await db.hostedConsentGrant.findMany({ where: { memberId: { in: players } }, select: { scope: true, status: true } }))
      .toEqual([{ scope: "launch.legal", status: "granted" }, { scope: "launch.legal", status: "granted" }]);
    for (const player of players) expect(await readStrictHostedMemberAccess({ memberId: player, prisma: db })).toBe(false);
    expect(await db.hostedMember.count({ where: { id: { in: players }, billingStatus: "not_started" } })).toBe(2);
    expect(await db.hostedUsageCreditGrant.count({ where: { beneficiaryMemberId: { in: players } } })).toBe(0);
    expect(await db.hostedRuntimeOwner.count({ where: { userId: { in: players } } })).toBe(0);
    expect(await db.hostedWorkspace.count({ where: { userId: { in: players } } })).toBe(0);
    expect(await db.hostedMailboxItem.count({ where: { userId: { in: players } } })).toBe(0);
    expect(await db.hostedLinqDelivery.count({ where: { OR: [
      { payloadOwnerMemberId: { in: players } }, { sourceRef: { in: players } },
    ] } })).toBe(0);
    expect(admission.requireHostedCompanionMemberIdFromRequest).not.toHaveBeenCalled();
  });

  const heartRate = { durationSec: 60, avgBpm: 120, lowBpm: 100, peakBpm: 140 };
  const reps = { exercise: "pushups", count: 1, reps: [{ tMs: 100, depth: 0.9 }] };
  for (const kind of ["heart_rate", "reps"] as const) {
    it.each(["missing", "revoked", "granted"] as const)(`${kind} requires a granted health scope: %s`, async status => {
      const db = getPrisma();
      const { a, id, context } = await livePair();
      if (status !== "missing") await recordHostedLaunchRequiredConsent({ memberId: a.id, prisma: db, scope: "launch.health-data" });
      if (status === "revoked") await revokeHostedConsentScope({ memberId: a.id, prisma: db, scope: "launch.health-data" });
      const entry = { entryId: randomUUID(), kind, mediaKeys: [await imageKey(a.token)],
        data: kind === "heart_rate" ? heartRate : { ...reps, heartRate } };
      if (status === "granted") {
        const first = await game(post(request(a.token, entry), context));
        const replay = await game(post(request(a.token, entry), context));
        expect(replay.days).toEqual(first.days);
        expect(await db.gameEntry.count({ where: { gameId: id } })).toBe(1);
        expect(await db.gameEvent.count({ where: { gameId: id, type: "posted" } })).toBe(1);
      } else {
        const response = await post(request(a.token, entry), context);
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toMatchObject({ error: {
          code: "HEALTH_DATA_REQUIRED", message: "Allow health data to post a heart rate.", retryable: false,
        } });
        expect(await db.gameEntry.count({ where: { gameId: id } })).toBe(0);
        expect(await db.gameEvent.count({ where: { gameId: id, type: "posted" } })).toBe(0);
      }
    });
  }

  it("allows a plain rep card without a health grant", async () => {
    const { a, context } = await livePair();
    const entryId = randomUUID();
    const result = await game(post(request(a.token, { entryId, kind: "reps", data: reps,
      mediaKeys: [await imageKey(a.token)] }), context));
    expect(result.days[0].mine).toMatchObject({ entryId, kind: "reps", data: reps });
  });

  it("lets a withdrawal committed after payload preparation win without entry or history writes", async () => {
    const db = getPrisma();
    const { a, id, context } = await livePair();
    await recordHostedLaunchRequiredConsent({ memberId: a.id, prisma: db, scope: "launch.health-data" });
    const entry = { entryId: randomUUID(), kind: "heart_rate", data: heartRate, mediaKeys: [await imageKey(a.token)] };
    const historyBefore = await db.gameEvent.count({ where: { gameId: id } });
    let markPrepared!: () => void, release!: () => void;
    const prepared = new Promise<void>(resolve => { markPrepared = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const seal = gameCrypto.sealGameText;
    vi.spyOn(gameCrypto, "sealGameText").mockImplementation(async (target, value) => {
      const encrypted = await seal(target, value);
      if (target.rowId === entry.entryId && target.field === "payload") {
        markPrepared();
        await released;
      }
      return encrypted;
    });
    const posting = post(request(a.token, entry), context);
    try {
      await Promise.race([prepared, posting.then(() => { throw new Error("Post did not pause before its transaction"); })]);
      await revokeHostedConsentScope({ memberId: a.id, prisma: db, scope: "launch.health-data" });
    } finally { release(); }
    const response = await posting;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "HEALTH_DATA_REQUIRED", retryable: false } });
    expect(await db.gameEntry.count({ where: { gameId: id } })).toBe(0);
    expect(await db.gameEvent.count({ where: { gameId: id } })).toBe(historyBefore);
  });
});
