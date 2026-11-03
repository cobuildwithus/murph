import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import { createHostedEmailLookupKey, createHostedExternalThreadIdentityLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { areGameGroupsEnabled } from "@/src/lib/game/access";
import { gameAudienceKeys } from "@/src/lib/game/audience";
import { runGameCommand, readGame, readHome, readGameChatState, runGameChatUpdate, readGameRecapMaterial, authorizeMediaRead } from "@/src/lib/game/service";
import { openGameTexts } from "@/src/lib/game/crypto";
import { parseStoredResult, canRedeemGroupTicket } from "@/src/lib/game/rules";
import { dayStartInstant, GAME_GRACE_MS } from "@/src/lib/game/time";
import { prepareGameAccountDeletion, applyGameAccountDeletionTx } from "@/src/lib/game/account-deletion";
import type { GameCommand, GameTerms } from "@/src/lib/game/command";

const chatProof = vi.hoisted(() => ({ rooms: new Map<string, string[]>(), sender: "", wake: null as unknown }));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async importOriginal => ({
  ...await importOriginal<object>(),
  readHostedThreadContainerLinqRouteAuthorities: async ({ containerMemberIds }: { containerMemberIds: string[] }) => ({ authorities: new Map(containerMemberIds.filter(id => chatProof.rooms.has(id)).map(id => [id, { channel: "linq", threadId: id, containerMemberId: id, accountLookupKey: "synthetic-line" }])) }),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async importOriginal => ({
  ...await importOriginal<object>(), getHostedLinqChatSummary: async ({ chatId }: { chatId: string }) => ({ isGroup: true, handlesComplete: true,
    handles: [{ handle: "+15555550100", isMe: true, status: "active" }, ...(chatProof.rooms.get(chatId) ?? []).map(handle => ({ handle, isMe: false, status: "active" }))] }),
}));
vi.mock("@/src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: async () => {} }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: async () => {} }));
vi.mock("@/src/lib/hosted-routing/thread-route-store", async importOriginal => ({ ...await importOriginal<object>(), assertHostedThreadRouteEgressAuthority: async () => {} }));
vi.mock("@/src/lib/hosted-groups/group-message-sender", () => ({ resolveHostedGroupMessageSenderMemberId: async () => chatProof.sender }));
vi.mock("@/src/lib/hosted-mailbox/store", async importOriginal => ({ ...await importOriginal<object>(), readHostedMailboxConversationWakeByAssistantInputId: async () => chatProof.wake }));
vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async importOriginal => ({
  ...await importOriginal<object>(), readHostedLinqIncomingLineState: async () => ({ kind: "assignable" }), listHostedLinqHealthyProactiveLines: async () => [{ phoneNumber: "+15555550100" }],
}));
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


vi.mock("@/src/lib/game/report-alert", () => ({ GAME_REPORT_ALERTS_PER_REPORTER_DAY: 10, sendGameReportAlert: vi.fn() }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const db = getPrisma();
const ids: string[] = [];
const createdAt = new Date("2030-03-01T12:00:00Z");
const terms: GameTerms = { startsOn: "2030-03-09", lengthDays: 10, schedule: { count: 10 }, defaultTask: "Take a walk",
  tasks: [], stakes: [{ kind: "prize", item: "Choose our next outing" }] };
type Person = { id: string; email: string };
async function person(zone = "UTC"): Promise<Person> {
  const id = `group_test_${randomUUID()}`;
  const email = `${randomUUID()}@example.test`;
  ids.push(id);
  await db.hostedMember.create({ data: { id } });
  await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: id, prisma: tx, verifiedEmail: { address: email, verifiedAt: createdAt } }));
  await ok(id, { type: "setProfile", firstName: "Player", timeZone: zone });
  return { id, email };
}
async function run(actor: string, command: GameCommand, now = createdAt) {
  return runGameCommand({ actorMemberId: actor, command, now, multiplayer: true });
}
async function ok(actor: string, command: GameCommand, now = createdAt) {
  const result = await run(actor, command, now);
  if (!result.ok) throw new Error(`${command.type}: ${result.error.code}`);
  return result.game;
}
async function create(starter: Person, targets: Person[], override: Partial<Extract<GameCommand, { type: "createGame" }>> = {}) {
  const view = await ok(starter.id, { type: "createGame", gameId: randomUUID(), maxPlayers: 10, groupWord: "Crew", terms,
    ...(targets.length ? { invitees: targets.map((target, index) => ({ seat: index + 1, recipient: { kind: "email" as const, value: target.email }, firstName: "Teammate" })) } : {}), ...override });
  if (!view?.inviteToken) throw new Error("Missing group invitation");
  return { id: view.id, token: view.inviteToken };
}
function join(token: string, timeZone = "UTC", termsVersion = 1): GameCommand { return { type: "join", token, timeZone, termsVersion }; }
async function gameRow(id: string) { return db.game.findUniqueOrThrow({ where: { id }, include: { players: { orderBy: { seat: "asc" } }, invitees: { orderBy: { seat: "asc" } }, tickets: true } }); }
async function entry(gameId: string, memberId: string, dayIndex: number) {
  return db.gameEntry.create({ data: { id: randomUUID(), gameId, memberId, dayIndex, attempt: 1, kind: "words", mediaKeys: [], receivedAt: createdAt } });
}
async function settle(id: string, actor: string, at = new Date("2030-04-01T12:00:00Z")) {
  expect(await run(actor, { type: "leave", gameId: id }, at)).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
  return gameRow(id);
}
async function erase(memberId: string) {
  const prepared = await prepareGameAccountDeletion({ memberIds: [memberId], prisma: db });
  await db.$transaction(tx => applyGameAccountDeletionTx({ memberIds: [memberId], prepared, tx, now: createdAt }));
  await db.hostedMember.delete({ where: { id: memberId } });
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => {
  if (!enabled) return;
  // Delete the large synthetic entry fixture in one set before roster cascades.
  await db.gameEntry.deleteMany({ where: { memberId: { in: ids } } });
  await db.game.deleteMany({ where: { wordsOwnerMemberId: { in: ids } } });
  await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: ids } } });
  await db.hostedMember.deleteMany({ where: { id: { in: ids } } });
});

describe("group admission switch and audience keys", () => {
  it("is dark by default in production and honors explicit switches", () => {
    expect(areGameGroupsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(areGameGroupsEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(areGameGroupsEnabled({ NODE_ENV: "production", MURPH_GAME_GROUPS_ENABLED: "true" })).toBe(true);
    expect(areGameGroupsEnabled({ NODE_ENV: "test", MURPH_GAME_GROUPS_ENABLED: "false" })).toBe(false);
  });
  it("normalizes exact sets, rotates with readable keys, and fails closed after retirement", () => {
    const handles = [{ kind: "email" as const, value: "One@EXAMPLE.test" }, { kind: "email" as const, value: "two@example.test" }];
    const first = gameAudienceKeys(handles);
    expect(gameAudienceKeys([...handles].reverse())).toEqual(first);
    expect(first.current).toMatch(/^hbidx:game-audience:v1:/u);
    expect(first.current).not.toBe(createHostedEmailLookupKey(JSON.stringify(handles)));
    expect(() => gameAudienceKeys([handles[0], { ...handles[0], value: "one@example.test" }])).toThrow();
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64url")},v2:${Buffer.alloc(32, 8).toString("base64url")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    expect(gameAudienceKeys(handles).candidates).toContain(first.current);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v2:${Buffer.alloc(32, 8).toString("base64url")}`);
    expect(gameAudienceKeys(handles).candidates).not.toContain(first.current);
  });
});

describe.skipIf(!enabled)("group lifecycle PostgreSQL", () => {
  it("keeps one starter indefinitely invited and activates only on the second acceptance", async () => {
    const a = await person(), b = await person();
    const game = await create(a, [b]);
    expect(await gameRow(game.id)).toMatchObject({ status: "invited", inviteExpiresAt: null, maxPlayers: 10, players: [{ memberId: a.id, seat: 0, joinedAt: createdAt }] });
    await ok(b.id, join(game.token), new Date("2030-05-01T21:00:00Z"));
    const row = await gameRow(game.id);
    expect(row.status).toBe("live");
    expect(row.players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(["2030-05-02", "2030-05-02"]);
    await ok(a.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms: { ...terms, defaultTask: "Walk outside" } }, new Date("2030-05-01T22:00:00Z"));
    expect((await gameRow(game.id)).players.map(player => player.dayOne)).toEqual(row.players.map(player => player.dayOne));
    expect(row.invitees[0]).toMatchObject({ memberId: b.id, seat: 1, pendingLabel: null });
    expect(await db.gameContactLabel.findUnique({ where: { ownerMemberId_subjectMemberId: { ownerMemberId: a.id, subjectMemberId: b.id } } })).not.toBeNull();
  });

  it("admits exactly a tenth player in a race, preserves addressed seats and never rejoins", async () => {
    const players = await Promise.all(Array.from({ length: 12 }, () => person()));
    const game = await create(players[0], players.slice(1, 3));
    for (const player of players.slice(1, 9)) await ok(player.id, join(game.token));
    const results = await Promise.all(players.slice(9, 11).map(player => run(player.id, join(game.token))));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toMatchObject([{ error: { code: "INVITE_USED" } }]);
    const row = await gameRow(game.id);
    expect(row.players).toHaveLength(10);
    expect(row.players.map(player => player.seat)).toEqual([0, 1, 2, 10, 11, 12, 13, 14, 15, 16]);
    await ok(players[1].id, { type: "leave", gameId: game.id });
    await ok(players[1].id, { type: "leave", gameId: game.id });
    expect(await run(players[1].id, join(game.token))).toMatchObject({ ok: false, error: { code: "INVITE_USED" } });
    expect(await run(players[11].id, join(game.token))).toMatchObject({ ok: false, error: { code: "INVITE_USED" } });
    expect((await gameRow(game.id)).players).toHaveLength(10);
  });

  it("resolves a newly registered addressed handle to its invitation seat", async () => {
    const a = await person();
    const b = { id: `group_test_${randomUUID()}`, email: `${randomUUID()}@example.test` };
    const game = await create(a, [b]);
    expect((await gameRow(game.id)).invitees[0]).toMatchObject({ memberId: null, recipientLookupKey: createHostedEmailLookupKey(b.email) });
    ids.push(b.id);
    await db.hostedMember.create({ data: { id: b.id } });
    await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: b.id, prisma: tx, verifiedEmail: { address: b.email, verifiedAt: createdAt } }));
    await ok(b.id, { type: "setProfile", firstName: "Player", timeZone: "UTC" });
    const { readInvitePreview } = await import("@/src/lib/game/service");
    expect(await readInvitePreview(game.token, true, b.id)).toMatchObject({ yourTask: "Take a walk" });
    await ok(b.id, join(game.token));
    expect((await gameRow(game.id)).players[1].seat).toBe(1);
  });

  it("serializes the ten-open-game audience limit and rejects duplicate handles or people", async () => {
    const a = await person(), b = await person();
    const attempts = await Promise.all(Array.from({ length: 11 }, () => run(a.id, { type: "createGame", gameId: randomUUID(), maxPlayers: 10,
      groupWord: "Crew", terms, invitees: [{ seat: 1, firstName: "Player", recipient: { kind: "email", value: b.email } }] })));
    expect(attempts.filter(result => result.ok)).toHaveLength(10);
    expect(attempts.filter(result => !result.ok)).toMatchObject([{ error: { code: "TOO_MANY_GAMES" } }]);
    const rows = await db.game.findMany({ where: { createdBy: a.id }, select: { audienceKey: true } });
    expect(new Set(rows.map(row => row.audienceKey)).size).toBe(1);
    await expect(create(a, [b, b])).rejects.toThrow("INVALID_REQUEST");
    await expect(create(a, [a])).rejects.toThrow("INVALID_REQUEST");
  });

  it("locks pre-Day-1 edits against stale joins and rejects edits at the first local Day 1", async () => {
    const a = await person("Pacific/Kiritimati"), b = await person(), c = await person();
    const game = await create(a, [b, c]);
    await ok(b.id, join(game.token));
    const edit: GameCommand = { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms: { ...terms, defaultTask: "Walk outside" } };
    const outcomes = await Promise.all([run(a.id, edit), run(a.id, edit)]);
    expect(outcomes.filter(result => result.ok)).toHaveLength(1);
    expect(outcomes.filter(result => !result.ok)).toMatchObject([{ error: { code: "TERMS_CHANGED" } }]);
    expect(await run(c.id, join(game.token))).toMatchObject({ ok: false, error: { code: "TERMS_CHANGED" } });
    const boundary = dayStartInstant("2030-03-09", "Pacific/Kiritimati");
    const race = await Promise.all([run(a.id, { ...edit, expectedTermsVersion: 2 }, boundary), run(c.id, join(game.token, "UTC", 2), boundary)]);
    expect(race[0]).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    expect(race[1].ok).toBe(true);
    expect((await gameRow(game.id)).players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(["2030-03-09", "2030-03-09", "2030-03-09"]);
    expect(await run(b.id, { ...edit, expectedTermsVersion: 2 })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
  });

  it("reschedules a retained leaver with the shared calendar before scoring and later admission", async () => {
    const [a, b, c, late] = await Promise.all([person(), person(), person(), person()]);
    const initial: GameTerms = { ...terms, startsOn: "2030-03-11", lengthDays: 7, schedule: { days: [0, 2] } };
    const game = await create(a, [b, c], { terms: initial });
    await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    await ok(b.id, { type: "leave", gameId: game.id });
    await ok(a.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms: { ...initial, startsOn: "2030-03-13" } });
    const changed = await gameRow(game.id);
    expect(changed.players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(Array(3).fill("2030-03-13"));
    expect(changed.players[1]).toMatchObject({ leftAt: createdAt, joinedAt: createdAt });
    expect(await readGame(game.id, b.id, true)).toBeNull();
    const post = (actor: string, now: Date) => run(actor, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done" }, now);
    expect(await post(b.id, new Date("2030-03-13T12:00:00Z"))).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect((await post(a.id, new Date("2030-03-13T12:00:00Z"))).ok).toBe(true);
    expect((await post(c.id, new Date("2030-03-18T12:00:00Z"))).ok).toBe(true);
    await ok(late.id, join(game.token, "UTC", 2), new Date("2030-03-18T12:00:00Z"));
    expect((await gameRow(game.id)).players.at(-1)?.dayOne?.toISOString().slice(0, 10)).toBe("2030-03-13");
    expect((await post(late.id, new Date("2030-03-18T12:00:00Z"))).ok).toBe(true);
    const settled = await settle(game.id, a.id);
    expect(parseStoredResult(settled.result).scores).toMatchObject([
      { seat: 0, score: 1, eligible: true }, { seat: 1, eligible: false }, { seat: 2, score: 1, eligible: true }, { seat: 10, score: 1, eligible: true },
    ]);
    expect(settled.tickets).toEqual([]);
  });

  it("rechecks Day 1 after an edit waits for the game lock", async () => {
    const a = await person(), b = await person();
    const game = await create(a, [b]); await ok(b.id, join(game.token));
    const boundary = dayStartInstant("2030-03-09", "UTC").getTime();
    await db.game.update({ where: { id: game.id }, data: { devClockOffsetMs: BigInt(boundary - Date.now() - 60_000) } });
    let prepared!: () => void;
    const preparing = new Promise<void>(resolve => { prepared = resolve; });
    let editing!: ReturnType<typeof runGameCommand>;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${game.id} FOR UPDATE`;
      editing = runGameCommand({ actorMemberId: a.id, multiplayer: true,
        command: { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms: { ...terms, startsOn: "2030-03-10" } },
        beforeMutationTx: async () => { prepared(); } });
      void editing.then(prepared, prepared);
      await preparing;
      await tx.game.update({ where: { id: game.id }, data: { devClockOffsetMs: BigInt(boundary - Date.now() + 60_000) } });
    });
    expect(await editing).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    expect((await gameRow(game.id)).terms).toMatchObject({ versions: [{ n: 1 }] });
  });

  it("accepts a late day after 20:00 without resetting the calendar, including DST and zero-opportunity joins", async () => {
    const a = await person("America/New_York"), b = await person("Pacific/Honolulu"), late = await person(), zero = await person();
    const game = await create(a, [b]);
    await ok(b.id, join(game.token, "Pacific/Honolulu"));
    const lateAt = new Date("2030-03-11T01:30:00Z"); // March 10, 21:30 after New York's DST transition.
    await ok(late.id, join(game.token, "America/New_York"), lateAt);
    await ok(late.id, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done" }, lateAt);
    expect(await db.gameEntry.findFirst({ where: { gameId: game.id, memberId: late.id }, select: { dayIndex: true } })).toEqual({ dayIndex: 1 });
    const ownEnd = dayStartInstant("2030-03-19", "Pacific/Kiritimati");
    await ok(zero.id, join(game.token, "Pacific/Kiritimati"), ownEnd);
    expect(await run(zero.id, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done" }, ownEnd)).toMatchObject({ ok: false, error: { code: "DAY_CLOSED" } });
    const row = await gameRow(game.id);
    expect(row.players.every(player => player.dayOne?.toISOString().slice(0, 10) === "2030-03-09")).toBe(true);
    expect(row.players.find(player => player.memberId === late.id)?.joinedAt).toEqual(lateAt);
    const result = parseStoredResult((await settle(game.id, a.id)).result);
    expect(result.scores.find(score => score.memberId === zero.id)).toMatchObject({ score: 0, misses: 0, eligible: true });
  });

  it("uses conditional final-day grace and never admits or leaves after settlement becomes due", async () => {
    const a = await person(), b = await person(), c = await person(), d = await person();
    const game = await create(a, [b]);
    await ok(b.id, join(game.token));
    const end = dayStartInstant("2030-03-19", "UTC");
    await ok(c.id, join(game.token), new Date(end.getTime() + GAME_GRACE_MS - 1));
    const atDue = new Date(end.getTime() + GAME_GRACE_MS);
    const race = await Promise.all([run(d.id, join(game.token), atDue), run(a.id, { type: "leave", gameId: game.id }, atDue)]);
    expect(race.every(result => !result.ok)).toBe(true);
    const row = await gameRow(game.id);
    expect(row.status).toBe("settled");
    expect(row.players.every(player => player.leftAt === null)).toBe(true);
    expect(row.players).toHaveLength(3);
    expect(await db.gameEvent.count({ where: { gameId: game.id, type: "settled" } })).toBe(1);
    const posted = await create(a, [b]);
    await ok(b.id, join(posted.token));
    await entry(posted.id, a.id, 9); await entry(posted.id, b.id, 9);
    expect(await run(d.id, join(posted.token), end)).toMatchObject({ ok: false, error: { code: "INVITE_EXPIRED" } });
    expect((await gameRow(posted.id)).status).toBe("settled");
  });

  it("freezes subset ties as one ticket and allows any eligible participant to redeem it once", async () => {
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c], { terms: { ...terms, schedule: { count: 2 } } });
    await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    for (let day = 0; day < 3; day++) { await entry(game.id, a.id, day); await entry(game.id, b.id, day); }
    await entry(game.id, c.id, 0);
    const row = await settle(game.id, a.id);
    expect(parseStoredResult(row.result).scores.map(score => score.score)).toEqual([2, 2, 1]);
    expect(row.tickets).toMatchObject([{ owedToSeats: [0, 1], owedBySeats: [2] }]);
    const now = new Date();
    await db.gameTicket.update({ where: { id: row.tickets[0].id }, data: { createdAt: now } });
    const results = await Promise.all([a, b, c].map(player => run(player.id, { type: "redeem", ticketId: row.tickets[0].id }, now)));
    expect(results.every(result => result.ok)).toBe(true);
    expect(await db.gameEvent.count({ where: { gameId: game.id, type: "redeemed" } })).toBe(1);
  });

  it("does not normalize a late 3/3 to a full 10/10 or award an all-way tie", async () => {
    const [a, b, late] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b]); await ok(b.id, join(game.token));
    await ok(late.id, join(game.token), new Date("2030-03-16T21:00:00Z"));
    for (let day = 0; day < 10; day++) await entry(game.id, a.id, day);
    for (let day = 7; day < 10; day++) await entry(game.id, late.id, day);
    const row = await settle(game.id, a.id);
    expect(parseStoredResult(row.result).scores).toMatchObject([{ score: 10 }, { score: 0 }, { score: 3, misses: 0 }]);
    expect(row.tickets).toMatchObject([{ owedToSeats: [0], owedBySeats: [1, 10] }]);
    const tied = await create(a, [b, late]); await ok(b.id, join(tied.token)); await ok(late.id, join(tied.token));
    expect((await settle(tied.id, a.id)).tickets).toEqual([]);
  });

  it("retains leave evidence, revokes access, and voids below two without a default winner", async () => {
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    await entry(game.id, b.id, 0);
    await ok(b.id, { type: "leave", gameId: game.id }, new Date("2030-03-10T12:00:00Z"));
    expect(await readGame(game.id, b.id, true)).toBeNull();
    expect((await readHome(b.id, true)).games.some(view => view.id === game.id)).toBe(false);
    expect(await run(b.id, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done" })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    await ok(c.id, { type: "leave", gameId: game.id });
    const row = await gameRow(game.id);
    expect(row).toMatchObject({ status: "void", result: null, tickets: [] });
    expect(row.players.map(player => player.seat)).toEqual([0, 1, 2]);
    expect(await db.gameEntry.count({ where: { gameId: game.id, memberId: b.id } })).toBe(1);
  });

  it("keeps block scoring and reports counted while stripping content symmetrically", async () => {
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    const post = await entry(game.id, b.id, 0); await entry(game.id, a.id, 0); await entry(game.id, c.id, 0);
    const mediaKey = `game/${b.id}/${"a".repeat(64)}.jpg`;
    await db.gameEntry.update({ where: { id: post.id }, data: { mediaKeys: [mediaKey], blurHash: "synthetic-blur" } });
    expect(await run(a.id, { type: "report", gameId: game.id, reportId: randomUUID(), about: "player", reason: "other" })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await ok(a.id, { type: "report", gameId: game.id, reportId: randomUUID(), about: "post", reason: "other", entryId: post.id, reportedMemberId: c.id });
    expect(await db.gameReport.findFirst({ where: { entryId: post.id }, select: { reportedMemberId: true } })).toEqual({ reportedMemberId: b.id });
    expect((await readGame(game.id, a.id, true))?.days[0].others.find(other => other.seat === 1)).toEqual({ entry: null, hidden: true, seat: 1, status: "posted" });
    expect((await readGame(game.id, c.id, true))?.days[0].others.find(other => other.seat === 1)?.entry?.entryId).toBe(post.id);
    await ok(a.id, { type: "block", memberId: b.id });
    expect((await gameRow(game.id)).status).toBe("live");
    expect((await readHome(a.id, true)).games.some(view => view.id === game.id)).toBe(true);
    expect((await readGame(game.id, b.id, true))?.days[0].others.find(other => other.seat === 0)).toEqual({ entry: null, hidden: true, seat: 0, status: "posted" });
    expect(await authorizeMediaRead(a.id, mediaKey, true)).toBe(false);
    const result = parseStoredResult((await settle(game.id, a.id)).result);
    expect(result.scores.map(score => [score.score, score.eligible])).toEqual([[1, true], [1, true], [1, true]]);
  });

  it("copies Same again audience and task seats but refuses an outside bearer", async () => {
    const [a, b, outside] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b], { terms: { ...terms, tasks: [{ seat: 1, text: "Stretch" }] } });
    await ok(b.id, join(game.token)); await ok(outside.id, join(game.token));
    const old = await settle(game.id, a.id);
    await expect(create(outside, [], { previousGameId: game.id })).rejects.toThrow("NOT_A_PLAYER");
    const rematch = await create(b, [], { previousGameId: game.id });
    const row = await gameRow(rematch.id);
    expect(row).toMatchObject({ audienceKey: old.audienceKey, round: 2, maxPlayers: 10, createdBy: b.id });
    expect(row.invitees).toMatchObject([{ memberId: a.id, seat: 1 }]);
    const [words] = await openGameTexts([{ table: "game", field: "terms_words", rowId: row.id, memberId: b.id, value: row.termsWordsEncrypted }]);
    expect(JSON.parse(words!)).toMatchObject({ groupWord: "Crew", versions: [{ defaultTask: "Take a walk", tasks: [{ seat: 0, text: "Stretch" }] }] });
    await ok(b.id, { type: "editTerms", gameId: row.id, expectedTermsVersion: 1, terms: { ...terms, tasks: [{ seat: 0, text: "Stretch outside" }] } });
    expect((await readGame(row.id, b.id, true))?.terms.tasks).toContainEqual({ seat: 0, text: "Stretch outside" });
  });

  it("drops unclaimable invitation rows on Same again while retaining audience identity", async () => {
    const [a, b, c, deletedInvitee] = await Promise.all([person(), person(), person(), person()]);
    const game = await create(a, [b, c, deletedInvitee]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    const original = await settle(game.id, a.id);
    await erase(a.id); await erase(deletedInvitee.id);
    const rematch = await create(b, [], { previousGameId: game.id });
    const row = await gameRow(rematch.id);
    expect(row.audienceKey).toBe(original.audienceKey);
    expect(row.invitees).toHaveLength(1);
    expect(row.invitees).toMatchObject([{ seat: 2, memberId: c.id }]);
    await ok(c.id, join(rematch.token));
    expect((await gameRow(rematch.id)).status).toBe("live");
  });

  it("leaves persisted settlement and deletion available when new group admission is off", async () => {
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    await entry(game.id, a.id, 0);
    vi.stubEnv("MURPH_GAME_GROUPS_ENABLED", "false");
    await expect(create(a, [b])).rejects.toThrow("GAME_DISABLED");
    expect(await run(b.id, join(game.token))).toMatchObject({ ok: false, error: { code: "GAME_DISABLED" } });
    const row = await settle(game.id, a.id);
    await erase(a.id);
    const kept = await gameRow(game.id);
    expect(kept.status).toBe("settled");
    expect(kept.tickets[0].owedToSeats).toEqual(row.tickets[0].owedToSeats);
    expect(canRedeemGroupTicket(kept.tickets[0], kept.players, parseStoredResult(kept.result), b.id)).toBe(false);
    expect(await readGame(game.id, b.id, true)).not.toBeNull();
  });

  it("rejects two different handles resolving to one person and reuses an audience through key rotation", async () => {
    const a = await person(), b = await person(), c = await person();
    const phone = "+12025550123";
    await db.$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phone), memberId: b.id, prisma: tx,
      phoneNumberVerifiedAt: createdAt, signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null, signupPhoneCodeSentAt: null, signupPhoneNumber: null }));
    expect(await run(a.id, { type: "createGame", gameId: randomUUID(), maxPlayers: 10, groupWord: "Crew", terms,
      invitees: [{ seat: 1, firstName: "Player", recipient: { kind: "email", value: b.email } }, { seat: 2, firstName: "Player", recipient: { kind: "phone", value: phone } }] }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    const first = await create(a, [b, c]);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64url")},v2:${Buffer.alloc(32, 8).toString("base64url")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    const second = await create(a, [c, b]);
    expect((await gameRow(second.id)).audienceKey).toBe((await gameRow(first.id)).audienceKey);
  });

  it("accepts one prize and sparse invitation overrides, and refuses group negotiations", async () => {
    const a = await person(), b = await person();
    await expect(create(a, [b], { terms: { ...terms, stakes: [{ kind: "dare", item: "Wear a funny hat" }] } })).rejects.toThrow("INVALID_REQUEST");
    await expect(create(a, [b], { terms: { ...terms, tasks: [{ seat: 3, text: "Stretch" }] } })).rejects.toThrow("INVALID_REQUEST");
    await expect(create(a, [b], { terms: { ...terms, defaultTask: "drink bleach" } })).rejects.toThrow("CONTENT_NOT_ALLOWED");
    const game = await create(a, [b]);
    expect(await run(b.id, { type: "negotiate", token: game.token, termsVersion: 1, timeZone: "UTC", proposalId: randomUUID(), change: { kind: "start_now" } }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await run(b.id, { type: "cancelInvite", gameId: game.id })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    await ok(b.id, join(game.token));
    expect(await run(a.id, { type: "proposeChange", gameId: game.id, proposalId: randomUUID(), expectedTermsVersion: 1, change: { kind: "start_now" } }))
      .toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    await ok(a.id, { type: "cancelInvite", gameId: game.id });
    expect((await gameRow(game.id)).status).toBe("void");
  });

  it("voids a waiting game when its starter leaves and refuses later acceptances", async () => {
    const a = await person(), b = await person();
    const game = await create(a, [b]);
    await ok(a.id, { type: "leave", gameId: game.id });
    await ok(a.id, { type: "leave", gameId: game.id });
    expect(await run(b.id, join(game.token))).toMatchObject({ ok: false, error: { code: "INVITE_EXPIRED" } });
    const row = await gameRow(game.id);
    expect(row).toMatchObject({ status: "void", result: null, tickets: [], players: [{ memberId: a.id, leftAt: createdAt, dayOne: null }] });
  });

  it("does not grant pre-join offline grace or missed weekdays", async () => {
    const a = await person(), b = await person(), c = await person();
    const game = await create(a, [b], { terms: { ...terms, startsOn: "2030-03-11", schedule: { days: [0, 2, 4] } } });
    await ok(b.id, join(game.token));
    const joinedAt = new Date("2030-03-13T03:30:00Z");
    await ok(c.id, join(game.token), joinedAt);
    expect(await run(c.id, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done", captureAgeMs: 3_600_000 }, joinedAt))
      .toMatchObject({ ok: false, error: { code: "DAY_CLOSED" } });
    await ok(c.id, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done" }, joinedAt);
    const row = await settle(game.id, a.id);
    // Eligible Wednesday, Friday, Monday and Wednesday; the first Monday is not a miss.
    expect(parseStoredResult(row.result).scores.find(score => score.memberId === c.id)).toMatchObject({ score: 1, misses: 3 });
  });

  it("keeps a leaver's past evidence visible to players while closing their content access", async () => {
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    await entry(game.id, a.id, 0);
    const past = await entry(game.id, b.id, 0);
    await ok(b.id, { type: "leave", gameId: game.id }, new Date("2030-03-10T12:00:00Z"));
    const view = await readGame(game.id, a.id, true);
    expect(view?.players.find(player => player.seat === 1)).toMatchObject({ left: true, memberId: b.id, score: 1 });
    expect(view?.days[0].others.find(player => player.seat === 1)?.entry?.entryId).toBe(past.id);
    expect(await readGame(game.id, b.id, true)).toBeNull();
    expect((await readHome(b.id, true)).wallet).toEqual({ held: [], owed: [], redeemed: [] });

    const photo = `game/${c.id}/${"b".repeat(64)}.jpg`;
    await db.gameProfile.update({ where: { memberId: c.id }, data: { photoKey: photo } });
    expect(await authorizeMediaRead(b.id, photo, true)).toBe(false);
  });

  it("freezes departures as ineligible before a settlement/redemption race", async () => {
    const [a, b, c, d] = await Promise.all([person(), person(), person(), person()]);
    const game = await create(a, [b, c, d]);
    for (const player of [b, c, d]) await ok(player.id, join(game.token));
    await entry(game.id, a.id, 0); await entry(game.id, b.id, 0);
    await ok(b.id, { type: "leave", gameId: game.id }, new Date("2030-03-18T12:00:00Z"));
    const row = await settle(game.id, a.id);
    expect(parseStoredResult(row.result).scores[1]).toMatchObject({ seat: 1, score: 1, eligible: false });
    expect(row.tickets).toMatchObject([{ owedBySeats: [2, 3], owedToSeats: [0] }]);
    const now = new Date();
    await db.gameTicket.update({ where: { id: row.tickets[0].id }, data: { createdAt: now } });
    const race = await Promise.all([run(c.id, { type: "leave", gameId: game.id }, now), run(c.id, { type: "redeem", ticketId: row.tickets[0].id }, now)]);
    expect(race[0]).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    expect(race[1].ok).toBe(true);
    expect(await run(b.id, { type: "redeem", ticketId: row.tickets[0].id }, now)).toMatchObject({ ok: false, error: { code: "TICKET_NOT_HELD" } });
    const result = parseStoredResult(row.result);
    expect(canRedeemGroupTicket(row.tickets[0], row.players.map(player => [2, 3].includes(player.seat) ? { ...player, memberId: null } : player), result, a.id)).toBe(false);
  });

  it("targets terms at the starter and named player reports at the selected participant", async () => {
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    const termsId = randomUUID(), playerId = randomUUID();
    await ok(c.id, { type: "report", reportId: termsId, gameId: game.id, about: "terms", reason: "other", reportedMemberId: b.id });
    await ok(c.id, { type: "report", reportId: playerId, gameId: game.id, about: "player", reason: "other", reportedMemberId: b.id });
    expect(await db.gameReport.findUnique({ where: { id: termsId }, select: { reportedMemberId: true } })).toEqual({ reportedMemberId: a.id });
    expect(await db.gameReport.findUnique({ where: { id: playerId }, select: { reportedMemberId: true } })).toEqual({ reportedMemberId: b.id });
  });

  it("admits a late player after starter deletion without reviving the erased seat", async () => {
    const [a, b, c, d] = await Promise.all([person(), person(), person(), person()]);
    const game = await create(a, [b, c, d]);
    await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    await erase(a.id);
    await ok(d.id, join(game.token), new Date("2030-03-12T12:00:00Z"));
    const row = await gameRow(game.id);
    expect(row).toMatchObject({ createdBy: null, status: "live", wordsOwnerMemberId: b.id });
    expect(row.players.map(player => [player.seat, player.memberId])).toEqual([[0, null], [1, b.id], [2, c.id], [3, d.id]]);
    expect(row.invitees[2].memberId).toBe(d.id);
    const result = parseStoredResult((await settle(game.id, b.id)).result);
    expect(result.scores[0]).toMatchObject({ seat: 0, eligible: false });
  });

  it("serializes leaving before the deadline against a settlement at the deadline", async () => {
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    await entry(game.id, a.id, 0); await entry(game.id, b.id, 0);
    const boundary = new Date("2030-03-19T04:00:00Z");
    const results = await Promise.all([
      run(b.id, { type: "leave", gameId: game.id }, new Date(boundary.getTime() - 1)),
      run(c.id, { type: "leave", gameId: game.id }, boundary),
    ]);
    const row = await gameRow(game.id);
    expect(row.status).toBe("settled");
    expect(results[1]).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    const departedFirst = results[0].ok;
    expect(row.players[1].leftAt !== null).toBe(departedFirst);
    expect(parseStoredResult(row.result).scores[1].eligible).toBe(!departedFirst);
    expect(row.tickets[0].owedToSeats).toEqual(departedFirst ? [0] : [0, 1]);
    expect(await db.gameEvent.count({ where: { gameId: game.id, type: "settled" } })).toBe(1);
  });

  it("scrubs an unjoined group's invitation when that account deletes during play", async () => {
    const [a, b, invited] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, invited]); await ok(b.id, join(game.token));
    await erase(invited.id);
    const row = await gameRow(game.id);
    expect(row.status).toBe("live");
    expect(row.invitees[1]).toMatchObject({ memberId: null, recipientLookupKey: null, pendingLabel: null });
  });

});

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedMemberAuthFromBearerToken: async (request: Request) => ({ member: { id: request.headers.get("x-test-member") } }),
}));

async function httpGame(memberId: string | null, path: string, method = "GET", body?: unknown, capable = true) {
  const headers = new Headers();
  if (memberId) { headers.set("authorization", "Bearer synthetic"); headers.set("x-test-member", memberId); }
  if (capable) headers.set("X-Murph-Game-Multiplayer", "1");
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://backend.test/api/game/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe.skipIf(!enabled)("multiplayer HTTP contract and privacy", () => {
  it("hides every game/token/ticket mutation without capability, including dev routes", async () => {
    const a = await person(), b = await person(); const game = await create(a, [b]);
    const reads = await import("../app/api/game/v1/games/[id]/route");
    const preview = await import("../app/api/game/v1/invites/[token]/route");
    expect((await reads.GET(await httpGame(a.id, `/games/${game.id}`, "GET", undefined, false), { params: Promise.resolve({ id: game.id }) })).status).toBe(404);
    expect((await preview.GET(await httpGame(null, `/invites/${game.token}`, "GET", undefined, false), { params: Promise.resolve({ token: game.token }) })).status).toBe(404);
    const commands: GameCommand[] = [
      { type: "createGame", gameId: randomUUID(), maxPlayers: 10, terms },
      { type: "createGame", gameId: randomUUID(), previousGameId: game.id, inviteeFirstName: "Player", terms },
      { type: "join", token: game.token, termsVersion: 1, timeZone: "UTC" },
      { type: "negotiate", token: game.token, termsVersion: 1, timeZone: "UTC", proposalId: randomUUID(), change: { kind: "start_now" } },
      { type: "leave", gameId: game.id }, { type: "cancelInvite", gameId: game.id },
      { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms },
      { type: "proposeChange", gameId: game.id, expectedTermsVersion: 1, proposalId: randomUUID(), change: { kind: "start_now" } },
      { type: "respondChange", gameId: game.id, proposalId: randomUUID(), decision: "approve" },
      { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", text: "Done", mediaKeys: [] },
      { type: "withdraw", gameId: game.id, entryId: randomUUID() },
      { type: "report", gameId: game.id, reportId: randomUUID(), reason: "other", about: "player", reportedMemberId: b.id },
      { type: "report", token: game.token, reportId: randomUUID(), reason: "other", about: "terms" },
      { type: "block", token: game.token },
    ];
    const ticket = await db.gameTicket.create({ data: { id: randomUUID(), gameId: game.id, stakeKey: "prize", owedBySeats: [0], owedToSeats: [1] } });
    commands.push({ type: "redeem", ticketId: ticket.id });
    for (const command of commands) expect(await runGameCommand({ actorMemberId: a.id, command })).toMatchObject({ ok: false, status: 404, error: { code: "token" in command ? "INVITE_NOT_FOUND" : "GAME_NOT_FOUND" } });
    const { devAdvanceDays, devSettleNow, devStartNow } = await import("@/src/lib/game/service");
    for (const step of [() => devAdvanceDays(game.id, a.id, 1), () => devSettleNow(game.id, a.id), () => devStartNow(game.id, a.id)]) await expect(step()).rejects.toMatchObject({ error: { code: "GAME_NOT_FOUND" } });
    expect((await gameRow(game.id)).status).toBe("invited");
  });

  it("creates, edits and leaves through HTTP, rejects stale versions and keeps admission dark", async () => {
    const a = await person(), b = await person();
    const createRoute = await import("../app/api/game/v1/games/route");
    const edit = await import("../app/api/game/v1/games/[id]/terms/route");
    const leaveRoute = await import("../app/api/game/v1/games/[id]/leave/route");
    const accept = await import("../app/api/game/v1/invites/[token]/accept/route");
    const body = { gameId: randomUUID(), maxPlayers: 10, groupWord: "Crew", terms: { ...terms, startsOn: undefined }, invitees: [{ seat: 4, firstName: "Private label", recipient: { kind: "email", value: b.email } }] };
    vi.stubEnv("MURPH_GAME_GROUPS_ENABLED", "false");
    expect((await createRoute.POST(await httpGame(a.id, "/games", "POST", body))).status).toBe(404);
    vi.stubEnv("MURPH_GAME_GROUPS_ENABLED", "true");
    const created = await createRoute.POST(await httpGame(a.id, "/games", "POST", body));
    expect(created.status).toBe(200); const { game } = await created.json();
    expect(game).toMatchObject({ maxPlayers: 10, invitedCount: 1, permissions: { canEditTerms: true, canCancel: true }, group: { word: "Crew" } });
    expect(game.players).toHaveLength(1);
    const context = { params: Promise.resolve({ id: game.id }) };
    const editing = { expectedTermsVersion: 1, terms: { ...body.terms, defaultTask: "Walk outdoors" } };
    expect((await edit.PUT(await httpGame(a.id, `/games/${game.id}/terms`, "PUT", editing), context)).status).toBe(200);
    expect((await edit.PUT(await httpGame(a.id, `/games/${game.id}/terms`, "PUT", editing), context)).status).toBe(409);
    vi.stubEnv("MURPH_GAME_GROUPS_ENABLED", "false");
    const joining = await accept.POST(await httpGame(b.id, `/invites/${game.inviteToken}/accept`, "POST", { termsVersion: 2, timeZone: "UTC" }), { params: Promise.resolve({ token: game.inviteToken }) });
    expect(joining.status).toBe(404);
    expect((await leaveRoute.POST(await httpGame(a.id, `/games/${game.id}/leave`, "POST"), context)).status).toBe(200);
    expect((await leaveRoute.POST(await httpGame(a.id, `/games/${game.id}/leave`, "POST"), context)).status).toBe(200);
    expect((await gameRow(game.id)).players[0].leftAt).not.toBeNull();
  });

  it("closes the preview at the actual deadline when final posts consume offline grace", async () => {
    const a = await person(), b = await person();
    const game = await create(a, [b]); await ok(b.id, join(game.token));
    const end = new Date("2030-03-19T03:00:00Z");
    await db.game.update({ where: { id: game.id }, data: { devClockOffsetMs: BigInt(end.getTime() - Date.now()) } });
    const { readInvitePreview } = await import("@/src/lib/game/service");
    expect(await readInvitePreview(game.token, true)).toMatchObject({ status: "open" });
    await entry(game.id, a.id, 9); await entry(game.id, b.id, 9);
    expect(await readInvitePreview(game.token, true)).toEqual({ status: "used" });
  });

  it("projects authenticated own-profile preview names, addressed task, dayOne and the per-request Home switch", async () => {
    const a = await person(), b = await person(), c = await person();
    await ok(b.id, { type: "setProfile", firstName: "Bailey" });
    const game = await create(a, [b, c], { terms: { ...terms, tasks: [{ seat: 2, text: "Walk in the park" }] } });
    const { readInvitePreview } = await import("@/src/lib/game/service");
    const previewRoute = await import("../app/api/game/v1/invites/[token]/route");
    const context = { params: Promise.resolve({ token: game.token }) };
    expect(await readInvitePreview(game.token, true)).toMatchObject({ status: "open", dayOne: null, expiresAt: null });
    await ok(b.id, join(game.token));
    const publicResult = await (await previewRoute.GET(await httpGame(null, `/invites/${game.token}`), context)).json();
    expect(publicResult.preview).toMatchObject({ status: "open", dayOne: "2030-03-09" });
    expect(publicResult.preview).not.toHaveProperty("alreadyIn"); expect(publicResult.preview).not.toHaveProperty("yourTask");
    const authenticated = await (await previewRoute.GET(await httpGame(c.id, `/invites/${game.token}`), context)).json();
    expect(authenticated.preview).toMatchObject({ alreadyIn: { count: 1, firstNames: ["Bailey"], avatarUrl: null }, yourTask: "Walk in the park" });
    vi.stubEnv("MURPH_GAME_GROUPS_ENABLED", "false"); expect((await readHome(a.id, true)).canStartGroups).toBe(false);
    vi.stubEnv("MURPH_GAME_GROUPS_ENABLED", "true"); expect((await readHome(a.id, true)).canStartGroups).toBe(true);
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", b.id); expect((await readHome(a.id, true)).canStartGroups).toBe(false);
    expect(await readHome(a.id)).not.toHaveProperty("canStartGroups");
  });
});

describe.skipIf(!enabled)("group daily claim concurrency", () => {
  it("claims each recipient slot once across concurrent peers and retries", async () => {
    const notifications = await import("@/src/lib/game/post-notification");
    vi.spyOn(notifications, "sendGamePostNotificationAfterResponse").mockImplementation(() => {});
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    for (const person of [a, b, c]) await db.companionPushRoute.create({ data: {
      userId: person.id, installationId: randomUUID(), token: "ab".repeat(32), topic: "ai.withmurph.app.dev",
      environment: "development", alertsAllowed: true, gameSessionId: randomUUID(), updatedAt: createdAt,
    } });
    const post = (): GameCommand => ({ type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done" });
    const first = post(), final = post(), now = new Date("2030-03-09T12:00:00Z");
    const results = await Promise.all([run(a.id, first, now), run(b.id, final, now), run(a.id, first, now), run(b.id, final, now)]);
    expect(results.every(result => result.ok)).toBe(true);
    const receipts = await db.gameEvent.findMany({ where: { gameId: game.id, type: "post_notification" } });
    expect(receipts).toHaveLength(4);
    expect(new Set(receipts.map(receipt => receipt.commandKey)).size).toBe(4);
    expect(receipts.filter(receipt => typeof receipt.payload === "object" && receipt.payload !== null && !Array.isArray(receipt.payload) && receipt.payload.recipientMemberId === c.id)
      .map(receipt => receipt.commandKey?.split(":").at(-1)).sort()).toEqual(["completion", "first"]);
  });
});

describe.skipIf(!enabled)("group privacy projections", () => {
  it("masks posts before decryption and signing across detail, preview, history and ticket parties", async () => {
    const crypto = await import("@/src/lib/game/crypto");
    const media = await import("@/src/lib/game/media");
    const { readHistory, readInvitePreview } = await import("@/src/lib/game/service");
    const { withHistoryPhotoDeliveries } = await import("@/src/lib/game/http/media-routes");
    const [a, b, c] = await Promise.all([person(), person(), person()]);
    const game = await create(a, [b, c]); await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    const photos = [b, c].map(person => `game/${person.id}/${"b".repeat(64)}.jpg`);
    await ok(b.id, { type: "setProfile", firstName: "Bailey" });
    await ok(c.id, { type: "setProfile", firstName: "Casey" });
    await db.gameProfile.update({ where: { memberId: b.id }, data: { photoKey: photos[0] } });
    await db.gameProfile.update({ where: { memberId: c.id }, data: { photoKey: photos[1] } });
    await entry(game.id, a.id, 0); await entry(game.id, a.id, 1);
    const peerEntries: Array<{ id: string; mediaKeys: string[] }> = [];
    for (const person of [b, c]) {
      const post = await entry(game.id, person.id, 0);
      const text = await crypto.sealGameText({ table: "game_entry", field: "text", memberId: person.id, rowId: post.id }, "Private post words");
      peerEntries.push(await db.gameEntry.update({ where: { id: post.id }, data: { textEncrypted: text, kind: "photo", mediaKeys: [`game/${person.id}/${"c".repeat(64)}.jpg`], blurHash: "private-blur" } }));
    }
    vi.spyOn(media, "servesSignedGameMedia").mockReturnValue(true);
    const sign = vi.spyOn(media, "gameMediaDelivery").mockResolvedValue({ url: "https://images.example.test/signed", expiresAt: "2031-01-01T00:00:00Z" });
    expect(await readInvitePreview(game.token, true, a.id)).toMatchObject({ alreadyIn: { count: 2, firstNames: ["Bailey", "Casey"], avatarUrl: "https://images.example.test/signed" } });
    expect(sign).toHaveBeenCalledWith(photos[0], "avatar");
    await ok(a.id, { type: "report", gameId: game.id, reportId: randomUUID(), about: "post", reason: "other", entryId: peerEntries[1].id });
    await ok(a.id, { type: "report", gameId: game.id, reportId: randomUUID(), about: "player", reason: "other", reportedMemberId: c.id });
    const termsReport = randomUUID();
    await ok(b.id, { type: "report", gameId: game.id, reportId: termsReport, about: "terms", reason: "other", reportedMemberId: c.id });
    expect(await db.gameReport.findUnique({ where: { id: termsReport }, select: { reportedMemberId: true } })).toEqual({ reportedMemberId: a.id });
    await ok(a.id, { type: "block", memberId: b.id });
    sign.mockClear();
    const open = vi.spyOn(crypto, "openGameTexts");
    const detail = await readGame(game.id, a.id, true);
    expect(detail?.days[0].others.every(other => other.hidden && other.entry === null && !other.preview && !other.postedAt && !other.blurHash)).toBe(true);
    expect(detail?.days[0].progress?.latestPosterSeats).not.toContain(1);
    expect(await readInvitePreview(game.token, true, a.id)).toMatchObject({ alreadyIn: { count: 1, firstNames: ["Casey"], avatarUrl: null } });
    for (const key of [...photos, ...peerEntries.flatMap(post => post.mediaKeys)]) expect(await authorizeMediaRead(a.id, key, true)).toBe(false);
    await settle(game.id, a.id);
    const home = await readHome(a.id, true);
    const ticket = home.wallet.held.find(ticket => ticket.group);
    expect(ticket?.parties?.owedBy).toEqual([
      { seat: 1, memberId: null, firstName: "", avatarUrl: null },
      { seat: 2, memberId: c.id, firstName: "Teammate", avatarUrl: null },
    ]);
    const history = await withHistoryPhotoDeliveries(await readHistory(a.id, true), a.id);
    expect(history.groups?.[0].games[0].previews.every(preview => preview.seat === 0)).toBe(true);
    expect(open.mock.calls.flatMap(([requests]) => requests).filter(request => request.table === "game_entry" && peerEntries.some(post => post.id === request.rowId))).toEqual([]);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe.skipIf(!enabled)("maximum-cardinality group projections", () => {
  it("measures Home, detail and history and filters legacy collections before their limits", async () => {
    const { Prisma } = await import("@prisma/client");
    const crypto = await import("@/src/lib/game/crypto");
    const media = await import("@/src/lib/game/media");
    const { readHistory } = await import("@/src/lib/game/service");
    const { withHistoryPhotoDeliveries, withLockedPreviewDeliveries } = await import("@/src/lib/game/http/media-routes");
    const { runWithPrismaOperationTimings } = await import("@/src/lib/prisma-operation-timing");
    const people: Person[] = []; for (let seat = 0; seat < 10; seat++) people.push(await person());
    const [viewer, other] = people;
    const base = await create(viewer, [other]);
    const original = await gameRow(base.id);
    await db.game.delete({ where: { id: base.id } });
    const { players: originalPlayers, invitees: originalInvitees, tickets: originalTickets, ...template } = original;
    expect([originalPlayers.length, originalInvitees.length, originalTickets.length]).toEqual([1, 1, 0]);
    const dayOne = new Date("2030-01-01T00:00:00Z");
    const effectiveNow = new Date("2030-12-30T12:00:00Z");
    const words = { v: 1, groupWord: "Crew", versions: [{ n: 1, defaultTask: "Walk outside", tasks: [], stakes: [{ key: "prize", item: "Choose an outing" }] }] };
    const termWords = await crypto.sealGameText({ memberId: viewer.id, rowId: "load", table: "game", field: "terms_words" }, JSON.stringify(words));
    const storedTerms = { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 365 }, stakes: [{ key: "prize", kind: "prize" }] }] };
    const liveIds = Array.from({ length: 50 }, () => randomUUID());
    await db.game.createMany({ data: liveIds.map((id, group) => ({ ...template, id, maxPlayers: 10, status: "live", audienceKey: `load-group-${group}`,
      inviteTokenHash: null, inviteTokenEncrypted: null, lengthDays: 365, terms: storedTerms, termsWordsEncrypted: termWords!, startedAt: dayOne,
      pendingChange: Prisma.DbNull, result: Prisma.DbNull, devClockOffsetMs: BigInt(effectiveNow.getTime() - Date.now()) })) });
    await db.gamePlayer.createMany({ data: liveIds.flatMap(gameId => people.map((person, seat) => ({ gameId, memberId: person.id, seat, timeZone: "UTC", dayOne, joinedAt: dayOne }))) });
    // One live artifact for every player/day. Three-attempt scan bounds are proved in game-collections.
    for (const [seat, person] of people.entries()) {
      const text = await crypto.sealGameText({ memberId: person.id, rowId: "load", table: "game_entry", field: "text" }, "A".repeat(140));
      await db.$executeRaw(Prisma.sql`INSERT INTO game_entry (id, game_id, member_id, day_index, attempt, kind, text_encrypted, media_keys, received_at)
        SELECT game.id || '-' || ${seat}::text || '-' || day::text, game.id, ${person.id}, day, 1, 'photo', ${text}, ARRAY['game/' || ${person.id} || '/' || md5(game.id || '-' || ${seat}::text || '-' || day::text) || md5(game.id || '-' || ${seat}::text || '-' || day::text) || '.jpg']::text[], ${dayOne}
        FROM game CROSS JOIN generate_series(0,364) day WHERE game.id IN (${Prisma.join(liveIds)})`);
    }
    await db.gameTicket.createMany({ data: Array.from({ length: 200 }, (_, index) => ({ id: randomUUID(), gameId: liveIds[index % 50], stakeKey: "prize", owedBySeats: [1,2,3,4,5,6,7,8,9], owedToSeats: [0] })) });
    // Refresh planner statistics after bulk seeding, as a populated database would.
    await db.$executeRaw`ANALYZE game, game_player, game_entry, game_ticket`;
    const open = vi.spyOn(crypto, "openGameTexts");
    let signing = 0, peakSigning = 0;
    vi.spyOn(media, "servesSignedGameMedia").mockReturnValue(true);
    const sign = vi.spyOn(media, "gameMediaDelivery").mockImplementation(async () => {
      signing++; peakSigning = Math.max(peakSigning, signing); await Promise.resolve(); signing--;
      return { url: "https://images.example.test/signed", expiresAt: "2031-01-01T00:00:00Z" };
    });
    const metrics: Record<string, unknown> = {};
    async function measure<T extends object | null>(name: string, run: () => Promise<T>) {
      const operations: import("@/src/lib/prisma-operation-timing").PrismaOperationTiming[] = [];
      const queries: import("@/src/lib/prisma-operation-timing").PrismaQueryTiming[] = [];
      open.mockClear(); sign.mockClear(); peakSigning = 0;
      const started = performance.now();
      const response = await runWithPrismaOperationTimings(operations, run, undefined, queries);
      const events = queries.flatMap(query => [{ at: query.startMs, change: 1 }, { at: query.startMs + query.ms, change: -1 }]).sort((a,b) => a.at - b.at || a.change - b.change);
      let active = 0, peakQueries = 0; for (const event of events) { active += event.change; peakQueries = Math.max(peakQueries, active); }
      const { jsonOk } = await import("@/src/lib/hosted-onboarding/http");
      const bytes = (await jsonOk(name === "detail" ? { ok: true, game: response } : { ok: true, ...response }).arrayBuffer()).byteLength;
      metrics[name] = { operations: operations.length, queries: queries.length, peakQueries, decryptFields: open.mock.calls.flatMap(([requests]) => requests.filter(request => request.value)).length,
        signatures: sign.mock.calls.length, peakSigning, bytes, ms: Math.round(performance.now() - started) };
      if (name === "home") { expect(sign).toHaveBeenCalledTimes(450); }
      if (name === "history") { expect(sign).toHaveBeenCalledTimes(120); expect(bytes).toBeLessThan(3_000_000); }
      expect(operations.length).toBeLessThanOrEqual(60);
      expect(peakQueries).toBeLessThanOrEqual(6); expect(peakSigning).toBeLessThanOrEqual(6);
      return response;
    }
    await measure("detail", () => readGame(liveIds[0], viewer.id, true));
    await measure("unlockedHome", async () => withLockedPreviewDeliveries(await readHome(viewer.id, true), viewer.id));
    await db.gameEntry.deleteMany({ where: { gameId: { in: liveIds }, memberId: viewer.id, dayIndex: 363 } });
    const home = await readHome(viewer.id, true); expect(home.games).toHaveLength(50); expect(home.wallet.held).toHaveLength(200);
    expect(home.games.every(game => game.days.length === 365 && game.days.filter(day => day.mine?.text === "A".repeat(140)).length === 364)).toBe(true);
    expect(home.games.every(game => game.days.filter(day => day.others.length > 0).map(day => day.index).join() === "363")).toBe(true);
    await measure("home", async () => withLockedPreviewDeliveries(await readHome(viewer.id, true), viewer.id));
    // Capture the full-calendar baseline with the same actual stored detail, before Home narrowing.
    const full = await readGame(liveIds[0], viewer.id, true);
    metrics.fullHomeBytes = Buffer.byteLength(JSON.stringify({ ...home, games: Array(50).fill(full) }));
    // The older pair and its ticket survive hundreds of newer group candidates without the capability.
    const pair = await ok(viewer.id, { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player", terms: { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Walk" }] } });
    await ok(other.id, join(pair!.inviteToken!));
    const pairRow = await gameRow(pair!.id);
    await db.gameTicket.create({ data: { id: randomUUID(), gameId: pair!.id, stakeKey: "prize", owedBySeats: [1], owedToSeats: [0], createdAt: new Date("2020-01-01T00:00:00Z") } });
    const legacy = await readHome(viewer.id); expect(legacy.games.map(game => game.id)).toEqual([pair!.id]); expect(legacy.wallet.held).toHaveLength(1);
    // Over-limit fixture proves separate twenty-group/twenty-five-round selection before hydration.
    const historyIds = Array.from({ length: 21 * 26 }, () => randomUUID());
    const result = { v: 1, maxPlayers: 10, termsVersion: 1, scores: people.map((person, seat) => ({ seat, memberId: person.id, score: 365-seat, misses: seat, eligible: true })) };
    for (let offset = 0; offset < historyIds.length; offset += 100) {
      const batch = historyIds.slice(offset, offset + 100);
      await db.game.createMany({ data: batch.map((id, index) => ({ ...template, id, maxPlayers: 10, status: "settled", audienceKey: `history-group-${Math.floor((offset + index) / 26)}`, round: (offset + index) % 26 + 1,
        inviteTokenHash: null, inviteTokenEncrypted: null, lengthDays: 365, terms: storedTerms, termsWordsEncrypted: termWords!, startedAt: dayOne, settledAt: new Date(effectiveNow.getTime() + offset + index),
        pendingChange: Prisma.DbNull, result })) });
      await db.gamePlayer.createMany({ data: batch.flatMap(gameId => people.map((person, seat) => ({ gameId, memberId: person.id, seat, timeZone: "UTC", dayOne, joinedAt: dayOne }))) });
      await db.gameEntry.createMany({ data: batch.flatMap(gameId => people.slice(0,6).map((person, seat) => ({ id: `${gameId}-${seat}`, gameId, memberId: person.id, dayIndex: 0, attempt: 1, kind: "photo", receivedAt: dayOne, mediaKeys: [`game/${person.id}/${String(offset + batch.indexOf(gameId)).padStart(64, "0")}.jpg`] }))) });
    }
    await db.game.update({ where: { id: pair!.id }, data: { status: "settled", settledAt: new Date("2020-01-01T00:00:00Z"), result: { v: 1, termsVersion: 1, scores: pairRow.players.map(player => ({ memberId: player.memberId!, seat: player.seat, score: 3, misses: 1 })) } } });
    expect((await readHistory(viewer.id)).people[0].games[0].id).toBe(pair!.id);
    await db.$executeRaw`ANALYZE game, game_player, game_entry`;
    const history = await readHistory(viewer.id, true); expect(history.groups).toHaveLength(20); expect(history.groups?.every(group => group.games.length === 25)).toBe(true);
    expect(history.groups?.map(group => group.id)).toEqual(Array.from({ length: 20 }, (_, i) => `history-group-${20-i}`));
    expect(history.groups?.every(group => group.games.map(game => game.round).join() === Array.from({ length: 25 }, (_, i) => 26-i).join())).toBe(true);
    expect(history.groups?.every(group => group.record.won === 25 && group.record.lost === 0 && group.record.tied === 0)).toBe(true);
    expect(history.people[0].games[0].id).toBe(pair!.id);
    await measure("history", async () => withHistoryPhotoDeliveries(await readHistory(viewer.id, true), viewer.id));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(".tmp-pr4-load.json", JSON.stringify(metrics, null, 2));
  });
});


async function exactRoom(people: Person[]) {
  const room = `room_${randomUUID()}`;
  ids.push(room);
  await db.hostedMember.create({ data: { id: room } });
  await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: people[0].id,
    participants: { create: people.map(person => ({ participantMemberId: person.id, handleLookupKey: createHostedEmailLookupKey(person.email)!, firstSeenAt: new Date(), lastSeenAt: new Date() })) } } });
  await db.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: room, threadLookupKey: `thread_${room}`, threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: room })! } });
  chatProof.rooms.set(room, people.map(person => person.email));
  return room;
}

describe.skipIf(!enabled)("exact group chat and composer persistence", () => {
  it("selects an exact room before create, keeps several games there, and disambiguates names", async () => {
    const people = await Promise.all([person(), person(), person()]);
    const room = await exactRoom(people);
    const first = await create(people[0], people.slice(1));
    const second = await create(people[0], people.slice(1));
    expect((await gameRow(first.id)).chatContainerMemberId).toBe(room);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: { in: [first.id, second.id] }, template: "game_rematch" } })).toBe(2);
    const state = await readGameChatState(room, people.map(p => p.id), people[0].id);
    const { hostedGameChatStateSchema } = await import("@murphai/hosted-execution/runtime-control");
    expect(hostedGameChatStateSchema.parse(state)).toEqual(state);
    expect(state.games[0].terms.tasks).toHaveLength(1);
    expect(state.games[0].pendingInviteeCount).toBe(2);
    expect(JSON.stringify(state)).not.toContain("Teammate");
    expect(state.games[0].terms.defaultTask).toBe("Take a walk");
    expect(state.games.map(g => g.id).sort()).toEqual([first.id, second.id].sort());
    expect((await readGameChatState(room, people.map(p => p.id), people[0].id, false)).games).toEqual([]);
    const { readGameChatProfiles } = await import("@/src/lib/game/service");
    expect(new Set((await readGameChatProfiles(people.map(p => p.id))).map(p => p.firstName)).size).toBe(3);
    const { readGameChatFundingRooms } = await import("@/src/lib/game/chat-access");
    expect((await readGameChatFundingRooms({ memberIds: [room], now: new Date(), prisma: db })).get(room)).toBe(room);
    const joinInput = { actorMemberId: people[1].id, multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: people.map(p => p.id), now: createdAt,
      update: { operation: "approve" as const, gameId: first.id, expectedTermsVersion: 1 } };
    vi.stubEnv("MURPH_GAME_REQUIRE_CURRENT_TERMS", "true");
    expect(await runGameChatUpdate(joinInput)).toMatchObject({ ok: false, error: { code: "TERMS_REQUIRED" } });
    vi.stubEnv("MURPH_GAME_REQUIRE_CURRENT_TERMS", "false");
    await db.gameProfile.delete({ where: { memberId: people[1].id } });
    expect(await runGameChatUpdate(joinInput)).toMatchObject({ ok: false, error: { code: "PROFILE_REQUIRED" } });
    await ok(people[1].id, { type: "setProfile", firstName: "Player", timeZone: "UTC" });
    expect(await runGameChatUpdate({ actorMemberId: people[1].id, multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: people.map(p => p.id), now: createdAt,
      update: { operation: "approve", gameId: first.id, expectedTermsVersion: 1 } })).toMatchObject({ ok: true });
    expect((await gameRow(first.id)).status).toBe("live");
    await db.gameBlock.create({ data: { blockerMemberId: people[1].id, blockedMemberId: people[2].id } });
    expect((await readGameChatState(room, people.map(p => p.id))).games).toEqual([]);
    expect((await readGameChatFundingRooms({ memberIds: [room], now: new Date(), prisma: db })).size).toBe(0);
  });

  it("maps starter edits to original invitee seats and preserves the default task", async () => {
    const people = await Promise.all([person(), person(), person()]);
    const room = await exactRoom(people);
    const game = { id: randomUUID() };
    expect(await runGameChatUpdate({ actorMemberId: people[0].id, multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: people.map(p => p.id), now: createdAt,
      update: { operation: "create", gameId: game.id, terms: { lengthDays: 3, tasks: people.map((p, index) => ({ memberId: p.id, text: index === 2 ? "Private stretch" : "Take a walk" })), schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Choose lunch" }] } } })).toMatchObject({ ok: true });
    expect((await gameRow(game.id)).players).toHaveLength(1);
    const input = { actorMemberId: people[1].id, multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: people.map(p => p.id), now: createdAt,
      update: { operation: "edit_terms" as const, gameId: game.id, expectedTermsVersion: 1,
        terms: { defaultTask: "Run", tasks: [{ memberId: people[0].id, text: "Run" }], schedule: { count: 2 }, stakes: [{ kind: "prize" as const, item: "Choose lunch" }] } } };
    expect(await runGameChatUpdate(input)).toMatchObject({ ok: false });
    expect(await runGameChatUpdate({ ...input, actorMemberId: people[0].id })).toEqual({ ok: true, game: null });
    const shared = await readGameChatState(room, people.map(p => p.id));
    expect(JSON.stringify(shared)).not.toContain("Private stretch");
    const saved = await gameRow(game.id);
    const [storedWords] = await openGameTexts([{ table: "game", field: "terms_words", rowId: saved.id, memberId: saved.wordsOwnerMemberId!, value: saved.termsWordsEncrypted }]);
    expect(storedWords).toContain("Private stretch");
    expect(shared.games[0].lengthDays).toBe(3);
    expect(shared.games[0].terms).toMatchObject({ n: 2, defaultTask: "Run", tasks: [{ seat: 0, text: "Run" }] });
  });

  it("keeps a two-person group rematch on group policy in chat", async () => {
    const people = await Promise.all([person(), person()]);
    const room = await exactRoom(people);
    const previous = await create(people[0], people.slice(1));
    await ok(people[1].id, join(previous.token)); await settle(previous.id, people[0].id);
    const gameId = randomUUID();
    expect(await runGameChatUpdate({ actorMemberId: people[0].id, multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: people.map(p => p.id), now: createdAt,
      update: { operation: "create", gameId, previousGameId: previous.id, terms: { tasks: people.map(p => ({ memberId: p.id, text: "Take a walk" })), schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Choose lunch" }] } } })).toMatchObject({ ok: true });
    expect(await gameRow(gameId)).toMatchObject({ maxPlayers: 10, previousGameId: previous.id, chatContainerMemberId: room });
  });

  it("withholds all shared recap material after a report or block", async () => {
    const people = await Promise.all([person(), person(), person()]);
    const room = await exactRoom(people);
    const game = await create(people[0], people.slice(1));
    await ok(people[1].id, join(game.token)); await ok(people[2].id, join(game.token));
    const post = await entry(game.id, people[1].id, 0);
    await settle(game.id, people[0].id);
    const members = people.map(p => p.id);
    const { hostedGameChatStateSchema } = await import("@murphai/hosted-execution/runtime-control");
    const settled = await readGameChatState(room, members);
    expect(hostedGameChatStateSchema.parse(settled)).toEqual(settled);
    const shared = await readGameRecapMaterial(game.id, room, members);
    expect(shared?.validation.result).toHaveLength(3);
    expect(new Set(shared?.players).size).toBe(3);
    expect(JSON.stringify(shared?.game)).not.toContain('"missed"');
    await ok(people[0].id, { type: "report", gameId: game.id, reportId: randomUUID(), about: "post", reason: "other", entryId: post.id });
    expect(await readGameRecapMaterial(game.id, room, members)).toBeNull();
    await db.gameReport.deleteMany({ where: { gameId: game.id } });
    await db.gameBlock.create({ data: { blockerMemberId: people[0].id, blockedMemberId: people[1].id } });
    expect(await readGameRecapMaterial(game.id, room, members)).toBeNull();
  });

  it("binds unresolved addressees without claiming, accepts a later verified address, and keeps an unjoined relative", async () => {
    const starter = await person();
    const relatives = [{ id: "not-an-account", email: `${randomUUID()}@example.test` }, { id: "also-not-an-account", email: `${randomUUID()}@example.test` }];
    const game = await create(starter, relatives);
    const room = await exactRoom([starter]);
    chatProof.rooms.set(room, [starter.email, ...relatives.map(p => p.email)]);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.example.test");
    const { prepareGameChatInvite, associateGameChatInviteTx } = await import("@/src/lib/game/chat-membership");
    const prepared = await prepareGameChatInvite(`Join https://example.test/g/${game.token}`, room);
    expect(prepared?.memberIds).toEqual([starter.id]);
    await db.$transaction(tx => associateGameChatInviteTx({ prepared, containerMemberId: room, senderMemberId: starter.id, threadId: room, tx }));
    expect((await gameRow(game.id)).chatContainerMemberId).toBe(room);
    expect((await gameRow(game.id)).invitees.every(invitee => invitee.memberId === null)).toBe(true);
    const repeatedAudience = await create(starter, relatives);
    expect((await gameRow(repeatedAudience.id)).chatContainerMemberId).toBe(room);
    const state = await readGameChatState(room, [starter.id], starter.id);
    expect(state.games[0]).toMatchObject({ pendingInviteeCount: 2, players: [{ memberId: starter.id }] });
    expect(state.games[0].terms.tasks).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain("Teammate");
    const { readGameChatFundingRooms } = await import("@/src/lib/game/chat-access");
    expect((await readGameChatFundingRooms({ memberIds: [room], now: new Date(), prisma: db })).get(room)).toBe(room);
    const relative = await person();
    await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: relative.id, prisma: tx, verifiedEmail: { address: relatives[0].email, verifiedAt: createdAt } }));
    const approve = { actorMemberId: relative.id, multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: [starter.id, relative.id], now: createdAt,
      update: { operation: "approve" as const, gameId: game.id, expectedTermsVersion: 1 } };
    expect(await runGameChatUpdate(approve)).toMatchObject({ ok: true });
    expect((await gameRow(game.id)).invitees[0].memberId).toBe(relative.id);
    const outsider = await person();
    expect(await runGameChatUpdate({ ...approve, actorMemberId: outsider.id })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    await settle(game.id, starter.id);
    expect((await readGameRecapMaterial(game.id, room, [starter.id, relative.id]))?.validation.result).toHaveLength(2);
    expect((await gameRow(game.id)).invitees[1].memberId).toBeNull();
  });

  it("returns an explicit composer on replay, binds the accepted invite once, and never retargets", async () => {
    const people = await Promise.all([person(), person(), person()]);
    const command: Extract<GameCommand, { type: "createGame" }> = { type: "createGame", gameId: randomUUID(), maxPlayers: 10, groupWord: "Crew", terms,
      invitees: people.slice(1).map((p, i) => ({ seat: i + 1, recipient: { kind: "email", value: p.email }, firstName: "Private label" })) };
    const [first, concurrent] = await Promise.all([ok(people[0].id, command), ok(people[0].id, command)]);
    expect(concurrent).toMatchObject({ composer: first!.composer, inviteToken: first!.inviteToken });
    expect(first).toMatchObject({ composer: { murphPhoneNumber: "+15555550100" } });
    expect(await ok(people[0].id, command)).toMatchObject({ composer: first!.composer, inviteToken: first!.inviteToken });
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: command.gameId } })).toBe(0);
    const room = await exactRoom(people);
    // Ordinary inbound association precedes runtime admission, including readable key rotation.
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64url")},v2:${Buffer.alloc(32, 8).toString("base64url")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    const { prepareGameChatInvite, associateGameChatInviteTx } = await import("@/src/lib/game/chat-membership");
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.withmurph.ai");
    const prepared = await prepareGameChatInvite(`https://www.withmurph.ai/g/${first!.inviteToken}`, room);
    expect(prepared).not.toBeNull();
    await db.$transaction(tx => associateGameChatInviteTx({ prepared, containerMemberId: room, senderMemberId: people[0].id, threadId: room, tx }));
    expect((await gameRow(command.gameId)).chatContainerMemberId).toBe(room);
    expect((await gameRow(command.gameId)).players).toHaveLength(1);
    const { handleGameChatTool } = await import("@/src/lib/game/chat-tool");
    chatProof.sender = people[0].id;
    const input = { memberId: room, multiplayer: true, runtimeIdentity: null, request: { action: "read_game" as const, includePlayers: true as const, origin: { kind: "accepted_input" as const, assistantInputId: "ain_synthetic_composer" } } };
    const setWake = (room: string) => { chatProof.wake = { kind: "conversation.message", userId: room, message: { channel: "linq", linqMessage: { isFromMe: false, threadIsDirect: false, chatId: room,
      parts: [{ type: "text", value: `https://www.withmurph.ai/g/${first!.inviteToken}` }] }, routeAuthority: { channel: "linq", containerMemberId: room, threadId: room } } }; };
    setWake(room);
    expect((await handleGameChatTool(input)).result.status).toBe("ok");
    expect((await gameRow(command.gameId)).chatContainerMemberId).toBe(room);
    await db.$transaction(tx => associateGameChatInviteTx({ prepared, containerMemberId: room, senderMemberId: people[0].id, threadId: room, tx }));
    await handleGameChatTool(input);
    expect((await gameRow(command.gameId)).players).toHaveLength(1);
    const otherRoom = await exactRoom(people); setWake(otherRoom);
    const otherPrepared = await prepareGameChatInvite(`https://www.withmurph.ai/g/${first!.inviteToken}`, otherRoom);
    await db.$transaction(tx => associateGameChatInviteTx({ prepared: otherPrepared, containerMemberId: otherRoom, senderMemberId: people[0].id, threadId: otherRoom, tx }));
    await handleGameChatTool({ ...input, memberId: otherRoom });
    expect((await gameRow(command.gameId)).chatContainerMemberId).toBe(room);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: command.gameId } })).toBe(0);
  });
});
