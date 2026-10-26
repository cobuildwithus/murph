import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

interface SentEmail { idempotencyKey: string; subject: string; text: string; to: string[] }
const mocks = vi.hoisted(() => ({ sendEmail: vi.fn<(email: SentEmail) => Promise<{ providerMessageId: string }>>(async () => ({ providerMessageId: "email_1" })) }));
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn(async () => {}) }));
vi.mock("@/src/lib/hosted-onboarding/resend-plain-text-email", () => ({ sendHostedResendPlainTextEmail: mocks.sendEmail }));

import type { GameCommand, GameTermsInput } from "@/src/lib/game/contract";
import { reserveGameChatLifecycleTx } from "@/src/lib/game/chat-lifecycle-receipt";
import { openGameTexts } from "@/src/lib/game/crypto";
import { readGameReportQueue, reviewGameReport } from "@/src/lib/game/report-review";
import { devSettleNow, devStartNow, readGame, readGameChatState, readHome, runGameCommand } from "@/src/lib/game/service";
import { getPrisma } from "@/src/lib/prisma";

const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (runPostgresProof && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("The game report and block proof needs an isolated local test database.");
}

const TERMS: GameTermsInput = {
  schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
  stakes: [{ item: "Breakfast in bed", kind: "prize" }],
  tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
};
const memberIds: string[] = [];

async function member(firstName: string): Promise<string> {
  const id = `hbm_gamesafe_${firstName.toLowerCase()}_${randomUUID().slice(0, 8)}`;
  await getPrisma().hostedMember.create({ data: { billingStatus: "active", id } });
  memberIds.push(id);
  await ok(id, { firstName, timeZone: "America/New_York", type: "setProfile" });
  return id;
}

async function run(actor: string, command: GameCommand) {
  return runGameCommand({ actorMemberId: actor, command });
}

async function ok(actor: string, command: GameCommand) {
  const result = await run(actor, command);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.error.code} ${result.error.message}`);
  return result.game;
}

async function invite(challenger: string, extra: Partial<Extract<GameCommand, { type: "createGame" }>> = {}) {
  const gameId = randomUUID();
  const created = await ok(challenger, { gameId, inviteeFirstName: "Bestie", terms: TERMS, type: "createGame", ...extra });
  return { gameId, token: created!.inviteToken! };
}

async function live(challenger: string, invitee: string) {
  const { gameId, token } = await invite(challenger);
  await ok(invitee, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" });
  await devStartNow(gameId, challenger).catch(() => undefined);
  return gameId;
}

async function words(actor: string, gameId: string, text: string) {
  const entryId = randomUUID();
  await ok(actor, { entryId, gameId, kind: "words", mediaKeys: [], text, type: "post" });
  return entryId;
}

type ReportCommand = Extract<GameCommand, { type: "report" }>;
const report = (gameId: string, extra: Partial<ReportCommand> = {}): ReportCommand =>
  ({ about: "player", gameId, reason: "harassment", reportId: randomUUID(), type: "report", ...extra });

describe.skipIf(!runPostgresProof)("weekly game report and block", () => {
  beforeEach(() => {
    mocks.sendEmail.mockClear();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("HOSTED_LINQ_ALERT_EMAIL_FROM", "Murph Alerts <alerts@example.test>");
    vi.stubEnv("HOSTED_GAME_REPORT_ALERT_EMAILS", "safety@example.test");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds } } });
  });

  it("calls off a game mid-way the way a player leaving does, and hides each from the other", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    await words(leo, gameId, "Leo day one");
    await words(ava, gameId, "Ava day one");

    expect(await ok(leo, { memberId: ava, type: "block" })).toBeNull();

    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ status: "void", liveRosterKey: null, result: null });
    expect(await getPrisma().gameTicket.count({ where: { gameId } })).toBe(0);
    expect(await getPrisma().gameEvent.findFirst({ where: { gameId, type: "blocked" } })).toMatchObject({ actor: leo });
    // Ava sees exactly what a player leaving looks like: no one told her it was a block.
    const avas = (await readGame(gameId, ava))!;
    expect(avas).toMatchObject({ status: "void", result: null, tickets: [] });
    expect(avas.players.find((player) => !player.isMe)).toMatchObject({ left: true, memberId: null, firstName: "Leo", avatarUrl: null, profileAvatarUrl: null });
    expect(avas.days[0].mine).toMatchObject({ text: "Ava day one" });
    expect(avas.days[0].others).toEqual([]);
    expect(JSON.stringify(avas)).not.toContain(leo);
    expect((await readHome(ava)).games.map((game) => game.id)).toContain(gameId);
    expect((await readHome(ava)).blocked).toEqual([]);
    // Leo's Home drops her and her game; Settings lists her by his own name for her.
    const leosHome = await readHome(leo);
    expect(leosHome.games.map((game) => game.id)).not.toContain(gameId);
    expect(leosHome.blocked).toEqual([{ firstName: "Bestie", memberId: ava }]);
    expect(JSON.stringify(await readGame(gameId, leo))).not.toContain("Ava day one");
    expect(await run(ava, { entryId: randomUUID(), gameId, kind: "words", mediaKeys: [], text: "again", type: "post" }))
      .toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
    // Blocking again changes nothing.
    expect(await ok(leo, { memberId: ava, type: "block" })).toBeNull();
    expect(await getPrisma().gameBlock.count({ where: { blockerMemberId: leo } })).toBe(1);
  });

  it("refuses invites and rematches either way until the blocker unblocks", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const first = await live(leo, ava);
    await words(leo, first, "Leo only");
    const settled = (await devSettleNow(first, leo))!;
    const ticket = settled.tickets[0];
    await ok(ava, { memberId: leo, type: "block" });

    // The settled game stays for Leo, Ava shown as having left; its ticket can't be marked done.
    const leos = (await readGame(first, leo))!;
    expect(leos).toMatchObject({ status: "settled" });
    expect(leos.players.find((player) => !player.isMe)).toMatchObject({ left: true, memberId: null });
    expect(leos.tickets).toEqual([expect.objectContaining({ id: ticket.id, left: true, owedByMemberId: "" })]);
    expect(await run(leo, { ticketId: ticket.id, type: "redeem" })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    // Ava, who blocked, no longer has it or its ticket on Home.
    const avasHome = await readHome(ava);
    expect(avasHome.games.map((game) => game.id)).not.toContain(first);
    expect([...avasHome.wallet.held, ...avasHome.wallet.owed].map((held) => held.id)).not.toContain(ticket.id);

    const fromLeo = await invite(leo);
    expect(await run(ava, { termsVersion: 1, timeZone: "America/New_York", token: fromLeo.token, type: "join" }))
      .toMatchObject({ ok: false, error: { code: "PLAYER_UNAVAILABLE", message: "You blocked them. Unblock them in Settings to play." } });
    const fromAva = await invite(ava);
    expect(await run(leo, { termsVersion: 1, timeZone: "America/New_York", token: fromAva.token, type: "join" }))
      .toMatchObject({ ok: false, error: { code: "PLAYER_UNAVAILABLE", message: "This invite isn't open anymore." } });
    expect(await run(leo, { change: { kind: "start_now" }, proposalId: randomUUID(), termsVersion: 1, timeZone: "America/New_York", token: fromAva.token, type: "negotiate" }))
      .toMatchObject({ ok: false, error: { code: "PLAYER_UNAVAILABLE" } });
    expect(await run(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", previousGameId: first, terms: TERMS, type: "createGame" }))
      .toMatchObject({ ok: false, error: { code: "PLAYER_UNAVAILABLE" } });

    await ok(ava, { memberId: leo, type: "unblock" });
    expect((await readHome(ava)).blocked).toEqual([]);
    expect(await ok(ava, { termsVersion: 1, timeZone: "America/New_York", token: fromLeo.token, type: "join" })).toMatchObject({ status: "live" });
    // What the block called off stays called off; the history is back.
    expect((await readGame(first, leo))!.players.some((player) => player.left)).toBe(false);
  });

  it("blocks whatever history the pair has: hundreds of cancelled rematches can't stop it", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const settled = await live(leo, ava);
    await devSettleNow(settled, leo);
    // Leo addressed rematches to Ava and cancelled each one, far past any bound.
    const template = await getPrisma().game.findUniqueOrThrow({ where: { id: settled } });
    const cancelled = Array.from({ length: 201 }, () => randomUUID());
    await getPrisma().game.createMany({ data: cancelled.map((id) => ({ createdBy: leo, id, inviteeMemberId: ava, lengthDays: 7, previousGameId: settled,
      round: 2, status: "void", terms: template.terms ?? {}, termsWordsEncrypted: template.termsWordsEncrypted })) });
    await getPrisma().gamePlayer.createMany({ data: cancelled.map((gameId) => ({ gameId, memberId: leo, seat: 0, timeZone: "America/New_York" })) });
    // And one more rematch, still open on Ava's Home.
    const open = (await ok(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", previousGameId: settled, terms: TERMS, type: "createGame" }))!;

    expect(await ok(ava, { memberId: leo, type: "block" })).toBeNull();

    expect(await getPrisma().gameBlock.count({ where: { blockedMemberId: leo, blockerMemberId: ava } })).toBe(1);
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ status: "void" });
    expect((await readHome(ava)).games.map((game) => game.id)).not.toContain(open.id);
    expect(await run(leo, { gameId: randomUUID(), inviteeFirstName: "Ava", previousGameId: settled, terms: TERMS, type: "createGame" }))
      .toMatchObject({ ok: false, error: { code: "PLAYER_UNAVAILABLE" } });
  });

  it("ends every open game between them, however many there are, before it reports success", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    // More open addressed invites than one batch, as overlapping rematch requests could leave.
    const template = await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } });
    const invites = Array.from({ length: 55 }, () => randomUUID());
    await getPrisma().game.createMany({ data: invites.map((id) => ({ createdBy: leo, id, inviteeMemberId: ava, lengthDays: 7, round: 2,
      inviteExpiresAt: new Date(Date.now() + 86_400_000), status: "invited", terms: template.terms ?? {}, termsWordsEncrypted: template.termsWordsEncrypted })) });
    await getPrisma().gamePlayer.createMany({ data: invites.map((id) => ({ gameId: id, memberId: leo, seat: 0, timeZone: "America/New_York" })) });

    await ok(ava, { memberId: leo, type: "block" });

    expect(await getPrisma().game.count({ where: { id: { in: [gameId, ...invites] }, status: { not: "void" } } })).toBe(0);
    expect(await run(leo, { entryId: randomUUID(), gameId, kind: "words", mediaKeys: [], text: "still here", type: "post" }))
      .toMatchObject({ ok: false, error: { code: "GAME_NOT_LIVE" } });
  });

  it("ends the pair's game chat: their games leave it, nothing waiting goes out, and Murph sees no game there", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    const room = `hbm_gamesafe_room_${randomUUID().slice(0, 8)}`;
    await getPrisma().hostedMember.create({ data: { id: room } });
    memberIds.push(room);
    await getPrisma().game.update({ data: { chatContainerMemberId: room }, where: { id: gameId } });
    await getPrisma().$transaction((tx) => reserveGameChatLifecycleTx({ gameId, kind: "started", now: new Date(), tx }));
    expect((await readGameChatState(room, [leo, ava])).games.map((game) => game.id)).toContain(gameId);

    await ok(ava, { memberId: leo, type: "block" });

    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ chatContainerMemberId: null, status: "void" });
    expect(await getPrisma().hostedLinqDelivery.findMany({ where: { source: "game_lifecycle", sourceRef: gameId } }))
      .toEqual([expect.objectContaining({ skipReason: "game_blocked", status: "skipped" })]);
    expect(await readGameChatState(room, [leo, ava])).toEqual({ games: [] });
  });

  it("hides a reported post from its reporter only, keeps a sealed snapshot, and tells the team once", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    const rude = await words(ava, gameId, "Some rude words");
    // Locked until Leo posts that day: nothing he can see yet, so nothing to report.
    expect(await run(leo, report(gameId, { about: "post", entryId: rude }))).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await words(leo, gameId, "Leo day one");
    const before = (await readGame(gameId, leo))!.players.find((player) => !player.isMe)!.score;

    const command = report(gameId, { about: "post", entryId: rude, note: "This was mean" });
    const reported = (await ok(leo, command))!;
    expect(reported.days[0].others).toEqual([{ entry: null, hidden: true, seat: 1, status: "posted" }]);
    expect(reported.players.find((player) => !player.isMe)!.score).toBe(before);
    expect(JSON.stringify(reported)).not.toContain("Some rude words");
    // Ava sees nothing different.
    expect((await readGame(gameId, ava))!.days[0].mine).toMatchObject({ text: "Some rude words" });

    const row = await getPrisma().gameReport.findUniqueOrThrow({ where: { id: command.reportId } });
    expect(row).toMatchObject({ about: "post", entryId: rude, gameId, reason: "harassment", reportedMemberId: ava, reporterMemberId: leo, snapshotMediaKeys: [], reviewedAt: null });
    expect(await openGameTexts([
      { field: "snapshot", memberId: leo, rowId: row.id, table: "game_report", value: row.snapshotTextEncrypted },
      { field: "note", memberId: leo, rowId: row.id, table: "game_report", value: row.noteEncrypted },
    ])).toEqual(["Some rude words", "This was mean"]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const email = mocks.sendEmail.mock.calls[0]![0];
    expect(email).toMatchObject({ idempotencyKey: `murph/game-report/${row.id}`, subject: "Murph game report: Harassment or bullying", to: ["safety@example.test"] });
    expect(email.text).toContain(`Report ID: ${row.id}`);
    expect(email.text).toContain(`Game ID: ${gameId}`);
    expect(email.text).toContain("Content: words");
    for (const secret of ["Some rude words", "This was mean", leo, ava]) expect(email.text).not.toContain(secret);

    // The same report again, by id or by post, is the same report and retries its alert.
    await ok(leo, command);
    await ok(leo, report(gameId, { about: "post", entryId: rude, reason: "hate" }));
    expect(await getPrisma().gameReport.count({ where: { reporterMemberId: leo } })).toBe(1);
    expect(mocks.sendEmail.mock.calls.map((call) => call[0].idempotencyKey))
      .toEqual(Array(3).fill(`murph/game-report/${row.id}`));
    // Nobody else can take its id, and you can't report yourself.
    expect(await run(ava, report(gameId, { reportId: command.reportId })))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "That report id is taken." } });
    const mine = await words(leo, gameId, "Leo retake");
    expect(await run(leo, report(gameId, { about: "post", entryId: mine }))).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });
  });

  it("keeps the report when the alert email fails, and sends it on the retry", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    const command = report(gameId, { reason: "self_harm" });
    mocks.sendEmail.mockRejectedValueOnce(new Error("provider down"));
    await expect(run(leo, command)).rejects.toMatchObject({ code: "GAME_REPORT_ALERT_FAILED", retryable: true });
    expect(await getPrisma().gameReport.count({ where: { id: command.reportId } })).toBe(1);
    await ok(leo, command);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("reports a player or their terms, from a game or an invite before accepting, and can block in the same step", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const { gameId, token } = await invite(leo);
    // Ava holds Leo's link but hasn't accepted: she reports what he wrote, then blocks him.
    expect(await ok(ava, { about: "terms", reason: "money", reportId: randomUUID(), token, type: "report" })).toBeNull();
    const terms = await getPrisma().gameReport.findFirstOrThrow({ where: { reporterMemberId: ava } });
    expect(terms).toMatchObject({ about: "terms", gameId, reportedMemberId: leo });
    expect((await openGameTexts([{ field: "snapshot", memberId: ava, rowId: terms.id, table: "game_report", value: terms.snapshotTextEncrypted }]))[0])
      .toBe("Task: 100 pushups\nTask: 10 min abs\nPrize: Breakfast in bed");
    expect(mocks.sendEmail.mock.calls[0]![0]).toMatchObject({ text: expect.stringContaining("Content: the task and prize or dare they wrote, on an invite") });
    expect(await ok(ava, { token, type: "block" })).toBeNull();
    expect(await run(ava, { termsVersion: 1, timeZone: "America/New_York", token, type: "join" })).toMatchObject({ ok: false, error: { code: "PLAYER_UNAVAILABLE" } });
    expect(await run(leo, { about: "player", reason: "other", reportId: randomUUID(), token, type: "report" })).toMatchObject({ ok: false, error: { code: "NOT_A_PLAYER" } });

    // In a game: a player report hides their photo from the reporter, and blocks in the same step.
    const sam = await member("Sam");
    const gameWithSam = await live(sam, leo);
    const photoKey = `game/${sam}/${"a".repeat(64)}.jpg`;
    await getPrisma().gameProfile.update({ data: { photoKey }, where: { memberId: sam } });
    expect((await readGame(gameWithSam, leo))!.players.find((player) => !player.isMe)!.profileAvatarUrl).not.toBeNull();
    const reportSam = report(gameWithSam, { block: true, reason: "sexual" });
    expect(await ok(leo, reportSam)).toMatchObject({ status: "void" });
    expect(await getPrisma().gameReport.findUniqueOrThrow({ where: { id: reportSam.reportId } }))
      .toMatchObject({ about: "player", reportedMemberId: sam, snapshotMediaKeys: [photoKey] });
    expect(await getPrisma().gameBlock.count({ where: { blockedMemberId: sam, blockerMemberId: leo } })).toBe(1);
    expect(mocks.sendEmail.mock.calls.at(-1)![0]).toMatchObject({ text: expect.stringContaining("They blocked the other player too: yes") });
  });

  it("refuses money in a stake before anything is stored", async () => {
    const leo = await member("Leo");
    const gameId = randomUUID();
    expect(await run(leo, { gameId, inviteeFirstName: "Ava", terms: { ...TERMS, stakes: [{ item: "Venmo me $20", kind: "prize" }] }, type: "createGame" }))
      .toMatchObject({ ok: false, error: { code: "CONTENT_NOT_ALLOWED", message: "This can't be posted." }, status: 422 });
    expect(await getPrisma().game.findUnique({ where: { id: gameId } })).toBeNull();
  });

  it("lets ops take the post down, end the games and suspend the member, then leaves the queue", async () => {
    const leo = await member("Leo");
    const ava = await member("Ava");
    const gameId = await live(leo, ava);
    const rude = await words(ava, gameId, "Rude again");
    await words(leo, gameId, "Leo day one");
    const command = report(gameId, { about: "post", entryId: rude, reason: "hate" });
    await ok(leo, command);
    const reportId = command.reportId;
    const queued = (await readGameReportQueue()).find((item) => item.reportId === reportId);
    expect(queued).toMatchObject({ content: "words", gameId, postRemoved: false, reason: "Hate", reportedSuspended: false, snapshotText: "Rude again" });

    expect(await reviewGameReport({ endGames: true, removePost: true, reportId, suspendMember: true })).toEqual({ found: true });
    expect(await getPrisma().gameEntry.findUniqueOrThrow({ where: { id: rude } }))
      .toMatchObject({ mediaKeys: [], textEncrypted: null, withdrawnReason: "removed" });
    expect((await readGame(gameId, ava))!.days[0].mine).toBeNull();
    expect(await getPrisma().game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({ status: "void" });
    expect((await getPrisma().hostedMember.findUniqueOrThrow({ where: { id: ava } })).suspendedAt).not.toBeNull();
    expect((await readGameReportQueue()).map((item) => item.reportId)).not.toContain(reportId);
    // The snapshot outlives the post.
    expect((await getPrisma().gameReport.findUniqueOrThrow({ where: { id: reportId } })).snapshotTextEncrypted).not.toBeNull();
    expect(await reviewGameReport({ reportId, removePost: true })).toEqual({ found: true });
  });
});
