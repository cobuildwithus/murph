import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Service tests inject provider/route evidence; room integration lives in the group suite.
vi.mock("@/src/lib/game/chat-membership", async original => ({ ...await original<typeof import("@/src/lib/game/chat-membership")>(),
  readGameChatAudience: async (room: string) => {
    const { getPrisma } = await import("@/src/lib/prisma");
    const players = await getPrisma().gamePlayer.findMany({ where: { game: { chatContainerMemberId: room } }, select: { memberId: true } });
    const memberIds = [...new Set(players.flatMap(player => player.memberId ? [player.memberId] : []))];
    return { memberIds, contacts: [], resolvedContacts: [], keys: { current: null, candidates: [] }, threadId: room };
  } }));
vi.mock("@/src/lib/hosted-routing/thread-route-store", async original => ({ ...await original<object>(),
  readHostedThreadRouteByThreadIdentity: async ({ threadId }: { threadId: string }) => ({ containerMemberId: threadId }) }));

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
      env: "test", gcpKms, webWrapKmsKeyName: "projects/example/locations/global/keyRings/hosted/cryptoKeys/history-benchmark",
    }),
  };
});


const push = vi.hoisted(() => vi.fn().mockResolvedValue("sent"));
const lifecycleDelivery = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const proposalDelivery = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: lifecycleDelivery }));
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: proposalDelivery }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/src/lib/apple-push/send", async (original) => ({
  ...await original<typeof import("@/src/lib/apple-push/send")>(), sendApplePush: push,
}));
// A post's push goes after its response; these runs wait for it like the platform does.
const afterResponse = vi.hoisted(() => [] as Promise<unknown>[]);
const deferredResponse = vi.hoisted(() => ({ hold: false, tasks: [] as Array<() => Promise<unknown>> }));
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: (task: () => Promise<unknown>) => { if (deferredResponse.hold) deferredResponse.tasks.push(task); else afterResponse.push(task()); },
}));

import { bindPairGameChat } from "@/src/lib/game/chat-membership";
import { lockGamePair } from "@/src/lib/game/blocks";
import type { GameCommand, GameTermsInput } from "@/src/lib/game/contract";
import { putGameMedia } from "@/src/lib/game/media";
import * as gameMedia from "@/src/lib/game/media";
import { gameMediaUrl } from "@/src/lib/game/views";
import { withHistoryPhotoDeliveries } from "@/src/lib/game/http/media-routes";
import { sealGameText } from "@/src/lib/game/crypto";
import {
  devAdvanceDays,
  devSettleNow,
  devStartNow,
  mediaKeyPrefixFor,
  authorizeLockedPreviewReads,
  authorizeMediaRead,
  authorizeMediaReads,
  readGame,
  readGamePhotoPostingStateTx,
  readGameRecapMaterial,
  GAME_RECAP_UI_WAIT_MS,
  readGameChallengeCase,
  readGameChallengeInstructions,
  readGameRematchNotice,
  readHistory,
  readHome,
  readGameChatState,
  readGameNoticeRoom,
  reserveDueGameMissedDayCheckIns,
  sealGameRecap,
  readInvitePreview,
  runGameCommand,
} from "@/src/lib/game/service";
import { buildGameRematchInstructions } from "@murphai/hosted-execution/runtime-control";
import { decideNewTerms, gameChallengeKey, parseStoredTerms } from "@/src/lib/game/rules";
import { toPrismaJsonObject } from "@/src/lib/device-sync/prisma-store/prisma-json";
import { addDays, dayStartInstant, gameLocalDate, weekdayOf } from "@/src/lib/game/time";
import { getPrisma } from "@/src/lib/prisma";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import { gameChatLifecycleEventId, reserveGameChatLifecycleTx, markGameChatGenerationQueuedTx } from "@/src/lib/game/chat-lifecycle-receipt";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error("The weekly game PostgreSQL proof requires a local DATABASE_URL.");
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const TERMS: GameTermsInput = {
  startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  stakes: [{ item: "Breakfast in bed", kind: "prize" }],
  tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
};
const memberIds: string[] = [];
let mediaDir = "";

async function member(firstName: string, timeZone: string, realCrypto = false): Promise<string> {
  const id = `hbm_gametest_${firstName.toLowerCase()}_${randomUUID().slice(0, 8)}`;
  await getPrisma().hostedMember.create({ data: { billingStatus: "active", id } });
  memberIds.push(id);
  if (realCrypto) {
    const { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } = await import("../src/lib/hosted-crypto/domain-root-store");
    const { runWithHostedDomainRootUnwrapCache } = await import("../src/lib/hosted-crypto/domain-root-unwrap-cache");
    await runWithHostedDomainRootUnwrapCache(async () => {
      const prepared = await prepareHostedDomainRootForWeb({ domain: "control", reason: "test", userId: id });
      await getPrisma().$transaction(tx => revalidatePreparedHostedDomainRootForWebTx({ prepared, tx }));
    });
  }
  await ok(id, { firstName, timeZone, type: "setProfile" });
  return id;
}

async function pushRoute(memberId: string, alertsAllowed = true): Promise<string> {
  const sessionId = randomUUID();
  const now = new Date();
  await getPrisma().hostedAuthRecord.create({ data: {
    model: "session", id: sessionId, memberId, payloadEncrypted: "synthetic-unused-by-delivery",
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), createdAt: now, updatedAt: now,
  } });
  await getPrisma().companionPushRoute.create({ data: {
    userId: memberId, installationId: randomUUID(), token: "ab".repeat(32),
    topic: "ai.withmurph.app.dev", environment: "development",
    alertsAllowed, gameSessionId: sessionId, updatedAt: now,
  } });
  return sessionId;
}

async function run(actor: string, command: GameCommand) {
  return runAndRespond({ actorMemberId: actor, command });
}

/** One command as a route runs it: its answer, then what the route does after responding. */
async function runAndRespond(input: Parameters<typeof runGameCommand>[0]) {
  const result = await runGameCommand(input);
  await Promise.all(afterResponse.splice(0));
  return result;
}

async function ok(actor: string, command: GameCommand) {
  const result = await run(actor, command);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.error.code} ${result.error.message}`);
  return result.game;
}

async function errorCode(actor: string, command: GameCommand) {
  const result = await run(actor, command);
  return result.ok ? "OK" : result.error.code;
}

/** A real stored upload under the member's prefix, as POST /media stores it (distinct bytes per name). */
async function upload(memberId: string, name: string): Promise<string> {
  const bytes = new Uint8Array([...JPEG, ...new TextEncoder().encode(name)]);
  return putGameMedia({ bytes, contentType: "image/jpeg", prefix: mediaKeyPrefixFor(memberId) });
}

async function photo(actor: string, gameId: string, name: string, text?: string): Promise<Extract<GameCommand, { type: "post" }>> {
  return {
    entryId: randomUUID(),
    gameId,
    kind: "photo",
    mediaKeys: [await upload(actor, name)],
    type: "post",
    ...(text ? { text } : {}),
  };
}

/**
 * Challenger invites, invitee accepts; returns the game id and its invite token.
 * The invitee plays from New York like the challengers here, so Start now
 * starts today for both whatever hour the suite runs (zones are the rules' job).
 */
async function startGame(challenger: string, invitee: string, extra: Partial<Extract<GameCommand, { type: "createGame" }>> = {}, inviteeTimeZone = "America/New_York") {
  const gameId = randomUUID();
  const created = await ok(challenger, { gameId, inviteeFirstName: "Friend", terms: TERMS, type: "createGame", ...extra });
  const token = created!.inviteToken!;
  await ok(invitee, { termsVersion: 1, timeZone: inviteeTimeZone, token, type: "join" });
  return { gameId, token };
}

async function seedSettledGame(input: {
  challenger: string;
  opponent: string;
  settledAt: Date;
  scores?: [number, number];
  misses?: [number, number];
  mediaDays?: number;
}): Promise<{ gameId: string; entryIds: string[]; mediaKeys: string[] }> {
  const gameId = randomUUID();
  const terms = decideNewTerms(TERMS, {
    newKey: () => randomUUID(),
    today: new Date().toISOString().slice(0, 10),
  });
  const termsWordsEncrypted = await sealGameText(
    { field: "terms_words", memberId: input.challenger, rowId: gameId, table: "game" },
    JSON.stringify(terms.words),
  );
  if (!termsWordsEncrypted) throw new Error("Synthetic game terms were not sealed.");
  const dayOne = new Date("2030-01-01T00:00:00.000Z");
  const scores = input.scores ?? [0, 0];
  const misses = input.misses ?? [7, 7];
  await getPrisma().game.create({ data: {
    id: gameId,
    createdBy: input.challenger, wordsOwnerMemberId: input.challenger,
    status: "settled",
    terms: toPrismaJsonObject(terms.terms),
    termsWordsEncrypted,
    lengthDays: terms.lengthDays,
    startsOn: dayOne,
    startedAt: dayOne,
    settledAt: input.settledAt,
    result: toPrismaJsonObject({
      scores: [
        { memberId: input.challenger, misses: misses[0], score: scores[0], seat: 0 },
        { memberId: input.opponent, misses: misses[1], score: scores[1], seat: 1 },
      ],
      termsVersion: 1,
      v: 1,
    }),
    players: { create: [
      { memberId: input.challenger, seat: 0, joinedAt: new Date("2030-01-01T12:00:00Z"), timeZone: "UTC", dayOne },
      { memberId: input.opponent, seat: 1, joinedAt: new Date("2030-01-01T12:00:00Z"), timeZone: "UTC", dayOne },
    ] },
  } });
  const entryIds: string[] = [];
  const mediaKeys: string[] = [];
  for (let dayIndex = 0; dayIndex < (input.mediaDays ?? 0); dayIndex += 1) {
    for (const [memberId, seat] of [[input.challenger, 0], [input.opponent, 1]] as const) {
      const id = randomUUID();
      const mediaKey = `game/${memberId}/${randomBytes(32).toString("hex")}.jpg`;
      entryIds.push(id);
      mediaKeys.push(mediaKey);
      await getPrisma().gameEntry.create({ data: {
        id,
        gameId,
        memberId,
        dayIndex,
        attempt: 1,
        kind: "photo",
        mediaKeys: [mediaKey],
        receivedAt: new Date(dayOne.getTime() + dayIndex * 86_400_000 + seat),
      } });
    }
  }
  return { entryIds, gameId, mediaKeys };
}

describe.skipIf(!runPostgresProof)("weekly game service against PostgreSQL", () => {
  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT ?? tmpdir(), "game-media-"));
    process.env.MURPH_GAME_MEDIA_DIR = mediaDir;
  });

  afterAll(async () => {
    await cleanupGameFixtures(getPrisma(), memberIds);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
    delete process.env.MURPH_GAME_MEDIA_DIR;
    await rm(mediaDir, { force: true, recursive: true });
  });

  if (process.env.MURPH_RECAP_LIVE_BRIDGE === "1") it("serves synthetic recap publication to the sanctioned live journey", async () => {
    const { createServer } = await import("node:http");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { hostedGameToolRequestSchema } = await import("@murphai/hosted-execution/runtime-control");
    const { handleGameChatTool } = await import("@/src/lib/game/chat-tool");
    const { readRecapEnvelope, readAuthorizedRecapAsset } = await import("@/src/lib/game/recap-asset-access");
    const db = getPrisma();
    const owner = await import("@/src/lib/hosted-execution/runtime-owner");
    const access = await import("@/src/lib/hosted-mailbox/runtime-access");
    const fence = vi.spyOn(owner, "requireHostedRuntimeCallbackTx").mockImplementation(async (tx, id) => tx.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: id } }));
    const active = vi.spyOn(access, "requireHostedRuntimeActiveAccessForUpdateTx").mockResolvedValue();
    vi.stubEnv("MURPH_GAME_RECAP_SHOW_ENABLED", "true");
    vi.stubEnv("HOSTED_WEB_BASE_URL", "https://recaps.murph.test");
    vi.stubEnv("MURPH_GAME_RECAP_MEDIA_DIR", path.join(mediaDir, "recap"));
    const fixtures = new Map<string, { gameId: string; room: string; a: string; eventId: string }>();
    let finish: () => void = () => {};
    const done = new Promise<void>(resolve => { finish = resolve; });
    const server = createServer(async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        let result: unknown;
        if (req.url === '/setup') {
          const a = await member("Solene", "UTC", true), b = await member("Rene", "UTC", true), room = await member("Room", "UTC", true);
          await ok(a, { type: "setProfile", firstName: "Solène Vale", timeZone: "UTC" });
          await ok(b, { type: "setProfile", firstName: "René Costa", timeZone: "UTC" });
          const { gameId } = await startGame(a, b, { terms: { ...TERMS, lengthDays: 7 } }, 'UTC');
          await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
          const sharp = (await import('sharp')).default;
          const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#ccbbaa"/><circle cx="240" cy="180" r="90" fill="#665577"/><path d="M100 600V400Q240 250 380 400V600" fill="#557766"/></svg>')).jpeg().toBuffer();
          for (const id of [a, b]) {
            const key = await putGameMedia({ bytes, contentType: 'image/jpeg', prefix: mediaKeyPrefixFor(id) });
            await db.gameProfile.update({ where: { memberId: id }, data: { photoKey: key } });
          }
          await devStartNow(gameId, a);
          for (let day = 0; day < 7; day++) {
            if (day) await devAdvanceDays(gameId, a, 1);
            for (const id of [a, b]) {
              if (day === 4 && id === b) continue;
              const key = await putGameMedia({ bytes, contentType: 'image/jpeg', prefix: mediaKeyPrefixFor(id) });
              await ok(id, { type: 'post', gameId, entryId: randomUUID(), kind: 'photo', mediaKeys: [key], text: id === a ? 'The purple mat reported for duty.' : 'The laundry basket supervised.' });
            }
          }
          if ((await db.game.findUniqueOrThrow({ where: { id: gameId } })).status === "live") await devSettleNow(gameId, a);
          const eventId = gameChatLifecycleEventId(gameId, "recap");
          await markGameChatGenerationQueuedTx(eventId, db, room);
          const { recordGameRecapWitnessTx } = await import("@/src/lib/game/recap-witness");
          await db.$transaction(tx => recordGameRecapWitnessTx(tx, gameId, eventId));
          await db.hostedRuntimeOwner.create({ data: { userId: room } });
          fixtures.set(gameId, { gameId, room, a, eventId });
          result = { gameId, room, eventId };
        } else if (req.url === '/finish') { result = { done: true }; finish(); }
        else {
          const fixture = fixtures.get(body.gameId); if (!fixture) throw new Error('Unknown synthetic game.');
          if (req.url === '/tool') result = await handleGameChatTool({ memberId: fixture.room, runtimeIdentity: null, multiplayer: true, request: hostedGameToolRequestSchema.parse(body.request) });
          else {
            const accepted = await readRecapEnvelope(fixture.gameId);
            if (!accepted) throw new Error('The canonical Web writer did not accept a show.');
            const images = accepted.envelope.assets.filter(asset => asset.kind === 'image');
            expect(images.length).toBeGreaterThan(0);
            for (const image of images) {
              const asset = await readAuthorizedRecapAsset({ gameId: fixture.gameId, generationId: accepted.envelope.generationId, slot: image.slot, memberId: fixture.a });
              expect(asset?.bytes.length).toBeGreaterThan(0);
              expect(await readAuthorizedRecapAsset({ gameId: fixture.gameId, generationId: accepted.envelope.generationId, slot: image.slot, memberId: fixture.room })).toBeNull();
            }
            result = (await readGame(fixture.gameId, fixture.a))?.recap;
          }
        }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Synthetic bridge failed.' })); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected local bridge.');
    await mkdir(new URL('../../../audit-packages/recap-show-simplify/', import.meta.url), { recursive: true });
    await writeFile(new URL('../../../audit-packages/recap-show-simplify/bridge.json', import.meta.url), JSON.stringify({ url: `http://127.0.0.1:${address.port}` }));
    try { await done; expect(fixtures.size).toBeGreaterThanOrEqual(2); }
    finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      fence.mockRestore(); active.mockRestore(); vi.unstubAllEnvs();
      await db.hostedRuntimeOwner.deleteMany({ where: { userId: { in: [...fixtures.values()].map(f => f.room) } } });
      await db.gameRecapAsset.deleteMany({ where: { userId: { in: [...fixtures.values()].map(f => f.a) } } });
    }
  }, 3_600_000);

  it("freezes the post-to-read gap, then settles unequal weekday scores exactly once and delivers the last push", async () => {
    const a = await member("Alex", "UTC"), b = await member("Sam", "UTC");
    const db = getPrisma();
    const { gameId } = await startGame(a, b, { terms: { ...TERMS, schedule: { days: [0, 1, 2, 3, 4] } } }, "UTC");
    const room = `synthetic_room_${randomUUID()}`; memberIds.push(room);
    await db.hostedMember.create({ data: { id: room } });
    await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date("2030-03-04"), timeZone: "UTC" } });
    const move = async (at: string) => db.game.update({ where: { id: gameId }, data: { devClockOffsetMs: BigInt(Date.parse(at) - Date.now()) } });
    await move("2030-03-04T18:00:00Z");
    await ok(a, await photo(a, gameId, "first-day"));
    await move("2030-03-08T18:00:00Z");
    const first = await photo(a, gameId, "last-day-first"); await ok(a, first);
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    await pushRoute(a); push.mockClear();
    const last = await photo(b, gameId, "last-day-second");
    const inChat = (actorMemberId: string, command: GameCommand) => runGameCommand({ actorMemberId, command,
      chatContainerMemberId: room, chatPlayerMemberIds: [a, b], beforeMutationTx: async () => {} });
    deferredResponse.hold = true;
    try {
      // Chat's committed post has no app projection: deliberately hold the interval
      // before the settling read, then inject the queued mutations into that gap.
      expect(await inChat(b, last)).toMatchObject({ ok: true });
      expect((await db.game.findUniqueOrThrow({ where: { id: gameId } })).status).toBe("live");
      expect(await db.$transaction(tx => readGamePhotoPostingStateTx(tx, gameId, a))).toBeNull();
      for (const command of [{ type: "withdraw" as const, gameId, entryId: first.entryId }, await photo(a, gameId, "too-late-retake")]) {
        expect(await inChat(a, command)).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
      }
      expect(await inChat(b, last)).toMatchObject({ ok: true });
      expect((await db.gameEntry.findUniqueOrThrow({ where: { id: first.entryId } })).withdrawnAt).toBeNull();
      const [view] = await Promise.all([readGame(gameId, a), readGame(gameId, b), readHome(a)]);
      expect(view).toMatchObject({ status: "settled", recap: null, recapPending: true,
        result: { scores: [{ score: 2, seat: 0 }, { score: 1, seat: 1 }] } });
      expect(view!.tickets).toHaveLength(1);
      expect(await db.gameTicket.count({ where: { gameId } })).toBe(1);
      expect(await db.gameEvent.count({ where: { gameId, type: "settled" } })).toBe(1);
      expect(await db.hostedLinqDelivery.count({ where: { sourceRef: gameId, template: "game_recap" } })).toBe(1);
      await Promise.all(deferredResponse.tasks.splice(0).map(task => task()));
      expect(push).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: { gameId, notification: "game_post" } }));
      expect(await ok(b, last)).toMatchObject({ status: "settled" });
      expect(await ok(a, { type: "replyToPost", gameId, entryId: last.entryId, replyId: randomUUID(), kind: "text", text: "Nice finish" })).toMatchObject({ status: "settled" });
      await move("2030-03-11T03:00:00Z");
      expect(await errorCode(b, { type: "replyToPost", gameId, entryId: first.entryId, replyId: randomUUID(), kind: "text", text: "Too late" })).toBe("GAME_NOT_LIVE");
      expect(await db.gameTicket.count({ where: { gameId } })).toBe(1);
      expect(await db.gameEvent.count({ where: { gameId, type: "settled" } })).toBe(1);
    } finally { deferredResponse.hold = false; await Promise.all(deferredResponse.tasks.splice(0).map(task => task())); }
  });

  it("bounds recapPending by real settlement time and room binding, without ending late generation", async () => {
    const a = await member("Alex", "UTC"), b = await member("Sam", "UTC");
    const { gameId } = await seedSettledGame({ challenger: a, opponent: b, settledAt: new Date() });
    const db = getPrisma();
    expect((await readGame(gameId, a))?.recapPending).toBeUndefined();
    const room = `synthetic_room_${randomUUID()}`; memberIds.push(room);
    await db.hostedMember.create({ data: { id: room } });
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room, devClockOffsetMs: 30n * 86_400_000n } });
    expect((await readGame(gameId, a))?.recapPending).toBe(true);
    await db.game.update({ where: { id: gameId }, data: { settledAt: new Date(Date.now() - GAME_RECAP_UI_WAIT_MS) } });
    expect((await readGame(gameId, a))?.recapPending).toBeUndefined();
    const recap = { pages: [{ background: "paper" as const, blocks: [{ kind: "headline" as const, text: "A late story" }] }], chatLine: "A finished game." };
    const eventId = gameChatLifecycleEventId(gameId, "recap");
    await db.$transaction(tx => reserveGameChatLifecycleTx({ gameId, kind: "recap", now: new Date(), tx }));
    await markGameChatGenerationQueuedTx(eventId, db, room);
    expect(await sealGameRecap({ beforeMutationTx: async () => {}, gameId, containerMemberId: room, eventId, playerMemberIds: [a, b], recap })).toEqual(recap);
    expect(await readGame(gameId, a)).toMatchObject({ recap });
    expect((await readGame(gameId, a))?.recapPending).toBeUndefined();
  });

  it("ends any-3-of-7, omits blank misses and keeps an immediate rematch's Day 1 and recap binding separate", async () => {
    const a = await member("Alex", "UTC"), b = await member("Sam", "UTC");
    const db = getPrisma();
    const terms = { ...TERMS, schedule: { count: 3 } };
    const { gameId } = await startGame(a, b, { terms }, "UTC");
    const room = `synthetic_room_${randomUUID()}`; memberIds.push(room);
    await db.hostedMember.create({ data: { id: room } });
    await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date("2030-03-04"), timeZone: "UTC" } });
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    for (const day of [4, 6, 7]) {
      await db.game.update({ where: { id: gameId }, data: { devClockOffsetMs: BigInt(Date.parse(`2030-03-0${day}T10:00:00Z`) - Date.now()) } });
      for (const actor of [a, b]) await ok(actor, await photo(actor, gameId, `count-${day}-${actor === a ? "first" : "second"}`));
    }
    expect((await readGame(gameId, a))?.status).toBe("settled");
    const before = await readGameRecapMaterial(gameId, room, [a, b]);
    expect(before?.game.days).toHaveLength(4);
    expect(JSON.stringify(before?.game.days)).not.toContain('"missed"');
    const at = new Date("2030-03-07T10:00:00Z"), nextId = randomUUID();
    const created = await runGameCommand({ actorMemberId: a, now: at, command: { type: "createGame", gameId: nextId,
      previousGameId: gameId, inviteeFirstName: "Sam", terms: { ...terms, startsOn: undefined } } });
    if (!created.ok || !created.game?.inviteToken) throw new Error("Expected rematch invite");
    expect(await runGameCommand({ actorMemberId: b, now: at, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).toMatchObject({ ok: true });
    const next = await db.game.findUniqueOrThrow({ where: { id: nextId }, include: { players: true } });
    expect(next.chatContainerMemberId).toBe(room);
    expect(next.players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(["2030-03-07", "2030-03-07"]);
    expect((await readGameRecapMaterial(gameId, room, [a, b]))?.game).toEqual(before?.game);
    expect(await readGameRecapMaterial(nextId, room, [a, b])).toBeNull();
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: gameId, template: "game_recap" } })).toBe(1);
  });

  it("expires a pending change on a background read without settling an overnight pair", async () => {
    const a = await member("Alex", "UTC"), b = await member("Sam", "UTC");
    const { gameId } = await startGame(a, b, {}, "UTC");
    const db = getPrisma(), room = `synthetic_room_${randomUUID()}`; memberIds.push(room);
    await db.hostedMember.create({ data: { id: room } });
    await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date("2030-03-04"), timeZone: "UTC" } });
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room,
      devClockOffsetMs: BigInt(Date.parse("2030-03-11T04:30:00Z") - Date.now()), pendingChange: {
        v: 1, id: randomUUID(), proposedByMemberId: a, expectedTermsVersion: 1,
        change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 1, startsOn: null, origin: "app", deliveryStatus: "pending",
      } } });
    expect((await readGameChatState(room, [a, b])).games.find(game => game.id === gameId)?.status).toBe("live");
    expect(await db.game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ status: "live", pendingChange: null });
    expect(await db.gameEvent.count({ where: { gameId, type: "change_expired" } })).toBe(1);
    expect(await db.gameEvent.count({ where: { gameId, type: "settled" } })).toBe(0);
    expect((await readGameChatState(room, [a, b], a)).games.find(game => game.id === gameId)?.status).toBe("settled");
  });

  it("names the inherited task in a Prove it case after a structural-only change", async () => {
    const a = await member("Maya", "America/New_York"), b = await member("Sam", "America/New_York");
    const db = getPrisma();
    const { gameId } = await startGame(a, b);
    const room = `game_room_${randomUUID()}`;
    memberIds.push(room);
    await db.hostedMember.create({ data: { id: room, billingStatus: "active" } });
    // A duration-only revision advances the structural terms version but adds no task words.
    const proposalId = randomUUID();
    await ok(a, { type: "proposeChange", gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 } });
    expect(await runGameCommand({ actorMemberId: b, command: { type: "respondChange", gameId, proposalId, decision: "approve" },
      chatContainerMemberId: room, chatPlayerMemberIds: [a, b], beforeMutationTx: async () => {} })).toMatchObject({ ok: true });
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    await devStartNow(gameId, a);
    expect((await readGame(gameId, a))!.terms.n).toBeGreaterThan(1);
    const target = await photo(b, gameId, "inherited-task-target");
    await ok(b, target);
    await ok(a, await photo(a, gameId, "inherited-task-unlock"));
    await ok(a, { type: "challenge", gameId, entryId: target.entryId });
    const currentCase = await readGameChallengeCase(db, gameId, target.entryId, new Date());
    expect(currentCase?.status).toBe("open");
    const instructions = await readGameChallengeInstructions(currentCase!);
    expect(JSON.parse(instructions!.split("\n").at(-1)!)).toMatchObject({ challengerName: "Maya", accusedName: "Sam", task: "10 min abs" });
  });

  it.each([false, true])("accepts Prove it atomically, reads spent budget, and returns it permanently after concession, legacy deadline=%s", async legacyDeadline => {
    const a = await member("Maya", "America/New_York"), b = await member("Sam", "America/New_York");
    const db = getPrisma();
    const { gameId } = await startGame(a, b);
    await devStartNow(gameId, a);
    const target = await photo(b, gameId, "challenge-target");
    await ok(b, target);
    const command = { type: "challenge" as const, gameId, entryId: target.entryId };
    expect(await errorCode(a, command)).toBe("CHAT_UNAVAILABLE");
    const room = `game_room_${randomUUID()}`;
    memberIds.push(room);
    await db.hostedMember.create({ data: { id: room, billingStatus: "active" } });
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    expect(await errorCode(a, command)).toBe("INVALID_REQUEST");
    await ok(a, await photo(a, gameId, "challenge-unlock"));
    const key = gameChallengeKey(gameId, target.entryId);
    // Force the event insert to fail after receipt reservation, in this isolated database.
    await db.$executeRaw`ALTER TABLE game_event ADD CONSTRAINT prove_it_test_failure CHECK (type <> 'challenged') NOT VALID`;
    try { await expect(run(a, command)).rejects.toThrow(); }
    finally { await db.$executeRaw`ALTER TABLE game_event DROP CONSTRAINT prove_it_test_failure`; }
    expect(await db.gameEvent.count({ where: { commandKey: key } })).toBe(0);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: `${gameId}:${target.entryId}`, template: "game_challenge" } })).toBe(0);
    const results = await Promise.all([run(a, command), run(a, command)]);
    expect(results.every(result => result.ok)).toBe(true);
    const accepted = await db.gameEvent.findUniqueOrThrow({ where: { commandKey: key } });
    expect(accepted).toMatchObject({ actor: a, type: "challenged" });
    expect(accepted.payload).toEqual({ v: 1, entryId: target.entryId });
    if (legacyDeadline) await db.gameEvent.update({ where: { id: accepted.id }, data: {
      payload: { v: 1, entryId: target.entryId, deadlineAt: new Date(accepted.createdAt.getTime() - 3_600_000).toISOString() },
    } });
    expect(await db.gameEvent.count({ where: { commandKey: key } })).toBe(1);
    expect(await db.hostedLinqDelivery.findMany({ where: { template: "game_challenge", sourceRef: `${gameId}:${target.entryId}` } }))
      .toEqual([expect.objectContaining({ status: "awaiting_generation", payloadOwnerMemberId: room })]);
    const currentCase = await readGameChallengeCase(db, gameId, target.entryId, new Date());
    expect(currentCase?.status).toBe("open");
    const instructions = await readGameChallengeInstructions(currentCase!);
    const facts = JSON.parse(instructions!.split("\n").at(-1)!);
    // Times are weekday and clock time in the accused's zone, which is never named.
    const inZone = (date: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
    const targetEntry = currentCase!.state.entries.find(entry => entry.id === target.entryId)!;
    expect(facts).toEqual({ challengerName: "Maya", accusedName: "Sam", dayNumber: targetEntry.dayIndex + 1, task: "10 min abs",
      postedAt: inZone(targetEntry.receivedAt) });
    expect(instructions).not.toMatch(/Friend|https?:|mediaKey|captureAge|proofDueBy|deadline|proof is due/iu);
    expect((await readGame(gameId, a))?.canChallenge).toBe(false);
    expect(await errorCode(b, command)).toBe("INVALID_REQUEST");
    const targetDay = (await readGame(gameId, b))!.days.find(day => day.mine?.entryId === target.entryId)!;
    const correct = (incomplete: boolean) => runAndRespond({ actorMemberId: b, chatContainerMemberId: room, chatPlayerMemberIds: [a, b],
      command: { type: "setDayCompletion", gameId, date: targetDay.localDate, incomplete } });
    expect((await correct(true)).ok).toBe(true);
    expect((await correct(false)).ok).toBe(true);
    expect((await readGameChallengeCase(db, gameId, target.entryId, new Date()))?.status).toBe("conceded");
    expect((await readGame(gameId, a))?.canChallenge).toBe(true);
    await ok(a, command);
    expect((await readGame(gameId, a))?.canChallenge).toBe(true);
    const replacement = await photo(b, gameId, "challenge-retake");
    await ok(b, replacement);
    await ok(a, { ...command, entryId: replacement.entryId });
    expect((await readGameChallengeCase(db, gameId, replacement.entryId, new Date()))?.status).toBe("open");
    expect((await readGame(gameId, a))?.canChallenge).toBe(false);
    await devAdvanceDays(gameId, a, 1);
    await ok(a, await photo(a, gameId, "challenge-next-unlock"));
    const next = await photo(b, gameId, "challenge-next-target");
    await ok(b, next);
    expect(await errorCode(a, { ...command, entryId: next.entryId })).toBe("CHALLENGE_USED");
    await devSettleNow(gameId, a);
    expect(await errorCode(a, command)).toBe("OK");
    expect(await db.gameEvent.count({ where: { gameId, type: "challenged" } })).toBe(2);
    // The recap writer sees who doubted the post that stands, and nothing on undoubted posts.
    const recapDays = (await readGameRecapMaterial(gameId, room, [a, b]))!.game.days as Array<{ posts: Record<string, unknown> }>;
    expect(recapDays[0].posts.Sam).toMatchObject({ entryId: replacement.entryId, proveIt: { by: "Maya" } });
    expect(recapDays[0].posts.Maya).not.toHaveProperty("proveIt");
    expect(recapDays[1].posts.Sam).not.toHaveProperty("proveIt");
  });

  it("returns Prove it after withdrawal and keeps the original retry a no-op", async () => {
    const a = await member("Alex", "America/New_York"), b = await member("Robin", "America/New_York"), db = getPrisma();
    const { gameId } = await startGame(a, b);
    await devStartNow(gameId, a);
    const room = `game_room_${randomUUID()}`; memberIds.push(room);
    await db.hostedMember.create({ data: { id: room, billingStatus: "active" } });
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    await ok(a, await photo(a, gameId, "withdraw-unlock"));
    const posted = await photo(b, gameId, "withdraw-target"); await ok(b, posted);
    const command = { type: "challenge" as const, gameId, entryId: posted.entryId };
    await ok(a, command);
    await ok(b, { type: "withdraw", gameId, entryId: posted.entryId });
    expect((await readGameChallengeCase(db, gameId, posted.entryId, new Date()))?.status).toBe("void");
    expect((await readGame(gameId, a))?.canChallenge).toBe(true);
    await ok(a, command);
    expect(await db.gameEvent.count({ where: { commandKey: gameChallengeKey(gameId, posted.entryId) } })).toBe(1);
  });

  it("freezes admission at the effective command clock and creates only pair storage", async () => {
    const starter = await member("Starter", "UTC"), peer = await member("Peer", "UTC");
    const gameId = randomUUID(), createdAt = new Date(), joinedAt = new Date(createdAt.getTime() + 60_000);
    const created = await runAndRespond({ actorMemberId: starter, now: createdAt, command: {
      type: "createGame", gameId, inviteeFirstName: "Teammate", terms: TERMS,
    } });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.game?.inviteToken) throw new Error("Synthetic invite was not created.");
    await getPrisma().game.update({ where: { id: gameId }, data: { devClockOffsetMs: BigInt(3_600_000) } });
    expect(await runAndRespond({ actorMemberId: peer, now: joinedAt, command: {
      type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC",
    } })).toMatchObject({ ok: true });
    const row = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId }, include: { players: { orderBy: { seat: "asc" } }, invitees: true } });
    expect(row).toMatchObject({ maxPlayers: 2, audienceKey: null, wordsOwnerMemberId: starter });
    expect(row.players.map(player => player.joinedAt)).toEqual([createdAt, new Date(joinedAt.getTime() + 3_600_000)]);
    expect(row.invitees).toEqual([expect.objectContaining({ seat: 1, memberId: peer, pendingLabel: null })]);
    await devAdvanceDays(gameId, starter, 1);
    expect((await getPrisma().gamePlayer.findMany({ where: { gameId }, orderBy: { seat: "asc" } })).map(player => player.joinedAt))
      .toEqual(row.players.map(player => player.joinedAt));
  });

  it("never opens locked payloads, keeps previews separate, and reveals data on recap", async () => {
    const poster = await member("Poster", "UTC");
    const viewer = await member("Viewer", "UTC");
    // Both play in UTC, so Start now makes today Day 1 for both at any hour.
    const { gameId } = await startGame(poster, viewer, { terms: { ...TERMS,
      startsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) } }, "UTC");
    await devStartNow(gameId, poster);
    const data = { activity: "run" as const, distanceM: 2345, durationSec: 900 };
    const command = { ...await photo(poster, gameId, "private-route"), kind: "route" as const, data, blurHash: "synthetic-blur" };
    const posted = await ok(poster, command);
    expect(posted?.terms.checkInKind).toBe("any");
    expect(posted?.days[0].mine?.data).toEqual(data);
    const stored = await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: command.entryId } });
    expect(stored.payloadEncrypted).toBeTruthy();
    expect(stored.payloadEncrypted).not.toContain("distanceM");
    expect(stored.blurHash).toBe("synthetic-blur");
    const locked = await readGame(gameId, viewer);
    expect(locked?.days[0].others[0]).toEqual({ seat: 0, status: "locked", entry: null,
      postedAt: stored.receivedAt.toISOString(), blurHash: "synthetic-blur",
      preview: { kind: "route", mediaUrl: `/api/game/v1/media/${encodeURIComponent(command.mediaKeys[0])}` } });
    expect(await authorizeMediaRead(viewer, command.mediaKeys[0])).toBe(false);
    expect(JSON.stringify(await readHome(viewer))).not.toMatch(/distanceM|private-route/);
    const chat = await readGameChatState("synthetic-room", [poster, viewer]);
    expect(chat.games[0].terms).not.toHaveProperty("checkInKind");
    expect(JSON.stringify(chat)).not.toMatch(/distanceM|blurHash|synthetic-blur|payloadEncrypted/);

    // A poisoned envelope proves the locked viewer never asks crypto to open it.
    await getPrisma().gameEntry.update({ where: { id: command.entryId }, data: { payloadEncrypted: "cannot-open" } });
    expect((await readGame(gameId, viewer))?.days[0].others[0].status).toBe("locked");
    await expect(readGame(gameId, poster)).rejects.toThrow();
    await getPrisma().gameEntry.update({ where: { id: command.entryId }, data: { payloadEncrypted: stored.payloadEncrypted } });
    const recap = await devSettleNow(gameId, viewer);
    expect(recap.days[0].others[0].entry?.data).toEqual(data);
    // Open now: its blur stays, for while the picture loads.
    expect(recap.days[0].others[0]).toMatchObject({ status: "posted", blurHash: "synthetic-blur" });
    expect(recap.days[0].others[0].postedAt).toBe(stored.receivedAt.toISOString());
    expect(await authorizeMediaRead(viewer, command.mediaKeys[0])).toBe(true);
  });
  it.each([0, 1, 2])("uploads once and accepts %i cards with canonical retries", async cardCount => {
    const a = await member("PlayerA", "UTC", true), b = await member("PlayerB", "UTC", true);
    const room = await member("Room", "UTC", true), db = getPrisma();
    const { gameId } = await startGame(a, b);
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    await devStartNow(gameId, a); await devSettleNow(gameId, a);
    const eventId = gameChatLifecycleEventId(gameId, "recap");
    await markGameChatGenerationQueuedTx(eventId, db, room);
    const { recordGameRecapWitnessTx } = await import("@/src/lib/game/recap-witness");
    await db.$transaction(tx => recordGameRecapWitnessTx(tx, gameId, eventId));
    const cards = [
      { memberId: a, title: "Cross examine mats", line: "PlayerA calls the mat as a witness." },
      { memberId: b, title: "Object to burpees", line: "PlayerB files a motion for recess." },
    ].slice(0, cardCount);
    const { gameRecapWriterSchema } = await import('@murphai/contracts/recap-show');
    const recap = gameRecapWriterSchema.parse({ ...(cards.length ? { superlatives: cards } : {}), treatment: "Courtroom drama", pages: [{ background: "paper" as const, blocks: [{ kind: "scene" as const,
      scene: { cast: ["PlayerA", "PlayerB"], prompt: "A synthetic paper courtroom stage with a rolled mat on a witness stand, with warm lighting and simple wooden benches." } }] }], chatLine: "The mat entered evidence." });
    const scope = { beforeMutationTx: async () => {}, containerMemberId: room, eventId, gameId, playerMemberIds: [a, b] };
    vi.stubEnv("MURPH_GAME_RECAP_SHOW_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_RECAP_MEDIA_DIR", path.join(mediaDir, "recap"));
    const ownerModule = await import("@/src/lib/hosted-execution/runtime-owner");
    const accessModule = await import("@/src/lib/hosted-mailbox/runtime-access");
    await db.hostedRuntimeOwner.upsert({ where: { userId: room }, create: { userId: room }, update: {} });
    const fence = vi.spyOn(ownerModule, "requireHostedRuntimeCallbackTx").mockImplementation(async tx => tx.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: room } }));
    const active = vi.spyOn(accessModule, "requireHostedRuntimeActiveAccessForUpdateTx").mockResolvedValue();
    try {
      const { uploadRecapMedia } = await import("@/src/lib/game/recap-media");
      const sharp = (await import("sharp")).default;
      const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#abcdef" } }).jpeg().toBuffer();
      const largePhoto = await sharp({ create: { width: 3072, height: 4096, channels: 3, background: "#abcdef" } }).jpeg().toBuffer();
      for (const player of [a, b]) {
        const key = await putGameMedia({ bytes: largePhoto, contentType: "image/jpeg", prefix: mediaKeyPrefixFor(player) });
        await db.gameProfile.update({ where: { memberId: player }, data: { photoKey: key } });
      }
      const material = (await readGameRecapMaterial(gameId, room, [a, b], eventId))!;
      const { readRecapSourceReferences, readRecapReferenceBytes } = await import("@/src/lib/game/recap-inputs");
      const references = (await readRecapSourceReferences(material, eventId)).filter(ref => ref.kind === 'profile');
      const normalized = await Promise.all(references.map(async ref => (await readRecapReferenceBytes(ref))!));
      expect(normalized.map(ref => [ref.width, ref.height])).toEqual([[768, 1024], [768, 1024]]);
      const file = { kind: "upload" as const, slot: "scene-0", mediaType: "image/jpeg" as const,
        referenceIds: references.map(ref => ref.id), bytes: bytes.toString("base64") };
      const upload = () => uploadRecapMedia({ memberId: room, gameId, eventId, material, beforeMutationTx: async () => {}, file });
      const profile = await db.gameProfile.findUniqueOrThrow({ where: { memberId: a } });
      await db.gameProfile.update({ where: { memberId: a }, data: { photoKey: null } });
      await expect(upload()).rejects.toThrow();
      await db.gameProfile.update({ where: { memberId: a }, data: { photoKey: profile.photoKey } });
      const asset = await upload();
      await expect(uploadRecapMedia({ memberId: room, gameId, eventId, material, beforeMutationTx: async () => {},
        file: { ...file, bytes: Buffer.from("not media").toString("base64") } })).rejects.toThrow();
      const assets = [asset];
      expect(await sealGameRecap({ ...scope, recap, assets })).toEqual(recap);
      expect(await sealGameRecap({ ...scope, recap: { ...recap, chatLine: "Changed after acceptance" }, assets })).toEqual(recap);
      expect(await sealGameRecap({ ...scope, recap: null })).toEqual(recap);
      const { readRecapEnvelope, readAuthorizedRecapAsset } = await import("@/src/lib/game/recap-asset-access");
      const accepted = (await readRecapEnvelope(gameId))!;
      expect(accepted.envelope.story.superlatives ?? []).toEqual(cards);
      expect(await db.gameEvent.count({ where: { commandKey: `${eventId}:selection` } })).toBe(0);
      expect(accepted.envelope.assets).toHaveLength(1);
      expect(accepted.envelope.assets[0]).toMatchObject({ hash: asset.hash });
      expect(await db.hostedMailboxItem.count({ where: { userId: room } })).toBe(0);
      expect((await readGame(gameId, a))?.recap?.show?.pages[0]?.media?.status).toBe("ready");
      const assetInput = { gameId, generationId: accepted.envelope.generationId, slot: "scene-0", memberId: a };
      expect((await readAuthorizedRecapAsset(assetInput))?.bytes.length).toBe(bytes.length);
      expect(await readAuthorizedRecapAsset({ ...assetInput, memberId: room })).toBeNull();
      const { readRecapCoverPreview } = await import("@/src/lib/game/recap-preview");
      expect((await readRecapCoverPreview(gameId, accepted.envelope.preview.token))?.length).toBe(bytes.length);
      await db.gameProfile.update({ where: { memberId: a }, data: { photoKey: null } });
      expect(await readAuthorizedRecapAsset(assetInput)).toBeNull();
      expect(await readRecapCoverPreview(gameId, accepted.envelope.preview.token)).toBeNull();
      expect((await readGame(gameId, a))?.recap?.chatLine).toBe(recap.chatLine);
      await db.gameProfile.update({ where: { memberId: a }, data: { photoKey: profile.photoKey } });
    } finally {
      fence.mockRestore(); active.mockRestore(); vi.unstubAllEnvs();
      await db.hostedRuntimeOwner.deleteMany({ where: { userId: room } });
      await db.gameRecapAsset.deleteMany({ where: { resourceId: { startsWith: `${gameId}|` } } });
    }
  });
  it("seals an authorized recap on the settled game and exposes it to both players", async () => {
    const ava = await member("RecapAva", "UTC"), leo = await member("RecapLeo", "UTC");
    const room = `hbm_gametest_room_${randomUUID().slice(0, 8)}`;
    memberIds.push(room);
    await getPrisma().hostedMember.create({ data: { id: room, billingStatus: "active" } });
    const { gameId } = await startGame(ava, leo);
    await getPrisma().game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    await devStartNow(gameId, ava);
    const recapPost = await photo(ava, gameId, "recap-private-post");
    await ok(ava, recapPost);
    await devSettleNow(gameId, ava);
    const eventId = gameChatLifecycleEventId(gameId, "recap");
    await markGameChatGenerationQueuedTx(eventId, getPrisma(), room);
    const recap = { pages: [
      { background: "paper" as const, blocks: [{ kind: "headline" as const, text: "A synthetic week" }] },
      { background: "slate" as const, blocks: [{ kind: "stat" as const, statValue: "7", text: "days considered" }] },
      { background: "sage" as const, blocks: [{ kind: "headline" as const, text: "Breakfast changed hands" }] },
    ], scoreLine: "RecapLeo owes RecapAva breakfast in bed.", chatLine: "Breakfast changed hands. Open the week for the handoff." };
    const authorize = async () => {};
    const alternate = { ...recap, chatLine: "A different concurrent candidate." };
    const sealed = await Promise.all([recap, alternate].map((candidate) => sealGameRecap({ beforeMutationTx: authorize,
      containerMemberId: room, eventId, gameId, playerMemberIds: [ava, leo], recap: candidate })));
    expect(sealed[0]).toEqual(sealed[1]);
    const canonical = sealed[0]!;
    const stored = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId }, select: { recapEncrypted: true } });
    expect(stored.recapEncrypted).toBeTruthy();
    expect(stored.recapEncrypted).not.toContain("Breakfast changed hands");
    expect((await readGame(gameId, ava))?.recap).toEqual(canonical);
    expect((await readGame(gameId, leo))?.recap).toEqual(canonical);
    const reportId = randomUUID();
    await getPrisma().gameReport.create({ data: { id: reportId, reporterMemberId: leo, reportedMemberId: ava,
      gameId, entryId: recapPost.entryId, about: "post", reason: "other" } });
    expect((await readGame(gameId, leo))?.recap).toBeNull();
    expect((await readGame(gameId, ava))?.recap).toEqual(canonical);
    await getPrisma().gameReport.delete({ where: { id: reportId } });
    await getPrisma().gameBlock.create({ data: { blockerMemberId: leo, blockedMemberId: ava } });
    expect((await readGame(gameId, leo))?.recap).toBeNull();
    expect((await readGame(gameId, ava))?.recap).toBeNull();
    await getPrisma().gameBlock.delete({ where: { blockerMemberId_blockedMemberId: { blockerMemberId: leo, blockedMemberId: ava } } });
    const nextId = randomUUID();
    const next = await ok(ava, { gameId: nextId, inviteeFirstName: "RecapLeo", previousGameId: gameId, terms: TERMS, type: "createGame" });
    await ok(leo, { termsVersion: 1, timeZone: "UTC", token: next!.inviteToken!, type: "join" });
    expect(await sealGameRecap({ beforeMutationTx: authorize, containerMemberId: room, eventId, gameId, playerMemberIds: [ava, leo], recap: { ...recap, scoreLine: "Stale recap" } })).toEqual(canonical);
    expect((await readGame(gameId, ava))?.recap).toEqual(canonical);
  });

  it("refuses a recap that waited on a player's account deletion", async () => {
    const ava = await member("DepartAva", "UTC"), leo = await member("DepartLeo", "UTC");
    const room = `hbm_gametest_room_${randomUUID().slice(0, 8)}`;
    memberIds.push(room);
    await getPrisma().hostedMember.create({ data: { id: room, billingStatus: "active" } });
    const { gameId } = await startGame(ava, leo);
    await getPrisma().game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    await devStartNow(gameId, ava);
    await devSettleNow(gameId, ava);
    const eventId = gameChatLifecycleEventId(gameId, "recap");
    await markGameChatGenerationQueuedTx(eventId, getPrisma(), room);
    const recap = { pages: [{ background: "paper" as const, blocks: [{ kind: "headline" as const, text: "A departing week" }] }],
      scoreLine: "DepartAva kept the streak.", chatLine: "The week is in." };
    let holdDeletion!: () => void;
    const held = new Promise<void>((resolve) => { holdDeletion = resolve; });
    let deletionLocked!: () => void;
    const locked = new Promise<void>((resolve) => { deletionLocked = resolve; });
    // Mirrors applyGameAccountDeletionTx: the kept game is marked departed and its recap cleared under the row lock.
    const deletion = getPrisma().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
      await tx.game.update({ where: { id: gameId }, data: { recapEncrypted: null,
        players: { update: { where: { gameId_seat: { gameId, seat: 1 } }, data: { leftAt: new Date() } } } } });
      deletionLocked();
      await held;
    }, { timeout: 20_000 });
    await locked;
    const sealing = sealGameRecap({ beforeMutationTx: async () => {}, containerMemberId: room, eventId, gameId, playerMemberIds: [ava, leo], recap });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [waiting] = await getPrisma().$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((waiting?.count ?? 0n) > 0n) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    holdDeletion();
    await deletion;
    expect(await sealing).toBeNull();
    const stored = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId }, select: { recapEncrypted: true } });
    expect(stored.recapEncrypted).toBeNull();
  });

  it("caps concurrent retries and retakes per recipient and game, then allows the next recipient day", async () => {
    const poster = await member("Poster", "America/New_York");
    const recipient = await member("Recipient", "America/New_York");
    for (const id of [poster, recipient]) {
      await pushRoute(id);
    }
    const { gameId } = await startGame(poster, recipient);
    await devStartNow(gameId, poster);
    const command = await photo(poster, gameId, "notification-first");
    push.mockClear();
    const results = await Promise.all([ok(poster, command), ok(poster, command)]);
    expect(results.every((result) => result?.id === gameId)).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0].data).toEqual({ gameId, notification: "game_post" });
    expect(push.mock.calls[0]?.[0].message.body).toBe("Someone posted. Share yours to see it.");
    expect(await authorizeMediaRead(recipient, command.mediaKeys[0]!)).toBe(false);
    await ok(poster, await photo(poster, gameId, "notification-retake"));
    expect(push).toHaveBeenCalledTimes(1);
    await ok(recipient, await photo(recipient, gameId, "notification-other-direction"));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1]?.[0].message).toMatchObject({ title: "They're in too.", body: "Theirs develops when you open it." });
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(tomorrow);
    expect((await runAndRespond({
      actorMemberId: poster, command: await photo(poster, gameId, "notification-next-day"), now: tomorrow,
    })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(3);
    expect(push.mock.calls[2]?.[0].message.body).toBe("Someone posted. Share yours to see it.");
    vi.useRealTimers();
    const receipts = await getPrisma().gameEvent.findMany({ where: { gameId, type: "post_notification" } });
    expect(receipts).toHaveLength(6);
    expect(new Set(receipts.map((receipt) => receipt.commandKey)).size).toBe(6);

    const third = await member("Third", "America/New_York");
    const another = await startGame(third, recipient);
    await devStartNow(another.gameId, third);
    await ok(third, await photo(third, another.gameId, "notification-another-game"));
    expect(push).toHaveBeenCalledTimes(4);
  });

  it("never notifies for excuses, denied alerts or a rejected post, and preserves accepted posts after push failure", async () => {
    const poster = await member("Sender", "America/New_York");
    const recipient = await member("Receiver", "America/New_York");
    const sessionId = await pushRoute(recipient, false);
    const { gameId } = await startGame(poster, recipient);
    await devStartNow(gameId, poster);
    push.mockClear();
    await ok(poster, await photo(poster, gameId, "notification-denied"));
    expect(push).not.toHaveBeenCalled();
    await getPrisma().companionPushRoute.update({ where: { userId: recipient }, data: { alertsAllowed: true } });
    push.mockRejectedValueOnce(new Error("synthetic uncertain push"));
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const next = await photo(poster, gameId, "notification-provider-failure");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(tomorrow);
    expect((await runAndRespond({ actorMemberId: poster, command: next, now: tomorrow })).ok).toBe(true);
    expect((await runAndRespond({ actorMemberId: poster, command: next, now: tomorrow })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await getPrisma().gameEntry.findUnique({ where: { id: next.entryId } })).not.toBeNull();
    expect(await getPrisma().gameEvent.findFirst({ where: { gameId, type: "post_notification" } })).toMatchObject({
      payload: { outcome: "failed" },
    });
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect((await runAndRespond({
      actorMemberId: poster, now: later,
      command: { type: "post", gameId, entryId: randomUUID(), kind: "excuse", mediaKeys: [], text: "Travel day" },
    })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    // Even a late address write after DELETE is inert once logout revokes its session.
    await getPrisma().hostedAuthRecord.delete({ where: { model_id: { model: "session", id: sessionId } } });
    expect((await runAndRespond({
      actorMemberId: poster, now: later, command: await photo(poster, gameId, "notification-after-signout"),
    })).ok).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("stores the agreed graph, rejects photos, and preserves private media and retries", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const stranger = await member("Sam", "UTC");
    const { gameId } = await startGame(leo, ava, { terms: { ...TERMS, checkInKind: "heart_rate" } });
    // A retained heart-rate-only game still enforces its stored requirement.
    const stored = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } });
    const terms = parseStoredTerms(stored.terms);
    terms.versions[0].checkInKind = "heart_rate";
    await getPrisma().game.update({ where: { id: gameId }, data: { terms: toPrismaJsonObject(terms) } });
    await pushRoute(leo);
    push.mockClear();
    await devStartNow(gameId, leo);
    expect((await readGame(gameId, leo))?.terms.checkInKind).toBe("heart_rate");
    const key = await upload(ava, "synthetic-graph");
    const graph: GameCommand = { type: "post", entryId: randomUUID(), gameId, kind: "heart_rate", mediaKeys: [key] };
    const accepted = await ok(ava, graph);
    expect(push).toHaveBeenCalledTimes(1);
    expect(accepted?.days[0]?.mine).toMatchObject({ kind: "heart_rate", data: null });
    await ok(ava, graph);
    expect(await getPrisma().gameEntry.count({ where: { gameId, memberId: ava } })).toBe(1);
    expect(await authorizeMediaRead(leo, key)).toBe(false);
    expect(await authorizeMediaRead(stranger, key)).toBe(false);
    // Fetching ahead: the other player may before posting; a stranger never.
    expect(await authorizeLockedPreviewReads(leo, [key])).toEqual(new Set([key]));
    expect(await authorizeLockedPreviewReads(stranger, [key])).toEqual(new Set());
    expect(await errorCode(leo, await photo(leo, gameId, "synthetic-photo"))).toBe("INVALID_REQUEST");
    await ok(leo, { ...await photo(leo, gameId, "synthetic-own-graph"), kind: "heart_rate" });
    expect(await authorizeMediaRead(leo, key)).toBe(true);
    expect((await readGame(gameId, leo))?.days[0]?.others[0]?.entry).toMatchObject({ kind: "heart_rate", data: null });
    await ok(ava, { ...await photo(ava, gameId, "synthetic-retake"), kind: "heart_rate" });
    expect(await errorCode(ava, { ...graph, entryId: randomUUID() })).toBe("RETAKE_USED");
    expect(await authorizeMediaRead(leo, key)).toBe(false);
    // A retaken picture is withdrawn, so it isn't fetched ahead either; and a
    // block ends the game, so nothing of it is.
    expect(await authorizeLockedPreviewReads(leo, [key])).toEqual(new Set());
    const retake = (await getPrisma().gameEntry.findFirstOrThrow({
      where: { gameId, memberId: ava, withdrawnAt: null, attempt: { gt: 0 } } })).mediaKeys[0];
    expect(await authorizeLockedPreviewReads(leo, [retake])).toEqual(new Set([retake]));
    await ok(leo, { memberId: ava, type: "block" });
    expect(await authorizeLockedPreviewReads(leo, [retake])).toEqual(new Set());
  });

  it("syncs canonical profile photos, preserves private overrides and scopes media to game participants", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const stranger = await member("Sam", "UTC");
    const canonical = await upload(ava, "canonical");
    const privatePhoto = await upload(leo, "private-contact");
    const missing = `${mediaKeyPrefixFor(ava)}${"0".repeat(64)}.jpg`;
    expect(await errorCode(ava, { type: "setProfile", photoKey: privatePhoto })).toBe("MEDIA_MISSING");
    expect(await errorCode(ava, { type: "setProfile", photoKey: missing })).toBe("MEDIA_MISSING");
    const saved = await run(ava, { type: "setProfile", photoKey: canonical });
    expect(saved).toMatchObject({ ok: true, profile: { memberId: ava, firstName: "Ava", timeZone: "Australia/Sydney" } });
    expect(await authorizeMediaRead(ava, canonical)).toBe(true);
    expect(await authorizeMediaRead(leo, canonical)).toBe(false);
    expect(await authorizeMediaRead(stranger, canonical)).toBe(false);
    const homePhoto = (await readHome(ava)).me.avatarUrl;
    expect(homePhoto).toContain(encodeURIComponent(canonical));
    await ok(ava, { firstName: "Ava", timeZone: "Australia/Sydney", type: "setProfile" });
    expect((await readHome(ava)).me.avatarUrl).toBe(homePhoto);

    const gameId = randomUUID();
    const created = await ok(leo, { gameId, inviteeFirstName: "Friend", inviteeLabel: { photoKey: privatePhoto }, terms: TERMS, type: "createGame" });
    const preview = await readInvitePreview(created!.inviteToken!);
    expect(preview).not.toHaveProperty("avatarUrl");
    expect(preview).not.toHaveProperty("profileAvatarUrl");
    const joined = await ok(ava, { type: "join", token: created!.inviteToken!, termsVersion: 1, timeZone: "Australia/Sydney" });
    expect(joined!.players[1]).toMatchObject({ avatarUrl: homePhoto, profileAvatarUrl: homePhoto });
    const opponentView = (await readGame(gameId, leo))!.players[1];
    expect(opponentView.avatarUrl).toBe(homePhoto);
    expect(opponentView.profileAvatarUrl).toBe(homePhoto);
    expect(await authorizeMediaRead(leo, canonical)).toBe(true);
    expect(await authorizeMediaRead(stranger, canonical)).toBe(false);
    expect(await authorizeMediaRead(ava, privatePhoto)).toBe(false);

    const replacement = await upload(ava, "replacement");
    await ok(ava, { type: "setProfile", photoKey: replacement });
    expect(await authorizeMediaRead(leo, canonical)).toBe(false);
    expect(await authorizeMediaRead(leo, replacement)).toBe(true);
    await Promise.all([
      ok(ava, { type: "setProfile", photoKey: null }),
      ok(ava, { type: "setProfile", firstName: "Avery" }),
    ]);
    expect((await readHome(ava)).me).toMatchObject({ firstName: "Avery", avatarUrl: null, timeZone: "Australia/Sydney" });
    expect(await authorizeMediaRead(leo, replacement)).toBe(false);
    const removed = (await readGame(gameId, leo))!.players[1];
    expect(removed.profileAvatarUrl).toBeNull();
    expect(removed.avatarUrl).toContain(encodeURIComponent(privatePhoto));
    expect((await getPrisma().gameContactLabel.findUnique({ where: { ownerMemberId_subjectMemberId: { ownerMemberId: leo, subjectMemberId: ava } } }))!.photoKey).toBe(privatePhoto);
  });

  it("lets the joiner set, replace and remove a private challenger photo across game, Home and history", async () => {
    const challenger = await member("Challenger", "UTC");
    const joiner = await member("Joiner", "UTC");
    const stranger = await member("Stranger", "UTC");
    const { gameId } = await startGame(challenger, joiner, {}, "UTC");
    const where = { ownerMemberId_subjectMemberId: { ownerMemberId: joiner, subjectMemberId: challenger } };
    const change = (photoKey: string | null): GameCommand => ({ type: "setPlayerPhoto", memberId: challenger, photoKey });
    await ok(joiner, change(null));
    expect(await getPrisma().gameContactLabel.findUnique({ where })).toBeNull();
    const privatePhoto = await upload(joiner, "private-challenger");
    expect(await run(joiner, change(privatePhoto))).toEqual({ ok: true, game: null });
    const avatarUrl = gameMediaUrl(privatePhoto);
    expect((await readGame(gameId, joiner))!.players[0]).toMatchObject({ avatarUrl, profileAvatarUrl: null });
    expect((await readHome(joiner)).games.find(game => game.id === gameId)!.players[0]).toMatchObject({ avatarUrl, profileAvatarUrl: null });
    expect((await readGame(gameId, challenger))!.players[0]).toMatchObject({ avatarUrl: null, profileAvatarUrl: null });
    expect(await authorizeMediaRead(joiner, privatePhoto)).toBe(true);
    expect(await authorizeMediaRead(challenger, privatePhoto)).toBe(false);
    expect(await authorizeMediaRead(stranger, privatePhoto)).toBe(false);
    const otherGame = await startGame(stranger, challenger, {}, "UTC");
    expect((await readGame(otherGame.gameId, stranger))!.players[1].avatarUrl).toBeNull();

    const replacement = await upload(joiner, "private-challenger-replacement");
    await ok(joiner, change(replacement));
    await ok(joiner, change(replacement));
    await devSettleNow(gameId, challenger);
    const privateHistory = (await readHistory(joiner)).people.find(person => person.memberId === challenger)!;
    expect(privateHistory.avatarUrl).toBe(gameMediaUrl(replacement));
    expect(privateHistory).not.toHaveProperty("profileAvatarUrl");
    await ok(joiner, change(null));
    await ok(joiner, change(null));
    expect((await readGame(gameId, joiner))!.players[0]).toMatchObject({ avatarUrl: null, profileAvatarUrl: null });
    expect((await readHistory(joiner)).people.find(person => person.memberId === challenger)).not.toHaveProperty("avatarUrl");
    expect(await getPrisma().gameContactLabel.findUnique({ where })).toMatchObject({ photoKey: null, nameEncrypted: null, relationshipEncrypted: null });
  });

  it("preserves private label words and permits clearing while the subject has their own photo", async () => {
    const owner = await member("Owner", "UTC"), subject = await member("Subject", "UTC");
    const { gameId } = await startGame(owner, subject, { inviteeFirstName: "Friend", inviteeLabel: { relationship: "teammate" } }, "UTC");
    const where = { ownerMemberId_subjectMemberId: { ownerMemberId: owner, subjectMemberId: subject } };
    const before = await getPrisma().gameContactLabel.update({ where, data: { updatedAt: new Date("2020-01-01") } });
    const photoKey = await upload(owner, "private-subject");
    const command: GameCommand = { type: "setPlayerPhoto", memberId: subject, photoKey };
    await ok(owner, command);
    const saved = await getPrisma().gameContactLabel.findUniqueOrThrow({ where });
    expect(saved).toMatchObject({ nameEncrypted: before.nameEncrypted, relationshipEncrypted: before.relationshipEncrypted, photoKey });
    expect(saved.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    await ok(subject, { type: "setProfile", photoKey: await upload(subject, "own-subject") });
    expect(await run(owner, command)).toMatchObject({ ok: false, status: 400, error: { code: "INVALID_REQUEST", message: expect.stringContaining("own profile photo") } });
    expect((await getPrisma().gameContactLabel.findUniqueOrThrow({ where })).photoKey).toBe(photoKey);
    await ok(owner, { ...command, photoKey: null });
    expect(await getPrisma().gameContactLabel.findUniqueOrThrow({ where })).toMatchObject({ nameEncrypted: before.nameEncrypted, relationshipEncrypted: before.relationshipEncrypted, photoKey: null });
    const shown = (await readGame(gameId, owner))!.players[1];
    expect(shown.avatarUrl).toBe(shown.profileAvatarUrl);
    expect(shown.avatarUrl).not.toBeNull();
  });

  it("rejects private photos of self or unrelated people and requires the actor's finished upload", async () => {
    const owner = await member("Owner", "UTC"), subject = await member("Subject", "UTC"), stranger = await member("Stranger", "UTC");
    await startGame(owner, subject, {}, "UTC");
    const photoKey = await upload(owner, "owned-private");
    expect(await errorCode(owner, { type: "setPlayerPhoto", memberId: owner, photoKey })).toBe("INVALID_REQUEST");
    for (const key of [photoKey, null]) {
      expect(await errorCode(owner, { type: "setPlayerPhoto", memberId: stranger, photoKey: key })).toBe("NOT_A_PLAYER");
    }
    for (const key of [await upload(subject, "not-owned"), `${mediaKeyPrefixFor(owner)}${"0".repeat(64)}.jpg`]) {
      expect(await errorCode(owner, { type: "setPlayerPhoto", memberId: subject, photoKey: key })).toBe("MEDIA_MISSING");
    }
  });

  it.each(["owner", "subject"])("rejects private photo writes when the %s blocked the other", async blocker => {
    const owner = await member("Owner", "UTC"), subject = await member("Subject", "UTC");
    const { gameId } = await startGame(owner, subject, {}, "UTC");
    const photoKey = await upload(owner, "blocked-private");
    await ok(owner, { type: "setPlayerPhoto", memberId: subject, photoKey });
    await ok(blocker === "owner" ? owner : subject, { type: "block", memberId: blocker === "owner" ? subject : owner });
    for (const key of [photoKey, null]) {
      expect(await errorCode(owner, { type: "setPlayerPhoto", memberId: subject, photoKey: key })).toBe("NOT_A_PLAYER");
    }
    expect((await readGame(gameId, owner))!.players[1].avatarUrl).toBeNull();
  });

  it("hides invite label photos behind the subject's profile across detail, Home, history and pending rematches", async () => {
    const owner = await member("Owner", "UTC"), subject = await member("Subject", "UTC");
    const privatePhoto = await upload(owner, "invite-label");
    const { gameId } = await startGame(owner, subject, { inviteeLabel: { photoKey: privatePhoto } }, "UTC");
    const ownPhoto = await upload(subject, "own-profile");
    const privateUrl = gameMediaUrl(privatePhoto), ownUrl = gameMediaUrl(ownPhoto);
    expect((await readGame(gameId, owner))!.players[1]).toMatchObject({ avatarUrl: privateUrl, profileAvatarUrl: null });
    await ok(subject, { type: "setProfile", photoKey: ownPhoto });
    expect((await readGame(gameId, owner))!.players[1]).toMatchObject({ avatarUrl: ownUrl, profileAvatarUrl: ownUrl });
    expect((await readHome(owner)).games.find(game => game.id === gameId)!.players[1].avatarUrl).toBe(ownUrl);
    await devSettleNow(gameId, owner);
    expect((await readHistory(owner)).people.find(person => person.memberId === subject)).toMatchObject({ avatarUrl: ownUrl, profileAvatarUrl: ownUrl });
    const pendingPhoto = await upload(owner, "pending-invite-label");
    const rematch = await ok(owner, { type: "createGame", gameId: randomUUID(), previousGameId: gameId,
      inviteeFirstName: "Friend", inviteeLabel: { photoKey: pendingPhoto }, terms: TERMS });
    expect(rematch!.players[1]).toMatchObject({ avatarUrl: ownUrl, profileAvatarUrl: ownUrl });
    await ok(subject, { type: "setProfile", photoKey: null });
    expect((await readGame(rematch!.id, owner))!.players[1]).toMatchObject({ avatarUrl: gameMediaUrl(pendingPhoto), profileAvatarUrl: null });
    expect((await readGame(gameId, owner))!.players[1]).toMatchObject({ avatarUrl: privateUrl, profileAvatarUrl: null });
    const hiddenAgain = (await readHistory(owner)).people.find(person => person.memberId === subject)!;
    expect(hiddenAgain.avatarUrl).toBe(privateUrl);
    expect(hiddenAgain).not.toHaveProperty("profileAvatarUrl");
    expect((await getPrisma().gameContactLabel.findUniqueOrThrow({ where: { ownerMemberId_subjectMemberId: { ownerMemberId: owner, subjectMemberId: subject } } })).photoKey).toBe(privatePhoto);
  });

  it("requires initial name and time zone before a photo-only profile update", async () => {
    const id = `hbm_gametest_new_${randomUUID().slice(0, 8)}`;
    await getPrisma().hostedMember.create({ data: { billingStatus: "active", id } });
    memberIds.push(id);
    expect(await errorCode(id, { type: "setProfile", photoKey: null })).toBe("PROFILE_REQUIRED");
    expect(await getPrisma().gameProfile.findUnique({ where: { memberId: id } })).toBeNull();
  });

  it("plays a full 1v1 game through the one write path", async () => {
    const leoNoProfile = `hbm_gametest_new_${randomUUID().slice(0, 8)}`;
    await getPrisma().hostedMember.create({ data: { billingStatus: "active", id: leoNoProfile } });
    memberIds.push(leoNoProfile);
    expect(await errorCode(leoNoProfile, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" }))
      .toBe("PROFILE_REQUIRED");
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");

    // Create; a retry with the same game id returns the same game.
    const gameId = randomUUID();
    const create: GameCommand = {
      gameId,
      inviteeFirstName: "Ava",
      inviteeLabel: { relationship: "girlfriend" },
      terms: TERMS,
      type: "createGame",
    };
    const created = await ok(leo, create);
    expect(created).toMatchObject({ round: 1, status: "invited" });
    expect(created!.players.map((player) => player.firstName)).toEqual(["Leo", "Ava"]);
    const token = created!.inviteToken!;
    expect((await ok(leo, create))!.inviteToken).toBe(token);

    const preview = await readInvitePreview(token);
    if (preview?.status !== "open") throw new Error("expected an open invite");
    expect(preview).toMatchObject({ inviterFirstName: "Leo" });
    expect(preview).not.toHaveProperty("inviteeFirstName");
    expect(preview.terms.tasks[0].text).toBe("100 pushups");

    // Accept (from New York, so Start now below starts today for both); the
    // invite is single-use and a used invite shows only its status.
    const joined = await ok(ava, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" });
    expect(joined).toMatchObject({ status: "live" });
    expect(await errorCode(kat, { termsVersion: 1, timeZone: "Europe/London", token, type: "join" })).toBe("INVITE_USED");
    expect(await readInvitePreview(token)).toEqual({ status: "used" });
    const label = await getPrisma().gameContactLabel.findUnique({
      where: { ownerMemberId_subjectMemberId: { ownerMemberId: leo, subjectMemberId: ava } },
    });
    expect(label?.nameEncrypted && label.relationshipEncrypted).toBeTruthy();
    // Accepting again is a repeat, not an error.
    expect(await errorCode(ava, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" })).toBe("OK");

    await devStartNow(gameId, leo);

    // Post to unlock: Leo can't see Ava's photo, caption or file until he posts.
    const avaPost = await photo(ava, gameId, "ava-d0", "done");
    await ok(ava, avaPost);
    const avaKey = avaPost.type === "post" ? avaPost.mediaKeys[0] : "";
    let leoView = await readGame(gameId, leo);
    expect(leoView!.days[0].others[0]).toEqual({ blurHash: null, entry: null, postedAt: expect.any(String), seat: 1, status: "locked",
      preview: { kind: "photo", mediaUrl: `/api/game/v1/media/${encodeURIComponent(avaKey)}` } });
    expect(await authorizeMediaRead(leo, avaKey)).toBe(false);
    // Fetching ahead is for players of the game only, and never for a profile stranger.
    expect(await authorizeLockedPreviewReads(leo, [avaKey])).toEqual(new Set([avaKey]));
    expect(await authorizeLockedPreviewReads(kat, [avaKey])).toEqual(new Set());
    expect(await authorizeMediaRead(kat, avaKey)).toBe(false);
    // Nobody can post someone else's upload, or one that was never stored.
    expect(await errorCode(leo, { entryId: randomUUID(), gameId, kind: "photo", mediaKeys: [avaKey], type: "post" })).toBe("MEDIA_MISSING");
    const missingKey = `${mediaKeyPrefixFor(leo)}${"0".repeat(64)}.jpg`;
    expect(await errorCode(leo, { entryId: randomUUID(), gameId, kind: "photo", mediaKeys: [missingKey], type: "post" }))
      .toBe("MEDIA_MISSING");

    const firstShot = await photo(leo, gameId, "leo-d0-a");
    await ok(leo, firstShot);
    leoView = await readGame(gameId, leo);
    expect(leoView!.days[0].others[0]).toMatchObject({ entry: { text: "done" }, status: "posted" });
    expect(await authorizeMediaRead(leo, avaKey)).toBe(true);
    expect(leoView!.retakeAvailable).toBe(true);

    // Sending the same entry again changes nothing; one retake per day.
    await ok(leo, firstShot);
    await ok(leo, await photo(leo, gameId, "leo-d0-b"));
    expect(await errorCode(leo, await photo(leo, gameId, "leo-d0-c"))).toBe("RETAKE_USED");
    expect(await getPrisma().gameEntry.count({ where: { gameId, memberId: leo } })).toBe(2);

    // Withdraw takes back only your own post; a retry is fine.
    const avaEntryId = avaPost.type === "post" ? avaPost.entryId : "";
    expect(await errorCode(leo, { entryId: avaEntryId, gameId, type: "withdraw" })).toBe("GAME_NOT_FOUND");
    await ok(ava, { entryId: avaEntryId, gameId, type: "withdraw" });
    await ok(ava, { entryId: avaEntryId, gameId, type: "withdraw" });
    await ok(ava, await photo(ava, gameId, "ava-d0-b"));

    // Day 1: only Leo posts. Settle: Leo wins breakfast in bed.
    await devAdvanceDays(gameId, leo, 1);
    await ok(leo, await photo(leo, gameId, "leo-d1"));
    const settled = await devSettleNow(gameId, ava);
    expect(settled).toMatchObject({ result: { outcome: "lost", scores: [{ score: 2, seat: 0 }, { score: 1, seat: 1 }] }, status: "settled" });
    expect(settled.tickets).toEqual([expect.objectContaining({ owedByMemberId: ava, status: "open", what: "Breakfast in bed", youHold: false })]);
    // After settle every live post is visible; the replaced first shot is not.
    const day1Key = (await readGame(gameId, ava))!.days[1].others[0].entry!.mediaUrls[0];
    expect(day1Key).toContain(encodeURIComponent(mediaKeyPrefixFor(leo)));
    const firstShotKey = firstShot.type === "post" ? firstShot.mediaKeys[0] : "";
    expect(await authorizeMediaRead(ava, firstShotKey)).toBe(false);

    // Wallet and redeem: only the holder cashes in, once.
    const ticketId = settled.tickets[0].id;
    expect(await errorCode(ava, { ticketId, type: "redeem" })).toBe("TICKET_NOT_HELD");
    expect((await readHome(leo)).wallet.held.map((ticket) => ticket.what)).toEqual(["Breakfast in bed"]);
    await ok(leo, { ticketId, type: "redeem" });
    await ok(leo, { ticketId, type: "redeem" });
    const homeAfter = await readHome(leo);
    expect(homeAfter.wallet).toMatchObject({ held: [], redeemed: [expect.objectContaining({ id: ticketId })] });
    expect(homeAfter.me).toMatchObject({ firstName: "Leo", timeZone: "America/New_York" });

    // The history: one row per accepted change, none for repeats or rejections.
    const events = await getPrisma().gameEvent.findMany({ orderBy: { id: "asc" }, where: { gameId } });
    expect(events.map((event) => event.type)).toEqual([
      "created", "joined", "started", "started", "posted", "posted", "posted",
      "withdrew", "posted", "time_shifted", "posted", "time_shifted", "settled", "redeemed",
    ]);
    expect(JSON.stringify(events.map((event) => event.payload))).not.toMatch(/pushups|Breakfast|done|girlfriend/u);

    // Rematch with the same person: round 2; the name typed most recently wins.
    const rematch = await ok(leo, {
      gameId: randomUUID(),
      inviteeFirstName: "Ava B",
      previousGameId: gameId,
      terms: TERMS,
      type: "createGame",
    });
    expect(rematch).toMatchObject({ round: 2 });
    const rejoined = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token: rematch!.inviteToken!, type: "join" });
    expect(rejoined).toMatchObject({ round: 2, status: "live" });
    expect(rejoined!.players[0].firstName).toBe("Leo");
    expect((await readGame(rematch!.id, leo))!.players[1].firstName).toBe("Ava B");
  });

  it("keeps the challenger's latest name for someone, and their earlier words it didn't replace", async () => {
    const kat = await member("Kat", "Europe/London");
    const leo = await member("Leo", "America/New_York");
    const first = await startGame(kat, leo, { inviteeFirstName: "Anna", inviteeLabel: { relationship: "brother" } });
    expect((await readGame(first.gameId, kat))!.players[1].firstName).toBe("Anna");
    await devSettleNow(first.gameId, kat);
    const next = await startGame(kat, leo, { inviteeFirstName: "Leo", previousGameId: first.gameId });
    expect((await readGame(next.gameId, kat))!.players[1].firstName).toBe("Leo");
    const label = await getPrisma().gameContactLabel.findUniqueOrThrow({
      where: { ownerMemberId_subjectMemberId: { ownerMemberId: kat, subjectMemberId: leo } },
    });
    expect(label.relationshipEncrypted).toBeTruthy();
  });

  it("shows the relationship the viewer typed only to them, and keeps it across a rematch", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const relationshipOf = (view: Awaited<ReturnType<typeof readGame>>, memberSeat: number) =>
      view!.players.find((player) => player.seat === memberSeat)!.relationship;

    const gameId = randomUUID();
    const created = await ok(leo, { gameId, inviteeFirstName: "Ava", inviteeLabel: { relationship: "my partner" }, terms: TERMS, type: "createGame" });
    expect(created!.players.map((player) => player.relationship)).toEqual([null, "my partner"]);
    await ok(ava, { termsVersion: 1, timeZone: "UTC", token: created!.inviteToken!, type: "join" });

    // The challenger sees it for the invitee; the invitee has no label for the challenger.
    expect(relationshipOf(await readGame(gameId, leo), 1)).toBe("my partner");
    expect(relationshipOf(await readGame(gameId, leo), 0)).toBeNull();
    expect((await readGame(gameId, ava))!.players.map((player) => player.relationship)).toEqual([null, null]);
    // Nobody else ever sees it: Kat isn't in the game, and in her own game with Ava it isn't her label.
    expect(await readGame(gameId, kat)).toBeNull();
    const katsGame = await startGame(kat, ava);
    expect((await readGame(katsGame.gameId, kat))!.players.map((player) => player.relationship)).toEqual([null, null]);
    expect(JSON.stringify(await readHome(kat))).not.toContain("my partner");
    expect(JSON.stringify(await readHome(ava))).not.toContain("my partner");

    // A rematch typed without a relationship keeps the one Leo saved, before and after Ava accepts.
    await devSettleNow(gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", previousGameId: gameId, terms: TERMS, type: "createGame" });
    expect(relationshipOf(rematch, 1)).toBe("my partner");
    await ok(ava, { termsVersion: 1, timeZone: "UTC", token: rematch!.inviteToken!, type: "join" });
    expect(relationshipOf(await readGame(rematch!.id, leo), 1)).toBe("my partner");
  });

  it("addresses a rematch to the previous opponent, on their Home and nobody else's", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const first = await startGame(leo, ava);
    const photoKey = await upload(ava, "rematch-profile");
    await ok(ava, { type: "setProfile", photoKey });
    await devSettleNow(first.gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Babe", previousGameId: first.gameId, terms: TERMS, type: "createGame" });
    expect(await getPrisma().gameInvitee.findUniqueOrThrow({ where: { gameId_seat: { gameId: rematch!.id, seat: 1 } } })).toMatchObject({ memberId: ava });

    expect(rematch!.players[1].avatarUrl).toContain(encodeURIComponent(photoKey));
    expect(rematch!.players[1].profileAvatarUrl).toBe(rematch!.players[1].avatarUrl);
    const avaHome = await readHome(ava);
    const addressed = avaHome.games.find((game) => game.id === rematch!.id);
    expect(addressed).toMatchObject({ inviteToken: rematch!.inviteToken, previousGameId: first.gameId, round: 2, status: "invited" });
    expect(avaHome.games.find((game) => game.id === first.gameId)).toMatchObject({ previousGameId: null, round: 1 });
    // She sees herself by her own name, never the challenger's private one for her.
    expect(addressed!.players.map((player) => [player.firstName, player.isMe])).toEqual([["Leo", false], ["Ava", true]]);
    expect(addressed!.players[1].profileAvatarUrl).toBe(avaHome.me.avatarUrl);
    expect(JSON.stringify(addressed)).not.toContain("Babe");
    expect((await readHome(kat)).games.map((game) => game.id)).not.toContain(rematch!.id);
    expect(await readGame(rematch!.id, kat)).toBeNull();

    const accepted = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token: addressed!.inviteToken!, type: "join" });
    expect(accepted).toMatchObject({ inviteToken: rematch!.inviteToken, round: 2, status: "live" });
  });

  it("inherits and queues only an existing rematch room, then starts delivery after commit", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const db = getPrisma();
    const linked = await startGame(leo, ava);
    const room = `game_room_${randomUUID()}`;
    memberIds.push(room);
    await db.hostedMember.create({ data: { id: room, billingStatus: "not_started" } });
    await db.game.update({ where: { id: linked.gameId }, data: { chatContainerMemberId: room } });
    await devSettleNow(linked.gameId, leo);
    lifecycleDelivery.mockClear();
    const rematchId = randomUUID();
    await ok(leo, { gameId: rematchId, inviteeFirstName: "Ava", previousGameId: linked.gameId, terms: TERMS, type: "createGame" });
    expect(await db.game.findUniqueOrThrow({ where: { id: rematchId }, select: { chatContainerMemberId: true } }))
      .toEqual({ chatContainerMemberId: room });
    expect(await db.hostedLinqDelivery.findFirst({ where: { source: "game_lifecycle", sourceRef: rematchId, template: "game_rematch" } }))
      .toMatchObject({ status: "awaiting_generation" });
    expect(lifecycleDelivery).toHaveBeenCalledExactlyOnceWith(rematchId, "rematch", undefined);

    const maya = await member("Maya", "UTC");
    const sam = await member("Sam", "UTC");
    const unlinked = await startGame(maya, sam);
    await devSettleNow(unlinked.gameId, maya);
    const silentId = randomUUID();
    await ok(maya, { gameId: silentId, inviteeFirstName: "Sam", previousGameId: unlinked.gameId, terms: TERMS, type: "createGame" });
    expect(await db.game.findUniqueOrThrow({ where: { id: silentId }, select: { chatContainerMemberId: true } }))
      .toEqual({ chatContainerMemberId: null });
    expect(await db.hostedLinqDelivery.count({ where: { source: "game_lifecycle", sourceRef: silentId, template: "game_rematch" } })).toBe(0);
  });

  it("keeps asymmetric tasks with their people when the previous invitee requests the rematch", async () => {
    const challenger = await member("Challenger", "UTC");
    const invitee = await member("Invitee", "UTC");
    const first = await startGame(challenger, invitee);
    await devSettleNow(first.gameId, challenger);
    const rematch = await ok(invitee, { gameId: randomUUID(), inviteeFirstName: "Challenger", previousGameId: first.gameId,
      terms: { ...TERMS, tasks: [{ seat: 0, text: "10 min abs" }, { seat: 1, text: "100 pushups" }] }, type: "createGame" });
    const notice = await readGameRematchNotice(rematch!.id, [challenger, invitee]);
    expect(notice).not.toBeNull();
    if (!notice || "maxPlayers" in notice) throw new Error("Expected pair rematch facts");
    expect(notice!.previous.tasksByMember).toEqual({ [challenger]: "100 pushups", [invitee]: "10 min abs" });
    expect(notice!.rematch.tasksByMember).toEqual(notice!.previous.tasksByMember);
    expect(notice!.players).toEqual([{ memberId: invitee, name: "Invitee", requester: true }, { memberId: challenger, name: "Challenger", requester: false }]);
    const prompt = JSON.parse(buildGameRematchInstructions(notice!).split("\n").at(-1)!);
    expect(prompt.sameGame).toBe(true);
    // Each task stays with its person by name, with no member key in the prompt.
    expect(prompt.players).toEqual([
      { name: "Invitee", requester: true, previousTask: "10 min abs", rematchTask: "10 min abs" },
      { name: "Challenger", requester: false, previousTask: "100 pushups", rematchTask: "100 pushups" },
    ]);
    expect(JSON.stringify(prompt)).not.toContain(challenger);
  });

  it("starts invite negotiation delivery immediately after its write", async () => {
    const challenger = await member("Alex", "UTC");
    const invitee = await member("Jordan", "UTC");
    const gameId = randomUUID();
    const created = await ok(challenger, { gameId, inviteeFirstName: "Jordan", terms: TERMS, type: "createGame" });
    const proposalId = randomUUID();
    proposalDelivery.mockClear();
    expect(await run(invitee, { type: "negotiate", token: created!.inviteToken!, proposalId, termsVersion: 1,
      timeZone: "UTC", change: { kind: "edit", lengthDays: 10 } })).toMatchObject({ ok: true });
    expect(proposalDelivery).toHaveBeenCalledExactlyOnceWith(gameId, proposalId);
    expect(await getPrisma().hostedLinqDelivery.count({ where: { source: "game_lifecycle", sourceRef: gameId, template: "game_proposal" } })).toBe(1);
  });

  it("keeps a game's own invite token for its players after go-live, and never shows it to anyone else", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const kat = await member("Kat", "America/New_York");
    const { gameId, token } = await startGame(leo, ava);
    // Live: both players can recognize their own link; a third person can't read the game at all.
    expect((await readGame(gameId, leo))!.inviteToken).toBe(token);
    expect((await readGame(gameId, ava))!.inviteToken).toBe(token);
    expect(await readGame(gameId, kat)).toBeNull();
    expect(JSON.stringify(await readHome(kat))).not.toContain(token);
    // Settled: still theirs, and a spent token can't be accepted again.
    await devSettleNow(gameId, leo);
    expect((await readHome(leo)).games.find((game) => game.id === gameId)!.inviteToken).toBe(token);
    expect((await readGame(gameId, ava))!.inviteToken).toBe(token);
    expect(await errorCode(kat, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" })).toBe("INVITE_USED");
  });

  it.each(["prize", "dare"] as const)("issues a long-game %s ticket for fourteen days on the dev clock", async (kind) => {
    const holder = await member("Sam", "America/New_York");
    const debtor = await member("Maya", "America/New_York");
    const {gameId} = await startGame(holder, debtor, {terms:{...TERMS,lengthDays:75,stakes:[{kind,item:"Pick a film"}]}});
    await devStartNow(gameId,holder);
    await ok(holder,{type:"post",gameId,entryId:randomUUID(),kind:"words",mediaKeys:[],text:"Done today"});
    await devAdvanceDays(gameId,holder,44);
    const [ticket] = (await devSettleNow(gameId,holder)).tickets;
    const row = await getPrisma().game.findUniqueOrThrow({where:{id:gameId}});
    const offset = Number(row.devClockOffsetMs);
    expect(offset).toBeGreaterThan(44 * 86_400_000);
    expect(ticket).toMatchObject({kind,status:"open",youHold:true});
    expect(Math.abs(Date.parse(ticket.createdAt) - (Date.now() + offset))).toBeLessThan(10_000);
    expect(Date.parse(ticket.useBy) - Date.parse(ticket.createdAt)).toBe(14 * 86_400_000);
    expect((await readHome(holder)).wallet.held).toContainEqual(expect.objectContaining({id:ticket.id,status:"open"}));
    expect((await readHome(debtor)).wallet.owed).toContainEqual(expect.objectContaining({id:ticket.id,status:"open"}));
    expect((await readGameChatState("synthetic-room",[holder,debtor])).games.find((game) => game.id === gameId)?.result?.tickets).toContainEqual(expect.objectContaining({status:"open",count:1}));
    if (kind === "dare") {
      await ok(holder,{type:"redeem",ticketId:ticket.id});
      expect((await readHome(holder)).wallet.redeemed).toContainEqual(expect.objectContaining({id:ticket.id,status:"redeemed"}));
    } else {
      await getPrisma().game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(offset + 13 * 86_400_000)}});
      expect((await readHome(holder)).wallet.held).toContainEqual(expect.objectContaining({id:ticket.id,status:"open"}));
      await getPrisma().game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(offset + 14 * 86_400_000)}});
      expect((await readHome(holder)).wallet.held).toContainEqual(expect.objectContaining({id:ticket.id,status:"expired"}));
      expect(await errorCode(holder,{type:"redeem",ticketId:ticket.id})).toBe("TICKET_EXPIRED");
    }
  });

  it("lets a ticket expire 14 days after it's issued, refusing to redeem it then", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const { gameId } = await startGame(leo, ava);
    await devStartNow(gameId, leo);
    await ok(leo, await photo(leo, gameId, "only-leo"));
    const [ticket] = (await devSettleNow(gameId, leo)).tickets;
    expect(ticket).toMatchObject({ status: "open", youHold: true });
    expect(new Date(ticket.useBy).getTime() - new Date(ticket.createdAt).getTime()).toBe(14 * 24 * 60 * 60 * 1000);

    await getPrisma().gameTicket.update({
      data: { createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
      where: { id: ticket.id },
    });
    expect((await readHome(leo)).wallet.held).toEqual([expect.objectContaining({ id: ticket.id, status: "expired" })]);
    expect((await readHome(ava)).wallet.owed).toEqual([expect.objectContaining({ id: ticket.id, status: "expired" })]);
    const refused = await run(leo, { ticketId: ticket.id, type: "redeem" });
    expect(refused).toMatchObject({ error: { code: "TICKET_EXPIRED" }, ok: false, status: 410 });
    expect((await getPrisma().gameTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("open");
  });

  it("starts on the challenger's picked date, shown before and after accept", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const today = gameLocalDate(new Date(), "America/New_York");
    const startsOn = addDays(today, 3);
    expect(await errorCode(leo, {
      gameId: randomUUID(),
      inviteeFirstName: "Ava",
      terms: { ...TERMS, startsOn: today },
      type: "createGame",
    })).toBe("INVALID_REQUEST");

    // The name Leo types for the invitee is his private label: the public preview never carries it.
    const created = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Babe", terms: { ...TERMS, startsOn }, type: "createGame" });
    expect(created!.startsOn).toBe(startsOn);
    const preview = await readInvitePreview(created!.inviteToken!);
    expect(preview).toMatchObject({ inviterFirstName: "Leo", startsOn, status: "open" });
    expect(preview).not.toHaveProperty("inviteeFirstName");
    expect(JSON.stringify(preview)).not.toContain("Babe");

    const joined = await ok(ava, { termsVersion: 1, timeZone: "Australia/Sydney", token: created!.inviteToken!, type: "join" });
    expect(joined).toMatchObject({ startsOn, status: "live" });
    expect(joined!.days[0].localDate).toBe(startsOn);
    expect((await readGame(created!.id, leo))!.days[0].localDate).toBe(startsOn);
    const players = await getPrisma().gamePlayer.findMany({ where: { gameId: created!.id } });
    expect(players.map((player) => player.dayOne?.toISOString().slice(0, 10))).toEqual([startsOn, startsOn]);
  });

  it("time-travels by moving only the game's clock: posts keep their real dates, and passing the end settles", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "UTC");
    // Only today's weekday counts, so tomorrow is a day off.
    const today = gameLocalDate(new Date(), "America/New_York");
    const { gameId, token } = await startGame(leo, ava, { terms: { ...TERMS, schedule: { days: [weekdayOf(today)] } } });
    await devStartNow(gameId, leo);
    const shot = await photo(leo, gameId, "today");
    await ok(leo, shot);
    const before = await getPrisma().game.findUniqueOrThrow({ include: { players: true }, where: { id: gameId } });
    const [entry] = await getPrisma().gameEntry.findMany({ where: { gameId } });

    const advanced = await devAdvanceDays(gameId, leo, 1);
    expect(advanced.players.find((player) => player.isMe)!.dayIndex).toBe(1);
    expect(advanced.days[1].off).toBe(true);
    expect(advanced.days[0]).toMatchObject({ localDate: today, mine: { entryId: shot.type === "post" ? shot.entryId : "" } });
    const after = await getPrisma().game.findUniqueOrThrow({ include: { players: true }, where: { id: gameId } });
    expect(after.devClockOffsetMs).toBe(BigInt(24 * 60 * 60 * 1000));
    expect(after.startedAt).toEqual(before.startedAt);
    expect(after.players.map((player) => player.dayOne)).toEqual(before.players.map((player) => player.dayOne));
    expect((await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: entry.id } })).receivedAt).toEqual(entry.receivedAt);

    const ended = await devAdvanceDays(gameId, leo, 7);
    expect(ended.status).toBe("settled");
    // Past the invite's 7-day expiry, a link that was taken still reads as used.
    expect(await readInvitePreview(token)).toEqual({ status: "used" });
  });

  it("refuses a rematch only when that chain has an open or settled descendant", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const { gameId: first } = await startGame(leo, ava);
    await devSettleNow(first, leo);
    const rematchOf = (previousGameId: string): GameCommand => ({
      gameId: randomUUID(),
      inviteeFirstName: "Ava",
      previousGameId,
      terms: TERMS,
      type: "createGame",
    });

    // A rematch of the newest game works.
    const second = await ok(leo, rematchOf(first));
    expect(second).toMatchObject({ round: 2, status: "invited" });
    // While that rematch is open, or live, another one from round 1 could never be accepted.
    expect(await run(leo, rematchOf(first))).toMatchObject({
      error: { code: "ALREADY_IN_A_GAME", message: "This game already has an open rematch." },
      ok: false,
    });
    await ok(ava, { termsVersion: 1, timeZone: "America/New_York", token: second!.inviteToken!, type: "join" });
    // Ava's own rematch of round 1 is refused because a live game is refused, not returned.
    expect(await run(ava, rematchOf(first))).toMatchObject({
      ok: false,
      error: { code: "ALREADY_IN_A_GAME", message: "This game already has an open rematch." },
    });

    // Once round 2 has settled, round 1 is outdated; round 2 rematches fine.
    await devSettleNow(second!.id, leo);
    expect(await run(ava, rematchOf(first))).toMatchObject({
      error: { code: "REMATCH_OUTDATED", message: "A later game in this rematch chain has already finished." },
      ok: false,
    });
    expect(await ok(ava, rematchOf(second!.id))).toMatchObject({ round: 3, status: "invited" });
  });

  it("addresses a new one-on-one invite to someone you already play, by the number you picked, and leaves anyone else an open link", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const sam = await member("Sam", "Europe/London");
    const phones = new Map([[ava, "+13125550171"], [kat, "+13125550172"], [sam, "+13125550173"], [leo, "+13125550174"]]);
    for (const [memberId, phone] of phones) await getPrisma().$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phone), memberId, prisma: tx,
      phoneNumberVerifiedAt: new Date(), signupPhoneNumber: null }));
    // Leo and Ava are mid-game; Leo has never played Kat.
    await startGame(ava, leo);
    const invite = (inviteeFirstName: string, value: string): GameCommand => ({ gameId: randomUUID(), inviteeFirstName, inviteeLabel: { relationship: "my brother" }, inviteeRecipient: { kind: "phone", value }, terms: TERMS, type: "createGame" });

    // Ava's number, as the app sends it: the invite is hers, under her member id, with Leo's own words for her.
    const second = await ok(leo, invite("Avi", "+1 312-555-0171"));
    expect((await getPrisma().gameInvitee.findUniqueOrThrow({ where: { gameId_seat: { gameId: second!.id, seat: 1 } } })).memberId).toBe(ava);
    expect(await readGame(second!.id, leo)).toMatchObject({ status: "invited", players: [{ seat: 0 }, { seat: 1, memberId: ava, firstName: "Avi", relationship: "my brother" }] });
    const accept = { termsVersion: 1, timeZone: "Europe/London", token: second!.inviteToken!, type: "join" } as const;
    expect(await run(kat, accept)).toMatchObject({ ok: false, status: 403, error: { code: "NOT_A_PLAYER", message: "This invite is for someone else." } });
    expect(await ok(ava, { ...accept, timeZone: "Australia/Sydney" })).toMatchObject({ status: "live" });

    // Kat is a member Leo has never played, so her number says nothing: an open link anyone can take.
    const open = await ok(leo, invite("Kat", "+13125550172"));
    expect((await getPrisma().gameInvitee.findUniqueOrThrow({ where: { gameId_seat: { gameId: open!.id, seat: 1 } } })).memberId).toBeNull();
    expect(await readGame(open!.id, leo)).toMatchObject({ players: [{ seat: 0 }, { seat: 1, memberId: null }] });
    expect(await ok(sam, { termsVersion: 1, timeZone: "Europe/London", token: open!.inviteToken!, type: "join" })).toMatchObject({ status: "live" });

    // A number that isn't anyone's, one that can't be read, or your own: an open link, and the invite still goes.
    for (const value of ["+13125550179", "not a number", "+13125550174"]) {
      const created = await ok(leo, invite("Pat", value));
      expect((await getPrisma().gameInvitee.findUniqueOrThrow({ where: { gameId_seat: { gameId: created!.id, seat: 1 } } })).memberId).toBeNull();
    }

    // Blocked either way: never addressed, so the number says nothing about the block.
    await getPrisma().gameBlock.create({ data: { blockerMemberId: ava, blockedMemberId: leo } });
    const blocked = await ok(leo, invite("Ava", "+13125550171"));
    expect((await getPrisma().gameInvitee.findUniqueOrThrow({ where: { gameId_seat: { gameId: blocked!.id, seat: 1 } } })).memberId).toBeNull();
  });

  it("lets only the addressed opponent accept a rematch, and never copies its label onto someone else", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const first = await startGame(leo, ava);
    await devSettleNow(first.gameId, leo);
    const rematch = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Emma", inviteeLabel: { relationship: "sister" }, previousGameId: first.gameId, terms: TERMS, type: "createGame" });
    const accept = { termsVersion: 1, timeZone: "Europe/London", token: rematch!.inviteToken!, type: "join" } as const;
    expect(await run(kat, accept)).toMatchObject({ ok: false, status: 403, error: { code: "NOT_A_PLAYER", message: "This invite is for someone else." } });
    expect(await run(kat, { ...accept, type: "negotiate", proposalId: randomUUID(), change: { kind: "edit", lengthDays: 10 } }))
      .toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await getPrisma().gameContactLabel.findUnique({ where: { ownerMemberId_subjectMemberId: { ownerMemberId: leo, subjectMemberId: kat } } })).toBeNull();
    expect(await readGame(rematch!.id, kat)).toBeNull();
    // Still open for Ava, who takes it as round 2.
    expect(await readGame(rematch!.id, leo)).toMatchObject({ status: "invited", players: [{ seat: 0 }, { seat: 1, firstName: "Emma" }] });
    expect(await ok(ava, { ...accept, timeZone: "Australia/Sydney" })).toMatchObject({ round: 2, status: "live" });
    expect((await readGame(rematch!.id, leo))!.players[1]).toMatchObject({ memberId: ava, firstName: "Emma", relationship: "sister" });
  });

  it.each([false, true])("serializes concurrent rematches (same player: %s)", async (samePlayer) => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const first = await startGame(leo, ava);
    await devSettleNow(first.gameId, leo);
    const command = (): GameCommand => ({ type: "createGame", gameId: randomUUID(), inviteeFirstName: "Friend",
      previousGameId: first.gameId, terms: TERMS });
    const results = await Promise.all([run(leo, command()), run(samePlayer ? leo : ava, command())]);
    const stored = await getPrisma().game.findMany({ where: { previousGameId: first.gameId } });
    expect(stored).toHaveLength(1);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ ok: false, status: 409, error: expect.objectContaining({ code: "ALREADY_IN_A_GAME" }) }),
    ]);
    expect(stored[0].status).toBe("invited");
  });

  it("keeps an older live game on Home beyond fifty newer invitations", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const first = await startGame(leo, ava);
    const template = await getPrisma().game.findUniqueOrThrow({ where: { id: first.gameId } });
    const seat = await getPrisma().gamePlayer.findUniqueOrThrow({ where: { gameId_memberId: { gameId: first.gameId, memberId: leo } } });
    for (let n = 0; n < 51; n += 1) {
      const id = randomUUID();
      await getPrisma().game.create({ data: { id, createdBy: leo, wordsOwnerMemberId: leo, status: "invited",
        terms: toPrismaJsonObject(template.terms), termsWordsEncrypted: template.termsWordsEncrypted,
        inviteExpiresAt: new Date(Date.now() + 86_400_000) } });
      await getPrisma().gamePlayer.create({ data: { gameId: id, memberId: leo, seat: 0, timeZone: seat.timeZone, joinedAt: new Date(Date.now() + n + 1) } });
    }
    expect((await readHome(leo)).games.some((game) => game.id === first.gameId)).toBe(true);
  });

  it("authorizes reused media through any visible entry beyond five newer references", async () => {
    const poster = await member("Poster", "America/New_York");
    const viewer = await member("Viewer", "America/New_York");
    const stranger = await member("Stranger", "America/New_York");
    const first = await startGame(poster, viewer);
    await devStartNow(first.gameId, poster);
    const shot = await photo(poster, first.gameId, "reused-image");
    await ok(poster, shot);
    await ok(viewer, await photo(viewer, first.gameId, "viewer-image"));
    const entry = await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: shot.entryId } });
    // Later withdrawn references cannot hide the earlier, still-visible post.
    for (let n = 0; n < 6; n += 1) {
      await getPrisma().gameEntry.create({ data: { ...entry, id: randomUUID(), dayIndex: n + 1,
        receivedAt: new Date(entry.receivedAt.getTime() + n + 1), withdrawnAt: new Date() } });
    }
    expect(await authorizeMediaRead(viewer, shot.mediaKeys[0])).toBe(true);
    expect(await authorizeMediaRead(stranger, shot.mediaKeys[0])).toBe(false);
    await getPrisma().gameReport.create({ data: { id: randomUUID(), reporterMemberId: viewer,
      reportedMemberId: poster, gameId: first.gameId, entryId: entry.id, about: "post", reason: "other" } });
    expect(await authorizeMediaRead(viewer, shot.mediaKeys[0])).toBe(false);
  });

  it.each(["challenger", "opponent"].flatMap(firstAsker => ["equal", "different"].map(secondTerms => ({ firstAsker, secondTerms }))))(
    "refuses a second rematch ask until explicit acceptance (first: $firstAsker, terms: $secondTerms)", async ({ firstAsker, secondTerms }) => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Pacific/Auckland");
    const first = await startGame(leo, ava);
    const room = `game_room_${randomUUID()}`;
    memberIds.push(room);
    await getPrisma().hostedMember.create({ data: { id: room, billingStatus: "not_started" } });
    await getPrisma().game.update({ where: { id: first.gameId }, data: { chatContainerMemberId: room } });
    await devSettleNow(first.gameId, leo);
    const [asker, answerer] = firstAsker === "challenger" ? [leo, ava] : [ava, leo];
    const firstRequest: GameCommand = { gameId: randomUUID(), inviteeFirstName: "Them", previousGameId: first.gameId, terms: TERMS, type: "createGame" };
    const asked = await ok(asker, firstRequest);
    lifecycleDelivery.mockClear();
    const secondRequest: GameCommand = { gameId: randomUUID(), inviteeFirstName: "Them", previousGameId: first.gameId,
      terms: secondTerms === "equal" ? TERMS : { ...TERMS, lengthDays: 14 }, type: "createGame" };
    const refusal = { ok: false, status: 409, error: { code: "ALREADY_IN_A_GAME",
      message: "They already asked for a rematch. Read it first: pull down on Home to see it." } };
    const db = getPrisma();
    const stored = await db.game.findMany({ where: { previousGameId: first.gameId } });
    const events = await db.gameEvent.count({ where: { gameId: asked!.id } });
    // Neither an ask nor its retry agrees to the open offer or writes another game.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await run(answerer, secondRequest)).toEqual(refusal);
      expect(await db.game.findMany({ where: { previousGameId: first.gameId } })).toEqual(stored);
      expect(stored).toEqual([expect.objectContaining({ id: asked!.id, status: "invited", lengthDays: 7 })]);
      expect(await db.game.count({ where: { id: secondRequest.gameId } })).toBe(0);
      expect(await db.gameEvent.count({ where: { gameId: asked!.id } })).toBe(events);
      expect(await db.hostedLinqDelivery.count({ where: { source: "game_lifecycle", template: "game_rematch", sourceRef: asked!.id } })).toBe(1);
      expect(lifecycleDelivery).not.toHaveBeenCalled();
    }
    expect(await ok(asker, firstRequest)).toMatchObject({ id: asked!.id, status: "invited" });
    const offer = (await readHome(answerer)).games.find(game => game.previousGameId === first.gameId);
    expect(offer).toMatchObject({ id: asked!.id, status: "invited", inviteToken: asked!.inviteToken, lengthDays: 7, terms: asked!.terms });
    expect(offer!.inviteToken).toEqual(expect.any(String));
    expect(await ok(answerer, { type: "join", token: offer!.inviteToken!, termsVersion: offer!.terms.n, timeZone: "UTC" }))
      .toMatchObject({ id: asked!.id, status: "live", lengthDays: 7, terms: asked!.terms });
    expect(await ok(asker, firstRequest)).toMatchObject({ id: asked!.id, status: "live" });
    expect(await run(answerer, secondRequest)).toEqual({ ok: false, status: 409,
      error: { code: "ALREADY_IN_A_GAME", message: "This game already has an open rematch." } });
  });

  async function waitForPairLockRequests(holderPid: number, expected: bigint) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      // The holder owns only this pair's advisory lock, so unrelated waiters cannot count.
      const [waiting] = await getPrisma().$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND ${holderPid} = ANY(pg_blocking_pids(pid))`;
      if (waiting.count === expected) return;
      if (Date.now() >= deadline) throw new Error(`Expected ${expected} rematch requests waiting on the pair lock; saw ${waiting.count}.`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  it("replays the same creator's same-id rematch under the pair lock", async () => {
    const challenger = await member("Challenger", "UTC"), opponent = await member("Opponent", "UTC");
    const previous = await startGame(challenger, opponent);
    await devSettleNow(previous.gameId, challenger);
    const request: GameCommand = { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Them", previousGameId: previous.gameId, terms: TERMS };
    const db = getPrisma();
    let markLocked!: () => void, release!: () => void, holderPid = 0;
    const locked = new Promise<void>(resolve => { markLocked = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const holding = db.$transaction(async tx => {
      await lockGamePair(tx, challenger, opponent);
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      holderPid = backend.pid;
      markLocked();
      await held;
    }, { timeout: 20_000 });
    const asks: Array<ReturnType<typeof run>> = [];
    try {
      await Promise.race([locked, holding]);
      for (const waitingFor of [1n, 2n]) {
        asks.push(run(challenger, request));
        await waitForPairLockRequests(holderPid, waitingFor);
      }
      expect(await db.game.count({ where: { id: request.gameId } })).toBe(0);
    } finally {
      release();
      await Promise.allSettled([holding, ...asks]);
    }
    await holding;
    for (const result of await Promise.all(asks)) {
      expect(result, result.ok ? undefined : JSON.stringify(result.error)).toMatchObject({ ok: true, game: { id: request.gameId, status: "invited" } });
    }
    expect(await db.game.count({ where: { id: request.gameId } })).toBe(1);
    expect(await db.gameEvent.count({ where: { gameId: request.gameId, type: "created" } })).toBe(1);
  });

  it.each(["challenger", "opponent"] as const)("refuses the second rematch ask under the pair lock (first: %s)", async firstAsker => {
    const challenger = await member("Challenger", "UTC"), opponent = await member("Opponent", "UTC");
    const previous = await startGame(challenger, opponent);
    await devSettleNow(previous.gameId, challenger);
    const [asker, answerer] = firstAsker === "challenger" ? [challenger, opponent] : [opponent, challenger];
    const firstRequest: GameCommand = { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Them", previousGameId: previous.gameId, terms: TERMS };
    const secondRequest: GameCommand = { ...firstRequest, gameId: randomUUID(), terms: { ...TERMS, lengthDays: 14 } };
    const db = getPrisma();
    let markLocked!: () => void, release!: () => void, holderPid = 0;
    const locked = new Promise<void>(resolve => { markLocked = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const holding = db.$transaction(async tx => {
      await lockGamePair(tx, challenger, opponent);
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      holderPid = backend.pid;
      markLocked();
      await held;
    }, { timeout: 20_000 });
    const asks: Array<ReturnType<typeof run>> = [];
    try {
      await Promise.race([locked, holding]);
      for (const waitingFor of [1n, 2n]) {
        asks.push(waitingFor === 1n ? run(asker, firstRequest) : run(answerer, secondRequest));
        await waitForPairLockRequests(holderPid, waitingFor);
      }
      // Both asks reached the pair lock after reading a chain with no rematch.
      expect(await db.game.count({ where: { previousGameId: previous.gameId } })).toBe(0);
    } finally {
      release();
      await Promise.allSettled([holding, ...asks]);
    }
    await holding;
    const [created, refused] = await Promise.all(asks);
    expect(created).toMatchObject({ ok: true, game: { id: firstRequest.gameId, status: "invited", lengthDays: 7 } });
    expect(refused).toEqual({ ok: false, status: 409, error: { code: "ALREADY_IN_A_GAME",
      message: "They already asked for a rematch. Read it first: pull down on Home to see it." } });
    expect(await db.game.findMany({ where: { previousGameId: previous.gameId }, select: { id: true, status: true, lengthDays: true } }))
      .toEqual([{ id: firstRequest.gameId, status: "invited", lengthDays: 7 }]);
    if (!created.ok || !created.game) throw new Error("Expected the first rematch offer.");
    expect(await ok(answerer, { type: "join", token: created.game.inviteToken!, termsVersion: created.game.terms.n, timeZone: "UTC" }))
      .toMatchObject({ id: firstRequest.gameId, status: "live", lengthDays: 7, terms: created.game.terms });
  });

  it.each([0, 1, 2, 3, 4, 5, 6] as const)("never starts a game on an unscheduled day (only weekday %s)", async (weekday) => {
    const leo = await member("Leo", "Pacific/Auckland");
    const ava = await member("Ava", "Pacific/Honolulu");
    const { gameId } = await startGame(leo, ava, { terms: { ...TERMS, lengthDays: 3, schedule: { days: [weekday] }, startsOn: undefined } }, "Pacific/Honolulu");
    for (const viewer of [leo, ava]) {
      const view = (await readGame(gameId, viewer))!;
      expect(view.days[0].off).toBe(false);
      expect(weekdayOf(view.days[0].localDate)).toBe(weekday);
      expect(view.days.filter((day) => !day.off)).toHaveLength(1);
    }
  });

  it("moves an unstarted Day 1 onto a newly agreed schedule", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "America/New_York");
    const startsOn = addDays(gameLocalDate(new Date(), "America/New_York"), 10);
    const { gameId } = await startGame(leo, ava, { terms: { ...TERMS, lengthDays: 3, startsOn } });
    const dayOne = (await readGame(gameId, leo))!.days[0].localDate;
    expect(dayOne).toBe(startsOn);
    const off = ((weekdayOf(dayOne) + 3) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const proposalId = randomUUID();
    await ok(leo, { type: "proposeChange", gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", schedule: { days: [off] } } });
    await getPrisma().game.update({ where: { id: gameId }, data: { chatContainerMemberId: null } });
    // Agreement happens in chat; drive the same locked approval directly.
    expect(await runGameCommand({ actorMemberId: ava, command: { type: "respondChange", gameId, proposalId, decision: "approve" }, chatContainerMemberId: "synthetic-room", chatPlayerMemberIds: [leo, ava], beforeMutationTx: async () => {} })).toMatchObject({ ok: true });
    const view = (await readGame(gameId, leo))!;
    expect(view.days[0]).toMatchObject({ localDate: addDays(dayOne, 3), off: false });
  });

  it("shows results soon instead of a fresh game once a player's days are over, and refuses edits then", async () => {
    const olivia = await member("Olivia", "Pacific/Auckland");
    const mia = await member("Mia", "Pacific/Honolulu");
    const { gameId } = await startGame(olivia, mia, { terms: { ...TERMS, lengthDays: 3, startsOn: undefined } }, "Pacific/Honolulu");
    // Move this game's clock to half an hour after Olivia's last day ends: Mia, behind the date line, is still on hers.
    const players = await getPrisma().gamePlayer.findMany({ where: { gameId } });
    const dayOne = players[0].dayOne!.toISOString().slice(0, 10);
    expect(players.map((player) => player.timeZone).sort()).toEqual(["Pacific/Auckland", "Pacific/Honolulu"]);
    const target = dayStartInstant(addDays(dayOne, 3), "Pacific/Auckland").getTime() + 30 * 60 * 1000;
    await getPrisma().game.update({ where: { id: gameId }, data: { devClockOffsetMs: BigInt(target - Date.now()) } });
    const view = (await readGame(gameId, olivia))!;
    expect(view.settlesAt).toBe(new Date(dayStartInstant(addDays(dayOne, 3), "Pacific/Honolulu").getTime() + 60 * 60 * 1000).toISOString());
    expect(view).toMatchObject({ status: "live", retakeAvailable: false, changeControls: { canEdit: false } });
    expect(view.players.find((player) => player.isMe)!.dayIndex).toBeNull();
    const miaView = (await readGame(gameId, mia))!;
    expect(miaView.settlesAt).toBeNull();
    expect(miaView.players.find((player) => player.isMe)!.dayIndex).toBe(2);
    for (const actor of [olivia, mia]) {
      expect(await run(actor, { type: "proposeChange", gameId, proposalId: randomUUID(), expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 5 } }))
        .toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    }
    expect(await devSettleNow(gameId, olivia)).toMatchObject({ status: "settled", settlesAt: null });
  });

  it("settles a finished game between the same two people that nobody opened before their next one", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const stale = await startGame(leo, ava);
    // Past the last day and grace, with no read since.
    await getPrisma().gamePlayer.updateMany({
      data: { dayOne: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
      where: { gameId: stale.gameId },
    });
    expect((await getPrisma().game.findUniqueOrThrow({ where: { id: stale.gameId } })).status).toBe("live");

    const next = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });
    const joined = await ok(ava, { termsVersion: 1, timeZone: "UTC", token: next!.inviteToken!, type: "join" });
    expect(joined!.status).toBe("live");
    expect((await getPrisma().game.findUniqueOrThrow({ where: { id: stale.gameId } })).status).toBe("settled");
  });

  it("names a room notice's game only when the pair has another open game", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const first = await startGame(a, b);
    expect(await readGameNoticeRoom(first.gameId, [a, b])).toBeUndefined();
    const second = await startGame(b, a, { terms: { ...TERMS, tasks: [{ seat: 0, text: "Read 20 pages" }, { seat: 1, text: "No phone after 10pm" }] } });
    // The first game started before the second, so only the second follows an earlier kickoff.
    expect(await readGameNoticeRoom(first.gameId, [a, b])).toEqual({ tasks: ["100 pushups", "10 min abs"], otherGames: [{ status: "live", tasks: ["Read 20 pages", "No phone after 10pm"] }], startedAfterAnother: false });
    expect(await readGameNoticeRoom(second.gameId, [b, a])).toEqual({ tasks: ["Read 20 pages", "No phone after 10pm"], otherGames: [{ status: "live", tasks: ["100 pushups", "10 min abs"] }], startedAfterAnother: true });
  });

  it("keeps two and ten same-pair games independent and refuses the eleventh", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const games = [];
    for (let index = 0; index < 10; index += 1) {
      games.push(await startGame(a, b));
      if (index === 1) expect((await readHome(a)).games.filter(game => game.status === "live")).toHaveLength(2);
    }
    expect((await readHome(a)).games.filter(game => game.status === "live")).toHaveLength(10);
    expect((await readGameChatState("synthetic-room", [a, b])).games.filter(game => game.status === "live")).toHaveLength(10);
    const extra = await ok(a, { gameId: randomUUID(), inviteeFirstName: "Friend", terms: TERMS, type: "createGame" });
    for (const command of [
      { type: "join" as const, token: extra!.inviteToken!, termsVersion: 1, timeZone: "UTC" },
      { type: "negotiate" as const, token: extra!.inviteToken!, termsVersion: 1, timeZone: "UTC", proposalId: randomUUID(), change: { kind: "edit" as const, lengthDays: 10 } },
    ]) expect(await run(b, command)).toMatchObject({ ok: false, status: 409, error: { code: "TOO_MANY_GAMES" } });
    // Retry a counted live game at the cap without consuming another slot.
    expect(await run(b, { type: "join", token: games[0]!.token, termsVersion: 1, timeZone: "UTC" })).toMatchObject({ ok: true });
    await devSettleNow(games[0]!.gameId, a);
    expect(await run(b, { type: "join", token: extra!.inviteToken!, termsVersion: 1, timeZone: "UTC" })).toMatchObject({ ok: true });
  });

  it("serializes simultaneous accepts at the ten-game cap", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    for (let index = 0; index < 9; index += 1) await startGame(a, b);
    const invites = await Promise.all([1, 2].map(() => ok(a, { gameId: randomUUID(), inviteeFirstName: "Friend", terms: TERMS, type: "createGame" })));
    const results = await Promise.all(invites.map(game => run(b, { type: "join", token: game!.inviteToken!, termsVersion: 1, timeZone: "UTC" })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.flatMap(result => result.ok ? [] : [result.error.code])).toEqual(["TOO_MANY_GAMES"]);
    expect((await readHome(a)).games.filter(game => game.status === "live")).toHaveLength(10);
  });

  it("serializes new rematches of separate chains at the cap", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const ancestors = await Promise.all([1, 2].map(() => startGame(a, b)));
    for (const game of ancestors) await devSettleNow(game.gameId, a);
    for (let index = 0; index < 9; index += 1) await startGame(a, b);
    const results = await Promise.all(ancestors.map(game => run(a, { type: "createGame", gameId: randomUUID(),
      previousGameId: game.gameId, inviteeFirstName: "Friend", terms: TERMS })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.flatMap(result => result.ok ? [] : [result.error.code])).toEqual(["TOO_MANY_GAMES"]);
  });

  it("requires a settled previous game for a rematch", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const previous = await startGame(a, b);
    const command: GameCommand = { type: "createGame", gameId: randomUUID(), previousGameId: previous.gameId, inviteeFirstName: "Friend", terms: TERMS };
    expect(await run(a, command)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await getPrisma().game.update({ where: { id: previous.gameId }, data: { status: "void" } });
    expect(await run(a, command)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("counts addressed rematches and negotiations, but not unclaimed links or expired invitations", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const ancestor = await startGame(a, b);
    await devSettleNow(ancestor.gameId, a);
    const otherChain = await startGame(a, b);
    await devSettleNow(otherChain.gameId, a);
    for (let index = 0; index < 8; index += 1) await startGame(a, b);
    const invitation = await ok(a, { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Friend", terms: TERMS });
    expect(await run(b, { type: "negotiate", token: invitation!.inviteToken!, termsVersion: 1, timeZone: "UTC", proposalId: randomUUID(), change: { kind: "edit", lengthDays: 10 } })).toMatchObject({ ok: true });
    const rematch = await ok(a, { type: "createGame", gameId: randomUUID(), previousGameId: ancestor.gameId, inviteeFirstName: "Friend", terms: TERMS });
    expect(await run(a, { type: "createGame", gameId: randomUUID(), previousGameId: otherChain.gameId, inviteeFirstName: "Friend", terms: TERMS })).toMatchObject({ ok: false, error: { code: "TOO_MANY_GAMES" } });
    // An already counted addressed invite can become live at ten.
    expect(await run(b, { type: "join", token: rematch!.inviteToken!, termsVersion: 1, timeZone: "UTC" })).toMatchObject({ ok: true });
    await getPrisma().game.update({ where: { id: invitation!.id }, data: { inviteExpiresAt: new Date(0) } });
    expect(await run(a, { type: "createGame", gameId: randomUUID(), previousGameId: otherChain.gameId, inviteeFirstName: "Friend", terms: TERMS })).toMatchObject({ ok: true });
  });

  it("rematches each chain independently of other live and newer settled games", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const first = await startGame(a, b); await devSettleNow(first.gameId, a);
    const unrelated = await startGame(a, b); await devSettleNow(unrelated.gameId, a);
    await startGame(a, b);
    const results = await Promise.all([a, b].map(actor => run(actor, { type: "createGame", gameId: randomUUID(), previousGameId: first.gameId, inviteeFirstName: "Friend", terms: TERMS })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const winner = results.findIndex(result => result.ok);
    const offered = results[winner];
    if (!offered.ok || !offered.game) throw new Error("Expected a rematch offer");
    expect(results[1 - winner]).toEqual({ ok: false, status: 409, error: { code: "ALREADY_IN_A_GAME",
      message: "They already asked for a rematch. Read it first: pull down on Home to see it." } });
    expect((await readGame(offered.game.id, a))!.status).toBe("invited");
    expect(await ok([a, b][1 - winner], { type: "join", token: offered.game.inviteToken!, termsVersion: offered.game.terms.n, timeZone: "UTC" }))
      .toMatchObject({ id: offered.game.id, status: "live" });
    expect(await run(a, { type: "createGame", gameId: randomUUID(), previousGameId: unrelated.gameId, inviteeFirstName: "Friend", terms: TERMS })).toMatchObject({ ok: true });
  });

  it("keeps named chat posts, day corrections and proposals on their selected game", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const [first, second] = await Promise.all([startGame(a, b, {}, "UTC"), startGame(a, b, {}, "UTC")]);
    const room = randomUUID(); memberIds.push(room);
    await getPrisma().hostedMember.create({ data: { id: room, billingStatus: "not_started" } });
    await getPrisma().game.updateMany({ where: { id: { in: [first.gameId, second.gameId] } }, data: { chatContainerMemberId: room } });
    const today = gameLocalDate(new Date(), "UTC");
    await getPrisma().gamePlayer.updateMany({ where: { gameId: { in: [first.gameId, second.gameId] } }, data: { dayOne: new Date(`${today}T00:00:00Z`), timeZone: "UTC" } });
    const chat = { actorMemberId: a, chatContainerMemberId: room, chatPlayerMemberIds: [a, b], beforeMutationTx: async () => {} };
    const post = await photo(a, second.gameId, "selected-chat-game");
    expect(await runAndRespond({ ...chat, command: post })).toMatchObject({ ok: true });
    expect(await getPrisma().gameEntry.count({ where: { gameId: first.gameId } })).toBe(0);
    expect(await runGameCommand({ ...chat, command: { type: "setDayCompletion", gameId: second.gameId, date: today, incomplete: true } })).toMatchObject({ ok: true, dayOutcome: { status: "marked_incomplete" } });
    const proposalId = randomUUID();
    expect(await runGameCommand({ ...chat, command: { type: "proposeChange", gameId: second.gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 } } })).toMatchObject({ ok: true });
    const shared = await readGameChatState(room, [a, b]);
    expect(shared.games.find(game => game.id === first.gameId)).toMatchObject({ pendingChange: null });
    expect(shared.games.find(game => game.id === second.gameId)).toMatchObject({ pendingChange: { id: proposalId } });
    expect(await runGameCommand({ ...chat, command: { type: "setDayCompletion", date: today, incomplete: true } })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("serializes concurrent room binding and reuses a route-less primary across games", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const games = await Promise.all([1, 2].map(() => startGame(a, b)));
    const rooms = [randomUUID(), randomUUID()];
    await getPrisma().hostedMember.createMany({ data: rooms.map(id => ({ id, billingStatus: "not_started" })) }); memberIds.push(...rooms);
    const bound = await Promise.all(games.map((game, index) => bindPairGameChat(game.gameId, [a, b], rooms[index]!)));
    expect(bound[0]).toBe(bound[1]);
    expect(rooms).toContain(bound[0]);
    const third = await startGame(a, b);
    expect(await bindPairGameChat(third.gameId, [a, b], null)).toBe(bound[0]);
    expect(await getPrisma().game.count({ where: { id: { in: [...games.map(game => game.gameId), third.gameId] }, chatContainerMemberId: bound[0] } })).toBe(3);
  });

  it("reserves one daily missed-game message for the pair across concurrent sweeps", async () => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const room = `synthetic_room_${randomUUID()}`;
    await getPrisma().hostedMember.create({ data: { id: room, billingStatus: "not_started" } }); memberIds.push(room);
    const games = await Promise.all([1, 2, 3].map(() => startGame(a, b, {}, "UTC")));
    const ids = games.map(game => game.gameId);
    await getPrisma().game.updateMany({ where: { id: { in: ids } }, data: { chatContainerMemberId: room } });
    await getPrisma().gamePlayer.updateMany({ where: { gameId: { in: ids } }, data: { dayOne: new Date("2030-03-04T00:00:00Z"), timeZone: "UTC" } });
    const [row] = await getPrisma().$queryRaw<Array<{ shard: bigint }>>`SELECT mod(abs(hashtext(${room})::bigint), 60) AS shard`;
    const now = new Date(Date.parse("2030-03-05T09:00:00Z") + Number(row.shard) * 60_000);
    try {
      const counts = await Promise.all([reserveDueGameMissedDayCheckIns(now), reserveDueGameMissedDayCheckIns(now)]);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
      const receipts = await getPrisma().hostedLinqDelivery.findMany({ where: { template: "game_missed", OR: ids.map(id => ({ sourceRef: { startsWith: `${id}:` } })) } });
      expect(receipts).toHaveLength(1);
      expect(await reserveDueGameMissedDayCheckIns(now)).toBe(0);
    } finally {
      await getPrisma().hostedLinqDelivery.deleteMany({ where: { template: "game_missed", OR: ids.map(id => ({ sourceRef: { startsWith: `${id}:` } })) } });
      await getPrisma().game.updateMany({ where: { id: { in: ids } }, data: { status: "settled", settledAt: now } });
    }
  });

  it.each([{ settles: "neither" }, { settles: "claimant" }, { settles: "other" }])("keeps the pair's one daily missed-game message after it is sent (settles: $settles)", async ({ settles }) => {
    const a = await member("Ava", "UTC"), b = await member("Leo", "UTC");
    const room = `synthetic_room_${randomUUID()}`;
    await getPrisma().hostedMember.create({ data: { id: room, billingStatus: "not_started" } }); memberIds.push(room);
    const games = await Promise.all([1, 2].map(() => startGame(a, b, {}, "UTC")));
    const ids = games.map(game => game.gameId);
    await getPrisma().game.updateMany({ where: { id: { in: ids } }, data: { chatContainerMemberId: room } });
    await getPrisma().gamePlayer.updateMany({ where: { gameId: { in: ids } }, data: { dayOne: new Date("2030-03-04T00:00:00Z"), timeZone: "UTC" } });
    const [row] = await getPrisma().$queryRaw<Array<{ shard: bigint }>>`SELECT mod(abs(hashtext(${room})::bigint), 60) AS shard`;
    const now = new Date(Date.parse("2030-03-05T09:00:00Z") + Number(row.shard) * 60_000);
    // Count only this pair's receipts: other tests' rooms can share the shard.
    const pending = () => getPrisma().hostedLinqDelivery.findMany({ where: { template: "game_missed", OR: ids.map(id => ({ sourceRef: { startsWith: `${id}:` } })) }, select: { id: true, sourceRef: true } });
    const sent: string[] = [];
    try {
      await reserveDueGameMissedDayCheckIns(now);
      const [first, ...rest] = await pending();
      expect(rest).toEqual([]);
      sent.push(first!.id);
      // Sending rewrites the receipt as a runtime delivery with a blinded source, as the provider dispatch does.
      await getPrisma().hostedLinqDelivery.update({ where: { id: first!.id }, data: { source: "hosted_runtime_linq_delivery", template: null, sourceRef: `hbid:synthetic:${randomUUID()}`, status: "sent_no_receipt_expected" } });
      // Either game may settle before the room's next shard sweep.
      const claimant = first!.sourceRef!.split(":")[0];
      const settling = settles === "claimant" ? claimant : settles === "other" ? ids.find(id => id !== claimant) : undefined;
      if (settling) await getPrisma().game.update({ where: { id: settling }, data: { status: "settled", settledAt: new Date(now.getTime() + 30 * 60_000) } });
      // The room's shard comes round again an hour later, still inside the two-hour window.
      await reserveDueGameMissedDayCheckIns(new Date(now.getTime() + 60 * 60_000));
      expect(await pending()).toEqual([]);
    } finally {
      await getPrisma().hostedLinqDelivery.deleteMany({ where: { OR: [{ id: { in: sent } }, { template: "game_missed", OR: ids.map(id => ({ sourceRef: { startsWith: `${id}:` } })) }] } });
      await getPrisma().game.updateMany({ where: { id: { in: ids } }, data: { status: "settled", settledAt: now } });
    }
  });

  it("orders Home: waiting on you today, other live games, invites, then results", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const kat = await member("Kat", "Europe/London");
    const ben = await member("Ben", "UTC");
    const settled = await startGame(leo, ben);
    await devSettleNow(settled.gameId, leo);
    const posted = await startGame(leo, kat);
    await devStartNow(posted.gameId, leo);
    await ok(leo, await photo(leo, posted.gameId, "done-today"));
    const waiting = await startGame(leo, ava);
    await devStartNow(waiting.gameId, leo);
    const invite = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ben", terms: TERMS, type: "createGame" });

    expect((await readHome(leo)).games.map((game) => game.id)).toEqual([waiting.gameId, posted.gameId, invite!.id, settled.gameId]);
  });

  it("lands the same post sent twice at once exactly once", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const { gameId } = await startGame(leo, ava);
    await devStartNow(gameId, leo);
    const shot = await photo(leo, gameId, "twice");

    const results = await Promise.all([run(leo, shot), run(leo, shot)]);

    expect(results.every((result) => result.ok)).toBe(true);
    const entries = await getPrisma().gameEntry.findMany({ where: { gameId, memberId: leo } });
    // One post, not a post and a retake of itself.
    expect(entries.map((entry) => [entry.attempt, entry.withdrawnAt])).toEqual([[1, null]]);
    expect(await getPrisma().gameEvent.count({ where: { gameId, type: "posted" } })).toBe(1);
  });

  it("shows open games and the three latest settled ones at home", async () => {
    const leo = await member("Leo", "America/New_York");
    const ava = await member("Ava", "Australia/Sydney");
    const settledIds: string[] = [];
    for (let round = 0; round < 4; round += 1) {
      const { gameId } = await startGame(leo, ava);
      await devSettleNow(gameId, leo);
      settledIds.push(gameId);
    }
    const open = await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", terms: TERMS, type: "createGame" });

    const home = await readHome(leo);
    expect(home.games.map((game) => game.id).sort()).toEqual([open!.id, ...settledIds.slice(1)].sort());
  });

  it("bounds populated history round trips through native auth and signing", async () => {
    const { performance } = await import("node:perf_hooks");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { runWithPrismaOperationTimings } = await import("../src/lib/prisma-operation-timing");
    const { hostedAuthAdapter } = await import("../src/lib/better-auth/adapter");
    const { serializeHostedNativeSessionToken } = await import("../src/lib/better-auth/transport");
    const { runWithHostedDomainRootUnwrapCache, getHostedDomainRootUnwrapCache } = await import("../src/lib/hosted-crypto/domain-root-unwrap-cache");
    const { GET } = await import("../app/api/game/v1/history/route");
    const { requireGameMember } = await import("../src/lib/game/http/auth");
    const crypto = await import("../src/lib/game/crypto");
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 9).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "http://localhost:3237");
    const { setHostedSecureBoxStringTestCodecForTests } = await import("../src/lib/hosted-crypto/secure-box");
    const holder = globalThis as typeof globalThis & { __murphHostedSecureBoxStringTestCodec?: Parameters<typeof setHostedSecureBoxStringTestCodecForTests>[0] };
    const codec = holder.__murphHostedSecureBoxStringTestCodec ?? null;
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      const { getHostedWebCryptoConfig } = await import("../src/lib/hosted-crypto/env");
      const kmsClient = getHostedWebCryptoConfig().gcpKms;
      const decrypt = kmsClient.decrypt.bind(kmsClient);
      const kms = vi.spyOn(kmsClient, "decrypt").mockImplementation(async input => {
        if (process.env.MURPH_GAME_HISTORY_BENCH_LATENCY === "1") await new Promise(resolve => setTimeout(resolve, 53));
        return decrypt(input);
      });
      const viewer = await member("BenchmarkViewer", "UTC", true);
      const token = randomUUID().replaceAll("-", "");
      const adapter = hostedAuthAdapter(getPrisma())({});
      const dates = { createdAt: new Date(), updatedAt: new Date() };
      await adapter.create({ model: "user", forceAllowId: true,
        data: { id: viewer, email: `${viewer}@example.test`, emailVerified: true, name: "", ...dates } });
      await adapter.create({ model: "session", forceAllowId: true, data: {
        id: `session-${viewer}`, userId: viewer, token, expiresAt: new Date(Date.now() + 3_600_000), ...dates,
      } });
      for (let person = 0; person < 4; person++) {
        const opponent = await member(`BenchmarkOpponent${person}`, "UTC", true);
        for (let round = 0; round < 3; round++) {
          await seedSettledGame({ challenger: viewer, opponent, mediaDays: 3,
            settledAt: new Date(Date.UTC(2030, 1, person + 1, round)), scores: [5, 3] });
        }
      }
      vi.spyOn(gameMedia, "servesSignedGameMedia").mockReturnValue(true);
      const sign = vi.spyOn(gameMedia, "gameMediaDelivery").mockImplementation(async () => {
        if (process.env.MURPH_GAME_HISTORY_BENCH_LATENCY === "1") await new Promise(resolve => setTimeout(resolve, 128));
        return { url: "https://imagedelivery.net/account/image/gamethumb?exp=9999999999&sig=synthetic",
          expiresAt: "2030-01-01T00:00:00.000Z" };
      });
      const open = vi.spyOn(crypto, "openGameTexts");
      const request = new Request("http://localhost/api/game/v1/history", {
        headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}` },
      });
      const samples: unknown[] = [];
      const benchmark = process.env.MURPH_GAME_HISTORY_BENCH === "1";
      for (let run = 0; run < (benchmark ? 11 : 2); run++) {
        performance.clearMeasures(); open.mockClear(); sign.mockClear(); kms.mockClear();
        const operations: import("../src/lib/prisma-operation-timing").PrismaOperationTiming[] = [];
        const queries: import("../src/lib/prisma-operation-timing").PrismaQueryTiming[] = [];
        const sample: Record<string, unknown> = {};
        const started = performance.now();
        await runWithPrismaOperationTimings(operations, async () => {
          const history = await runWithHostedDomainRootUnwrapCache(async () => {
            let at = performance.now();
            expect(await requireGameMember(request)).toBe(viewer);
            sample.auth = performance.now() - at;
            sample.authQueries = queries.length;
            at = performance.now();
            const history = await readHistory(viewer);
            sample.read = performance.now() - at;
            sample.readQueries = queries.length - Number(sample.authQueries);
            return history;
          });
          expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
          const at = performance.now();
          const signed = await withHistoryPhotoDeliveries(history, viewer);
          sample.signing = performance.now() - at;
          sample.signingQueries = queries.length - Number(sample.authQueries) - Number(sample.readQueries);
          expect(signed.people).toHaveLength(4);
          expect(signed.people.every(person => person.games.length === 3)).toBe(true);
          expect(sign).toHaveBeenCalledTimes(24);
        }, undefined, queries);
        sample.total = performance.now() - started;
        sample.steps = Object.fromEntries(performance.getEntriesByType("measure")
          .filter(entry => entry.name.startsWith("history-bench:"))
          .map(entry => [entry.name.replace("history-bench:", ""), entry.duration]));
        sample.operations = operations;
        sample.queries = queries.length;
        sample.kmsCalls = kms.mock.calls.length;
        expect(sample.authQueries).toBe(5);
        expect(sample.readQueries).toBe(9);
        expect(sample.signingQueries).toBe(4);
        expect(sample.kmsCalls).toBe(5);
        sample.decryptFields = open.mock.calls.flatMap(([entries]) => entries.filter(entry => entry.value)).length;
        if (run > 0) samples.push(sample);
      }
      kms.mockClear();
      const response = await GET(request);
      expect(response.status).toBe(200);
      expect((await response.json()).people).toHaveLength(4);
      expect(kms).toHaveBeenCalledTimes(5);
      expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
      // A later request must re-read revocation, never reuse an authenticated session.
      await getPrisma().hostedAuthRecord.deleteMany({ where: { model: "session", memberId: viewer } });
      expect((await GET(request)).status).toBe(401);
      expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
      if (benchmark) {
        await mkdir(".tmp/game-history-speed", { recursive: true });
        await writeFile(".tmp/game-history-speed/benchmark.json", JSON.stringify(samples, null, 2));
      }
    } finally {
      setHostedSecureBoxStringTestCodecForTests(codec);
      vi.unstubAllEnvs();
    }
  });

  it("orders settled history, counts each side's record, and keeps previews viewer-scoped to their game", async () => {
    const viewer = await member("HistoryViewer", "UTC");
    const ava = await member("HistoryAva", "UTC");
    const ben = await member("HistoryBen", "UTC");
    const now = Date.now();
    const first = await seedSettledGame({ challenger: viewer, opponent: ava,
      settledAt: new Date(now - 5 * 3_600_000), scores: [4, 2] });
    const second = await seedSettledGame({ challenger: viewer, opponent: ava,
      settledAt: new Date(now - 4 * 3_600_000), scores: [1, 3] });
    const third = await seedSettledGame({ challenger: viewer, opponent: ava,
      settledAt: new Date(now - 3 * 3_600_000), scores: [5, 2], mediaDays: 1 });
    const latest = await seedSettledGame({ challenger: viewer, opponent: ava,
      settledAt: new Date(now - 2 * 3_600_000), scores: [7, 7], misses: [0, 0], mediaDays: 4 });
    const benGame = await seedSettledGame({ challenger: viewer, opponent: ben,
      settledAt: new Date(now - 3_600_000), scores: [2, 4] });
    const avatarKey = `game/${ava}/${randomUUID()}.jpg`;
    await getPrisma().gameProfile.update({ where: { memberId: ava }, data: { photoKey: avatarKey } });
    await getPrisma().gameReport.create({ data: {
      id: randomUUID(), reporterMemberId: viewer, reportedMemberId: ava,
      gameId: latest.gameId, entryId: latest.entryIds[1], about: "post", reason: "other",
    } });

    const history = await readHistory(viewer);
    expect(history.people.map((person) => person.memberId)).toEqual([ben, ava]);
    expect(history.people[0]).toMatchObject({ memberId: ben, record: { won: 0, lost: 1, tied: 0 },
      games: [{ id: benGame.gameId, result: "lost", perfect: false, score: { mine: 2, theirs: 4 } }] });
    const withAva = history.people[1];
    expect(withAva).toMatchObject({
      memberId: ava,
      firstName: "HistoryAva",
      avatarUrl: `/api/game/v1/media/${encodeURIComponent(avatarKey)}`,
      record: { won: 2, lost: 1, tied: 1 },
    });
    expect(withAva.games.map((game) => game.id)).toEqual([latest.gameId, third.gameId, second.gameId, first.gameId]);
    expect(withAva.games[0]).toMatchObject({
      startedOn: "2030-01-01",
      endsOn: "2030-01-07",
      lengthDays: 7,
      result: "tied",
      perfect: true,
      score: { mine: 7, theirs: 7 },
      schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
    });
    expect(withAva.games[0].previews).toHaveLength(6);
    expect(withAva.games[0].previews.map((preview) => preview.mine)).toEqual([true, true, false, true, false, true]);
    expect(JSON.stringify(withAva.games[0].previews)).not.toContain(latest.mediaKeys[1]);
    expect(JSON.stringify(withAva.games[0].previews)).not.toContain(third.mediaKeys[0]);

    const otherSide = await readHistory(ava);
    expect(otherSide.people).toHaveLength(1);
    expect(otherSide.people[0].games[0].tasks).toEqual({ mine: "10 min abs", theirs: "100 pushups" });
    expect(otherSide.people[0]).toMatchObject({ memberId: viewer, record: { won: 1, lost: 2, tied: 1 } });
  });

  it("loads six photos from seven photo days even when each day also has words", async () => {
    const viewer = await member("PhotoViewer", "UTC");
    const opponent = await member("PhotoOpponent", "UTC");
    const game = await seedSettledGame({ challenger: viewer, opponent, settledAt: new Date(), mediaDays: 7 });
    await getPrisma().gameEntry.updateMany({
      where: { gameId: game.gameId, memberId: viewer }, data: { kind: "words", mediaKeys: [] },
    });
    const previews = (await readHistory(viewer)).people[0].games[0].previews;
    expect(previews.map(preview => preview.entryId)).toEqual([1, 3, 5, 7, 9, 11].map(index => game.entryIds[index]));
    expect(previews.every(preview => preview.kind === "photo")).toBe(true);
  });

  it("prefers photos in mixed history previews, excludes invisible words, and signs only photos", async () => {
    const viewer = await member("WordsViewer", "UTC");
    const opponent = await member("WordsOpponent", "UTC");
    const game = await seedSettledGame({ challenger: viewer, opponent, settledAt: new Date(), mediaDays: 5 });
    // Four photos take priority; the earliest visible words fill the remaining slots.
    const wordsIndexes = [0, 1, 3, 5, 6, 7];
    for (const index of wordsIndexes) {
      const memberId = index % 2 === 0 ? viewer : opponent;
      const textEncrypted = await sealGameText({ table: "game_entry", field: "text", memberId, rowId: game.entryIds[index] }, `Walk complete ${index}.`);
      await getPrisma().gameEntry.update({ where: { id: game.entryIds[index] }, data: { kind: "words", mediaKeys: [], textEncrypted } });
    }
    await getPrisma().gameReport.create({ data: {
      id: randomUUID(), reporterMemberId: viewer, reportedMemberId: opponent,
      gameId: game.gameId, entryId: game.entryIds[1], about: "post", reason: "other",
    } });
    await getPrisma().gameEntry.update({ where: { id: game.entryIds[3] }, data: { withdrawnAt: new Date() } });
    await getPrisma().gameEntry.update({ where: { id: game.entryIds[5] }, data: { attempt: 0, kind: "excuse" } });
    const history = await readHistory(viewer);
    const previews = history.people[0].games[0].previews;
    expect(previews.map(preview => preview.entryId)).toEqual([0, 2, 4, 6, 8, 9].map(index => game.entryIds[index]));
    expect(previews.map(preview => preview.kind)).toEqual(["words", "photo", "photo", "words", "photo", "photo"]);
    expect(previews[0]).toEqual({ entryId: game.entryIds[0], kind: "words", mediaUrls: [], text: "Walk complete 0.", data: null, mine: true });
    // Reports are viewer-specific; withdrawn and hidden opponent entries stay out.
    const otherSide = await readHistory(opponent);
    expect(otherSide.people[0].games[0].previews.map(preview => preview.entryId)).toEqual([0, 1, 2, 4, 8, 9].map(index => game.entryIds[index]));
    vi.spyOn(gameMedia, "servesSignedGameMedia").mockReturnValue(true);
    const delivery = { url: "https://example.com/synthetic-photo", expiresAt: "2030-01-01T00:00:00.000Z" };
    const sign = vi.spyOn(gameMedia, "gameMediaDelivery").mockResolvedValue(delivery);
    const signed = await withHistoryPhotoDeliveries(history, viewer);
    expect(sign.mock.calls.map(([key]) => key)).toEqual([2, 4, 8, 9].map(index => game.mediaKeys[index]));
    for (const preview of signed.people[0].games[0].previews) {
      expect(preview.delivery).toEqual(preview.kind === "photo" ? delivery : undefined);
    }
  });

  it("opens history terms in the existing batch without opening recaps or relationships", async () => {
    const viewer = await member("ProjectionViewer", "UTC");
    const opponent = await member("ProjectionOpponent", "UTC");
    const seeded = await seedSettledGame({ challenger: viewer, opponent, settledAt: new Date(), mediaDays: 3 });
    const before = await readHistory(viewer);
    // These encrypted fields belong to the live/detail view, never history JSON.
    await getPrisma().game.update({ where: { id: seeded.gameId }, data: {
      recapEncrypted: "not-opened-by-history",
    } });
    await getPrisma().gameContactLabel.create({ data: { ownerMemberId: viewer,
      subjectMemberId: opponent, relationshipEncrypted: "not-opened-by-history" } });
    const crypto = await import("../src/lib/game/crypto");
    const open = vi.spyOn(crypto, "openGameTexts");
    expect(await readHistory(viewer)).toEqual(before);
    const fields = open.mock.calls.flatMap(([requests]) => requests).map(request => request.field);
    expect(open).toHaveBeenCalledTimes(1);
    expect(fields.filter(field => field === "terms_words")).toHaveLength(1);
    expect(before.people[0].games[0]).toMatchObject({
      tasks: { mine: "100 pushups", theirs: "10 min abs" },
      stake: { kind: "prize", item: "Breakfast in bed" },
    });
    for (const unused of ["recap", "relationship"]) expect(fields).not.toContain(unused);
  });

  it("signs only authorized history previews, excluding reported, withdrawn, blocked and non-player content", async () => {
    const viewer = await member("DeliveryViewer", "UTC");
    const opponent = await member("DeliveryOpponent", "UTC");
    const outsider = await member("DeliveryOutsider", "UTC");
    const game = await seedSettledGame({ challenger: viewer, opponent, settledAt: new Date(), mediaDays: 4 });
    await getPrisma().gameReport.create({ data: {
      id: randomUUID(), reporterMemberId: viewer, reportedMemberId: opponent,
      gameId: game.gameId, entryId: game.entryIds[1], about: "post", reason: "other",
    } });
    await getPrisma().gameEntry.update({ where: { id: game.entryIds[3] }, data: { withdrawnAt: new Date() } });
    vi.spyOn(gameMedia, "servesSignedGameMedia").mockReturnValue(true);
    const delivery = { url: "https://imagedelivery.net/account/image/gamethumb?exp=9999999999&sig=synthetic", expiresAt: "2030-01-01T00:00:00.000Z" };
    const sign = vi.spyOn(gameMedia, "gameMediaDelivery").mockResolvedValue(delivery);
    const history = await readHistory(viewer);
    const previewKeys = history.people[0].games[0].previews.map(preview => decodeURIComponent(preview.mediaUrls[0].split("/media/")[1]));
    expect(await authorizeMediaReads(viewer, [...previewKeys, previewKeys[0], "invalid"])).toEqual(new Set(previewKeys));
    const signed = await withHistoryPhotoDeliveries(history, viewer);
    expect(signed.people[0].games[0].previews).toHaveLength(6);
    expect(signed.people[0].games[0].previews.every((preview) => preview.delivery?.url === delivery.url)).toBe(true);
    expect(sign).toHaveBeenCalledTimes(6);
    expect(sign).not.toHaveBeenCalledWith(game.mediaKeys[1], "thumb");
    expect(sign).not.toHaveBeenCalledWith(game.mediaKeys[3], "thumb");
    sign.mockClear();
    expect(await withHistoryPhotoDeliveries(await readHistory(outsider), outsider)).toEqual({ people: [] });
    await withHistoryPhotoDeliveries(history, outsider);
    expect(sign).not.toHaveBeenCalled();

    const visibleOther = history.people[0].games[0].previews.find(preview => !preview.mine)!;
    await getPrisma().gameReport.create({ data: {
      id: randomUUID(), reporterMemberId: viewer, reportedMemberId: opponent,
      gameId: game.gameId, entryId: visibleOther.entryId, about: "post", reason: "other",
    } });
    const reportedLater = await withHistoryPhotoDeliveries(history, viewer);
    expect(reportedLater.people[0].games[0].previews.find(preview => preview.entryId === visibleOther.entryId)?.delivery).toBeUndefined();
    sign.mockClear();

    await ok(opponent, { memberId: viewer, type: "block" });
    expect(await withHistoryPhotoDeliveries(await readHistory(viewer), viewer)).toEqual({ people: [] });
    expect(sign).not.toHaveBeenCalled();
    // If a block lands after history assembly, media authorization still hides
    // the opponent's pictures. The media route permits one's own uploads.
    const changed = await withHistoryPhotoDeliveries(history, viewer);
    expect(changed.people[0].games[0].previews.filter((preview) => !preview.mine)
      .every((preview) => !preview.delivery)).toBe(true);
    expect(sign.mock.calls.every(([key]) => key.startsWith(`game/${viewer}/`))).toBe(true);
  });

  it("leaves blocked people and every non-settled status out of history", async () => {
    const viewer = await member("HistoryFilterViewer", "UTC");
    const blocked = await member("HistoryBlocked", "UTC");
    const blockedGame = await seedSettledGame({ challenger: viewer, opponent: blocked, settledAt: new Date() });
    await ok(viewer, { memberId: blocked, type: "block" });
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: blockedGame.gameId } })).toMatchObject({ status: "settled" });
    // Someone who blocked the viewer is left out too, before the people cap counts them.
    const blocker = await member("HistoryBlocker", "UTC");
    await seedSettledGame({ challenger: viewer, opponent: blocker, settledAt: new Date() });
    await ok(blocker, { memberId: viewer, type: "block" });

    for (const status of ["void", "invited", "negotiating", "live"] as const) {
      const opponent = await member(`History${status}`, "UTC");
      const seeded = await seedSettledGame({ challenger: viewer, opponent, settledAt: new Date() });
      await getPrisma().game.update({ where: { id: seeded.gameId }, data: {
        status,

        result: Prisma.DbNull,
        settledAt: null,
      } });
    }

    expect(await readHistory(viewer)).toEqual({ people: [] });
  });

  it("caps history at fifty people and fifty games per person", async () => {
    const viewer = await member("HistoryCapViewer", "UTC");
    const frequent = await member("HistoryFrequent", "UTC");
    const now = Date.now();
    const frequentIds: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      frequentIds.push((await seedSettledGame({ challenger: viewer, opponent: frequent,
        settledAt: new Date(now - (100 - index) * 1000) })).gameId);
    }
    const frequentHistory = await readHistory(viewer);
    expect(frequentHistory.people).toHaveLength(1);
    expect(frequentHistory.people[0].games).toHaveLength(50);
    expect(frequentHistory.people[0].games.map((game) => game.id)).not.toContain(frequentIds[0]);

    for (let index = 0; index < 51; index += 1) {
      const opponent = await member(`HistoryCap${index}`, "UTC");
      await seedSettledGame({ challenger: viewer, opponent,
        settledAt: new Date(now + index * 1000) });
    }
    const peopleHistory = await readHistory(viewer);
    expect(peopleHistory.people).toHaveLength(50);
    expect(peopleHistory.people.every((person) => person.games.length <= 50)).toBe(true);
    expect(new Set(peopleHistory.people.map((person) => person.memberId)).size).toBe(50);
  });

  it("voids an unclaimed invite past its expiry on the next read and keeps it on Home for a week", async () => {
    const kat = await member("Kat", "Europe/London");
    const invite = async (expiredMsAgo: number) => {
      const gameId = randomUUID();
      await ok(kat, { gameId, inviteeFirstName: "Leo", terms: TERMS, type: "createGame" });
      await getPrisma().game.update({ data: { inviteExpiresAt: new Date(Date.now() - expiredMsAgo) }, where: { id: gameId } });
      return gameId;
    };
    const hour = 60 * 60 * 1000;
    const gameId = await invite(60_000);
    expect((await readHome(kat)).games.map((game) => [game.id, game.status])).toEqual([[gameId, "void"]]);
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ status: "void" });
    expect((await getPrisma().gameEvent.findMany({ orderBy: { id: "asc" }, where: { gameId } })).map((event) => [event.type, event.actor]))
      .toEqual([["created", kat], ["expired", "system"]]);

    // At most the three latest, and nothing older than a week.
    const [oneHour, twoHours] = [await invite(hour), await invite(2 * hour)];
    await invite(3 * hour);
    await invite(8 * 24 * hour);
    expect((await readHome(kat)).games.map((game) => game.id).sort()).toEqual([gameId, oneHour, twoHours].sort());
  });
});

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres") && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
