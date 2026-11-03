import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import { createHostedEmailLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { areGameGroupsEnabled } from "@/src/lib/game/access";
import { gameAudienceKeys } from "@/src/lib/game/audience";
import { runGameCommand, readGame, readHome, authorizeMediaRead } from "@/src/lib/game/service";
import { openGameTexts } from "@/src/lib/game/crypto";
import { parseStoredResult, canRedeemGroupTicket } from "@/src/lib/game/rules";
import { dayStartInstant, GAME_GRACE_MS } from "@/src/lib/game/time";
import { prepareGameAccountDeletion, applyGameAccountDeletionTx } from "@/src/lib/game/account-deletion";
import type { GameCommand, GameTerms } from "@/src/lib/game/command";

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
  return runGameCommand({ actorMemberId: actor, command, now });
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
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  if (!enabled) return;
  await db.game.deleteMany({ where: { wordsOwnerMemberId: { in: ids } } });
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
    await ok(b.id, join(game.token));
    expect((await gameRow(game.id)).players[1].seat).toBe(1);
  });

  it("serializes the ten-open-game audience limit and rejects duplicate handles or people", async () => {
    const a = await person(), b = await person();
    const attempts = await Promise.all(Array.from({ length: 11 }, () => run(a.id, { type: "createGame", gameId: randomUUID(), maxPlayers: 10,
      groupWord: "Crew", terms, invitees: [{ seat: 1, recipient: { kind: "email", value: b.email } }] })));
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
    expect(await readGame(game.id, b.id)).toBeNull();
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
      editing = runGameCommand({ actorMemberId: a.id,
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
    expect(await readGame(game.id, b.id)).toBeNull();
    expect((await readHome(b.id)).games.some(view => view.id === game.id)).toBe(false);
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
    expect((await readGame(game.id, a.id))?.days[0].others.find(other => other.seat === 1)).toEqual({ entry: null, hidden: true, seat: 1, status: "posted" });
    expect((await readGame(game.id, c.id))?.days[0].others.find(other => other.seat === 1)?.entry?.entryId).toBe(post.id);
    await ok(a.id, { type: "block", memberId: b.id });
    expect((await gameRow(game.id)).status).toBe("live");
    expect((await readHome(a.id)).games.some(view => view.id === game.id)).toBe(true);
    expect((await readGame(game.id, b.id))?.days[0].others.find(other => other.seat === 0)).toEqual({ entry: null, hidden: true, seat: 0, status: "posted" });
    expect(await authorizeMediaRead(a.id, mediaKey)).toBe(false);
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
    expect((await readGame(row.id, b.id))?.terms.tasks).toContainEqual({ seat: 0, text: "Stretch outside" });
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
    expect(await readGame(game.id, b.id)).not.toBeNull();
  });

  it("rejects two different handles resolving to one person and reuses an audience through key rotation", async () => {
    const a = await person(), b = await person(), c = await person();
    const phone = "+12025550123";
    await db.$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phone), memberId: b.id, prisma: tx,
      phoneNumberVerifiedAt: createdAt, signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null, signupPhoneCodeSentAt: null, signupPhoneNumber: null }));
    expect(await run(a.id, { type: "createGame", gameId: randomUUID(), maxPlayers: 10, groupWord: "Crew", terms,
      invitees: [{ seat: 1, recipient: { kind: "email", value: b.email } }, { seat: 2, recipient: { kind: "phone", value: phone } }] }))
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
    const view = await readGame(game.id, a.id);
    expect(view?.players.find(player => player.seat === 1)).toMatchObject({ left: true, memberId: b.id, score: 1 });
    expect(view?.days[0].others.find(player => player.seat === 1)?.entry?.entryId).toBe(past.id);
    expect(await readGame(game.id, b.id)).toBeNull();
    expect((await readHome(b.id)).wallet).toEqual({ held: [], owed: [], redeemed: [] });

    const photo = `game/${c.id}/${"b".repeat(64)}.jpg`;
    await db.gameProfile.update({ where: { memberId: c.id }, data: { photoKey: photo } });
    expect(await authorizeMediaRead(b.id, photo)).toBe(false);
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
