import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { linqRoster } from "./support/linq-roster";
import { reviewGameReport } from "@/src/lib/game/report-review";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import { createHostedEmailLookupKey, createHostedExternalThreadIdentityLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { areGameGroupsEnabled } from "@/src/lib/game/access";
import { readGameMessageRecipient } from "@/src/lib/game/message-recipient";
import { gameAudienceKeys, gameGroupLoreFingerprint } from "@/src/lib/game/audience";
import { runGameCommand, readGame, readHome, readGameChatState, readGameRematchNotice, runGameChatUpdate, readGameRecapMaterial, sealGameRecap, authorizeMediaRead } from "@/src/lib/game/service";
import { assertGameProposalDeliveryCurrentTx } from "@/src/lib/game/chat-delivery-authority";
import { readGameChatFundingRooms } from "@/src/lib/game/chat-access";
import { requestGameRecapRegeneration } from "@/src/lib/game/recap-regeneration";
import { markGameChatGenerationQueuedTx, reserveGameChatLifecycleTx } from "@/src/lib/game/chat-lifecycle-receipt";
import { bindPairGameChat, readGameChatAudience, readGameChatAuthority, readGroupGameNoticeAuthority } from "@/src/lib/game/chat-membership";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import type { HostedGameRecap, HostedGameUpdate } from "@murphai/hosted-execution/runtime-control";
import { hostedGameChatStateSchema } from "@murphai/hosted-execution/runtime-control";
import { openGameTexts } from "@/src/lib/game/crypto";
import { parseStoredResult, parseStoredTerms, parseTermWords, canRedeemGroupTicket } from "@/src/lib/game/rules";
import { dayStartInstant, gameLocalDate, GAME_GRACE_MS } from "@/src/lib/game/time";
import { prepareGameAccountDeletion, applyGameAccountDeletionTx } from "@/src/lib/game/account-deletion";
import type { GameCommand, GameTerms } from "@/src/lib/game/command";
import type { GameSchedule } from "@/src/lib/game/contract";

const chatProof = vi.hoisted(() => ({ rooms: new Map<string, string[]>(), sender: "", wake: null as unknown }));
const lifecycleProof = vi.hoisted(() => ({ destination: vi.fn(), bind: vi.fn(), route: vi.fn(), prepare: vi.fn(), append: vi.fn(), mailbox: vi.fn(), signal: vi.fn() }));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async importOriginal => ({
  ...await importOriginal<object>(),
  resolveHostedAssistantNotificationDestination: lifecycleProof.destination,
  bindHostedAssistantNotificationDestination: lifecycleProof.bind,
  assertHostedAssistantNotificationRouteAuthority: lifecycleProof.route,
  readHostedThreadContainerLinqRouteAuthorities: async ({ containerMemberIds }: { containerMemberIds: string[] }) => ({ nonLinqContainerMemberIds: new Set(), unavailableContainerMemberIds: new Set(),
    authorities: new Map(containerMemberIds.filter(id => chatProof.rooms.has(id)).map(id => [id, { channel: "linq", threadId: id, containerMemberId: id, accountLookupKey: "synthetic-line" }])) }),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async importOriginal => ({
  ...await importOriginal<object>(), getHostedLinqChatSummary: async ({ chatId }: { chatId: string }) => linqRoster({ isGroup: true, handlesComplete: true,
    handles: [{ handle: "+15555550100", isMe: true, status: "active" }, ...(chatProof.rooms.get(chatId) ?? []).map(handle => ({ handle, isMe: false, status: "active" }))] }),
}));
vi.mock("@/src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: async () => {} }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: async () => {} }));
vi.mock("@/src/lib/hosted-routing/thread-route-store", async importOriginal => ({ ...await importOriginal<object>(), assertHostedThreadRouteEgressAuthority: async () => {} }));
vi.mock("@/src/lib/hosted-groups/group-message-sender", () => ({ resolveHostedGroupMessageSenderMemberId: async () => chatProof.sender }));
vi.mock("@/src/lib/hosted-mailbox/store", async importOriginal => ({ ...await importOriginal<object>(), readHostedMailboxConversationWakeByAssistantInputId: async () => chatProof.wake,
  isHostedMailboxItemConsumed: async () => false, prepareHostedMailboxEnvelopeAppend: lifecycleProof.prepare, appendPreparedHostedMailboxEnvelopeTx: lifecycleProof.append, readHostedMailboxItemByDedupeKey: lifecycleProof.mailbox,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: lifecycleProof.signal }));
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
async function groupContext(gameId: string, people: Person[]) {
  const room = await exactRoom(people);
  await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
  return { multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: people.map(p => p.id),
    chatAudience: await readGameChatAudience(room), beforeMutationTx: async () => {} };
}
async function agreeTerms(context: Awaited<ReturnType<typeof groupContext>>, actor: string, voter: string,
  command: Extract<GameCommand, { type: "editTerms" }>, now = createdAt) {
  const proposalId = randomUUID();
  expect(await runGameCommand({ ...context, actorMemberId: actor, now, command: { ...command, proposalId } })).toMatchObject({ ok: true });
  expect(await runGameCommand({ ...context, actorMemberId: voter, now,
    command: { type: "respondChange", gameId: command.gameId, proposalId, decision: "approve" } })).toMatchObject({ ok: true });
  return readGame(command.gameId, actor, true);
}
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
/** A pass takes ten receipts, so being oldest no longer isolates one from earlier tests' pending work in other chats. */
async function parkOtherLifecycleReceipts(receiptId: string) {
  await db.hostedLinqDelivery.updateMany({ where: { source: "game_lifecycle", id: { not: receiptId }, status: { in: ["awaiting_generation", "generation_queued"] } },
    data: { retryAfterAt: new Date("9999-01-01T00:00:00Z") } });
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => {
  if (!enabled) return;
  // Delete the large synthetic entry fixture in one set before roster cascades.
  await db.gameEntry.deleteMany({ where: { memberId: { in: ids } } });
  await cleanupGameFixtures(db, ids);
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
  it("preserves hidden invitation tasks through live editable round-trips and allows invited removal", async () => {
    const [starter, joined, invited] = await Promise.all([person(), person(), person()]);
    const ownTask = { seat: 2, text: "Read a chapter" };
    const game = await create(starter, [joined, invited], { terms: { ...terms, tasks: [ownTask] } });
    const { readInvitePreview } = await import("@/src/lib/game/service");
    expect(await readInvitePreview(game.token, true)).toMatchObject({ terms: { tasks: [] } });
    expect(await readInvitePreview(game.token, true, invited.id)).toMatchObject({ yourTask: ownTask.text });
    // Direct edits can remove and restore an override while the starter is alone.
    await ok(starter.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms });
    expect(await readInvitePreview(game.token, true, invited.id)).toMatchObject({ yourTask: terms.defaultTask });
    await ok(starter.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: 2, terms: { ...terms, tasks: [ownTask] } });
    const draft = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(parseStoredTerms(draft.terms).versions).toHaveLength(1);
    const [draftWords] = await openGameTexts([{ table: "game", field: "terms_words", rowId: game.id,
      memberId: draft.wordsOwnerMemberId, value: draft.termsWordsEncrypted }]);
    expect(parseTermWords(draftWords!).versions).toHaveLength(1);
    expect(await runGameCommand({ actorMemberId: joined.id, multiplayer: true, command: join(game.token, "UTC", 1) }))
      .toMatchObject({ ok: false, error: { code: "TERMS_CHANGED" } });
    await ok(joined.id, join(game.token, "UTC", 3));
    const context = await groupContext(game.id, [starter, joined, invited]);
    const before = await readGame(game.id, starter.id, true);
    expect(before?.terms.tasks.slice().sort((a, b) => a.seat - b.seat)).toEqual([
      { seat: 0, text: terms.defaultTask }, { seat: 1, text: terms.defaultTask },
    ]);
    expect((await readGame(game.id, joined.id, true))?.terms).toEqual(before!.terms);
    // The live editor sends only visible tasks; the server preserves hidden overrides.
    const tasks = before!.terms.tasks.filter(task => task.text !== before!.terms.defaultTask);
    await agreeTerms(context, starter.id, joined.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: before!.terms.n,
      terms: { ...terms, tasks, stakes: [{ kind: "prize", item: "Pick the next movie" }] } });
    expect(await readInvitePreview(game.token, true, invited.id)).toMatchObject({ terms: { n: 4 }, yourTask: ownTask.text });
  });

  it("excludes a removed invitation's stored override from an editable round-trip", async () => {
    const [starter, joined, invited, removed] = await Promise.all([person(), person(), person(), person()]);
    const ownTask = { seat: 2, text: "Read a chapter" };
    const game = await create(starter, [joined, invited, removed], {
      terms: { ...terms, tasks: [ownTask, { seat: 3, text: "Practice piano" }] },
    });
    await ok(joined.id, join(game.token));
    await db.gameInvitee.delete({ where: { gameId_seat: { gameId: game.id, seat: 3 } } });
    const before = await readGame(game.id, starter.id, true);
    expect(before?.terms.tasks.slice().sort((a, b) => a.seat - b.seat)).toEqual([
      { seat: 0, text: terms.defaultTask }, { seat: 1, text: terms.defaultTask },
    ]);
    const tasks = before!.terms.tasks.filter(task => task.text !== before!.terms.defaultTask);
    const context = await groupContext(game.id, [starter, joined, invited, removed]);
    const edited = await agreeTerms(context, starter.id, joined.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: before!.terms.n,
      terms: { ...terms, tasks, stakes: [{ kind: "prize", item: "Pick the next movie" }] } });
    expect(edited?.terms.tasks).toEqual(before!.terms.tasks);
  });

  it("keeps one starter indefinitely invited and activates only on the second acceptance", async () => {
    const a = await person(), b = await person();
    const game = await create(a, [b]);
    expect(await gameRow(game.id)).toMatchObject({ status: "invited", inviteExpiresAt: null, maxPlayers: 10, players: [{ memberId: a.id, seat: 0, joinedAt: createdAt }] });
    await ok(b.id, join(game.token), new Date("2030-05-01T21:00:00Z"));
    const row = await gameRow(game.id);
    expect(row.status).toBe("live");
    expect(row.players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(["2030-05-02", "2030-05-02"]);
    const context = await groupContext(game.id, [a, b]);
    await agreeTerms(context, a.id, b.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms: { ...terms, defaultTask: "Walk outside" } }, new Date("2030-05-01T22:00:00Z"));
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

  it("serializes proposals against stale joins and locks tasks when the first local Day 1 starts", async () => {
    const a = await person("Pacific/Kiritimati"), b = await person(), c = await person();
    const game = await create(a, [b, c]);
    await ok(b.id, join(game.token));
    const context = await groupContext(game.id, [a, b, c]);
    const edit = { type: "editTerms" as const, gameId: game.id, expectedTermsVersion: 1, terms: { ...terms, defaultTask: "Walk outside" } };
    const outcomes = await Promise.all([randomUUID(), randomUUID()].map(proposalId => runGameCommand({ ...context, actorMemberId: a.id, now: createdAt, command: { ...edit, proposalId } })));
    expect(outcomes.filter(result => result.ok)).toHaveLength(1);
    expect(outcomes.filter(result => !result.ok)).toMatchObject([{ error: { code: "CHANGE_PENDING" } }]);
    const pending = (await gameRow(game.id)).pendingChange as { id: string };
    expect(await runGameCommand({ ...context, actorMemberId: b.id, now: createdAt, command: { type: "respondChange", gameId: game.id, proposalId: pending.id, decision: "approve" } })).toMatchObject({ ok: true });
    expect(await run(c.id, join(game.token))).toMatchObject({ ok: false, error: { code: "TERMS_CHANGED" } });
    const boundary = dayStartInstant("2030-03-09", "Pacific/Kiritimati");
    expect((await run(c.id, join(game.token, "UTC", 2), boundary)).ok).toBe(true);
    expect(await runGameCommand({ ...context, actorMemberId: b.id, now: boundary, command: { ...edit, proposalId: randomUUID(), expectedTermsVersion: 2, terms: { ...terms, defaultTask: "Stretch" } } }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "Tasks lock once Day 1 begins." } });
    expect((await gameRow(game.id)).players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(["2030-03-09", "2030-03-09", "2030-03-09"]);
  });

  it("reschedules a retained leaver with the shared calendar before scoring and later admission", async () => {
    const [a, b, c, late] = await Promise.all([person(), person(), person(), person()]);
    const initial: GameTerms = { ...terms, startsOn: "2030-03-11", lengthDays: 7, schedule: { days: [0, 2] } };
    const game = await create(a, [b, c], { terms: initial });
    await ok(b.id, join(game.token)); await ok(c.id, join(game.token));
    const context = await groupContext(game.id, [a, b, c]);
    await agreeTerms(context, a.id, c.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms: { ...initial, startsOn: "2030-03-13" } });
    await ok(b.id, { type: "leave", gameId: game.id });
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

  it("moves Day 1 by agreement until a check-in, rechecked under the approval lock", async () => {
    const a = await person(), b = await person();
    const game = await create(a, [b]); await ok(b.id, join(game.token));
    const context = await groupContext(game.id, [a, b]);
    let now = new Date("2030-03-09T12:00:00Z");
    const edit = (startsOn: string, expectedTermsVersion: number, proposalId = randomUUID()) => runGameCommand({ ...context, actorMemberId: a.id, now,
      command: { type: "editTerms", gameId: game.id, expectedTermsVersion, proposalId, terms: { ...terms, startsOn } } });
    expect(await edit("2030-03-08", 1)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await agreeTerms(context, a.id, b.id, { type: "editTerms", gameId: game.id, expectedTermsVersion: 1, terms: { ...terms, startsOn: "2030-03-10" } }, now);
    expect((await gameRow(game.id)).players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(["2030-03-10", "2030-03-10"]);
    now = new Date("2030-03-10T12:00:00Z");
    const proposalId = randomUUID();
    expect(await edit("2030-03-11", 2, proposalId)).toMatchObject({ ok: true });
    let prepared!: () => void;
    const preparing = new Promise<void>(resolve => { prepared = resolve; });
    let approving!: ReturnType<typeof runGameCommand>;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${game.id} FOR UPDATE`;
      approving = runGameCommand({ ...context, actorMemberId: b.id, now, beforeMutationTx: async () => { prepared(); },
        command: { type: "respondChange", gameId: game.id, proposalId, decision: "approve" } });
      void approving.then(prepared, prepared);
      await preparing;
      await tx.gameEntry.create({ data: { id: randomUUID(), gameId: game.id, memberId: b.id, dayIndex: 0, attempt: 1, kind: "words", mediaKeys: [], receivedAt: now } });
    });
    expect(await approving).toMatchObject({ ok: false, error: { code: "CHANGE_EXPIRED" } });
    expect(await gameRow(game.id)).toMatchObject({ pendingChange: null, terms: { versions: [{ n: 2 }] } });
    expect(await db.gameEvent.findFirst({ where: { gameId: game.id, type: "change_expired" } })).toMatchObject({ payload: { proposalId, reason: "The start date locks once someone checks in." } });
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

  it("names each group invitee in invitees, never in a one-on-one recipient", async () => {
    const a = await person(), b = await person();
    expect(await run(a.id, { type: "createGame", gameId: randomUUID(), maxPlayers: 10, groupWord: "Crew", terms,
      invitees: [{ seat: 1, firstName: "Player", recipient: { kind: "email", value: b.email } }], inviteeRecipient: { kind: "email", value: b.email } }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("never counts a group as a one-on-one game: an invite to a group-mate is an open link with no number to text", async () => {
    const a = await person(), b = await person();
    for (const [p, phone] of [[a, "+15555550311"], [b, "+15555550312"]] as const) await db.$transaction(tx => upsertHostedMemberIdentity({
      ...buildHostedMemberPhoneIdentityFields(phone), memberId: p.id, prisma: tx, phoneNumberVerifiedAt: createdAt, signupPhoneNumber: null }));
    // A group of just the two of them, live.
    const group = await create(a, [b]);
    await ok(b.id, join(group.token));
    expect((await gameRow(group.id)).status).toBe("live");
    const pairTerms: GameTerms = { startsOn: terms.startsOn, lengthDays: 10, schedule: { count: 10 }, stakes: terms.stakes,
      tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Walk" }] };
    const invite = async () => (await ok(a.id, { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player", inviteeMemberId: b.id, terms: pairTerms }))!;
    const inviteeOf = async (id: string) => (await db.gameInvitee.findUniqueOrThrow({ where: { gameId_seat: { gameId: id, seat: 1 } } })).memberId;

    // Picked by who they are: the group isn't a one-on-one game, so it's an open link.
    const open = await invite();
    expect(await inviteeOf(open.id)).toBeNull();
    // Even an invite addressed to them gets no number from the group.
    await db.gameInvitee.update({ where: { gameId_seat: { gameId: open.id, seat: 1 } }, data: { memberId: b.id } });
    expect(await readGameMessageRecipient(open.id, a.id)).toBeNull();

    // Once they shake on a one-on-one game, it's addressed and texts them.
    await ok(b.id, join(open.inviteToken!));
    const again = await invite();
    expect(await inviteeOf(again.id)).toBe(b.id);
    expect(await readGameMessageRecipient(again.id, a.id)).toBe("+15555550312");
  });

  it("rejects two different handles resolving to one person and reuses an audience through key rotation", async () => {
    const a = await person(), b = await person(), c = await person();
    const phone = "+12025550123";
    await db.$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phone), memberId: b.id, prisma: tx,
      phoneNumberVerifiedAt: createdAt, signupPhoneNumber: null }));
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
      .toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
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

// Authentication is stubbed here, so its commit-time recheck is too; game-api-postgres proves the real one.
vi.mock("@/src/lib/better-auth/native-auth", async importOriginal => ({ ...await importOriginal<object>(), assertHostedNativeMemberAuthCurrentTx: async () => {} }));
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
    expect(await readInvitePreview(game.token, true)).toBeNull();
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
    await cleanupGameFixtures(db, [viewer.id]);
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
    console.info(JSON.stringify(metrics));
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
  it.each([false, true])("keeps a bound pair's reads, commands, photos and inherited room with a bystander (registered: %s)", async registered => {
    const people = [await person(), await person()];
    const bystander = registered ? await person() : { id: "", email: "bystander@example.test" };
    const room = await exactRoom(people);
    const makePair = async () => {
      const result = await runGameCommand({ actorMemberId: people[0].id, command: { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player",
        terms: { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Pair walk" }, { seat: 1, text: "Pair read" }] } }, now: createdAt });
      if (!result.ok || !result.game?.inviteToken) throw new Error("Pair fixture creation failed");
      expect(await runGameCommand({ actorMemberId: people[1].id, command: join(result.game.inviteToken), now: createdAt })).toMatchObject({ ok: true });
      return result.game.id;
    };
    const gameId = await makePair();
    const players = people.map(p => p.id);
    expect(await bindPairGameChat(gameId, players, room)).toBe(room);
    chatProof.rooms.set(room, [...people.map(p => p.email), bystander.email]);
    const audience = await readGameChatAudience(room);
    expect(await readGameChatAuthority(await gameRow(gameId), room, audience)).not.toBeNull();
    expect(await readGameChatFundingRooms({ memberIds: [room], now: new Date(), prisma: db })).toEqual(new Map([[room, room]]));
    const { handleGameChatTool } = await import("@/src/lib/game/chat-tool");
    const input = { memberId: room, multiplayer: true, runtimeIdentity: null };
    const origin = { kind: "accepted_input" as const, assistantInputId: "ain_synthetic_open_room" };
    chatProof.sender = people[0].id; chatProof.wake = leaverChatWake(room);
    const read = await handleGameChatTool({ ...input, request: { action: "read_game", origin, includePlayers: true } });
    expect(read).toMatchObject({ result: { status: "ok", state: { games: [{ id: gameId }], players: expect.any(Array) } } });
    expect(read.result).not.toHaveProperty("loreFingerprint");
    expect(read.result.state?.players?.map(p => p.memberId).sort()).toEqual([...players].sort());
    await db.game.update({ where: { id: gameId }, data: { devClockOffsetMs: BigInt(new Date("2030-03-09T12:00:01Z").getTime() - Date.now()) } });
    const download = vi.spyOn(await import("@/src/lib/game/chat-photo-media"), "downloadGameChatPhoto").mockResolvedValue({ bytes: new Uint8Array([255, 216, 255]), contentType: "image/jpeg" });
    const { mediaKeyPrefixFor } = await import("@/src/lib/game/access");
    vi.spyOn(await import("@/src/lib/game/media"), "putGameMedia").mockResolvedValue(`${mediaKeyPrefixFor(people[0].id)}${"a".repeat(64)}.jpg`);
    vi.spyOn(await import("@/src/lib/game/media"), "statGameMedia").mockResolvedValue({ byteLength: 3, contentType: "image/jpeg" });
    const photo = { action: "game_photo" as const, origin, photo: { operation: "save" as const, gameId, sourceMessageRef: origin.assistantInputId, attachmentOrdinal: 1 } };
    for (let attempt = 0; attempt < 2; attempt++) {
      const saved = await handleGameChatTool({ ...input, request: photo });
      expect(saved.result.error).toBeUndefined();
      expect(saved).toMatchObject({ result: { status: "ok", photoOutcome: "saved" } });
    }
    expect(download).toHaveBeenCalledOnce();
    expect(await db.gameEntry.count({ where: { gameId, memberId: people[0].id, kind: "photo" } })).toBe(1);
    chatProof.sender = people[1].id;
    await db.game.update({ where: { id: gameId }, data: { devClockOffsetMs: BigInt(new Date("2030-03-10T12:00:00Z").getTime() - Date.now()) } });
    chatProof.rooms.set(room, people.map(p => p.email));
    const service = await import("@/src/lib/game/service");
    const applyUpdate = service.runGameChatUpdate;
    vi.spyOn(service, "runGameChatUpdate").mockImplementation(async input => {
      const result = await applyUpdate(input);
      chatProof.rooms.set(room, [...people.map(p => p.email), bystander.email]);
      return result;
    });
    const command = { action: "update_game" as const, origin, update: { operation: "mark_complete" as const, gameId, date: "2030-03-09", text: "Read outside" } };
    const changed = await handleGameChatTool({ ...input, request: command });
    expect(changed.result.error).toBeUndefined();
    expect(changed).toMatchObject({ result: { status: "ok", state: { games: [{ id: gameId }] } } });
    expect(await handleGameChatTool({ ...input, request: command })).toMatchObject({ result: { status: "ok" } });
    expect(await db.gameEvent.count({ where: { gameId, type: "day_credited" } })).toBe(1);
    if (registered) {
      chatProof.sender = bystander.id;
      expect(await handleGameChatTool({ ...input, request: command })).toMatchObject({ result: { status: "rejected" } });
      await db.hostedMember.update({ where: { id: bystander.id }, data: { suspendedAt: new Date() } });
      expect(await readGameChatAuthority(await gameRow(gameId), room, audience)).toBeNull();
      await db.hostedMember.update({ where: { id: bystander.id }, data: { suspendedAt: null } });
      await db.gameBlock.create({ data: { blockerMemberId: bystander.id, blockedMemberId: players[0] } });
      expect(await readGameChatAuthority(await gameRow(gameId), room, audience)).toBeNull();
      await db.gameBlock.deleteMany({ where: { blockerMemberId: bystander.id } });
    }
    const inherited = await makePair();
    expect(await bindPairGameChat(inherited, players, null)).toBe(room);
    expect(await readGameChatAuthority(await gameRow(inherited), room)).not.toBeNull();
    chatProof.rooms.set(room, [people[0].email, bystander.email]);
    expect(await readGameChatAuthority(await gameRow(gameId), room)).toBeNull();
  });

  it.each([false, true])("keeps the app recap but holds private pair text in an expanded room (registered bystander: %s)", async registered => {
    const people = [await person(), await person()], members = people.map(person => person.id);
    const bystander = registered ? await person() : { id: "", email: "bystander@example.test" };
    const room = await exactRoom(people);
    const created = await runGameCommand({ actorMemberId: people[0].id, command: { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player",
      terms: { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }] } }, now: createdAt });
    if (!created.ok || !created.game?.inviteToken) throw new Error("Expected pair invitation");
    const game = { id: created.game.id, token: created.game.inviteToken };
    await ok(people[1].id, join(game.token));
    await bindPairGameChat(game.id, members, room);
    chatProof.rooms.set(room, [...people.map(person => person.email), bystander.email]);
    prepareGroupLifecycle(room);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    const { readGameProposalDeliveryPlayers } = await import("@/src/lib/game/chat-delivery");
    expect(await deliverGameChatLifecycle(game.id, "started")).toBe(true);
    expect(lifecycleProof.append).toHaveBeenCalledOnce();
    const authority = await readGameProposalDeliveryPlayers(`game-started:${game.id}`, room, room);
    if (!authority || "policy" in authority) throw new Error("Expected game room authority");
    const dispatch = () => db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: room,
      deliveryIdempotencyKey: `game-started:${game.id}`, audience: authority }));
    expect(await dispatch()).toBe(true);
    if (registered) {
      await db.hostedMember.update({ where: { id: bystander.id }, data: { suspendedAt: createdAt } });
      await expect(dispatch()).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
      await db.hostedMember.update({ where: { id: bystander.id }, data: { suspendedAt: null } });
    }
    await settle(game.id, people[0].id);
    expect((await readGameRecapMaterial(game.id, room, authority.memberIds, undefined, authority))?.validation.result).toHaveLength(2);
    const sealing = await queuedGroupRecap({ game, room, people, members });
    if (registered) {
      expect(await sealGameRecap({ ...sealing, beforeMutationTx: async tx => {
        await tx.hostedMember.update({ where: { id: bystander.id }, data: { suspendedAt: createdAt } });
      } })).toBeNull();
      expect((await gameRow(game.id)).recapEncrypted).toBeNull();
      await db.hostedMember.update({ where: { id: bystander.id }, data: { suspendedAt: null } });
    }
    expect(await sealGameRecap(sealing)).toEqual(sealing.recap);
    expect(await readGame(game.id, people[1].id)).toMatchObject({ recap: sealing.recap });
    await expect(db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: room,
      deliveryIdempotencyKey: `game-recap:${game.id}`, audience: authority }))).rejects.toMatchObject({ reason: "participants_changed" });
    chatProof.rooms.set(room, people.map(person => person.email));
    const privateAudience = await readGameChatAudience(room);
    expect(await db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: room,
      deliveryIdempotencyKey: `game-recap:${game.id}`, audience: privateAudience }))).toBe(true);
  });

  it("rechecks a pair room restriction after notice preparation before append", async () => {
    const people = [await person(), await person()], bystander = await person(), room = await exactRoom(people);
    const created = await runGameCommand({ actorMemberId: people[0].id, command: { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player",
      terms: { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }] } }, now: createdAt });
    if (!created.ok || !created.game?.inviteToken) throw new Error("Expected pair invitation");
    await ok(people[1].id, join(created.game.inviteToken));
    await bindPairGameChat(created.game.id, people.map(person => person.id), room);
    chatProof.rooms.set(room, [...people.map(person => person.email), bystander.email]);
    prepareGroupLifecycle(room);
    lifecycleProof.prepare.mockImplementationOnce(async () => {
      await db.hostedMember.update({ where: { id: bystander.id }, data: { suspendedAt: createdAt } }); return {};
    });
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(created.game.id, "started")).toBe(false);
    expect(lifecycleProof.append).not.toHaveBeenCalled();
  });

  it.each([false, true])("reads and funds ten players plus a bystander through real room evidence (registered: %s)", async registered => {
    const people = await Promise.all(Array.from({ length: 10 }, () => person()));
    const room = await exactRoom(people);
    const game = await create(people[0], people.slice(1));
    for (const p of people.slice(1)) await ok(p.id, join(game.token));
    const bystander = registered ? await person() : { id: "", email: "outside@example.test" };
    chatProof.rooms.set(room, [...people.map(p => p.email), bystander.email]);
    const audience = await readGameChatAudience(room);
    expect(audience.contacts).toHaveLength(11); expect(audience.keys.candidates).toEqual([]);
    expect(await readGameChatAuthority(await gameRow(game.id), room, audience)).not.toBeNull();
    expect(await readGameChatFundingRooms({ memberIds: [room], now: new Date(), prisma: db })).toEqual(new Map([[room, room]]));
    const { handleGameChatTool } = await import("@/src/lib/game/chat-tool");
    chatProof.sender = people[0].id; chatProof.wake = leaverChatWake(room);
    expect(await handleGameChatTool({ memberId: room, multiplayer: true, runtimeIdentity: null, request: { action: "read_game",
      origin: { kind: "accepted_input", assistantInputId: "ain_synthetic_large_room" } } })).toMatchObject({ result: { status: "ok", state: { games: [{ id: game.id, players: expect.any(Array) }] } } });
    expect(await readGameChatAuthority({ ...await gameRow(game.id), chatContainerMemberId: null }, room, audience)).toBeNull();
  });

  it("delivers and replays pair kickoff in the exact pair room beside a partially joined group", async () => {
    Object.values(lifecycleProof).forEach(mock => mock.mockReset());
    const people = await Promise.all([person(), person()]);
    const groupRoom = await exactRoom(people);
    const relative = { id: "unjoined-relative", email: `${randomUUID()}@example.test` };
    chatProof.rooms.set(groupRoom, [...people.map(p => p.email), relative.email]);
    const group = await create(people[0], [people[1], relative]);
    await ok(people[1].id, join(group.token));
    const phones = ["+15555550301", "+15555550302"];
    for (const [index, p] of people.entries()) await db.$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phones[index]), memberId: p.id, prisma: tx,
      phoneNumberVerifiedAt: createdAt, signupPhoneNumber: null }));
    const pairRoom = await exactRoom(people);
    chatProof.rooms.set(pairRoom, phones);
    const pair = await runGameCommand({ actorMemberId: people[0].id, command: { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player",
      terms: { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Pair walk" }, { seat: 1, text: "Pair read" }] } }, now: createdAt });
    if (!pair.ok || !pair.game?.inviteToken) throw new Error("Pair fixture creation failed");
    expect(await runGameCommand({ actorMemberId: people[1].id, command: join(pair.game.inviteToken), now: createdAt })).toMatchObject({ ok: true });
    expect((await gameRow(pair.game.id)).chatContainerMemberId).toBeNull();
    lifecycleProof.destination.mockResolvedValue({ conversationShape: "thread-container", route: { channel: "linq" } });
    lifecycleProof.bind.mockImplementation(({ memberId }: { memberId: string }) => ({ route: { channel: "linq", delivery: { kind: "thread", target: memberId }, accountId: "line" }, externalThreadRouteAuthority: { channel: "linq", containerMemberId: memberId, threadId: memberId, accountLookupKey: "line-key" } }));
    lifecycleProof.prepare.mockResolvedValue({}); lifecycleProof.append.mockResolvedValue({ mailboxItemId: "pair-notice" });
    lifecycleProof.mailbox.mockResolvedValue(null);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    await expect(deliverGameChatLifecycle(pair.game.id, "started")).resolves.toBe(true);
    expect((await gameRow(pair.game.id)).chatContainerMemberId).toBe(pairRoom);
    expect((await gameRow(group.id)).chatContainerMemberId).toBe(groupRoom);
    expect(lifecycleProof.prepare.mock.calls[0][0].envelope.notification.route.delivery.target).toBe(pairRoom);
    lifecycleProof.mailbox.mockResolvedValue({ id: "pair-notice", consumedAt: null });
    await expect(deliverGameChatLifecycle(pair.game.id, "started")).resolves.toBe(true);
    expect(lifecycleProof.append).toHaveBeenCalledOnce();
    Object.values(lifecycleProof).forEach(mock => mock.mockReset());
  });
  it("withholds scheduled pair state when the capable provider roster adds an unresolved handle", async () => {
    const people = await Promise.all([person(), person()]);
    const room = await exactRoom(people);
    const result = await runGameCommand({ actorMemberId: people[0].id, command: { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player",
      terms: { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Private pair walk" }, { seat: 1, text: "Private pair read" }] } }, now: createdAt });
    if (!result.ok || !result.game?.inviteToken) throw new Error("Pair fixture creation failed");
    expect(await runGameCommand({ actorMemberId: people[1].id, command: join(result.game.inviteToken), now: createdAt })).toMatchObject({ ok: true });
    const { handleGameChatTool } = await import("@/src/lib/game/chat-tool");
    const input = { memberId: room, multiplayer: true, runtimeIdentity: null, request: { action: "read_game" as const,
      origin: { kind: "automation_occurrence" as const, automationId: "synthetic-automation", occurrenceAt: "2030-03-01T12:00:00Z" } } };
    expect(JSON.stringify(await handleGameChatTool(input))).toContain("Private pair walk");
    chatProof.rooms.set(room, [...people.map(p => p.email), "unresolved@example.test"]);
    expect(await handleGameChatTool(input)).toMatchObject({ action: "read_game", result: { status: "ok", state: { games: [] } } });
    const addressed = await create(people[0], [people[1], { id: "unjoined-relative", email: "unresolved@example.test" }]);
    await ok(people[1].id, join(addressed.token));
    expect(await handleGameChatTool(input)).toMatchObject({ result: { status: "ok", state: { games: [{ id: addressed.id, maxPlayers: 10, pendingInviteeCount: 1 }] } } });
  });
  it("enqueues group kickoff and recap with an unjoined relative and keeps roomless pair notices separate", async () => {
    const people = await Promise.all([person(), person()]);
    const relative = { id: "unjoined-relative", email: `${randomUUID()}@example.test` };
    const room = await exactRoom(people);
    chatProof.rooms.set(room, [...people.map(p => p.email), relative.email]);
    const group = await create(people[0], [people[1], relative]);
    await ok(people[1].id, join(group.token));
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    const { readGameNoticeRoom } = await import("@/src/lib/game/service");
    lifecycleProof.destination.mockResolvedValue({ conversationShape: "thread-container", route: { channel: "linq" } });
    lifecycleProof.bind.mockReturnValue({ route: { channel: "linq", delivery: { kind: "thread", target: room }, accountId: "line" }, externalThreadRouteAuthority: { channel: "linq", containerMemberId: room, threadId: room, accountLookupKey: "line-key" } });
    lifecycleProof.prepare.mockResolvedValue({}); lifecycleProof.append.mockResolvedValue({ mailboxItemId: "synthetic-notice" });
    lifecycleProof.mailbox.mockResolvedValue(null);
    await expect(deliverGameChatLifecycle(group.id, "started")).resolves.toBe(true);
    expect(lifecycleProof.append).toHaveBeenCalledOnce();
    expect(lifecycleProof.prepare.mock.calls[0][0].envelope.notification).toMatchObject({ deliveryIdempotencyKey: `game-started:${group.id}`, responsePolicy: { kind: "require_send" } });
    expect(await db.hostedLinqDelivery.findFirst({ where: { sourceRef: group.id, template: "game_started" } })).toMatchObject({ status: "generation_queued" });
    lifecycleProof.mailbox.mockResolvedValue({ id: "synthetic-notice", consumedAt: null });
    await expect(deliverGameChatLifecycle(group.id, "started")).resolves.toBe(true);
    expect(lifecycleProof.append).toHaveBeenCalledOnce();
    await expect(readGameNoticeRoom(group.id, people.map(p => p.id))).resolves.toBeUndefined();
    await settle(group.id, people[0].id);
    lifecycleProof.mailbox.mockResolvedValue(null);
    await expect(deliverGameChatLifecycle(group.id, "recap")).resolves.toBe(true);
    expect(lifecycleProof.append).toHaveBeenCalledTimes(2);
    expect(lifecycleProof.prepare.mock.calls[1][0].envelope.notification).toMatchObject({ deliveryIdempotencyKey: `game-recap:${group.id}`, responsePolicy: { kind: "require_game_recap", pairFingerprint: gameGroupLoreFingerprint((await gameRow(group.id)).audienceKey!), loreAccess: "read" } });
    expect((await gameRow(group.id)).invitees[1].memberId).toBeNull();
    lifecycleProof.mailbox.mockResolvedValue({ id: "synthetic-recap", consumedAt: null });
    await expect(deliverGameChatLifecycle(group.id, "recap")).resolves.toBe(true);
    expect(lifecycleProof.append).toHaveBeenCalledTimes(2);
    // The pair notice reader must not load a group merely because its two seated IDs match.
    const pairTerms = { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Pair walk" }, { seat: 1, text: "Pair read" }] };
    const pairs = [];
    for (let i = 0; i < 2; i++) {
      const result = await runGameCommand({ actorMemberId: people[0].id, command: { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Player", terms: pairTerms }, now: createdAt });
      if (!result.ok) throw new Error(result.error.code);
      if (!result.game?.inviteToken) throw new Error("Pair fixture token missing");
      await runGameCommand({ actorMemberId: people[1].id, command: join(result.game.inviteToken), now: createdAt });
      pairs.push(result.game.id);
    }
    expect(await readGameNoticeRoom(pairs[0], people.map(p => p.id))).toMatchObject({ tasks: ["Pair walk", "Pair read"], otherGames: [{ tasks: ["Pair walk", "Pair read"] }] });
  });
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
    const sealInput = await queuedGroupRecap({ game, room, people, members });
    expect(await sealGameRecap(sealInput)).toEqual(sealInput.recap);
    const before = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    const reportId = randomUUID();
    await ok(people[0].id, { type: "report", gameId: game.id, reportId, about: "post", reason: "other", entryId: post.id });
    expect((await readGame(game.id, people[2].id, true))?.recap).toEqual(sealInput.recap);
    expect(await reviewGameReport({ reportId, removePost: true })).toEqual({ found: true });
    expect((await readGame(game.id, people[2].id, true))?.recap).toBeNull();
    const after = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(after).toEqual({ ...before, recapEncrypted: null, updatedAt: after.updatedAt });
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

async function majorityGame(seated = 4, unjoined = 0) {
  const people = await Promise.all(Array.from({ length: seated + unjoined }, () => person()));
  const game = await create(people[0], people.slice(1), { terms: { ...terms,
    tasks: unjoined ? [{ seat: seated, text: "Private invitation task" }] : [] } });
  for (const player of people.slice(1, seated)) await ok(player.id, join(game.token));
  const context = await groupContext(game.id, people);
  const send = (index: number, update: HostedGameUpdate, now = createdAt) => runGameChatUpdate({ ...context, actorMemberId: people[index].id, now, update });
  const proposalId = randomUUID();
  const edit = (overrides: Partial<Extract<HostedGameUpdate, { operation: "edit_terms" }>> = {}): Extract<HostedGameUpdate, { operation: "edit_terms" }> => ({
    operation: "edit_terms", gameId: game.id, expectedTermsVersion: 1, proposalId,
    terms: { ...terms, defaultTask: terms.defaultTask!, tasks: people.slice(0, seated).map(p => ({ memberId: p.id, text: terms.defaultTask! })),
      stakes: [{ kind: "prize", item: "Pick a movie" }] }, ...overrides,
  });
  const vote = (index: number, decision: "approve" | "decline" | "cancel", now = createdAt) => send(index, { operation: decision, gameId: game.id, proposalId }, now);
  const shared = async () => {
    const state = await readGameChatState(context.chatContainerMemberId, people.map(p => p.id), people[0].id);
    expect(hostedGameChatStateSchema.safeParse(state).success).toBe(true);
    return state.games.find(candidate => candidate.id === game.id)!;
  };
  return { people, game, context, send, proposalId, edit, vote, shared };
}

describe.skipIf(!enabled)("group majority changes", () => {
  it.each([
    { scalar: "duration", starter: 0 }, { scalar: "duration", starter: 1 },
    { scalar: "schedule", starter: 0 }, { scalar: "schedule", starter: 1 },
  ])("Same again inherits words after a real $scalar-only change with starter $starter", async ({ scalar, starter }) => {
    const g = await majorityGame(3, 1);
    const before = await gameRow(g.game.id);
    const edit = g.edit();
    edit.terms.stakes = [{ kind: "prize", item: "Choose our next outing" }];
    if (scalar === "duration") edit.terms.lengthDays = 12;
    else edit.terms.schedule = { days: [0, 2, 4] };
    expect(await g.send(0, edit)).toMatchObject({ ok: true });
    expect(await g.vote(1, "approve")).toMatchObject({ ok: true });
    const changed = await gameRow(g.game.id);
    expect(changed.termsWordsEncrypted).toBe(before.termsWordsEncrypted);
    expect(changed.terms).toMatchObject({ versions: [{ n: 2 }] });
    await settle(g.game.id, g.people[0].id);
    const copied = await create(g.people[starter], [], { previousGameId: g.game.id });
    const row = await gameRow(copied.id);
    expect(row.lengthDays).toBe(scalar === "duration" ? 12 : 10);
    expect(row.terms).toMatchObject({ versions: [{ n: 1, schedule: scalar === "schedule" ? { days: [0, 2, 4] } : { count: 10 } }] });
    const notice = await readGameRematchNotice(copied.id, g.people.map(p => p.id));
    expect(notice).toMatchObject({ maxPlayers: 10, termsVersion: 1, comparison: { sameGame: true } });
    expect(JSON.stringify(notice)).not.toContain("Private invitation task");
  });

  it("Same again takes v3 words through a v1-word, v2-scalar, v3-word, v4-scalar sequence", async () => {
    const g = await majorityGame(3, 1);
    for (let revision = 1; revision <= 3; revision++) {
      const edit = g.edit({ expectedTermsVersion: revision, proposalId: randomUUID() });
      edit.terms = { ...edit.terms, lengthDays: revision === 3 ? 14 : 12,
        stakes: [{ kind: "prize", item: revision >= 2 ? "Choose a concert" : "Choose our next outing" }] };
      expect(await g.send(0, edit)).toMatchObject({ ok: true });
      expect(await g.send(1, { operation: "approve", gameId: g.game.id, proposalId: edit.proposalId! })).toMatchObject({ ok: true });
    }
    const prior = await gameRow(g.game.id);
    const [plain] = await openGameTexts([{ table: "game", field: "terms_words", rowId: prior.id, memberId: prior.wordsOwnerMemberId, value: prior.termsWordsEncrypted }]);
    expect(JSON.parse(plain!).versions.map((words: { n: number }) => words.n)).toEqual([1, 3]);
    await settle(g.game.id, g.people[0].id);
    const copied = await create(g.people[1], [], { previousGameId: g.game.id });
    const notice = await readGameRematchNotice(copied.id, g.people.map(p => p.id));
    expect(notice).toMatchObject({ comparison: { sameGame: true }, terms: { lengthDays: 14, stakes: [{ item: "Choose a concert" }] } });
  });

  it.each([false, true])("copies then edits group Same again once with private overrides; joined in between: %s", async joined => {
    const g = await majorityGame(3, 1);
    await settle(g.game.id, g.people[0].id);
    const gameId = randomUUID();
    const requested = { lengthDays: 12, startsOn: "2030-03-15", defaultTask: "Read a chapter", tasks: [{ memberId: g.people[1].id, text: "Read a chapter" }],
      schedule: { days: [0, 2, 4] }, stakes: [{ kind: "prize" as const, item: "Choose the concert" }] };
    const send = (update: HostedGameUpdate) => runGameChatUpdate({ ...g.context, actorMemberId: g.people[1].id, now: createdAt, update });
    expect(await send({ operation: "create", gameId, previousGameId: g.game.id, terms: { ...requested, tasks: g.people.map(p => ({ memberId: p.id, text: "Read a chapter" })) } })).toMatchObject({ ok: true });
    expect(await gameRow(gameId)).toMatchObject({ maxPlayers: 10, lengthDays: 10, startsOn: null });
    if (joined) {
      const view = await readGame(gameId, g.people[1].id, true);
      await ok(g.people[0].id, join(view!.inviteToken!));
      requested.tasks.push({ memberId: g.people[0].id, text: "Read a chapter" });
    }
    const proposalId = randomUUID();
    const firstEdit = await send({ operation: "edit_terms", gameId, expectedTermsVersion: 1, proposalId, terms: requested });
    if (joined) {
      expect(firstEdit).toMatchObject({ ok: false });
      expect(await send({ operation: "edit_terms", gameId, expectedTermsVersion: 1, proposalId: randomUUID(), terms: {
        ...requested, startsOn: "2030-03-01", defaultTask: "Take a walk", tasks: requested.tasks.map(task => ({ ...task, text: "Take a walk" })), schedule: { count: 10 },
      } })).toMatchObject({ ok: true });
    } else expect(firstEdit).toMatchObject({ ok: true });
    const row = await gameRow(gameId);
    expect(row.lengthDays).toBe(joined ? 10 : 12);
    if (joined) expect(row.pendingChange).not.toBeNull();
    else expect(row.startsOn?.toISOString().slice(0, 10)).toBe("2030-03-15");
    const [plain] = await openGameTexts([{ table: "game", field: "terms_words", rowId: row.id, memberId: row.wordsOwnerMemberId, value: row.termsWordsEncrypted }]);
    expect(plain).toContain("Private invitation task");
    expect(await db.game.count({ where: { previousGameId: g.game.id } })).toBe(1);
  });

  it.each(["task", "prize", "date"])("fences prepared and generated rematch facts after a %s edit without another receipt", async changed => {
    const g = await majorityGame(3, 1);
    await settle(g.game.id, g.people[0].id);
    const copied = await create(g.people[1], [], { previousGameId: g.game.id });
    const notice = await readGameRematchNotice(copied.id, g.people.map(p => p.id));
    expect(notice).toMatchObject({ termsVersion: 1 });
    const delivery = { tx: db, containerMemberId: g.context.chatContainerMemberId, audience: g.context.chatAudience, deliveryIdempotencyKey: `game-rematch:${copied.id}`, rematchTermsVersion: 1 };
    expect(await assertGameProposalDeliveryCurrentTx(delivery)).toBe(true);
    await expect(assertGameProposalDeliveryCurrentTx({ ...delivery, rematchTermsVersion: null })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    const { startsOn: _start, ...copiedTerms } = terms;
    await ok(g.people[1].id, { type: "editTerms", gameId: copied.id, expectedTermsVersion: 1, terms: { ...copiedTerms,
      ...(changed === "date" ? { startsOn: "2030-03-15" } : {}),
      stakes: changed === "prize" ? [{ kind: "prize", item: "Choose a concert" }] : terms.stakes,
      tasks: [{ seat: 3, text: changed === "task" ? "Hidden new assignment" : "Private invitation task" }],
    } });
    await expect(assertGameProposalDeliveryCurrentTx(delivery)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    const updated = await readGameRematchNotice(copied.id, g.people.map(p => p.id));
    expect(updated).toMatchObject({ termsVersion: 2, startsOn: changed === "date" ? "2030-03-15" : null,
      comparison: { sameGame: changed === "date", individualTasksChanged: changed === "task" } });
    expect(JSON.stringify(updated)).not.toContain("Hidden new assignment");
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: copied.id, template: "game_rematch" } })).toBe(1);
  });
  it("lets a non-starter propose full terms, keeps private words, and applies with the deciding voter", async () => {
    const g = await majorityGame(4, 1);
    const edit = g.edit();
    edit.terms = { ...edit.terms, defaultTask: "Walk outside", lengthDays: 12, startsOn: "2030-03-10", schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
      tasks: g.people.slice(0, 4).map((p, index) => ({ memberId: p.id, text: index === 0 ? "Read" : "Walk outside" })) };
    expect(await g.send(1, edit)).toMatchObject({ ok: true });
    expect(await g.send(1, edit)).toMatchObject({ ok: true });
    const stored = (await gameRow(g.game.id)).pendingChange;
    expect(stored).toMatchObject({ origin: "chat", deliveryStatus: "conversation", votes: { [g.people[1].id]: "yes" }, tasksChanged: true,
      change: { kind: "edit", lengthDays: 12, startsOn: "2030-03-10" } });
    expect(JSON.stringify(stored)).not.toMatch(/Walk outside|Private invitation task|Pick a movie/u);
    const pending = (await g.shared()).pendingChange;
    expect(pending).toMatchObject({ yesNeeded: 2, votes: [{ memberId: g.people[1].id, vote: "yes" }], change: { defaultTask: "Walk outside",
      tasks: [{ seat: 0, text: "Read" }, ...[1, 2, 3].map(seat => ({ seat, text: "Walk outside" }))] } });
    expect(JSON.stringify(pending)).not.toContain("Private invitation task");
    expect(await readGame(g.game.id, g.people[0].id, true)).toMatchObject({ pendingChange: { id: g.proposalId, yesNeeded: 2 }, permissions: { canEditTerms: false },
      changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, canEditTasks: false, canEditStakes: false, editableFromDay: null } });
    for (const decision of ["approve", "decline"] as const) expect(await g.vote(1, decision)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "You already count as a yes." } });
    expect(await g.vote(4, "approve")).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await g.vote(0, "approve")).toMatchObject({ ok: true });
    expect((await g.shared()).pendingChange).toMatchObject({ yesNeeded: 1 });
    expect(await g.vote(0, "approve")).toMatchObject({ ok: true });
    expect(await g.vote(0, "decline")).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "You already said yes to this change." } });
    expect(await g.vote(2, "approve")).toMatchObject({ ok: true });
    expect(await g.shared()).toMatchObject({ pendingChange: null, lengthDays: 12, startsOn: "2030-03-10", terms: { n: 2, fromDay: 0, defaultTask: "Walk outside" } });
    const applied = await gameRow(g.game.id);
    expect(applied.players.map(p => p.dayOne?.toISOString().slice(0, 10))).toEqual(Array(4).fill("2030-03-10"));
    const [plain] = await openGameTexts([{ table: "game", field: "terms_words", rowId: applied.id, memberId: applied.wordsOwnerMemberId, value: applied.termsWordsEncrypted }]);
    expect(JSON.parse(plain!)).toMatchObject({ groupWord: "Crew", versions: [{ n: 1 }, { n: 2, defaultTask: "Walk outside", tasks: [{ seat: 0, text: "Read" }, { seat: 4, text: "Private invitation task" }] }] });
    expect(await db.gameEvent.findUnique({ where: { commandKey: `game-change-resolved:${g.game.id}:${g.proposalId}` } })).toMatchObject({ type: "change_applied", actor: g.people[2].id });
    for (const index of [0, 2]) expect(await g.vote(index, "approve")).toMatchObject({ ok: true });
    expect(await g.vote(0, "decline")).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await g.send(1, edit)).toMatchObject({ ok: true });
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_voted" } })).toBe(2);
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_proposed" } })).toBe(1);
    const receipt = await db.gameEvent.findUnique({ where: { commandKey: `game-change-vote:${g.game.id}:${g.proposalId}:${g.people[0].id}` } });
    expect(receipt?.payload).toEqual({ v: 1, proposalId: g.proposalId, vote: "yes" });
  });

  it("serializes concurrent votes in a ten-player game with one application and one receipt per voter", async () => {
    const g = await majorityGame(10);
    expect(await g.send(0, g.edit())).toMatchObject({ ok: true });
    expect((await g.shared()).pendingChange?.yesNeeded).toBe(5);
    const outcomes = await Promise.all([1, 2, 3, 4, 5, 1].map(index => g.vote(index, "approve")));
    expect(outcomes.every(result => result.ok)).toBe(true);
    expect(await g.shared()).toMatchObject({ pendingChange: null, terms: { n: 2 } });
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_voted" } })).toBe(5);
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_applied" } })).toBe(1);
  });

  it("closes only when a majority is impossible and keeps no votes final after resolution", async () => {
    const g = await majorityGame();
    expect(await g.send(0, g.edit())).toMatchObject({ ok: true });
    expect(await g.vote(1, "decline")).toMatchObject({ ok: true });
    expect((await g.shared()).pendingChange).toMatchObject({ yesNeeded: 2 });
    expect(await g.vote(1, "decline")).toMatchObject({ ok: true });
    expect(await g.vote(1, "approve")).toMatchObject({ ok: false, error: { message: "You already said no to this change." } });
    expect(await g.vote(2, "decline")).toMatchObject({ ok: true });
    expect(await g.shared()).toMatchObject({ pendingChange: null, terms: { n: 1 } });
    expect(await db.gameEvent.findUnique({ where: { commandKey: `game-change-resolved:${g.game.id}:${g.proposalId}` } })).toMatchObject({ type: "change_declined", payload: { v: 1, proposalId: g.proposalId } });
    expect((await db.gameEvent.findFirst({ where: { gameId: g.game.id, type: "change_declined" } }))?.payload).toMatchObject({ v: 1, proposalId: g.proposalId, tally: { yes: 1, no: 2, total: 4 } });
    expect(await g.vote(1, "decline")).toMatchObject({ ok: true });
    expect(await g.vote(1, "approve")).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_voted" } })).toBe(2);
  });

  it("allows only the proposer to cancel and only one ask at a time", async () => {
    const g = await majorityGame(3);
    expect(await g.send(1, g.edit())).toMatchObject({ ok: true });
    expect(await g.send(0, g.edit({ proposalId: randomUUID() }))).toMatchObject({ ok: false, error: { code: "CHANGE_PENDING" } });
    expect(await g.vote(0, "cancel")).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await g.vote(1, "cancel")).toMatchObject({ ok: true });
    expect(await g.vote(1, "cancel")).toMatchObject({ ok: true });
    expect(await g.shared()).toMatchObject({ pendingChange: null, terms: { n: 1 } });
    expect(await g.send(0, g.edit({ proposalId: randomUUID() }))).toMatchObject({ ok: true });
  });

  it("refuses old runners, pair deltas and unchanged full terms on a live group", async () => {
    const g = await majorityGame(2);
    const command: GameCommand = { type: "editTerms", gameId: g.game.id, expectedTermsVersion: 1, proposalId: g.proposalId, terms };
    expect(await run(g.people[0].id, command)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "Nothing changed." } });
    expect(await run(g.people[0].id, { type: "proposeChange", gameId: g.game.id, proposalId: randomUUID(), expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 12 } }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "Use full terms to request a group edit." } });
    expect(await g.send(0, g.edit({ proposalId: undefined }))).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: expect.stringContaining("proposalId") } });
    expect(await g.send(0, { operation: "propose", gameId: g.game.id, proposalId: g.proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 12 } }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: expect.stringContaining("edit_terms") } });
    expect(await runGameCommand({ ...g.context, actorMemberId: g.people[1].id, now: createdAt, command })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "Nothing changed." } });
    expect(await runGameCommand({ ...g.context, beforeMutationTx: undefined, actorMemberId: g.people[1].id, now: createdAt, command }))
      .toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
  });

  it("calls off a live group only when every remaining player says yes in its chat", async () => {
    const g = await majorityGame(3);
    const callOff = { operation: "propose" as const, gameId: g.game.id, proposalId: g.proposalId, expectedTermsVersion: 1, change: { kind: "call_off" as const } };
    expect(await g.send(1, callOff)).toMatchObject({ ok: true });
    expect((await g.shared()).pendingChange).toMatchObject({ id: g.proposalId, change: { kind: "call_off" }, yesNeeded: 2 });
    expect(await g.vote(0, "approve")).toMatchObject({ ok: true });
    // A majority is not enough, and an app vote can't finish it.
    expect(await gameRow(g.game.id)).toMatchObject({ status: "live" });
    expect((await g.shared()).pendingChange?.yesNeeded).toBe(1);
    expect(await run(g.people[2].id, { type: "respondChange", gameId: g.game.id, proposalId: g.proposalId, decision: "approve" }))
      .toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    for (let i = 0; i < 2; i++) expect(await g.vote(2, "approve")).toMatchObject({ ok: true });
    expect(await gameRow(g.game.id)).toMatchObject({ status: "void", pendingChange: null, result: null, terms: { versions: [{ n: 1 }] } });
    expect(await db.gameEvent.findUnique({ where: { commandKey: `game-change-resolved:${g.game.id}:${g.proposalId}` } }))
      .toMatchObject({ type: "change_applied", payload: { changeKind: "call_off", tally: { yes: 3, no: 0, total: 3 } } });
    expect(await db.gameEvent.findMany({ where: { gameId: g.game.id, type: "cancelled" }, select: { payload: true } }))
      .toEqual([{ payload: { v: 1, calledOff: true, proposalId: g.proposalId } }]);
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_voted" } })).toBe(2);
    expect(await db.hostedLinqDelivery.findMany({ where: { source: "game_lifecycle", sourceRef: { startsWith: g.game.id },
      template: { in: ["game_cancelled", "game_change_resolved", "game_change_expired"] } }, select: { template: true } })).toEqual([{ template: "game_cancelled" }]);
  });

  it("closes a group call-off on the first no and counts every remaining player", async () => {
    const g = await majorityGame(4);
    expect(await g.send(0, { operation: "propose", gameId: g.game.id, proposalId: g.proposalId, expectedTermsVersion: 1, change: { kind: "call_off" } })).toMatchObject({ ok: true });
    expect(await g.vote(1, "approve")).toMatchObject({ ok: true });
    expect(await g.vote(2, "decline")).toMatchObject({ ok: true });
    expect(await gameRow(g.game.id)).toMatchObject({ status: "live", pendingChange: null });
    expect(await db.gameEvent.findUnique({ where: { commandKey: `game-change-resolved:${g.game.id}:${g.proposalId}` } }))
      .toMatchObject({ type: "change_declined", payload: { tally: { yes: 2, no: 1, total: 4 } } });
    const ten = await majorityGame(10);
    expect(await ten.send(3, { operation: "propose", gameId: ten.game.id, proposalId: ten.proposalId, expectedTermsVersion: 1, change: { kind: "call_off" } })).toMatchObject({ ok: true });
    expect((await ten.shared()).pendingChange?.yesNeeded).toBe(9);
  });

  it("adds late joiners to the tally without resolving the ask on join", async () => {
    const g = await majorityGame(2, 2);
    expect(await g.send(0, g.edit())).toMatchObject({ ok: true });
    expect((await g.shared()).pendingChange?.yesNeeded).toBe(1);
    await ok(g.people[2].id, join(g.game.token));
    await ok(g.people[3].id, join(g.game.token));
    expect((await g.shared()).pendingChange?.yesNeeded).toBe(2);
    expect(await g.vote(1, "approve")).toMatchObject({ ok: true });
    expect((await g.shared()).pendingChange?.yesNeeded).toBe(1);
    expect(await g.vote(3, "approve")).toMatchObject({ ok: true });
    expect(await g.shared()).toMatchObject({ pendingChange: null, terms: { n: 2 } });
  });

  it.each([2, 4])("clears the ask when a player leaves a %i-player group", async count => {
    const g = await majorityGame(count);
    expect(await g.send(0, g.edit())).toMatchObject({ ok: true });
    await ok(g.people[1].id, { type: "leave", gameId: g.game.id });
    expect(await gameRow(g.game.id)).toMatchObject({ pendingChange: null, status: count === 2 ? "void" : "live" });
    expect(await db.gameEvent.findFirst({ where: { gameId: g.game.id, type: "change_expired" } })).toMatchObject({ payload: { proposalId: g.proposalId, reason: "The playing roster changed, so that request was cleared without applying it." } });
    const shared = await readGameChatState(g.context.chatContainerMemberId, g.people.map(p => p.id));
    expect(shared.games.map(game => game.id)).toEqual(count === 2 ? [] : [g.game.id]);
    // Departed players can also exit the text while the surviving game stays available.
    chatProof.rooms.set(g.context.chatContainerMemberId, g.people.filter((_, i) => i !== 1).map(p => p.email));
    expect((await readGameChatState(g.context.chatContainerMemberId, g.people.map(p => p.id))).games.map(game => game.id)).toEqual(count === 2 ? [] : [g.game.id]);
  });

  it("applies a duration change from the next unstarted day and retains default task and group word", async () => {
    const g = await majorityGame(3);
    const now = new Date("2030-03-11T12:00:00Z");
    const edit = g.edit(); edit.terms.lengthDays = 12;
    expect(await g.send(1, edit, now)).toMatchObject({ ok: true });
    expect(await g.vote(2, "approve", now)).toMatchObject({ ok: true });
    const saved = await gameRow(g.game.id);
    expect(saved.terms).toMatchObject({ versions: [{ n: 1, fromDay: 0 }, { n: 2, fromDay: 3 }] });
    const [plain] = await openGameTexts([{ table: "game", field: "terms_words", rowId: saved.id, memberId: saved.wordsOwnerMemberId, value: saved.termsWordsEncrypted }]);
    expect(JSON.parse(plain!)).toMatchObject({ groupWord: "Crew", versions: [{ defaultTask: "Take a walk" }, { n: 2, defaultTask: "Take a walk" }] });
  });

  it("treats the shown Day 1 or a missing date as no start change after a check-in", async () => {
    const weekdays: GameSchedule = { days: [0, 1, 2, 3, 4] };
    const [a, b, c] = [await person(), await person(), await person()];
    // A Saturday pick on a weekday schedule: Day 1 lands on Monday 2030-03-11.
    const game = await create(a, [b, c], { terms: { ...terms, schedule: weekdays, startsOn: "2030-03-09" } });
    for (const player of [b, c]) await ok(player.id, join(game.token));
    const context = await groupContext(game.id, [a, b, c]);
    const now = new Date("2030-03-12T12:00:00Z");
    await ok(b.id, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "words", mediaKeys: [], text: "Done" }, now);
    const shown = (await readGameChatState(context.chatContainerMemberId, [a.id, b.id, c.id], a.id)).games.find(candidate => candidate.id === game.id)!;
    expect(shown.startsOn).toBe("2030-03-11");
    expect((await gameRow(game.id)).startsOn?.toISOString().slice(0, 10)).toBe("2030-03-09");
    const { startsOn: _picked, ...base } = terms;
    const ask = (actor: Person, expectedTermsVersion: number, startsOn?: string, proposalId = randomUUID()) => runGameChatUpdate({ ...context, actorMemberId: actor.id, now,
      update: { operation: "edit_terms", gameId: game.id, expectedTermsVersion, proposalId, terms: { ...base, schedule: weekdays, lengthDays: 12,
        defaultTask: terms.defaultTask!, tasks: [a, b, c].map(p => ({ memberId: p.id, text: terms.defaultTask! })), stakes: [{ kind: "prize", item: "Choose our next outing" }],
        ...(startsOn ? { startsOn } : {}) } } });
    const echoed = randomUUID();
    expect(await ask(b, 1, "2030-03-11", echoed)).toMatchObject({ ok: true });
    expect((await gameRow(game.id)).pendingChange).toMatchObject({ change: { kind: "edit", lengthDays: 12 } });
    expect((await gameRow(game.id)).pendingChange).not.toHaveProperty("change.startsOn");
    expect(await runGameChatUpdate({ ...context, actorMemberId: b.id, now, update: { operation: "cancel", gameId: game.id, proposalId: echoed } })).toMatchObject({ ok: true });
    const omitted = randomUUID();
    expect(await ask(b, 1, undefined, omitted)).toMatchObject({ ok: true });
    expect((await gameRow(game.id)).pendingChange).not.toHaveProperty("change.startsOn");
    expect(await runGameChatUpdate({ ...context, actorMemberId: c.id, now, update: { operation: "approve", gameId: game.id, proposalId: omitted } })).toMatchObject({ ok: true });
    const saved = await gameRow(game.id);
    expect(saved).toMatchObject({ pendingChange: null, lengthDays: 12, terms: { versions: [{ n: 1 }, { n: 2 }] } });
    expect(saved.players.map(player => player.dayOne?.toISOString().slice(0, 10))).toEqual(["2030-03-11", "2030-03-11", "2030-03-11"]);
    expect(await ask(a, 2, "2030-03-18")).toMatchObject({ ok: false, error: { code: "DAY_CLOSED" } });
  });

  it("targets a terms report at the applied proposal's author, not the deciding voter", async () => {
    const g = await majorityGame(3);
    expect(await g.send(1, g.edit())).toMatchObject({ ok: true });
    expect(await g.vote(2, "approve")).toMatchObject({ ok: true });
    const reportId = randomUUID();
    await ok(g.people[0].id, { type: "report", gameId: g.game.id, reportId, about: "terms", reason: "harassment" });
    expect(await db.gameReport.findUnique({ where: { id: reportId } })).toMatchObject({ reportedMemberId: g.people[1].id });
    // A later call-off writes no terms, so its asker never becomes the terms author.
    const callOff = randomUUID();
    expect(await g.send(2, { operation: "propose", gameId: g.game.id, proposalId: callOff, expectedTermsVersion: 2, change: { kind: "call_off" } })).toMatchObject({ ok: true });
    for (const index of [0, 1]) expect(await g.send(index, { operation: "approve", gameId: g.game.id, proposalId: callOff })).toMatchObject({ ok: true });
    expect(await gameRow(g.game.id)).toMatchObject({ status: "void" });
    const afterCallOff = randomUUID();
    await ok(g.people[0].id, { type: "report", gameId: g.game.id, reportId: afterCallOff, about: "terms", reason: "harassment" });
    expect(await db.gameReport.findUnique({ where: { id: afterCallOff } })).toMatchObject({ reportedMemberId: g.people[1].id });
  });
});

async function leaverChatGame(count = 3) {
  const people = await Promise.all(Array.from({ length: count }, () => person()));
  for (const [i, p] of people.entries()) await ok(p.id, { type: "setProfile", firstName: ["Alex", "Sam", "River", "Taylor"][i], timeZone: "UTC" });
  const room = await exactRoom(people);
  const game = await create(people[0], people.slice(1), { terms: { ...terms, tasks: [{ seat: 2, text: "Private leaver task" }] } });
  for (const p of people.slice(1)) await ok(p.id, join(game.token));
  const members = people.map(p => p.id);
  const context = { multiplayer: true, chatContainerMemberId: room, chatPlayerMemberIds: members,
    chatAudience: await readGameChatAudience(room), beforeMutationTx: async () => {} };
  return { people, room, game, members, context };
}

async function queuedGroupRecap(g: Pick<Awaited<ReturnType<typeof leaverChatGame>>, "game" | "room" | "people" | "members">) {
  const eventId = `game-recap:${g.game.id}`;
  await reserveGameChatLifecycleTx({ gameId: g.game.id, kind: "recap", now: createdAt, tx: db });
  await markGameChatGenerationQueuedTx(eventId, db, g.room);
  const recap: HostedGameRecap = { pages: [
    { background: "paper", blocks: [{ kind: "headline", text: "A week outside" }] },
    { background: "sage", blocks: [{ kind: "headline", text: "New paths together" }] },
    { background: "night", blocks: [{ kind: "headline", text: "The next walk awaits" }] },
  ], chatLine: "The walking challenge ended. New routes made a shared week.",
  superlatives: g.people.slice(0, 2).map((p, i) => ({ memberId: p.id, title: `Route finder ${i + 1}`, line: "Brought a walking task to the week." })) };
  return { beforeMutationTx: async () => {}, containerMemberId: g.room, eventId, gameId: g.game.id, playerMemberIds: g.members, recap };
}

function leaverChatWake(room: string): HostedExecutionConversationMessageWake {
  return { eventId: "synthetic-leaver-message", kind: "conversation.message", occurredAt: "2030-03-09T12:00:00Z", userId: room,
    message: { channel: "linq", phoneLookupKey: "synthetic-phone-key",
      routeAuthority: { channel: "linq", containerMemberId: room, threadId: room, accountLookupKey: "synthetic-line" },
      linqMessage: { chatId: room, from: "+15555550101", isFromMe: false, messageId: "synthetic-message", threadIsDirect: false,
        parts: [{ type: "text", value: "A sunny walk" }, { type: "media", mimeType: "image/jpeg", attachmentId: "synthetic-photo" }] } } };
}

function prepareGroupLifecycle(room: string) {
  Object.values(lifecycleProof).forEach(mock => mock.mockReset());
  lifecycleProof.destination.mockResolvedValue({ conversationShape: "thread-container", route: { channel: "linq" } });
  lifecycleProof.bind.mockReturnValue({ route: { channel: "linq", delivery: { kind: "thread", target: room }, accountId: "line" },
    externalThreadRouteAuthority: { channel: "linq", containerMemberId: room, threadId: room, accountLookupKey: "line-key" } });
  lifecycleProof.prepare.mockResolvedValue({}); lifecycleProof.append.mockResolvedValue({ mailboxItemId: "synthetic-leaver-notice" });
  lifecycleProof.mailbox.mockResolvedValue(null);
}

async function expectSharedGame(room: string, gameId: string, kept: boolean) {
  const audience = await readGameChatAudience(room);
  expect((await readGameChatState(room, audience.memberIds)).games.map(game => game.id)).toEqual(kept ? [gameId] : []);
}

describe.skipIf(!enabled)("group chat after departure", () => {
  it.each(["game-first", "text-first"])("keeps reads and commands after both departures: %s", async order => {
    const g = await leaverChatGame();
    const leave = () => ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    if (order === "game-first") await leave();
    chatProof.rooms.set(g.room, g.people.slice(0, 2).map(p => p.email));
    if (order === "text-first") {
      await expectSharedGame(g.room, g.game.id, false);
      const audience = await readGameChatAudience(g.room);
      expect(await runGameCommand({ ...g.context, chatAudience: audience, actorMemberId: g.people[0].id,
        now: new Date("2030-03-09T12:00:00Z"), command: { type: "post", gameId: g.game.id, entryId: randomUUID(), kind: "words", text: "A walk" } })).toMatchObject({ ok: false });
      await leave();
    }
    await expectSharedGame(g.room, g.game.id, true);
    g.context.chatAudience = await readGameChatAudience(g.room);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.example.test");
    const { prepareGameChatInvite } = await import("@/src/lib/game/chat-membership");
    expect(await prepareGameChatInvite(`Join https://example.test/g/${g.game.token}`, g.room)).toBeNull();
    expect(await runGameCommand({ ...g.context, actorMemberId: g.people[0].id, now: new Date("2030-03-09T12:00:00Z"),
      command: { type: "post", gameId: g.game.id, entryId: randomUUID(), kind: "words", text: "A walk" } })).toMatchObject({ ok: true });
    // Both original invitees and bystanders may remain beside the current players.
    chatProof.rooms.set(g.room, [...g.people.slice(0, 2).map(p => p.email), "outsider@example.test"]);
    await expectSharedGame(g.room, g.game.id, true);
    chatProof.rooms.set(g.room, g.people.map(p => p.email));
    await expectSharedGame(g.room, g.game.id, true);
    await db.gameBlock.create({ data: { blockerMemberId: g.people[2].id, blockedMemberId: g.people[0].id } });
    chatProof.rooms.set(g.room, g.people.slice(0, 2).map(p => p.email));
    await expectSharedGame(g.room, g.game.id, false);
  });

  it.each([[2, 3], [3, 2]])("keeps two exits before any read, in order %i then %i", async (first, second) => {
    const g = await leaverChatGame(4);
    for (const seat of [first, second]) await ok(g.people[seat].id, { type: "leave", gameId: g.game.id });
    chatProof.rooms.set(g.room, g.people.slice(0, 2).map(p => p.email));
    await expectSharedGame(g.room, g.game.id, true);
    chatProof.rooms.set(g.room, g.people.slice(0, 3).map(p => p.email));
    await expectSharedGame(g.room, g.game.id, true);
  });

  it.each([false, true])("keeps an unjoined invitee's exit (registered: %s), but detaches if they join while absent", async registered => {
    const people = await Promise.all([person(), person()]);
    const invitee = registered ? await person() : { id: "", email: `${randomUUID()}@example.test` };
    const room = await exactRoom(registered ? [...people, invitee] : people);
    chatProof.rooms.set(room, [...people.map(p => p.email), invitee.email]);
    const game = await create(people[0], [people[1], invitee]);
    await ok(people[1].id, join(game.token));
    chatProof.rooms.set(room, people.map(p => p.email));
    await expectSharedGame(room, game.id, true);
    prepareGroupLifecycle(room);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(game.id, "started")).toBe(true);
    const delivery = { tx: db, containerMemberId: room, audience: await readGameChatAudience(room), deliveryIdempotencyKey: `game-started:${game.id}` };
    expect(await assertGameProposalDeliveryCurrentTx(delivery)).toBe(true);
    if (registered) {
      await ok(invitee.id, join(game.token));
      await expectSharedGame(room, game.id, false);
      await expect(assertGameProposalDeliveryCurrentTx(delivery)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    }
  });

  it("keeps a registered unaccepted addressee and bystanders without binding their invitations", async () => {
    const people = await Promise.all([person(), person(), person()]);
    const invitee = { id: "", email: `${randomUUID()}@example.test` };
    const room = await exactRoom(people);
    chatProof.rooms.set(room, [...people.map(p => p.email), invitee.email]);
    const game = await create(people[0], [...people.slice(1), invitee]);
    for (const p of people.slice(1)) await ok(p.id, join(game.token));
    const registered = await person();
    await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: registered.id, prisma: tx,
      verifiedEmail: { address: invitee.email, verifiedAt: createdAt } }));
    await ok(people[2].id, { type: "leave", gameId: game.id });
    chatProof.rooms.set(room, [...people.slice(0, 2).map(p => p.email), invitee.email]);
    await expectSharedGame(room, game.id, true);
    expect((await gameRow(game.id)).invitees[2]).toMatchObject({ memberId: null, recipientLookupKey: expect.any(String) });
    await settle(game.id, people[0].id);
    expect(await readGameRecapMaterial(game.id, room, people.map(p => p.id))).not.toBeNull();
    prepareGroupLifecycle(room);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(game.id, "recap")).toBe(true);
    const sealInput = await queuedGroupRecap({ room, game, people, members: people.map(p => p.id) });
    expect(await sealGameRecap(sealInput)).toEqual(sealInput.recap);
    const delivery = { tx: db, containerMemberId: room, audience: await readGameChatAudience(room), deliveryIdempotencyKey: sealInput.eventId };
    expect(await assertGameProposalDeliveryCurrentTx(delivery)).toBe(true);
    chatProof.rooms.set(room, [...people.slice(0, 2).map(p => p.email), invitee.email, "unrelated@example.test"]);
    await expectSharedGame(room, game.id, true);
    expect(await sealGameRecap(sealInput)).toEqual(sealInput.recap);
    expect(await assertGameProposalDeliveryCurrentTx({ ...delivery, audience: await readGameChatAudience(room) })).toBe(true);
  });

  it("allows an unseated invitee's obsolete phone as a bystander", async () => {
    const people = await Promise.all([person(), person(), person()]);
    const invited = await person();
    const oldPhone = "+12025550172";
    const phoneIdentity = (phone: string) => db.$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phone),
      memberId: invited.id, prisma: tx, phoneNumberVerifiedAt: createdAt,
      signupPhoneNumber: null }));
    await phoneIdentity(oldPhone);
    const room = await exactRoom([...people, invited]);
    chatProof.rooms.set(room, [...people.map(p => p.email), oldPhone]);
    const game = await create(people[0], [], { invitees: [
      ...people.slice(1).map((p, i) => ({ seat: i + 1, recipient: { kind: "email" as const, value: p.email }, firstName: "Player" })),
      { seat: 3, recipient: { kind: "phone", value: oldPhone }, firstName: "Player" },
    ] });
    for (const p of people.slice(1)) await ok(p.id, join(game.token));
    expect((await gameRow(game.id)).invitees[2]).toMatchObject({ memberId: invited.id, recipientLookupKey: expect.any(String) });
    await expectSharedGame(room, game.id, true);
    await phoneIdentity("+12025550173");
    await ok(people[2].id, { type: "leave", gameId: game.id });
    chatProof.rooms.set(room, [...people.slice(0, 2).map(p => p.email), oldPhone]);
    await expectSharedGame(room, game.id, true);
  });

  it("allows a departed bearer to remain as a bystander in the shrunk text", async () => {
    const g = await leaverChatGame();
    const bearer = await person();
    await ok(bearer.id, join(g.game.token));
    expect((await gameRow(g.game.id)).players.at(-1)?.seat).toBeGreaterThan(9);
    for (const p of [bearer, g.people[2]]) await ok(p.id, { type: "leave", gameId: g.game.id });
    chatProof.rooms.set(g.room, g.people.slice(0, 2).map(p => p.email));
    await expectSharedGame(g.room, g.game.id, true);
    chatProof.rooms.set(g.room, [...g.people.slice(0, 2).map(p => p.email), bearer.email]);
    await expectSharedGame(g.room, g.game.id, true);
  });

  it("rejects a room with only one human", async () => {
    const g = await leaverChatGame();
    chatProof.rooms.set(g.room, [g.people[0].email]);
    expect(await readGameChatAuthority(await gameRow(g.game.id), g.room)).toBeNull();
  });

  it("allows a deleted departed player to remain as an unresolved bystander", async () => {
    const g = await leaverChatGame(4);
    await erase(g.people[3].id);
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    chatProof.rooms.set(g.room, [g.people[0].email, g.people[1].email, g.people[3].email]);
    await expectSharedGame(g.room, g.game.id, true);
    chatProof.rooms.set(g.room, g.people.slice(0, 2).map(p => p.email));
    await expectSharedGame(g.room, g.game.id, true);
  });

  it("uses each unbound contact's readable invitation key and fails closed after retirement", async () => {
    const people = await Promise.all([person(), person(), person()]);
    const invitee = { id: "", email: `${randomUUID()}@example.test` };
    const room = await exactRoom(people);
    chatProof.rooms.set(room, [...people.map(p => p.email), invitee.email]);
    const game = await create(people[0], [...people.slice(1), invitee]);
    for (const p of people.slice(1)) await ok(p.id, join(game.token));
    await ok(people[2].id, { type: "leave", gameId: game.id });
    chatProof.rooms.set(room, [...people.slice(0, 2).map(p => p.email), invitee.email]);
    const oldKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS!;
    const newKey = `v99:${Buffer.alloc(32, 19).toString("base64url")}`;
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `${oldKeys},${newKey}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v99");
    await expectSharedGame(room, game.id, true);
    // Keep verified accounts readable so only the old invitation key loses authority.
    for (const p of people.slice(0, 2)) await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: p.id, prisma: tx,
      verifiedEmail: { address: p.email, verifiedAt: createdAt } }));
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", newKey);
    const audience = await readGameChatAudience(room);
    expect(audience.memberIds.sort()).toEqual(people.slice(0, 2).map(p => p.id).sort());
    expect(await readGameChatAuthority(await gameRow(game.id), room, audience)).toBeNull();
  });

  it("keeps remaining-player reads, funding, check-ins and majority edits while refusing leaver mutations", async () => {
    const g = await leaverChatGame();
    const { handleGameChatTool } = await import("@/src/lib/game/chat-tool");
    const request = { memberId: g.room, multiplayer: true, runtimeIdentity: null, request: { action: "read_game" as const,
      origin: { kind: "automation_occurrence" as const, automationId: "synthetic_lore_read", occurrenceAt: "2030-03-09T12:00:00Z" } } };
    const lore = { loreFingerprint: gameGroupLoreFingerprint((await gameRow(g.game.id)).audienceKey!), loreGuidance: expect.stringContaining("murph.game_lore") };
    expect((await handleGameChatTool(request)).result).toMatchObject(lore);
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    expect((await handleGameChatTool(request)).result).toMatchObject(lore);
    expect(await readGameChatAuthority(await gameRow(g.game.id), g.room)).not.toBeNull();
    const shared = (await readGameChatState(g.room, g.members, g.people[2].id)).games[0];
    expect(shared).toMatchObject({ id: g.game.id, pendingInviteeCount: 0 });
    expect(shared.players.map(p => p.memberId).sort()).toEqual(g.members.slice(0, 2).sort());
    expect(shared.progress?.players.map(p => p.memberId).sort()).toEqual(g.members.slice(0, 2).sort());
    expect(shared.terms.tasks).toHaveLength(2);
    expect(await requestGameRecapRegeneration({ gameId: g.game.id, regenerationId: "live_game", operatorMemberId: "system", execute: false })).toMatchObject({ outcome: "not_settled" });
    chatProof.sender = g.people[2].id; chatProof.wake = leaverChatWake(g.room);
    expect(await handleGameChatTool({ memberId: g.room, multiplayer: true, runtimeIdentity: null,
      request: { action: "read_game", origin: { kind: "accepted_input", assistantInputId: "ain_synthetic_leaver_read" } } }))
      .toMatchObject({ result: { status: "ok", state: { games: [{ id: g.game.id, players: shared.players }] } } });
    expect(JSON.stringify(shared)).not.toContain("Private leaver task");
    expect((await readGameChatFundingRooms({ memberIds: [g.room], now: new Date(), prisma: db })).get(g.room)).toBe(g.room);
    const proposalId = randomUUID();
    const update: Extract<HostedGameUpdate, { operation: "edit_terms" }> = { operation: "edit_terms", gameId: g.game.id,
      proposalId, expectedTermsVersion: shared.terms.n, terms: { ...shared.terms, defaultTask: shared.terms.defaultTask!,
        tasks: shared.terms.tasks.map(task => ({ memberId: shared.players.find(p => p.seat === task.seat)!.memberId, text: task.text })),
        stakes: [{ kind: "prize", item: "Choose dinner" }] } };
    expect(await runGameChatUpdate({ ...g.context, actorMemberId: g.people[0].id, now: createdAt, update })).toMatchObject({ ok: true });
    const vote = (actor: string) => runGameChatUpdate({ ...g.context, actorMemberId: actor, now: createdAt,
      update: { operation: "approve", gameId: g.game.id, proposalId } });
    expect(await vote(g.people[2].id)).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await vote(g.people[1].id)).toMatchObject({ ok: true });
    const saved = await gameRow(g.game.id);
    const [words] = await openGameTexts([{ table: "game", field: "terms_words", rowId: saved.id, memberId: saved.wordsOwnerMemberId, value: saved.termsWordsEncrypted }]);
    expect(JSON.parse(words!).versions.at(-1).tasks).toContainEqual({ seat: 2, text: "Private leaver task" });
    const post = (actor: string) => runGameCommand({ ...g.context, actorMemberId: actor, now: new Date("2030-03-09T12:00:00Z"),
      command: { type: "post", gameId: g.game.id, entryId: randomUUID(), kind: "words", text: "A walk by the river" } });
    expect(await post(g.people[0].id)).toMatchObject({ ok: true });
    expect(await post(g.people[2].id)).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    // Restrictions still include departed identities, even if the caller omits them.
    await db.gameBlock.create({ data: { blockerMemberId: g.people[2].id, blockedMemberId: g.people[0].id } });
    expect(await readGameChatAuthority(await gameRow(g.game.id), g.room, { ...g.context.chatAudience, memberIds: g.members.slice(0, 2) })).toBeNull();
  });

  it("refuses a leaver's photo offer and save before selection, offer writes or media import", async () => {
    const g = await leaverChatGame();
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    const now = new Date("2030-03-09T12:00:00Z");
    await db.game.update({ where: { id: g.game.id }, data: { devClockOffsetMs: BigInt(now.getTime() - Date.now()) } });
    const { handleGameChatPhoto } = await import("@/src/lib/game/chat-photo");
    const media = await import("@/src/lib/game/chat-photo-media");
    const download = vi.spyOn(media, "downloadGameChatPhoto");
    const { readGamePhotoPostingStateTx } = await import("@/src/lib/game/service");
    expect(await db.$transaction(tx => readGamePhotoPostingStateTx(tx, g.game.id, g.people[0].id))).not.toBeNull();
    expect(await db.$transaction(tx => readGamePhotoPostingStateTx(tx, g.game.id, g.people[2].id))).toBeNull();
    for (const operation of ["offer", "save"] as const) expect(await handleGameChatPhoto({ actor: g.people[2].id,
      multiplayer: true, containerMemberId: g.room, playerMemberIds: g.members, messageRef: "ain_synthetic_leaver_photo",
      photo: { operation, gameId: g.game.id, sourceMessageRef: "ain_synthetic_leaver_photo", attachmentOrdinal: 1 },
      authorize: async () => ({ actor: g.people[2].id, wake: leaverChatWake(g.room) }) })).toMatchObject({ status: "rejected", error: "photo_check_in_unavailable" });
    expect(download).not.toHaveBeenCalled();
    expect(await db.gameProfile.findUnique({ where: { memberId: g.people[2].id } })).toMatchObject({ chatPhotoOffer: null, chatPhotoIntroducedAt: null });
  });

  it("restores room authority and funding when an outside bearer leaves", async () => {
    const g = await leaverChatGame();
    const bearer = await person();
    await ok(bearer.id, join(g.game.token));
    expect((await gameRow(g.game.id)).players.at(-1)?.seat).toBeGreaterThan(9);
    expect(await readGameChatAuthority(await gameRow(g.game.id), g.room)).toBeNull();
    expect((await readGameChatFundingRooms({ memberIds: [g.room], now: new Date(), prisma: db })).size).toBe(0);
    chatProof.rooms.set(g.room, [...g.people.map(p => p.email), bearer.email]);
    const audience = await readGameChatAudience(g.room);
    expect(await readGameChatAuthority(await gameRow(g.game.id), g.room, audience)).not.toBeNull();
    expect((await readGameChatFundingRooms({ memberIds: [g.room], now: new Date(), prisma: db })).get(g.room)).toBe(g.room);
    await ok(bearer.id, { type: "leave", gameId: g.game.id });
    expect((await readGameChatState(g.room, g.members)).games[0]?.players).toHaveLength(3);
    expect((await readGameChatFundingRooms({ memberIds: [g.room], now: new Date(), prisma: db })).get(g.room)).toBe(g.room);
    chatProof.rooms.set(g.room, g.people.slice(0, 2).map(p => p.email));
    expect(await readGameChatAuthority(await gameRow(g.game.id), g.room)).toBeNull();
  });

  it.each([0, 2])("keeps the room after non-owner account deletion at seat %i, including the creator", async seat => {
    const g = await leaverChatGame();
    // Runtime ownership belongs to a surviving player, independently of game creation.
    await db.hostedThreadContainer.update({ where: { memberId: g.room }, data: { ownerMemberId: g.people[1].id } });
    await erase(g.people[seat].id);
    const row = await gameRow(g.game.id);
    expect(row.players[seat]).toMatchObject({ memberId: null, leftAt: expect.any(Date) });
    expect(row.createdBy).toBe(seat === 0 ? null : g.people[0].id);
    expect(await readGameChatAuthority(row, g.room)).not.toBeNull();
    const shared = (await readGameChatState(g.room, g.members.filter((_, i) => i !== seat))).games[0];
    expect(shared).toMatchObject({ pendingInviteeCount: 0, players: expect.any(Array) });
    expect(shared.players).toHaveLength(2);
    expect((await readGameChatFundingRooms({ memberIds: [g.room], now: new Date(), prisma: db })).get(g.room)).toBe(g.room);
  });

  it("keeps fresh reads but retires kickoff at enqueue and final delivery after departure", async () => {
    const g = await leaverChatGame();
    prepareGroupLifecycle(g.room);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    const delivery = { tx: db, containerMemberId: g.room, audience: g.context.chatAudience, deliveryIdempotencyKey: `game-started:${g.game.id}` };
    expect(await assertGameProposalDeliveryCurrentTx(delivery)).toBe(true);
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    expect((await readGameChatState(g.room, g.members)).games).toHaveLength(1);
    expect(await deliverGameChatLifecycle(g.game.id, "started")).toBe(false);
    expect(lifecycleProof.prepare).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.findFirst({ where: { sourceRef: g.game.id, template: "game_started" } })).toMatchObject({ status: "skipped", skipReason: "game_lifecycle_superseded" });
    await expect(assertGameProposalDeliveryCurrentTx(delivery)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it.each([false, true])("projects, enqueues, seals, delivers and regenerates the remaining recap cohort (exited text: %s)", async exited => {
    const g = await leaverChatGame();
    const kept = await entry(g.game.id, g.people[0].id, 0);
    const gone = await entry(g.game.id, g.people[2].id, 0);
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    if (exited) {
      chatProof.rooms.set(g.room, g.people.slice(0, 2).map(p => p.email));
      g.context.chatAudience = await readGameChatAudience(g.room);
    }
    await settle(g.game.id, g.people[0].id);
    const material = await readGameRecapMaterial(g.game.id, g.room, g.members);
    expect(material?.players).toEqual(["Alex", "Sam"]);
    if (exited) {
      const rematchId = randomUUID();
      await expect(run(g.people[0].id, { type: "createGame", gameId: rematchId, maxPlayers: 10, previousGameId: g.game.id, terms })).rejects.toThrow("participants have changed");
      expect(await db.game.findUnique({ where: { id: rematchId } })).toBeNull();
    }
    expect(material?.entries.map(e => e.entryId)).toEqual([kept.id]);
    expect(JSON.stringify(material)).not.toContain(gone.id);
    expect(JSON.stringify(material)).not.toContain("River");
    expect(material?.validation.playerNamesByMemberId.map(p => p.memberId)).toEqual(g.members.slice(0, 2));
    expect(material?.validation.result.map(p => p.memberId)).toEqual(g.members.slice(0, 2));
    const mailbox = await import("@/src/lib/hosted-mailbox/store");
    const decoded = vi.spyOn(mailbox, "decodeHostedMailboxStoredPayloads").mockResolvedValue([leaverChatWake(g.room)]);
    const { readGameRecapChatMessages } = await import("@/src/lib/game/chat-tool");
    chatProof.sender = g.people[2].id;
    expect(await readGameRecapChatMessages({ containerMemberId: g.room, material: material! })).toEqual([]);
    chatProof.sender = "synthetic-non-player";
    expect(await readGameRecapChatMessages({ containerMemberId: g.room, material: material! })).toEqual([]);
    chatProof.sender = g.people[0].id;
    expect(await readGameRecapChatMessages({ containerMemberId: g.room, material: material! })).toEqual([{ playerName: "Alex", text: "A sunny walk" }]);
    decoded.mockRestore();
    const shared = (await readGameChatState(g.room, g.members)).games[0];
    expect(shared.result?.scores.map(p => p.memberId)).toEqual(g.members.slice(0, 2));
    expect(parseStoredResult((await gameRow(g.game.id)).result).scores).toHaveLength(3);
    prepareGroupLifecycle(g.room);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(g.game.id, "recap")).toBe(true);
    expect(lifecycleProof.prepare.mock.calls[0][0].envelope.notification.instructions).not.toContain("River");
    const sealInput = await queuedGroupRecap(g);
    const { validateGameRecap } = await import("@/src/lib/game/recap");
    expect(validateGameRecap({ recap: sealInput.recap, players: material!.players, entries: material!.entries, result: material!.validation.result, group: true })).toEqual([]);
    expect(await sealGameRecap(sealInput)).toEqual(sealInput.recap);
    expect(await assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: g.room, audience: g.context.chatAudience, deliveryIdempotencyKey: sealInput.eventId })).toBe(true);
    await db.hostedLinqDelivery.updateMany({ where: { sourceRef: g.game.id, template: "game_recap" }, data: { status: "accepted" } });
    expect(await requestGameRecapRegeneration({ gameId: g.game.id, regenerationId: "after_departure", operatorMemberId: "system", execute: true })).toMatchObject({ outcome: "reserved" });
    await db.gameBlock.create({ data: { blockerMemberId: g.people[2].id, blockedMemberId: g.people[0].id } });
    expect(await requestGameRecapRegeneration({ gameId: g.game.id, regenerationId: "blocked_leaver", operatorMemberId: "system", execute: true })).toMatchObject({ outcome: "players_blocked" });
  });

  it.each(["at_settlement", "after_settlement", "one_survivor"])("refuses an invalid recap cohort (%s) before generation and at every later gate", async condition => {
    const g = await leaverChatGame();
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    const settled = await settle(g.game.id, g.people[0].id);
    expect(await readGameRecapMaterial(g.game.id, g.room, g.members)).not.toBeNull();
    const sealInput = await queuedGroupRecap(g);
    const leftAt = condition === "one_survivor" ? createdAt : new Date(settled.settledAt!.getTime() + (condition === "after_settlement" ? 1 : 0));
    await db.gamePlayer.update({ where: { gameId_seat: { gameId: g.game.id, seat: 1 } }, data: { leftAt } });
    expect(await readGameRecapMaterial(g.game.id, g.room, g.members)).toBeNull();
    expect(await sealGameRecap(sealInput)).toBeNull();
    await expect(assertGameProposalDeliveryCurrentTx({ tx: db, containerMemberId: g.room, audience: g.context.chatAudience, deliveryIdempotencyKey: sealInput.eventId })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    expect(await requestGameRecapRegeneration({ gameId: g.game.id, regenerationId: "invalid_cohort", operatorMemberId: "system", execute: true })).toMatchObject({ outcome: "player_departed" });
    await db.hostedLinqDelivery.updateMany({ where: { sourceRef: g.game.id, template: "game_recap" }, data: { status: "awaiting_generation" } });
    prepareGroupLifecycle(g.room);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(g.game.id, "recap")).toBe(false);
    expect(lifecycleProof.prepare).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.findFirst({ where: { sourceRef: g.game.id, template: "game_recap" } })).toMatchObject({ status: "skipped", skipReason: "game_lifecycle_superseded" });
  });

  it("refuses sealing when deletion rekeys a departed words owner under the game lock", async () => {
    const g = await leaverChatGame();
    await db.hostedThreadContainer.update({ where: { memberId: g.room }, data: { ownerMemberId: g.people[1].id } });
    await ok(g.people[0].id, { type: "leave", gameId: g.game.id });
    await settle(g.game.id, g.people[1].id);
    expect(await readGameRecapMaterial(g.game.id, g.room, g.members)).not.toBeNull();
    const sealInput = await queuedGroupRecap(g);
    const prepared = await prepareGameAccountDeletion({ memberIds: [g.people[0].id], prisma: db });
    expect(await sealGameRecap({ ...sealInput, beforeMutationTx: async tx => { await applyGameAccountDeletionTx({ memberIds: [g.people[0].id], prepared, tx, now: new Date("2030-04-02T12:00:00Z") }); } })).toBeNull();
    const row = await gameRow(g.game.id);
    expect(row.wordsOwnerMemberId).not.toBe(g.people[0].id);
    expect(row.recapEncrypted).toBeNull();
    expect(await readGameRecapMaterial(g.game.id, g.room, g.members.slice(1))).not.toBeNull();
  });
});


describe.skipIf(!enabled)("group app change parity", () => {
  const start = (g: Awaited<ReturnType<typeof majorityGame>>, proposalId = g.proposalId): GameCommand => ({
    type: "proposeChange", gameId: g.game.id, proposalId, expectedTermsVersion: 1, change: { kind: "start_now" },
  });
  const appVote = (g: Awaited<ReturnType<typeof majorityGame>>, index: number, decision: "approve" | "decline" | "cancel", now = createdAt) =>
    run(g.people[index].id, { type: "respondChange", gameId: g.game.id, proposalId: g.proposalId, decision }, now);
  const resolutions = (g: Awaited<ReturnType<typeof majorityGame>>) => db.gameEvent.findMany({ where: { commandKey: `game-change-resolved:${g.game.id}:${g.proposalId}` } });

  it("announces an app Start now ask once, counts app/chat votes and advances only the live calendar", async () => {
    const g = await majorityGame(4, 1);
    const { devStartNow } = await import("@/src/lib/game/service");
    await expect(devStartNow(g.game.id, g.people[0].id, true)).rejects.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    const at = new Date(), earlier = gameLocalDate(at, "UTC");
    expect(await run(g.people[0].id, start(g), at)).toMatchObject({ ok: true, game: { pendingChange: { origin: "app", yesNeeded: 2, startsOn: earlier } } });
    expect(await run(g.people[0].id, start(g), at)).toMatchObject({ ok: true });
    expect(await run(g.people[1].id, start(g), at)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await appVote(g, 1, "approve", at)).toMatchObject({ ok: true, game: { pendingChange: { yesNeeded: 1 } } });
    expect(await appVote(g, 2, "approve", at)).toMatchObject({ ok: true, game: { pendingChange: null, terms: { n: 2 } } });
    expect(await appVote(g, 1, "approve", at)).toMatchObject({ ok: true });
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "started" } })).toBe(1);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: g.game.id, template: "game_proposal" } })).toBe(1);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: `${g.game.id}:${g.proposalId}`, template: "game_change_resolved" } })).toBe(1);
    expect(await resolutions(g)).toMatchObject([{ type: "change_applied", payload: { tally: { yes: 3, no: 0, total: 4 }, startsOn: earlier } }]);
    expect((await gameRow(g.game.id)).players.every(player => player.dayOne?.toISOString().startsWith(earlier))).toBe(true);
    expect(await run(g.people[4].id, join(g.game.token), at)).toMatchObject({ ok: false, error: { code: "TERMS_CHANGED" } });
    await ok(g.people[4].id, join(g.game.token, "UTC", 2), at);
    expect((await gameRow(g.game.id)).players.at(-1)?.dayOne?.toISOString()).toBe(`${earlier}T00:00:00.000Z`);
  });

  it("requires a bound room for an app ask and never starts an invited group", async () => {
    const people = [await person(), await person()];
    const game = await create(people[0], [people[1]]);
    const command: GameCommand = { type: "proposeChange", gameId: game.id, expectedTermsVersion: 1, proposalId: randomUUID(), change: { kind: "start_now" } };
    await groupContext(game.id, people);
    expect(await run(people[0].id, command)).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    await ok(people[1].id, join(game.token));
    await db.game.update({ where: { id: game.id }, data: { chatContainerMemberId: null } });
    expect(await run(people[0].id, command)).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await db.gameEvent.count({ where: { gameId: game.id, type: "change_proposed" } })).toBe(0);
  });

  it("keeps a departed starter's old calendar out of previews, chat and late acceptance", async () => {
    const g = await majorityGame(3, 1);
    await ok(g.people[0].id, { type: "leave", gameId: g.game.id });
    const at = new Date(), earlier = gameLocalDate(at, "UTC");
    expect(await run(g.people[1].id, start(g), at)).toMatchObject({ ok: true });
    expect(await appVote(g, 2, "approve", at)).toMatchObject({ ok: true });
    const row = await gameRow(g.game.id);
    expect(row.players[0].dayOne?.toISOString()).toBe("2030-03-09T00:00:00.000Z");
    const { readInvitePreview } = await import("@/src/lib/game/service");
    expect(await readInvitePreview(g.game.token, true, g.people[3].id)).toMatchObject({ status: "open", dayOne: earlier });
    expect(await g.shared()).toMatchObject({ startsOn: earlier });
    await ok(g.people[3].id, join(g.game.token, "UTC", 2), at);
    expect((await gameRow(g.game.id)).players[3].dayOne?.toISOString()).toBe(`${earlier}T00:00:00.000Z`);
  });

  it.each(["approve", "decline"] as const)("expires a stale first %s before recording a vote and replays earlier votes", async decision => {
    const g = await majorityGame(4);
    const edit = g.edit(); edit.terms.startsOn = "2030-03-10";
    expect(await g.send(0, edit)).toMatchObject({ ok: true });
    expect(await appVote(g, 1, "decline")).toMatchObject({ ok: true });
    await entry(g.game.id, g.people[0].id, 0);
    expect(await appVote(g, 2, decision)).toMatchObject({ ok: false, error: { code: "CHANGE_EXPIRED" } });
    expect(await resolutions(g)).toMatchObject([{ type: "change_expired", payload: { reason: "The start date locks once someone checks in." } }]);
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_voted" } })).toBe(1);
    expect(await appVote(g, 1, "decline")).toMatchObject({ ok: true });
  });

  it.each(["app", "chat"] as const)("rejects a departed task basis prepared through %s", async source => {
    const g = await majorityGame(3);
    const command: GameCommand = { type: "editTerms", gameId: g.game.id, proposalId: g.proposalId, expectedTermsVersion: 1,
      terms: { ...terms, defaultTask: "Walk outside", tasks: [{ seat: 2, text: "Read" }] } };
    let release!: () => void; let prepared!: () => void;
    const ready = new Promise<void>(resolve => { prepared = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const context = { ...(source === "chat" ? g.context : {}), actorMemberId: g.people[0].id, multiplayer: true, now: createdAt,
      beforeMutationTx: async () => { prepared(); await gate; } };
    const writing = source === "chat" ? runGameChatUpdate({ ...context, update: g.edit({ terms: { ...g.edit().terms,
      defaultTask: "Walk outside", tasks: g.people.map((p, i) => ({ memberId: p.id, text: i === 2 ? "Read" : "Walk outside" })) } }) })
      : runGameCommand({ ...context, command });
    await ready;
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    release();
    expect(await writing).toMatchObject({ ok: false, error: { code: "TERMS_CHANGED" } });
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_proposed" } })).toBe(0);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: g.game.id, template: "game_proposal" } })).toBe(0);
  });

  it.each([false, true])("orders a terminal no against the first public check-in, post first=%s", async postFirst => {
    const g = await majorityGame(4);
    const edit = g.edit(); edit.terms.startsOn = "2030-03-10";
    expect(await g.send(0, edit)).toMatchObject({ ok: true });
    expect(await appVote(g, 1, "decline")).toMatchObject({ ok: true });
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const action = (post: boolean, first: boolean) => runGameCommand({ actorMemberId: g.people[post ? 0 : 2].id,
      multiplayer: true, now: new Date("2030-03-09T12:00:00Z"), beforeMutationTx: async tx => {
        if (first) { await tx.$queryRaw`SELECT id FROM game WHERE id = ${g.game.id} FOR UPDATE`; acquired(); await gate; }
      }, command: post ? { type: "post", gameId: g.game.id, entryId: randomUUID(), kind: "words", text: "Done", mediaKeys: [] }
        : { type: "respondChange", gameId: g.game.id, proposalId: g.proposalId, decision: "decline" } });
    const first = action(postFirst, true);
    await ready;
    const second = action(!postFirst, false);
    release();
    const results = await Promise.all([first, second]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject(postFirst ? { ok: false, error: { code: "CHANGE_EXPIRED" } } : { ok: true });
    expect(await resolutions(g)).toMatchObject([{ type: postFirst ? "change_expired" : "change_declined" }]);
    expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "change_voted" } })).toBe(postFirst ? 1 : 2);
    expect((await gameRow(g.game.id)).pendingChange).toBeNull();
  });

  it.each(["read", "accept", "leave"] as const)("resolves a pending ask once when %s settles the group", async trigger => {
    const g = await majorityGame(2, 1);
    expect(await g.send(0, g.edit())).toMatchObject({ ok: true });
    const due = new Date("2030-04-01T12:00:00Z");
    if (trigger === "read") {
      await db.game.update({ where: { id: g.game.id }, data: { devClockOffsetMs: BigInt(due.getTime() - Date.now()) } });
      await readGame(g.game.id, g.people[0].id, true);
    } else if (trigger === "accept") {
      expect(await run(g.people[2].id, join(g.game.token), due)).toMatchObject({ ok: false });
    } else await settle(g.game.id, g.people[0].id, due);
    expect(await resolutions(g)).toMatchObject([{ type: "change_expired", payload: { reason: "The game ended before that request could apply." } }]);
    expect((await gameRow(g.game.id)).pendingChange).toBeNull();
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: `${g.game.id}:${g.proposalId}`, template: "game_change_expired" } })).toBe(1);
  });

  it("preserves hidden overrides in app writes, rejects explicit hidden writes and withholds invitee controls", async () => {
    const g = await majorityGame(3, 1);
    const command: GameCommand = { type: "editTerms", gameId: g.game.id, proposalId: g.proposalId, expectedTermsVersion: 1,
      terms: { ...terms, tasks: [{ seat: 3, text: "Changed hidden task" }], lengthDays: 12 } };
    expect(await run(g.people[0].id, command)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    const visible = await readGame(g.game.id, g.people[0].id, true);
    expect(JSON.stringify(visible?.terms)).not.toContain("Private invitation task");
    expect(await run(g.people[0].id, { ...command, terms: { ...terms, tasks: visible!.terms.tasks, defaultTask: "Walk outside", lengthDays: 12 } })).toMatchObject({ ok: true });
    expect(await appVote(g, 1, "approve")).toMatchObject({ ok: true });
    const row = await gameRow(g.game.id);
    const [plain] = await openGameTexts([{ table: "game", field: "terms_words", rowId: row.id, memberId: row.wordsOwnerMemberId, value: row.termsWordsEncrypted }]);
    expect(plain).toContain("Private invitation task");
    await ok(g.people[2].id, { type: "leave", gameId: g.game.id });
    expect(await readGame(g.game.id, g.people[3].id, true)).toMatchObject({ changeControls: { canEdit: false, canStartNow: false } });
  });

  it.each([false, true])("retains historical attempts after account deletion, withdrawn=%s", async withdrawn => {
    const people = [await person("Pacific/Honolulu"), await person("Pacific/Honolulu"), await person("Pacific/Kiritimati")];
    const game = await create(people[0], people.slice(1), { terms: { ...terms, schedule: { days: [0, 1, 2, 3, 4, 5, 6] } } });
    for (const [i, player] of people.slice(1).entries()) await ok(player.id, join(game.token, i === 0 ? "Pacific/Honolulu" : "Pacific/Kiritimati"));
    const context = await groupContext(game.id, people);
    const at = new Date("2030-03-09T00:30:00Z"), entryId = randomUUID();
    await ok(people[2].id, { type: "post", gameId: game.id, entryId, kind: "words", text: "Done", mediaKeys: [] }, at);
    if (withdrawn) await ok(people[2].id, { type: "withdraw", gameId: game.id, entryId }, at);
    await erase(people[2].id);
    expect(await db.gameEntry.count({ where: { gameId: game.id } })).toBe(0);
    const state = await readGameChatState(context.chatContainerMemberId, people.map(p => p.id), people[0].id);
    expect(state.games[0]?.changeControls).toMatchObject({ canStartNow: false, canEditStartDate: false });
    expect(await run(people[0].id, { type: "proposeChange", gameId: game.id, proposalId: randomUUID(), expectedTermsVersion: 1, change: { kind: "start_now" } }, at)).toMatchObject({ ok: false });
    expect(await readGame(game.id, people[0].id, true)).toMatchObject({ permissions: { canCancel: false } });
    expect(await run(people[0].id, { type: "cancelInvite", gameId: game.id }, at)).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    expect((await gameRow(game.id)).status).toBe("live");
    // An older accepted request is still refused at the deciding-vote boundary.
    const proposalId = randomUUID();
    await db.game.update({ where: { id: game.id }, data: { pendingChange: { v: 1, id: proposalId, proposedByMemberId: people[0].id, expectedTermsVersion: 1,
      change: { kind: "start_now" }, startsOn: "2030-03-08", effectiveFromDay: 0, origin: "chat", deliveryStatus: "conversation", votes: { [people[0].id]: "yes" } } } });
    expect(await run(people[1].id, { type: "respondChange", gameId: game.id, proposalId, decision: "approve" }, at)).toMatchObject({ ok: false, error: { code: "CHANGE_EXPIRED" } });
  });

  it.each([2, 3])("records one neutral departure resolution on retained deletion with %i players", async count => {
    const g = await majorityGame(count);
    expect(await g.send(0, g.edit())).toMatchObject({ ok: true });
    await erase(g.people[count - 1].id);
    expect(await resolutions(g)).toMatchObject([{ type: "change_expired", payload: { reason: "The playing roster changed, so that request was cleared without applying it." } }]);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: `${g.game.id}:${g.proposalId}`, template: "game_change_expired" } })).toBe(1);
  });

  it("does not duplicate a read_game expiry followed by an answered replacement", async () => {
    const g = await majorityGame(3);
    const edit = g.edit(); edit.terms.startsOn = "2030-03-10";
    expect(await g.send(0, edit)).toMatchObject({ ok: true });
    await entry(g.game.id, g.people[0].id, 0);
    await g.shared();
    expect(await g.send(0, g.edit({ proposalId: randomUUID() }))).toMatchObject({ ok: true });
    expect(await resolutions(g)).toMatchObject([{ type: "change_expired" }]);
    expect(await db.hostedLinqDelivery.count({ where: { sourceRef: `${g.game.id}:${g.proposalId}`, template: "game_change_expired" } })).toBe(0);
  });
  it("requires remaining-player presence even when original provider handles are unchanged", async () => {
    const people = [await person(), await person(), await person()];
    const oldPhone = "+12025550174";
    const phone = (value: string) => db.$transaction(tx => upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(value),
      memberId: people[2].id, prisma: tx, phoneNumberVerifiedAt: createdAt,
      signupPhoneNumber: null }));
    await phone(oldPhone);
    const room = await exactRoom(people); chatProof.rooms.set(room, [people[0].email, people[1].email, oldPhone]);
    const game = await create(people[0], [], { invitees: [
      { seat: 1, recipient: { kind: "email", value: people[1].email }, firstName: "Player" },
      { seat: 2, recipient: { kind: "phone", value: oldPhone }, firstName: "Player" },
    ] });
    for (const person of people.slice(1)) await ok(person.id, join(game.token));
    await db.game.update({ where: { id: game.id }, data: { chatContainerMemberId: room } });
    const proposalId = randomUUID();
    const command: GameCommand = { type: "proposeChange", gameId: game.id, proposalId, expectedTermsVersion: 1, change: { kind: "start_now" } };
    expect(await run(people[0].id, command, new Date())).toMatchObject({ ok: true });
    await phone("+12025550175");
    const audience = await readGameChatAudience(room);
    expect(await readGameChatAuthority(await gameRow(game.id), room, audience)).toBeNull();
    expect((await readGameChatState(room, people.map(p => p.id))).games).toEqual([]);
    expect(await run(people[0].id, { ...command, proposalId: randomUUID() })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    expect(await runGameChatUpdate({ actorMemberId: people[1].id, multiplayer: true, chatContainerMemberId: room,
      chatPlayerMemberIds: audience.memberIds, chatAudience: audience, beforeMutationTx: async () => {}, now: createdAt,
      update: { operation: "approve", gameId: game.id, proposalId } })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
    await expect(db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: room, audience,
      deliveryIdempotencyKey: `game-change:${game.id}:${proposalId}`, now: createdAt }))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    await phone(oldPhone);
    expect(await readGameChatAuthority(await gameRow(game.id), room)).not.toBeNull();
  });

  it.each(["vote", "departure", "post", "join"] as const)("serializes the final dispatch claim with %s in both lock orders", async mutation => {
    for (const claimFirst of [false, true]) {
      const g = await majorityGame(2, 1);
      // The new joiner's date has already passed the requested earlier date.
      const at = new Date();
      await db.gamePlayer.updateMany({ where: { gameId: g.game.id }, data: { timeZone: "Pacific/Honolulu" } });
      await db.gameProfile.update({ where: { memberId: g.people[2].id }, data: { timeZone: "Pacific/Kiritimati" } });
      expect(await run(g.people[0].id, start(g), at)).toMatchObject({ ok: true });
      let release!: () => void, acquired!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const ready = new Promise<void>(resolve => { acquired = resolve; });
      const audience = await readGameChatAudience(g.context.chatContainerMemberId);
      const claim = () => db.$transaction(async tx => {
        await assertGameProposalDeliveryCurrentTx({ tx, audience, containerMemberId: g.context.chatContainerMemberId,
          deliveryIdempotencyKey: `game-change:${g.game.id}:${g.proposalId}`, now: at });
        if (claimFirst) { acquired(); await gate; }
        await tx.gameEvent.create({ data: { gameId: g.game.id, actor: "system", type: "test_dispatch_claim", payload: {} } });
      });
      const mutate = () => runGameCommand({ actorMemberId: g.people[mutation === "join" ? 2 : 1].id, multiplayer: true, now: at,
        beforeMutationTx: async tx => {
          if (!claimFirst) { await tx.$queryRaw`SELECT id FROM game WHERE id = ${g.game.id} FOR UPDATE`; acquired(); await gate; }
        }, command: mutation === "vote" ? { type: "respondChange", gameId: g.game.id, proposalId: g.proposalId, decision: "approve" }
          : mutation === "departure" ? { type: "leave", gameId: g.game.id }
          : mutation === "join" ? join(g.game.token, "Pacific/Kiritimati")
          // The post case uses the public command below.
          : { type: "respondChange", gameId: g.game.id, proposalId: g.proposalId, decision: "cancel" } });
      const post = () => runGameCommand({ actorMemberId: g.people[1].id, multiplayer: true, now: new Date("2030-03-09T22:00:00Z"),
        beforeMutationTx: async tx => {
          if (!claimFirst) { await tx.$queryRaw`SELECT id FROM game WHERE id = ${g.game.id} FOR UPDATE`; acquired(); await gate; }
        }, command: { type: "post", gameId: g.game.id, entryId: randomUUID(), kind: "words", text: "Done", mediaKeys: [] } });
      const mutationWork = () => mutation === "post" ? post() : mutate();
      const first = claimFirst ? claim() : mutationWork();
      await ready;
      const second = claimFirst ? mutationWork() : claim();
      const observed = second.then(value => ({ value }), error => ({ error }));
      release(); await first;
      const result = await observed;
      if (claimFirst) expect(result).not.toHaveProperty("error");
      else expect(result).toMatchObject({ error: { code: "GAME_CHANGE_SUPERSEDED" } });
      expect(await db.gameEvent.count({ where: { gameId: g.game.id, type: "test_dispatch_claim" } })).toBe(claimFirst ? 1 : 0);
    }
  });

  it.each(["settled", "void", "later ask"] as const)("delivers historical resolution after %s with canonical disambiguation and recovery", async transition => {
    const g = await majorityGame(2);
    prepareGroupLifecycle(g.context.chatContainerMemberId);
    expect(await g.send(0, g.edit())).toMatchObject({ ok: true });
    if (transition === "void") await ok(g.people[1].id, { type: "leave", gameId: g.game.id });
    else expect(await appVote(g, 0, "cancel")).toMatchObject({ ok: true });
    if (transition === "settled") await settle(g.game.id, g.people[0].id);
    if (transition === "later ask") expect(await g.send(0, g.edit({ proposalId: randomUUID() }))).toMatchObject({ ok: true });
    const other = await create(g.people[0], [g.people[1]], { terms: { ...terms, defaultTask: "Read a chapter" } });
    await ok(g.people[1].id, join(other.token));
    await db.game.update({ where: { id: other.id }, data: { chatContainerMemberId: g.context.chatContainerMemberId } });
    const { deliverGameChatLifecycle, drainGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    const kind = transition === "void" ? "change_expired" : "change_cancelled";
    expect(await deliverGameChatLifecycle(g.game.id, kind, g.proposalId)).toBe(true);
    const instructions = lifecycleProof.prepare.mock.calls.at(-1)![0].envelope.notification.instructions;
    expect(instructions).toContain("Take a walk"); expect(instructions).toContain("Read a chapter");
    expect(instructions).not.toContain("Private invitation task");
    await expect(db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, audience: g.context.chatAudience,
      containerMemberId: g.context.chatContainerMemberId, deliveryIdempotencyKey: `game-${kind.replace("_", "-")}:${g.game.id}:${g.proposalId}` }))).resolves.toBe(true);
    if (transition === "void") expect(await readGameChatFundingRooms({ memberIds: [g.context.chatContainerMemberId], now: new Date(), prisma: db })).toEqual(new Map([[g.context.chatContainerMemberId, g.context.chatContainerMemberId]]));
    lifecycleProof.mailbox.mockResolvedValue({ id: "synthetic-notice", consumedAt: null });
    // Isolate this receipt from unrelated test games' pending work.
    const receipt = await db.hostedLinqDelivery.findFirstOrThrow({ where: { sourceRef: `${g.game.id}:${g.proposalId}`, template: `game_${kind}` } });
    await db.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { attemptedAt: new Date(0), retryAfterAt: new Date(0) } });
    await parkOtherLifecycleReceipts(receipt.id);
    const before = lifecycleProof.append.mock.calls.length;
    expect((await drainGameChatLifecycle()).queued).toBe(1);
    expect(lifecycleProof.append).toHaveBeenCalledTimes(before);
    expect(lifecycleProof.signal).toHaveBeenCalled();
  });

});

// Plan B composes the existing roster, crypto and lifecycle fixtures.
const caseNow = new Date("2030-03-09T12:00:00Z");
async function talkGroup(size = 4, live = false) {
  const people = await Promise.all(Array.from({ length: size }, () => person()));
  for (const [index, p] of people.entries()) await ok(p.id, { type: "setProfile", firstName: `Player${index}`, timeZone: "UTC" });
  const group = await create(people[0], people.slice(1));
  const context = await groupContext(group.id, people);
  if (live) await ok(people[1].id, join(group.token), caseNow);
  prepareGroupLifecycle(context.chatContainerMemberId);
  const command = (index: number, proposalId = randomUUID()): Extract<GameCommand, { type: "negotiate" }> & { note: string; change?: never } => ({ type: "negotiate", token: group.token,
    proposalId, termsVersion: 1, timeZone: "UTC", note: `Could we discuss an outdoor prize, from Player${index}?` });
  return { group, people, context, command };
}
async function talkReceipt(gameId: string, proposalId: string) {
  const { createHostedLinqDeliveryIdempotencyLookupKey } = await import("@/src/lib/hosted-onboarding/linq-observability-identifiers");
  return db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(`game-talk:${gameId}:${proposalId}`)! } });
}
async function groupPhoto(gameId: string, memberId: string) {
  return db.gameEntry.create({ data: { id: randomUUID(), gameId, memberId, dayIndex: 0, attempt: 1, kind: "photo", mediaKeys: [], receivedAt: caseNow } });
}

describe.skipIf(!enabled)("group Prove it and Talk", () => {
  it("accepts nine independent notes without joining and recovers exact receipts in reverse order", async () => {
    const f = await talkGroup(10);
    const before = await gameRow(f.group.id);
    const commands = f.people.slice(1).map((_, i) => f.command(i + 1));
    for (const [i, command] of commands.entries()) expect(await run(f.people[i + 1].id, command)).toMatchObject({ ok: true });
    const after = await gameRow(f.group.id);
    expect(after).toEqual(before);
    expect(await db.gameEvent.count({ where: { gameId: f.group.id, type: "talk_requested" } })).toBe(9);
    const { readGameTalkReceiptIdentity } = await import("@/src/lib/game/talk");
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    for (const [i, command] of [...commands.entries()].reverse()) {
      const receipt = await talkReceipt(f.group.id, command.proposalId);
      expect(receipt.sourceRef).toBe(`${f.group.id}:${command.proposalId}`);
      expect(await readGameTalkReceiptIdentity(db, receipt)).toEqual({ gameId: f.group.id, proposalId: command.proposalId, eventId: `game-talk:${f.group.id}:${command.proposalId}` });
      expect(await deliverGameChatLifecycle(f.group.id, "talk", command.proposalId, createdAt)).toBe(true);
      const instructions = lifecycleProof.prepare.mock.lastCall![0].envelope.notification.instructions;
      expect(instructions).toContain(`Player${i + 1}`);
      expect(instructions).toContain(command.note);
      expect(instructions).not.toMatch(/Teammate|termsWords|https?:|private/);
    }
    expect(lifecycleProof.append).toHaveBeenCalledTimes(9);
    lifecycleProof.mailbox.mockResolvedValue({ id: "synthetic-recovered-note", consumedAt: null });
    for (const command of commands) expect(await deliverGameChatLifecycle(f.group.id, "talk", command.proposalId, createdAt)).toBe(true);
    expect(lifecycleProof.append).toHaveBeenCalledTimes(9);
    expect(lifecycleProof.signal).toHaveBeenCalledTimes(18);
    expect(await gameRow(f.group.id)).toEqual(before);
  });

  it("serializes the quota, preserves immutable replay and projects only the author's status", async () => {
    const f = await talkGroup();
    const { readInvitePreview } = await import("@/src/lib/game/service");
    expect(await readInvitePreview(f.group.token, true, f.people[1].id)).toMatchObject({ supportsTalk: true, canTalk: true });
    expect(await readInvitePreview(f.group.token, true)).toMatchObject({ canTalk: false });
    const commands = [f.command(1), f.command(1)];
    const results = await Promise.all(commands.map(command => run(f.people[1].id, command)));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toMatchObject([{ error: { code: "INVITE_USED" } }]);
    const command = commands[results.findIndex(result => result.ok)];
    expect(await readInvitePreview(f.group.token, true, f.people[1].id)).toMatchObject({ canTalk: false, talkDelivery: "pending" });
    expect(await readInvitePreview(f.group.token, true, f.people[2].id)).not.toHaveProperty("talkDelivery");
    expect(await readInvitePreview(f.group.token, true)).not.toHaveProperty("talkDelivery");
    const event = await db.gameEvent.findUniqueOrThrow({ where: { commandKey: `game-change:${f.group.id}:${command.proposalId}` } });
    await ok(f.people[1].id, join(f.group.token));
    expect(await run(f.people[1].id, { ...command, note: "A different note", termsVersion: 99 })).toMatchObject({ ok: true });
    expect(await db.gameEvent.findUnique({ where: { id: event.id } })).toEqual(event);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(f.group.id, "talk", command.proposalId, createdAt)).toBe(false);
    expect(await readInvitePreview(f.group.token, true, f.people[1].id)).toMatchObject({ canTalk: false, talkDelivery: "failed" });
    await db.game.update({ where: { id: f.group.id }, data: { status: "settled" } });
    expect(await readInvitePreview(f.group.token, true, f.people[1].id)).toEqual({ status: "used", talkDelivery: "failed" });
    await db.game.update({ where: { id: f.group.id }, data: { status: "void" } });
    expect(await readInvitePreview(f.group.token, true, f.people[1].id)).toMatchObject({ status: "expired", talkDelivery: "failed" });
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: f.group.id, memberId: f.people[1].id } }, data: { leftAt: caseNow } });
    expect(await readInvitePreview(f.group.token, true, f.people[1].id)).toBeNull();
  });

  it("keeps an unseated author's note current when someone else activates the game", async () => {
    const f = await talkGroup(); const command = f.command(2);
    await ok(f.people[2].id, command);
    await ok(f.people[1].id, join(f.group.token));
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(f.group.id, "talk", command.proposalId, createdAt)).toBe(true);
    const { readGameProposalDeliveryPlayers } = await import("@/src/lib/game/chat-delivery");
    const eventId = `game-talk:${f.group.id}:${command.proposalId}`;
    const audience = await readGameProposalDeliveryPlayers(eventId, f.context.chatContainerMemberId);
    if (!audience || Array.isArray(audience)) throw new Error("Expected group audience");
    expect(await db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: f.context.chatContainerMemberId,
      deliveryIdempotencyKey: eventId, audience: audience as Awaited<ReturnType<typeof readGameChatAudience>>, now: createdAt }))).toBe(true);
  });

  it.each(["join", "terms", "end", "delete"])("suppresses a prepared note when %s wins the game lock", async change => {
    const f = await talkGroup(4, true); const command = f.command(2);
    await ok(f.people[2].id, command, caseNow);
    const eventId = `game-talk:${f.group.id}:${command.proposalId}`;
    const { readGameProposalDeliveryPlayers } = await import("@/src/lib/game/chat-delivery");
    const audience = await readGameProposalDeliveryPlayers(eventId, f.context.chatContainerMemberId);
    if (!audience || !("contacts" in audience)) throw new Error("Expected prepared group audience");
    lifecycleProof.prepare.mockImplementationOnce(async () => {
      if (change === "join") await ok(f.people[2].id, join(f.group.token), caseNow);
      if (change === "terms") await agreeTerms(f.context, f.people[0].id, f.people[1].id, { type: "editTerms", gameId: f.group.id,
        expectedTermsVersion: 1, terms: { ...terms, stakes: [{ kind: "prize", item: "Pick the next picnic" }] } }, caseNow);
      if (change === "end") await db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM game WHERE id = ${f.group.id} FOR UPDATE`; await tx.game.update({ where: { id: f.group.id }, data: { status: "settled" } }); });
      if (change === "delete") await erase(f.people[2].id);
      return {};
    });
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(f.group.id, "talk", command.proposalId, caseNow)).toBe(false);
    expect(lifecycleProof.append).not.toHaveBeenCalled();
    expect(await talkReceipt(f.group.id, command.proposalId)).toMatchObject({ status: "skipped" });
    await expect(db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, deliveryIdempotencyKey: eventId,
      containerMemberId: f.context.chatContainerMemberId, audience, now: caseNow }))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it("scrubs an unseated deleted author without changing other notes, pending terms or the seat quota", async () => {
    const f = await talkGroup(4, true); const own = f.command(2), other = f.command(3);
    await db.gameInvitee.update({ where: { gameId_seat: { gameId: f.group.id, seat: 2 } }, data: { memberId: null } });
    await ok(f.people[2].id, own, caseNow); await ok(f.people[3].id, other, caseNow);
    const before = await gameRow(f.group.id);
    const otherEvent = await db.gameEvent.findUnique({ where: { commandKey: `game-change:${f.group.id}:${other.proposalId}` } });
    await erase(f.people[2].id);
    const after = await gameRow(f.group.id);
    expect(after.pendingChange).toEqual(before.pendingChange); expect(after.recapEncrypted).toBe(before.recapEncrypted);
    expect(after.players).toEqual(before.players); expect(after.status).toBe(before.status);
    expect(await db.gameEvent.findUnique({ where: { commandKey: `game-change:${f.group.id}:${own.proposalId}` } })).toMatchObject({ actor: "system", payload: { v: 2, invitationSeat: 2, noteEncrypted: null } });
    expect(await db.gameEvent.findUnique({ where: { id: otherEvent!.id } })).toEqual(otherEvent);
    expect(await talkReceipt(f.group.id, own.proposalId)).toMatchObject({ status: "skipped" });
    // A fresh account can prove the same formerly unbound invitation, but its accepted seat stays spent.
    const replacement = await person();
    await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: replacement.id, prisma: tx,
      verifiedEmail: { address: f.people[2].email, verifiedAt: caseNow } }));
    const { readInvitePreview } = await import("@/src/lib/game/service");
    expect(await readInvitePreview(f.group.token, true, replacement.id)).toMatchObject({ canTalk: false });
    expect(await run(replacement.id, f.command(2), caseNow)).toMatchObject({ ok: false,
      error: { code: "INVITE_USED", message: "You've already sent a note for this invitation." } });
  });

  it("requires addressed proof and profile, rejects outsiders and keeps bearer joins unchanged", async () => {
    const f = await talkGroup(); const outsider = await person();
    expect(await run(outsider.id, f.command(1))).toMatchObject({ ok: false, error: { code: "INVITE_USED" } });
    expect(await run(f.people[0].id, f.command(0))).toMatchObject({ ok: false });
    expect(await run(f.people[1].id, { ...f.command(1), termsVersion: 2 })).toMatchObject({ ok: false, error: { code: "TERMS_CHANGED" } });
    expect(await run(f.people[1].id, { type: "negotiate", token: f.group.token, proposalId: randomUUID(), termsVersion: 1, timeZone: "UTC", change: { kind: "edit", lengthDays: 9 } })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await db.gameInvitee.update({ where: { gameId_seat: { gameId: f.group.id, seat: 1 } }, data: { memberId: null } });
    expect(await run(f.people[1].id, f.command(1))).toMatchObject({ ok: true });
    expect(await run(outsider.id, join(f.group.token))).toMatchObject({ ok: true });
  });

  it("keeps Talk availability and admission closed after profile or verified-contact loss", async () => {
    const f = await talkGroup(); const actor = f.people[1];
    const { readInvitePreview } = await import("@/src/lib/game/service");
    await db.gameProfile.delete({ where: { memberId: actor.id } });
    expect(await readInvitePreview(f.group.token, true, actor.id)).toMatchObject({ canTalk: false });
    expect(await run(actor.id, f.command(1))).toMatchObject({ ok: false });
    await ok(actor.id, { type: "setProfile", firstName: "Sam", timeZone: "UTC" });
    await db.gameInvitee.update({ where: { gameId_seat: { gameId: f.group.id, seat: 1 } }, data: { memberId: null } });
    await db.hostedMemberEmailAuthorization.deleteMany({ where: { memberId: actor.id } });
    expect(await readInvitePreview(f.group.token, true, actor.id)).toMatchObject({ canTalk: false });
    expect(await run(actor.id, f.command(1))).toMatchObject({ ok: false, error: { code: "INVITE_USED" } });
    await db.$transaction(tx => upsertHostedMemberEmailAuthorization({ memberId: actor.id, prisma: tx,
      verifiedEmail: { address: actor.email, verifiedAt: createdAt } }));
    expect(await readInvitePreview(f.group.token, true, actor.id)).toMatchObject({ canTalk: true });
    expect(await run(actor.id, f.command(1))).toMatchObject({ ok: true });
  });

  it("keeps unjoined challengers and hidden, incomplete or reported group photos ineligible", async () => {
    const f = await talkGroup(3, true);
    const target = await groupPhoto(f.group.id, f.people[1].id);
    const command = { type: "challenge" as const, gameId: f.group.id, entryId: target.id };
    expect(await run(f.people[2].id, command, caseNow)).toMatchObject({ ok: false });
    expect(await run(f.people[0].id, command, caseNow)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await groupPhoto(f.group.id, f.people[0].id);
    await db.gameEntry.update({ where: { id: target.id }, data: { incomplete: true } });
    expect(await run(f.people[0].id, command, caseNow)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await db.gameEntry.update({ where: { id: target.id }, data: { incomplete: null } });
    await ok(f.people[0].id, { type: "report", reportId: randomUUID(), gameId: f.group.id, entryId: target.id, about: "post", reason: "other" }, caseNow);
    expect(await run(f.people[0].id, command, caseNow)).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await db.gameEvent.count({ where: { gameId: f.group.id, type: "challenged" } })).toBe(0);
  });

  it("serializes competing cases, gives independent budgets and refunds departure without reopening an entry", async () => {
    const f = await talkGroup(4, true); await ok(f.people[2].id, join(f.group.token), caseNow);
    const photos = await Promise.all(f.people.slice(0, 3).map(p => groupPhoto(f.group.id, p.id)));
    const commands = [0, 2].map(index => ({ actor: f.people[index].id, command: { type: "challenge" as const, gameId: f.group.id, entryId: photos[1].id } }));
    const results = await Promise.all(commands.map(({ actor, command }) => run(actor, command, caseNow)));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok)).toMatchObject([{ error: { code: "INVALID_REQUEST" } }]);
    const winner = commands[results.findIndex(r => r.ok)];
    expect(await run(winner.actor, winner.command, caseNow)).toMatchObject({ ok: true });
    expect((await readGame(f.group.id, winner.actor, true))?.canChallenge).toBe(false);
    const accused = await readGame(f.group.id, f.people[1].id, true);
    expect(accused?.days[0].mine?.entryId).toBe(photos[1].id);
    expect(accused?.days[0].mine).not.toHaveProperty("challenge");
    expect(await run(f.people[1].id, { type: "challenge", gameId: f.group.id, entryId: photos[0].id }, caseNow)).toMatchObject({ ok: true });
    await ok(f.people[1].id, { type: "leave", gameId: f.group.id }, caseNow);
    expect((await readGame(f.group.id, winner.actor, true))?.canChallenge).toBe(true);
    expect(await run(winner.actor, winner.command, caseNow)).toMatchObject({ ok: true });
    expect(await db.gameEvent.count({ where: { gameId: f.group.id, type: "challenged" } })).toBe(2);
  });

  it("revalidates app challenge room authority before spending and uses inherited shared facts", async () => {
    const f = await talkGroup(4, true);
    await Promise.all(f.people.slice(0, 2).map(p => groupPhoto(f.group.id, p.id)));
    const target = await db.gameEntry.findFirstOrThrow({ where: { gameId: f.group.id, memberId: f.people[1].id } });
    chatProof.rooms.set(f.context.chatContainerMemberId, [f.people[0].email, "outsider@example.test"]);
    expect(await run(f.people[0].id, { type: "challenge", gameId: f.group.id, entryId: target.id }, caseNow)).toMatchObject({ ok: false, error: { code: "CHAT_UNAVAILABLE" } });
    expect(await db.gameEvent.count({ where: { gameId: f.group.id, type: "challenged" } })).toBe(0);
    chatProof.rooms.set(f.context.chatContainerMemberId, [...f.people.map(p => p.email), "outsider@example.test"]);
    // A structural revision inherits the earlier default task words.
    const row = await gameRow(f.group.id);
    const stored = row.terms as { v: number; versions: Array<{ n: number; fromDay: number }> };
    const { sealGameText } = await import("@/src/lib/game/crypto");
    const termsWordsEncrypted = await sealGameText({ memberId: row.wordsOwnerMemberId, table: "game", rowId: row.id, field: "terms_words" },
      JSON.stringify({ v: 1, versions: [{ n: 1, defaultTask: "Take a walk", tasks: [{ seat: 1, text: "Private rehab override" }], stakes: [] }] }));
    if (!termsWordsEncrypted) throw new Error("Expected sealed terms words");
    await db.game.update({ where: { id: f.group.id }, data: { terms: { ...stored,
      versions: [...stored.versions, { ...stored.versions[0], n: 2, fromDay: 0 }] }, termsWordsEncrypted } });
    await ok(f.people[0].id, { type: "challenge", gameId: f.group.id, entryId: target.id }, caseNow);
    const { readGameChallengeCase, readGameChallengeInstructions } = await import("@/src/lib/game/service");
    const current = await readGameChallengeCase(db, f.group.id, target.id, caseNow);
    const instructions = await readGameChallengeInstructions(current!);
    expect(instructions).toContain("Take a walk"); expect(instructions).toContain("Player0"); expect(instructions).toContain("Player1");
    expect(instructions).not.toMatch(/Teammate|caption|https?:|mediaKey|Private rehab override/);
  });
});

describe.skipIf(!enabled)("group exact notice ordering", () => {
  beforeEach(async () => {
    // Keep the injected provider failure on this notice, outside the missed-day pre-sweep.
    vi.spyOn(await import("@/src/lib/game/service"), "reserveDueGameMissedDayCheckIns").mockResolvedValue(0);
  });

  it("retries provider outages and keeps a challenge after a bystander arrives during recovery", async () => {
    const f = await talkGroup(3, true);
    const photos = await Promise.all(f.people.slice(0, 2).map(p => groupPhoto(f.group.id, p.id)));
    await ok(f.people[0].id, { type: "challenge", gameId: f.group.id, entryId: photos[1].id }, caseNow);
    const receipt = await db.hostedLinqDelivery.findFirstOrThrow({ where: { sourceRef: `${f.group.id}:${photos[1].id}`, template: "game_challenge" } });
    const { drainGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    const recover = async () => {
      await db.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { attemptedAt: new Date("1600-01-01"), retryAfterAt: new Date(0) } });
      await parkOtherLifecycleReceipts(receipt.id);
      return drainGameChatLifecycle({ prisma: db, now: caseNow });
    };
    expect(await recover()).toMatchObject({ attempted: 1, queued: 1 });
    lifecycleProof.mailbox.mockResolvedValue({ id: "synthetic-challenge", consumedAt: null });
    const provider = vi.spyOn(await import("@/src/lib/hosted-onboarding/linq-client"), "getHostedLinqChatSummary");
    provider.mockRejectedValueOnce(new Error("Temporary provider outage"));
    expect(await recover()).toMatchObject({ attempted: 1, queued: 0, deferred: 1 });
    expect(await db.hostedLinqDelivery.findUnique({ where: { id: receipt.id } })).toMatchObject({ status: "generation_queued" });
    provider.mockRestore();
    chatProof.rooms.set(f.context.chatContainerMemberId, [...f.people.map(p => p.email), "outsider@example.test"]);
    expect(await recover()).toMatchObject({ attempted: 1, queued: 1 });
    expect(await db.hostedLinqDelivery.findUnique({ where: { id: receipt.id } })).toMatchObject({ status: "generation_queued" });
    expect(lifecycleProof.append).toHaveBeenCalledOnce();
    expect(lifecycleProof.signal).toHaveBeenCalledTimes(2);
  });

  it.each(["concession", "retake", "withdrawal", "departure", "end"])("suppresses prepared challenge publication and final dispatch after %s", async change => {
    const f = await talkGroup(4, true); await ok(f.people[2].id, join(f.group.token), caseNow);
    const photos = await Promise.all(f.people.slice(0, 3).map(p => groupPhoto(f.group.id, p.id)));
    await ok(f.people[0].id, { type: "challenge", gameId: f.group.id, entryId: photos[1].id }, caseNow);
    const eventId = `game-challenge:${f.group.id}:${photos[1].id}`;
    const { createHostedLinqDeliveryIdempotencyLookupKey } = await import("@/src/lib/hosted-onboarding/linq-observability-identifiers");
    const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
    const audience = await readGameChatAudience(f.context.chatContainerMemberId);
    const changeFirst = async () => {
      if (change === "concession") expect(await runGameCommand({ ...f.context, actorMemberId: f.people[1].id, now: caseNow,
        command: { type: "setDayCompletion", gameId: f.group.id, date: "2030-03-09", incomplete: true } })).toMatchObject({ ok: true });
      if (change === "withdrawal") await ok(f.people[1].id, { type: "withdraw", gameId: f.group.id, entryId: photos[1].id }, caseNow);
      if (change === "departure") await ok(f.people[1].id, { type: "leave", gameId: f.group.id }, caseNow);
      if (change === "end" || change === "retake") await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM game WHERE id = ${f.group.id} FOR UPDATE`;
        if (change === "end") await tx.game.update({ where: { id: f.group.id }, data: { status: "settled" } });
        else {
          await tx.gameEntry.update({ where: { id: photos[1].id }, data: { withdrawnAt: caseNow, withdrawnReason: "replaced" } });
          await tx.gameEntry.create({ data: { ...photos[1], id: randomUUID(), attempt: 2 } });
        }
      });
    };
    lifecycleProof.prepare.mockImplementationOnce(async () => { await changeFirst(); return {}; });
    const { id: challengeReceipt } = await db.hostedLinqDelivery.update({ where: { idempotencyKey: key }, data: { attemptedAt: new Date("1800-01-01"), retryAfterAt: null } });
    await parkOtherLifecycleReceipts(challengeReceipt);
    const { drainGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    await drainGameChatLifecycle({ prisma: db, now: caseNow });
    expect(lifecycleProof.prepare).toHaveBeenCalledOnce();
    expect(lifecycleProof.append).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key } })).toMatchObject({ status: "skipped" });
    await expect(db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, deliveryIdempotencyKey: eventId,
      containerMemberId: f.context.chatContainerMemberId, audience, now: caseNow }))).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it.each([false, true])("serializes unseated note acceptance behind account deletion, unbound=%s", async unbound => {
    const f = await talkGroup(4, true); const actor = f.people[2].id; const command = f.command(2);
    if (unbound) await db.gameInvitee.update({ where: { gameId_seat: { gameId: f.group.id, seat: 2 } }, data: { memberId: null } });
    const preparedDeletion = await prepareGameAccountDeletion({ memberIds: [actor], prisma: db });
    const { lockHostedMemberRow } = await import("@/src/lib/hosted-onboarding/shared");
    const crypto = await import("@/src/lib/game/crypto");
    const original = crypto.sealGameText;
    let preparationReady: () => void = () => {};
    const prepared = new Promise<void>(resolve => { preparationReady = resolve; });
    vi.spyOn(crypto, "sealGameText").mockImplementation(async (target, text) => {
      const result = await original(target, text);
      if (target.field === `talk_note:${command.proposalId}`) preparationReady();
      return result;
    });
    let acceptance: ReturnType<typeof run> | undefined;
    await db.$transaction(async tx => {
      await lockHostedMemberRow(tx, actor);
      acceptance = run(actor, command, caseNow);
      await prepared;
      await applyGameAccountDeletionTx({ memberIds: [actor], tx, prepared: preparedDeletion, now: caseNow });
      await tx.hostedMember.delete({ where: { id: actor } });
    });
    expect(await acceptance).toMatchObject({ ok: false, error: { code: "PLAYER_UNAVAILABLE" } });
    expect(await db.gameEvent.count({ where: { gameId: f.group.id, actor } })).toBe(0);
    expect(await db.gameEvent.count({ where: { commandKey: `game-change:${f.group.id}:${command.proposalId}` } })).toBe(0);
  });

  it("rejects mismatched receipt identity, event type and author before opening note content", async () => {
    const f = await talkGroup(); const command = f.command(2); await ok(f.people[2].id, command);
    const { readGameTalkReceiptIdentity, readCurrentGameTalk } = await import("@/src/lib/game/talk");
    const receipt = await talkReceipt(f.group.id, command.proposalId);
    expect(await readGameTalkReceiptIdentity(db, { ...receipt, sourceRef: `${f.group.id}:${randomUUID()}` })).toBeNull();
    expect(await readGameTalkReceiptIdentity(db, { ...receipt, sourceRef: f.group.id })).toBeNull();
    const commandKey = `game-change:${f.group.id}:${command.proposalId}`;
    await db.gameEvent.update({ where: { commandKey }, data: { type: "change_proposed" } });
    expect(await readCurrentGameTalk(db, f.group.id, command.proposalId, createdAt)).toBeNull();
    await db.gameEvent.update({ where: { commandKey }, data: { type: "talk_requested", actor: f.people[3].id } });
    expect(await readCurrentGameTalk(db, f.group.id, command.proposalId, createdAt)).toBeNull();
  });

  it("uses per-game duplicate-name cohorts and deliberately includes a consenting unseated author", async () => {
    const f = await talkGroup(4, true); await ok(f.people[2].id, join(f.group.token), caseNow);
    for (const p of f.people) await ok(p.id, { type: "setProfile", firstName: "Sam", timeZone: "UTC" });
    await ok(f.people[2].id, { type: "leave", gameId: f.group.id }, caseNow);
    const overlapping = await create(f.people[0], f.people.slice(1));
    await db.game.update({ where: { id: overlapping.id }, data: { chatContainerMemberId: f.context.chatContainerMemberId } });
    await ok(f.people[2].id, join(overlapping.token), caseNow);
    const photos = await Promise.all(f.people.slice(0, 2).map(p => groupPhoto(f.group.id, p.id)));
    await ok(f.people[0].id, { type: "challenge", gameId: f.group.id, entryId: photos[1].id }, caseNow);
    const { readGameChallengeCase, readGameChallengeInstructions, readGameChatProfiles } = await import("@/src/lib/game/service");
    const projection = await readGameChatState(f.context.chatContainerMemberId, f.people.map(p => p.id));
    expect(projection.games).toHaveLength(2);
    const shared = projection.games.find(g => g.id === f.group.id)!;
    const instructions = await readGameChallengeInstructions((await readGameChallengeCase(db, f.group.id, photos[1].id, caseNow))!);
    const facts = JSON.parse(instructions!.split("\n").at(-1)!);
    expect(facts.challengerName).toBe(shared.players.find(p => p.memberId === f.people[0].id)?.firstName);
    expect(facts.accusedName).toBe(shared.players.find(p => p.memberId === f.people[1].id)?.firstName);
    const command = f.command(3); await ok(f.people[3].id, command, caseNow);
    const { deliverGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
    expect(await deliverGameChatLifecycle(f.group.id, "talk", command.proposalId, caseNow)).toBe(true);
    const cohort = await readGameChatProfiles([f.people[0].id, f.people[1].id, f.people[3].id]);
    expect(lifecycleProof.prepare.mock.lastCall![0].envelope.notification.instructions).toContain(JSON.stringify(cohort.find(p => p.memberId === f.people[3].id)!.firstName));
  });
});

describe.skipIf(!enabled)("surviving group authority", () => {
  async function survivingGroup() {
    const f = await talkGroup(4, true);
    await ok(f.people[2].id, join(f.group.token), caseNow);
    await db.hostedThreadContainer.update({ where: { memberId: f.context.chatContainerMemberId }, data: { ownerMemberId: f.people[1].id } });
    await erase(f.people[0].id);
    const context = { ...f.context, chatPlayerMemberIds: f.people.slice(1).map(p => p.id),
      chatAudience: await readGameChatAudience(f.context.chatContainerMemberId) };
    expect(await gameRow(f.group.id)).toMatchObject({ status: "live", createdBy: null, inviteTokenEncrypted: null });
    return { ...f, context, actor: f.people[3] };
  }

  it("keeps excuse-only cancellation closed until the excuser deletes", async () => {
    const people = [await person(), await person(), await person()];
    const game = await create(people[0], people.slice(1));
    for (const p of people.slice(1)) await ok(p.id, join(game.token));
    const at = new Date("2030-03-10T12:00:00Z");
    await ok(people[2].id, { type: "post", gameId: game.id, entryId: randomUUID(), kind: "excuse", text: "Missed yesterday", mediaKeys: [] }, at);
    expect(await db.gameEntry.findFirst({ where: { gameId: game.id } })).toMatchObject({ attempt: 0 });
    expect(await run(people[0].id, { type: "cancelInvite", gameId: game.id }, at)).toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    await erase(people[2].id);
    expect(await readGame(game.id, people[0].id, true)).toMatchObject({ permissions: { canCancel: true } });
    expect(await run(people[0].id, { type: "cancelInvite", gameId: game.id }, at)).toMatchObject({ ok: true });
    expect((await gameRow(game.id)).status).toBe("void");
  }, 60_000);

  it("accepts surviving Talk and exact replay, while a creatorless pair still expires", async () => {
    const f = await survivingGroup();
    const { readInvitePreview } = await import("@/src/lib/game/service");
    expect(await readInvitePreview(f.group.token, true, f.actor.id)).toMatchObject({ canTalk: true });
    const command = f.command(3);
    expect(await run(f.actor.id, command, caseNow)).toMatchObject({ ok: true });
    expect(await talkReceipt(f.group.id, command.proposalId)).toMatchObject({ status: "awaiting_generation" });
    expect(await run(f.actor.id, command, caseNow)).toMatchObject({ ok: true });
    expect(await db.gameEvent.count({ where: { gameId: f.group.id, type: "talk_requested" } })).toBe(1);
    const pairStarter = await person(), pairSurvivor = await person();
    const pair = await ok(pairStarter.id, { type: "createGame", gameId: randomUUID(), inviteeFirstName: "Teammate",
      terms: { ...terms, defaultTask: undefined, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }] } });
    await ok(pairSurvivor.id, join(pair!.inviteToken!));
    await erase(pairStarter.id);
    expect(await run(pairSurvivor.id, { ...command, token: pair!.inviteToken! }, caseNow)).toMatchObject({ ok: false, error: { code: "INVITE_EXPIRED" } });
  }, 60_000);

  it("accepts surviving chat at the addressed seat exactly once without a bearer token", async () => {
    const f = await survivingGroup();
    const input = { ...f.context, actorMemberId: f.actor.id, now: caseNow,
      update: { operation: "approve" as const, gameId: f.group.id, expectedTermsVersion: 1 } };
    expect(await runGameChatUpdate(input)).toEqual({ ok: true, game: null });
    const before = await db.gameEvent.count({ where: { gameId: f.group.id } });
    expect(await runGameChatUpdate(input)).toEqual({ ok: true, game: null });
    expect(await db.gameEvent.count({ where: { gameId: f.group.id } })).toBe(before);
    expect(await db.gamePlayer.findMany({ where: { gameId: f.group.id, memberId: f.actor.id } })).toMatchObject([{ seat: 3 }]);
    expect(await db.gamePlayer.count({ where: { gameId: f.group.id, seat: { gte: 10 } } })).toBe(0);
    const { parseGameCommand } = await import("@/src/lib/game/command");
    expect(() => parseGameCommand({ type: "join", gameId: f.group.id, termsVersion: 1, timeZone: "UTC" })).toThrow();
  }, 60_000);

  it.each(["unaddressed", "contact", "invitation", "terms", "disabled", "legacy", "room", "version"] as const)("refuses surviving chat admission after %s authority loss", async kind => {
    const f = await survivingGroup();
    let hookReached = false;
    if (kind === "contact") await db.gameInvitee.update({ where: { gameId_seat: { gameId: f.group.id, seat: 3 } }, data: { memberId: null } });
    if (kind === "unaddressed") await db.gameInvitee.update({ where: { gameId_seat: { gameId: f.group.id, seat: 3 } }, data: { memberId: null, recipientLookupKey: null } });
    if (kind === "terms") vi.stubEnv("MURPH_GAME_REQUIRE_CURRENT_TERMS", "true");
    if (kind === "disabled") vi.stubEnv("MURPH_GAME_GROUPS_ENABLED", "false");
    const result = await runGameChatUpdate({ ...f.context, actorMemberId: f.actor.id, now: caseNow, multiplayer: kind !== "legacy",
      update: { operation: "approve", gameId: f.group.id, expectedTermsVersion: kind === "version" ? 0 : 1 },
      beforeMutationTx: async tx => {
        hookReached = true;
        if (kind === "contact") await tx.hostedMemberEmailAuthorization.deleteMany({ where: { memberId: f.actor.id } });
        if (kind === "invitation") await tx.gameInvitee.update({ where: { gameId_seat: { gameId: f.group.id, seat: 3 } }, data: { memberId: null, recipientLookupKey: null } });
        if (kind === "room") await tx.game.update({ where: { id: f.group.id }, data: { chatContainerMemberId: null } });
      } });
    const code = kind === "terms" ? "TERMS_REQUIRED" : kind === "disabled" ? "GAME_DISABLED" : kind === "legacy" ? "INVITE_NOT_FOUND" : kind === "version" ? "INVALID_REQUEST" : "NOT_A_PLAYER";
    expect(result).toMatchObject({ ok: false, error: { code } });
    if (["contact", "invitation", "room"].includes(kind)) expect(hookReached).toBe(true);
    if (["contact", "invitation"].includes(kind)) expect(result).toMatchObject({ error: { message: "Only an addressed invitee can agree." } });
    expect(await db.gamePlayer.count({ where: { gameId: f.group.id, memberId: f.actor.id } })).toBe(0);
  }, 60_000);
});

/** Each recovery isolates one receipt while retaining the real sweep and authority owners. */
async function recoverBlockedGroupNotice(receiptId: string, now = caseNow) {
  await db.hostedLinqDelivery.update({ where: { id: receiptId }, data: { attemptedAt: new Date("1600-01-01"), retryAfterAt: new Date(0) } });
  await parkOtherLifecycleReceipts(receiptId);
  const { drainGameChatLifecycle } = await vi.importActual<typeof import("@/src/lib/game/chat-lifecycle")>("@/src/lib/game/chat-lifecycle");
  return drainGameChatLifecycle({ prisma: db, now });
}
async function blockedGroupNotice(kind: "talk" | "challenge") {
  const f = await talkGroup(4, true);
  let eventId: string;
  if (kind === "talk") {
    const command = f.command(2);
    await ok(f.people[2].id, command, caseNow);
    eventId = `game-talk:${f.group.id}:${command.proposalId}`;
  } else {
    await groupPhoto(f.group.id, f.people[0].id);
    const photo = await groupPhoto(f.group.id, f.people[1].id);
    await ok(f.people[0].id, { type: "challenge", gameId: f.group.id, entryId: photo.id }, caseNow);
    eventId = `game-challenge:${f.group.id}:${photo.id}`;
  }
  const { createHostedLinqDeliveryIdempotencyLookupKey } = await import("@/src/lib/hosted-onboarding/linq-observability-identifiers");
  const receipt = () => db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)! } });
  const block = (type: "block" | "unblock") => ok(f.people[0].id, { type, memberId: f.people[1].id }, caseNow);
  const dispatch = () => db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, deliveryIdempotencyKey: eventId,
    containerMemberId: f.context.chatContainerMemberId, audience: f.context.chatAudience, now: caseNow }));
  return { ...f, eventId, receipt, block, dispatch };
}

describe.skipIf(!enabled)("group block keeps the room", () => {
  beforeEach(async () => {
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.withmurph.ai");
    vi.spyOn(await import("@/src/lib/game/service"), "reserveDueGameMissedDayCheckIns").mockResolvedValue(0);
  });

  it("keeps the authority answer when a block commits after its block read", async () => {
    const f = await blockedGroupNotice("talk");
    const game = await gameRow(f.group.id), room = f.context.chatContainerMemberId;
    const late = new Proxy(db, { get(target, property, receiver) {
      if (property !== "gameBlock") return Reflect.get(target, property, receiver);
      return new Proxy(target.gameBlock, { get(blocks, operation, blockReceiver) {
        if (operation !== "findFirst") return Reflect.get(blocks, operation, blockReceiver);
        return async (args: Parameters<typeof blocks.findFirst>[0]) => {
          const result = await blocks.findFirst(args);
          await f.block("block");
          return result;
        };
      } });
    } });
    expect(await readGroupGameNoticeAuthority(game, room, f.context.chatAudience, late)).toEqual(f.context.chatAudience);
    await expect(readGroupGameNoticeAuthority(game, room, f.context.chatAudience, db)).rejects.toMatchObject({ reason: "blocked" });
  });

  it("keeps the live game and every waiting receipt byte-identical", async () => {
    const f = await blockedGroupNotice("talk");
    await groupPhoto(f.group.id, f.people[0].id);
    const photo = await groupPhoto(f.group.id, f.people[1].id);
    await ok(f.people[0].id, { type: "challenge", gameId: f.group.id, entryId: photo.id }, caseNow);
    await reserveGameChatLifecycleTx({ gameId: f.group.id, kind: "change_cancelled", proposalId: "synthetic-change", tx: db, now: caseNow });
    await markGameChatGenerationQueuedTx(f.eventId, db, f.context.chatContainerMemberId);
    await markGameChatGenerationQueuedTx(`game-started:${f.group.id}`, db, f.context.chatContainerMemberId);
    const receipts = () => db.hostedLinqDelivery.findMany({ where: { source: "game_lifecycle", OR: [{ sourceRef: f.group.id }, { sourceRef: { startsWith: `${f.group.id}:` } }] }, orderBy: { id: "asc" } });
    const game = await gameRow(f.group.id), before = await receipts();
    expect(new Set(before.map(row => row.status))).toEqual(new Set(["awaiting_generation", "generation_queued"]));
    await f.block("block");
    expect(await gameRow(f.group.id)).toEqual(game);
    expect(await receipts()).toEqual(before);
    expect((await receipts()).some(row => row.skipReason === "game_blocked")).toBe(false);
  });

  it.each([ ["talk", false], ["talk", true], ["challenge", false], ["challenge", true] ] as const)("waits and resumes %s, published=%s", async (kind, published) => {
    const f = await blockedGroupNotice(kind);
    if (published) {
      expect(await recoverBlockedGroupNotice((await f.receipt()).id)).toMatchObject({ attempted: 1, queued: 1 });
      lifecycleProof.mailbox.mockResolvedValue({ id: "synthetic-blocked-notice", consumedAt: null });
    }
    const status = (await f.receipt()).status;
    lifecycleProof.append.mockClear(); lifecycleProof.signal.mockClear();
    await f.block("block");
    expect(await recoverBlockedGroupNotice((await f.receipt()).id)).toMatchObject({ attempted: 1, queued: 0 });
    expect(await f.receipt()).toMatchObject({ status, skipReason: null, skippedAt: null });
    expect(lifecycleProof.append).not.toHaveBeenCalled(); expect(lifecycleProof.signal).not.toHaveBeenCalled();
    const { readGameProposalDeliveryPlayers } = await import("@/src/lib/game/chat-delivery");
    await expect(readGameProposalDeliveryPlayers(f.eventId, f.context.chatContainerMemberId)).rejects.toMatchObject({ reason: "blocked" });
    await expect(f.dispatch()).rejects.toMatchObject({ reason: "blocked" });
    await f.block("unblock");
    expect(await recoverBlockedGroupNotice((await f.receipt()).id)).toMatchObject({ attempted: 1, queued: 1 });
    expect(lifecycleProof.append).toHaveBeenCalledTimes(published ? 0 : 1);
    expect(lifecycleProof.signal).toHaveBeenCalledOnce();
    expect(await f.dispatch()).toBe(true);
  });

  it("preserves a challenge when the block commits during publication", async () => {
    const f = await blockedGroupNotice("challenge");
    lifecycleProof.prepare.mockImplementationOnce(async () => { await f.block("block"); return {}; });
    expect(await recoverBlockedGroupNotice((await f.receipt()).id)).toMatchObject({ attempted: 1, queued: 0 });
    expect(lifecycleProof.prepare).toHaveBeenCalledOnce(); expect(lifecycleProof.append).not.toHaveBeenCalled();
    expect(await f.receipt()).toMatchObject({ status: "awaiting_generation", skippedAt: null, skipReason: null });
    await f.block("unblock");
    expect(await recoverBlockedGroupNotice((await f.receipt()).id)).toMatchObject({ queued: 1 });
    expect(lifecycleProof.append).toHaveBeenCalledOnce();
  });

  it.each(["talk", "challenge"] as const)("supersedes an ended %s even while a block stands", async kind => {
    const f = await blockedGroupNotice(kind);
    await f.block("block");
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${f.group.id} FOR UPDATE`;
      await tx.game.update({ where: { id: f.group.id }, data: { status: kind === "talk" ? "void" : "settled" } });
    });
    await recoverBlockedGroupNotice((await f.receipt()).id);
    expect(await f.receipt()).toMatchObject({ status: "skipped", skipReason: "game_lifecycle_superseded" });
    expect(lifecycleProof.append).not.toHaveBeenCalled();
    await expect(f.dispatch()).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it("keeps a bystander audience without a block", async () => {
    const f = await blockedGroupNotice("talk");
    chatProof.rooms.set(f.context.chatContainerMemberId, [...f.people.map(p => p.email), "outsider@example.test"]);
    await recoverBlockedGroupNotice((await f.receipt()).id);
    expect(await f.receipt()).toMatchObject({ status: "generation_queued", skipReason: null });
    expect(lifecycleProof.append).toHaveBeenCalledOnce();
  });

  it.each(["before settlement", "while waiting", "after publication"])("resumes the recap after a block %s", async timing => {
    const g = await leaverChatGame();
    await entry(g.game.id, g.people[0].id, 0);
    prepareGroupLifecycle(g.room);
    const block = (type: "block" | "unblock") => ok(g.people[0].id, { type, memberId: g.people[1].id }, caseNow);
    if (timing === "before settlement") await block("block");
    await settle(g.game.id, g.people[0].id);
    // Keep this fixture inside the existing seven-day funding window.
    await db.game.update({ where: { id: g.game.id }, data: { settledAt: new Date() } });
    const receipt = () => db.hostedLinqDelivery.findFirstOrThrow({ where: { sourceRef: g.game.id, template: "game_recap" } });
    if (timing === "after publication") {
      expect(await recoverBlockedGroupNotice((await receipt()).id)).toMatchObject({ queued: 1 });
      lifecycleProof.mailbox.mockResolvedValue({ id: "synthetic-blocked-recap", consumedAt: null });
    }
    const before = await receipt();
    if (timing !== "before settlement") await block("block");
    expect(await receipt()).toEqual(before);
    expect(await readGameRecapMaterial(g.game.id, g.room, g.members)).toBeNull();
    const { handleGameChatTool } = await import("@/src/lib/game/chat-tool");
    const origin = { kind: "game_recap" as const, gameId: g.game.id, eventId: `game-recap:${g.game.id}` };
    const read = () => handleGameChatTool({ memberId: g.room, multiplayer: true, runtimeIdentity: null, request: { action: "read_game", origin } });
    if (timing === "after publication") {
      expect(await read()).toMatchObject({ result: { status: "unavailable", error: "recap_authority_unavailable" } });
      expect(await receipt()).toEqual(before);
    }
    lifecycleProof.append.mockClear(); lifecycleProof.signal.mockClear();
    expect(await recoverBlockedGroupNotice(before.id)).toMatchObject({ queued: 0 });
    expect(await receipt()).toMatchObject({ status: before.status, skipReason: null, skippedAt: null });
    expect(lifecycleProof.append).not.toHaveBeenCalled(); expect(lifecycleProof.signal).not.toHaveBeenCalled();
    expect((await readGameChatFundingRooms({ memberIds: [g.room], now: new Date(), prisma: db })).has(g.room)).toBe(false);
    await block("unblock");
    expect((await readGameChatFundingRooms({ memberIds: [g.room], now: new Date(), prisma: db })).get(g.room)).toBe(g.room);
    expect(await recoverBlockedGroupNotice(before.id)).toMatchObject({ queued: 1 });
    expect(lifecycleProof.append).toHaveBeenCalledTimes(timing === "after publication" ? 0 : 1);
    expect(lifecycleProof.signal).toHaveBeenCalledOnce();
    expect(await read()).toMatchObject({ result: { status: "ok" } });
    const sealInput = await queuedGroupRecap(g);
    const recap = { ...sealInput.recap, superlatives: g.people.map((p, i) => ({ memberId: p.id,
      title: `Route finder ${i + 1}`, line: "Brought a walking task to the week." })) };
    expect(await handleGameChatTool({ memberId: g.room, multiplayer: true, runtimeIdentity: null,
      request: { action: "write_recap", origin, recap, priorChatLines: [] } })).toMatchObject({ result: { status: "ok" } });
    expect((await readGame(g.game.id, g.people[0].id, true))?.recap).toMatchObject({ pages: recap.pages });
    expect(await db.$transaction(tx => assertGameProposalDeliveryCurrentTx({ tx, containerMemberId: g.room,
      audience: g.context.chatAudience, deliveryIdempotencyKey: origin.eventId }))).toBe(true);
  });

  it("calls off the pair beside an intact group shared by the same players", async () => {
    const f = await blockedGroupNotice("talk");
    const pairId = randomUUID();
    const pair = await ok(f.people[0].id, { type: "createGame", gameId: pairId, inviteeFirstName: "Teammate",
      terms: { tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Choose our next outing" }] } });
    await ok(f.people[1].id, join(pair!.inviteToken!));
    await db.game.update({ where: { id: pairId }, data: { chatContainerMemberId: f.context.chatContainerMemberId } });
    const before = await f.receipt(), game = await gameRow(f.group.id);
    await f.block("block");
    expect(await gameRow(pairId)).toMatchObject({ status: "void", chatContainerMemberId: null });
    expect(await db.hostedLinqDelivery.findFirst({ where: { sourceRef: pairId, template: "game_started" } })).toMatchObject({ status: "skipped", skipReason: "game_blocked" });
    expect(await gameRow(f.group.id)).toEqual(game); expect(await f.receipt()).toEqual(before);
  });
});
