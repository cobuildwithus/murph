import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHostedRuntimeGroupToolRequest, parseHostedRuntimeGroupToolResponse } from "../src/parsers/runtime-control.ts";
import { hostedGameToolRequestSchema, hostedGameToolResponseSchema } from "../src/game-tools.ts";
import { parseHostedExecutionEvent } from "../src/parsers.ts";

const origin = { kind: "accepted_input", assistantInputId: "ain_synthetic" };

const rematchNotice = (termsVersion: unknown = 1) => ({ kind: "assistant.notification.requested", userId: "synthetic_room", notification: {
  instructions: "Synthetic compact comparison", responsePolicy: { kind: "require_game_rematch", gameId: "game_synthetic", eventId: "game-rematch:game_synthetic", termsVersion },
  route: { actorId: null, channel: "linq", delivery: { kind: "explicit", target: "synthetic_chat" }, identityId: null, threadId: "synthetic_chat", threadIsDirect: false },
} });

it("requires exact group rematch revision authority", () => {
  expect(parseHostedExecutionEvent(rematchNotice())).toMatchObject(rematchNotice());
  for (const revision of [undefined, null, 0, -1, 1.5, "1"]) {
    const event = rematchNotice(); event.notification.responsePolicy.termsVersion = revision;
    expect(() => parseHostedExecutionEvent(event)).toThrow();
  }
  const event = rematchNotice(); event.notification.responsePolicy.eventId = "game-rematch:other";
  expect(() => parseHostedExecutionEvent(event)).toThrow();
});

it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("old runners reject revision-bound group rematches before generation", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const target = new URL(`../src/.game-rematch-skew-${randomUUID()}.ts`, import.meta.url);
  await writeFile(target, execFileSync("git", ["show", "b2694496c0665990fa0fd283b5041e5018a38d3e:packages/hosted-execution/src/parsers.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
  try {
    const legacy = await import(target.href) as typeof import("../src/parsers.ts");
    expect(() => legacy.parseHostedExecutionEvent(rematchNotice())).toThrow(/kind/u);
    const pair = rematchNotice();
    const legacyPair = { ...pair, notification: { ...pair.notification, responsePolicy: { kind: "require_send" } } };
    expect(legacy.parseHostedExecutionEvent(legacyPair)).toEqual(parseHostedExecutionEvent(legacyPair));
  } finally { await rm(target, { force: true }); }
});
const game = {
  id: "game_synthetic", status: "live", lengthDays: 7, startsOn: "2030-04-01",
  terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], schedule: { days: [0, 1, 2, 3, 4] }, stakes: [{ kind: "winner_gets", item: "Choose the next game" }] },
  players: [{ memberId: "player_first", seat: 0, firstName: "Alex", dayOne: "2030-04-01", timeZone: "UTC" }, { memberId: "player_second", seat: 1, firstName: "Sam", dayOne: "2030-04-01", timeZone: "UTC" }],
  pendingChange: null,
  changeControls: { canStartNow: false, canEdit: true, canEditSchedule: true, canEditStartDate: false, editableFromDay: 1 },
};
const response = <T extends object>(value: T) => ({ action: "read_game", result: { status: "ok", state: { games: [value] } } });

describe("additive game reader compatibility", () => {
  it("accepts strict scheduled origins only for shared game reads", () => {
    const scheduledOrigin = { kind: "automation_occurrence", automationId: "automation_game_read", occurrenceAt: "2030-04-01T20:00:00-04:00" };
    const request = { action: "read_game", origin: scheduledOrigin, includePlayers: true };
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
    for (const origin of [{ ...scheduledOrigin, assistantInputId: "ain_synthetic" }, { ...scheduledOrigin, automationId: "" }, { ...scheduledOrigin, occurrenceAt: "yesterday" }]) {
      expect(() => parseHostedRuntimeGroupToolRequest({ ...request, origin })).toThrow();
    }
    expect(() => parseHostedRuntimeGroupToolRequest({ ...request, actorMemberId: "player_synthetic" })).toThrow();
    for (const action of [
      { action: "update_game", update: { operation: "cancel_game", gameId: game.id } },
      { action: "game_photo", photo: { operation: "save", gameId: game.id } },
      { action: "write_recap", recap: { pages: [], chatLine: "Finished." }, priorChatLines: [] },
    ]) expect(() => parseHostedRuntimeGroupToolRequest({ ...action, origin: scheduledOrigin })).toThrow();
  });
  it("preserves legacy requests and responses without new optional fields", () => {
    for (const request of [
      { action: "read_game", origin },
      { action: "update_game", origin, update: { operation: "approve", gameId: game.id, proposalId: "proposal_synthetic" } },
      { action: "update_game", origin, update: { operation: "cancel_game", gameId: game.id } },
    ]) expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
    expect(hostedGameToolRequestSchema.safeParse({ action: "update_game", origin, update: { operation: "cancel_game", gameId: game.id, proposalId: "proposal_synthetic" } }).success).toBe(false);
    const payload = response(game);
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  });

  it.each(["pending", "queued", "sent", "failed", "conversation"])("reads %s proposal delivery while preserving negotiation fields", (deliveryStatus) => {
    const change = { kind: "edit", startsOn: null, tasks: [{ seat: 0, text: "Walk outside" }, { seat: 1, text: "Read a chapter" }], stakes: [{ kind: "per_miss", item: "Pick a song" }], stakesApplyToWholeGame: true };
    const payload = response({ ...game, status: "negotiating", changeControls: { ...game.changeControls, canEditTasks: true, canEditStakes: true }, pendingChange: { id: "proposal_synthetic", proposedByMemberId: "player_first", expectedTermsVersion: 1, change, effectiveFromDay: 0, deliveryStatus, startsOn: null } });
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
    for (const proposalOrigin of ["app", "chat"]) {
      const withOrigin = response({ ...payload.result.state.games[0], pendingChange: { ...payload.result.state.games[0].pendingChange, origin: proposalOrigin } });
      expect(hostedGameToolResponseSchema.parse(withOrigin)).toEqual(withOrigin);
    }
    const request = { action: "update_game", origin, update: { operation: "propose", gameId: game.id, proposalId: "proposal_synthetic", expectedTermsVersion: 1, change } };
    expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
  });

  it.each(["prize", "dare"])("reads %s stakes and year-long games before writers emit them", (kind) => {
    const change = { kind: "edit", lengthDays: 365, schedule: { count: 365 }, stakes: [{ kind, item: "Choose the next game" }] };
    const request = { action: "update_game", origin, update: { operation: "propose", gameId: game.id, proposalId: "proposal_synthetic", expectedTermsVersion: 1, change } };
    expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
    const payload = response({ ...game, lengthDays: 365,
      terms: { ...game.terms, checkInKind: "any", schedule: { count: 365 }, stakes: change.stakes },
      pendingChange: { id: "proposal_synthetic", proposedByMemberId: "player_first", expectedTermsVersion: 1, origin: "app", change, effectiveFromDay: 0, deliveryStatus: "queued", startsOn: null },
      progress: { checkedAt: "2030-04-01T12:00:00Z", players: [{ memberId: "player_first", score: 0, target: 365, currentDayIndex: 0, currentEntryId: null, attemptsRemaining: 2,
        days: Array.from({ length: 365 }, (_, dayIndex) => ({ dayIndex, date: new Date(Date.UTC(2030, 3, dayIndex + 1)).toISOString().slice(0, 10), status: "upcoming" })),
      }] },
    });
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
    for (const invalid of [{ lengthDays: 366 }, { schedule: { count: 366 } }, { stakes: [{ kind: "unknown", item: "Invalid" }] }]) {
      expect(hostedGameToolRequestSchema.safeParse({ ...request, update: { ...request.update, change: { ...change, ...invalid } } }).success).toBe(false);
    }
    expect(hostedGameToolResponseSchema.safeParse(response({ ...game, lengthDays: 366 })).success).toBe(false);
    expect(hostedGameToolResponseSchema.safeParse(response({ ...game, terms: { ...game.terms, checkInKind: "unknown" } })).success).toBe(false);
  });

  it.each(["photo", "heart_rate"])("preserves legacy %s terms and one-day lengths", (checkInKind) => {
    const payload = response({ ...game, lengthDays: 1, terms: { ...game.terms, checkInKind, schedule: { count: 1 }, stakes: [{ kind: "per_miss", item: "Choose a song" }] } });
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  });

  it("reads shared progress, frozen results and actor introduction state without stripping them", () => {
    const payload = { action: "read_game", result: { status: "ok", state: {
      photoCheckIn: { introductionAvailable: false, hasPendingOffer: true },
      games: [{ ...game, status: "settled", progress: { checkedAt: "2030-04-08T12:00:00Z", players: [{ memberId: "player_first", score: 3, target: 5, currentDayIndex: null, currentEntryId: null, attemptsRemaining: 0, days: ["posted", "due", "missed", "off", "upcoming", "not_posted"].map((status, dayIndex) => ({ dayIndex, date: `2030-04-0${dayIndex + 1}`, status })) }] }, result: { scores: [{ memberId: "player_first", seat: 0, score: 3, misses: 2 }], tickets: ["open", "redeemed", "expired"].map((status) => ({ owedByMemberId: "player_second", owedToMemberId: "player_first", what: "Choose the next game", status, count: 1 })) } }],
    } } };
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  });

  it.each(["offer", "save", "dismiss"])("accepts the %s photo request without granting a caller-selected identity or URL", (operation) => {
    const request = { action: "game_photo", origin, photo: { operation, gameId: game.id, sourceMessageRef: "ain_original", attachmentOrdinal: 1, replaceEntryId: "entry_synthetic" } };
    expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
    for (const extra of [{ memberId: "other_player" }, { url: "https://example.test/image.jpg" }, { mediaKeys: ["arbitrary"] }, { captureAgeMs: 1 }]) {
      expect(hostedGameToolRequestSchema.safeParse({ ...request, photo: { ...request.photo, ...extra } }).success).toBe(false);
    }
    const pending = { action: "game_photo", origin, photo: { operation, gameId: game.id } };
    expect(hostedGameToolRequestSchema.parse(pending)).toEqual(pending);
  });

  it.each(["offer", "suppressed", "saved", "dismissed"])("reads %s photo outcome", (photoOutcome) => {
    const payload = { action: "game_photo", result: { status: "ok", photoOutcome } };
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  });

  it("keeps strict shared-state privacy and projection bounds", () => {
    expect(hostedGameToolResponseSchema.safeParse(response({ ...game, privateLabels: ["private"] })).success).toBe(false);
    const progress = { checkedAt: "2030-04-01T12:00:00Z", players: [{ memberId: "player_first", score: 0, target: 5, currentDayIndex: 0, currentEntryId: null, attemptsRemaining: 2, days: Array.from({ length: 366 }, (_, dayIndex) => ({ dayIndex, date: "2030-04-01", status: "upcoming" })) }] };
    expect(hostedGameToolResponseSchema.safeParse(response({ ...game, progress })).success).toBe(false);
  });
});


it.each(["mark_incomplete", "restore_day"])("accepts %s only with a date and no player selector", (operation) => {
  const request = { action: "update_game", origin, update: { operation, gameId: game.id, date: "2030-04-01" } };
  expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
  for (const extra of [{ memberId: "another" }, { proposalId: "proposal_synthetic" }, { date: "yesterday" }]) {
    expect(hostedGameToolRequestSchema.safeParse({ ...request, update: { ...request.update, ...extra } }).success).toBe(false);
  }
  const payload = { action: "update_game", result: { status: "ok", state: { games: [game] }, dayOutcome: { date: "2030-04-01", status: "marked_incomplete" } } };
  expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
});

it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("keeps old-runtime responses compatible while Web accepts the next runtime's corrections", async () => {
  const target = new URL(`../src/.game-incomplete-skew-${randomUUID()}.ts`, import.meta.url);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const source = execFileSync("git", ["show", "b64002efb9:packages/hosted-execution/src/game-tools.ts"], { cwd: root, encoding: "utf8" });
  await writeFile(target, source, { flag: "wx" });
  try {
    const legacy = await import(target.href) as typeof import("../src/game-tools.ts");
    const payload = response({ ...game, progress: { checkedAt: "2030-04-02T12:00:00Z", players: [{ memberId: "player_first", score: 0, target: 5, currentDayIndex: 1, currentEntryId: null, attemptsRemaining: 2, days: [{ dayIndex: 0, date: "2030-04-01", status: "missed" }] }] } });
    expect(legacy.hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
    const request = { action: "update_game", origin, update: { operation: "mark_incomplete", gameId: game.id, date: "2030-04-01" } };
    expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
    expect(legacy.hostedGameToolRequestSchema.safeParse(request).success).toBe(false);
    expect(legacy.hostedGameToolResponseSchema.safeParse({ ...payload, result: { ...payload.result, dayOutcome: { date: "2030-04-01", status: "marked_incomplete" } } }).success).toBe(false);
  } finally { await rm(target, { force: true }); }
});


it("accepts legacy bare lines and composed recap messages", () => {
  const bare = "x".repeat(160);
  for (const chatLine of [bare, `${bare}\nWatch the recap: https://recaps.murph.test/r/game_synthetic`]) {
    const payload = { action: "write_recap", result: { status: "ok", chatLine } };
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  }
  // The old response reader rejects a long delivery string; deploy this reader first.
  expect(hostedGameToolResponseSchema.shape.result.shape.chatLine.unwrap().max(160).safeParse(`${bare}\nWatch the recap: https://recaps.murph.test/r/game_synthetic`).success).toBe(false);
});

it.each([undefined, "Leo owes Ava breakfast."])("round-trips recap requests and responses with scoreLine=%s", (scoreLine) => {
  const recap = { pages: [
    { background: "paper", blocks: [{ kind: "headline", text: "Breakfast changed hands" }] },
    { background: "sage", blocks: [{ kind: "headline", text: "The mat stayed put" }] },
    { background: "slate", blocks: [{ kind: "headline", text: "The laundry watched" }] },
  ], chatLine: "The laundry watched. Open the week for the evidence.", ...(scoreLine === undefined ? {} : { scoreLine }) };
  const request = { action: "write_recap", origin: { kind: "game_recap", gameId: "game_synthetic", eventId: "game-recap:game_synthetic" }, recap, priorChatLines: [] };
  expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
  const response = { action: "write_recap", result: { status: "ok", recap } };
  expect(hostedGameToolResponseSchema.parse(response)).toEqual(response);
  expect(hostedGameToolRequestSchema.safeParse({ ...request, recap: { ...recap, scoreLine: null } }).success).toBe(false);
});


it("round-trips setup through the runtime parser and rejects extra authority and legacy create stakes", () => {
  const update = { operation: "create", gameId: "game_setup", terms: {
    tasks: [{ memberId: "player_first", text: "Walk" }, { memberId: "player_second", text: "Read" }],
    schedule: { count: 3 }, lengthDays: 7, stakes: [{ kind: "prize", item: "Lunch" }],
  } };
  const request = { action: "update_game", origin, update };
  expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
  for (const extra of [{ actorMemberId: "other" }, { containerMemberId: "other" }, { terms: { ...update.terms, lengthDays: 2 } }, { terms: { ...update.terms, stakes: [{ kind: "per_miss", item: "Lunch" }] } }]) {
    expect(() => parseHostedRuntimeGroupToolRequest({ ...request, update: { ...update, ...extra } })).toThrow();
  }
  const read = { action: "read_game", origin };
  expect(parseHostedRuntimeGroupToolRequest(read)).toEqual(read);
  const response = { action: "read_game", result: { status: "ok", state: { games: [] } } };
  expect(parseHostedRuntimeGroupToolResponse(response)).toEqual(response);
  expect(() => parseHostedRuntimeGroupToolRequest({ action: "update_game", origin, update: { operation: "approve", gameId: "game_setup" } })).toThrow();
  const approval = { action: "update_game", origin, update: { operation: "approve", gameId: "game_setup", expectedTermsVersion: 1 } };
  expect(parseHostedRuntimeGroupToolRequest(approval)).toEqual(approval);
});


// Historical-reader proof needs the base Git object; ordinary CI may be shallow.
it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("fences the setup roster for the deployed strict response reader", async () => {
  const target = new URL(`../src/.game-setup-skew-${randomUUID()}.ts`, import.meta.url);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await writeFile(target, execFileSync("git", ["show", "0edefc73dc:packages/hosted-execution/src/game-tools.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
  try {
    const legacy = await import(target.href) as typeof import("../src/game-tools.ts");
    const oldPayload = { action: "read_game", result: { status: "ok", state: { games: [] } } };
    const players = [{ memberId: "player_first", firstName: "Ava", timeZone: "UTC", isSender: true }, { memberId: "player_second", firstName: null, timeZone: null, isSender: false }];
    const nextPayload = { ...oldPayload, result: { ...oldPayload.result, state: { games: [], players } } };
    expect(legacy.hostedGameToolResponseSchema.parse(oldPayload)).toEqual(oldPayload);
    const invited = response({ ...game, status: "invited", startsOn: null,
      players: [{ ...game.players[0], dayOne: null }],
      changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null } });
    expect(legacy.hostedGameToolResponseSchema.parse(invited)).toEqual(invited);
    expect(parseHostedRuntimeGroupToolResponse(invited)).toEqual(invited);
    expect(legacy.hostedGameToolResponseSchema.safeParse(nextPayload).success).toBe(false);
    expect(parseHostedRuntimeGroupToolResponse(nextPayload)).toEqual(nextPayload);
    const marked = { action: "read_game", origin, includePlayers: true };
    expect(parseHostedRuntimeGroupToolRequest(marked)).toEqual(marked);
    expect(legacy.hostedGameToolRequestSchema.safeParse(marked).success).toBe(false);
    expect(() => parseHostedRuntimeGroupToolRequest({ action: "update_game", origin, update: { operation: "approve", gameId: "game_setup", proposalId: "proposal_synthetic", expectedTermsVersion: 1 } })).toThrow();
  } finally { await rm(target, { force: true }); }
});

// Historical objects are an explicit local proof; shallow routine CI skips this lane.
it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("accepts old Web pair responses and keeps group responses away from the released strict runner", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const target = new URL(`../src/.game-pr5-legacy-${randomUUID()}.ts`, import.meta.url);
  await writeFile(target, execFileSync("git", ["show", "3049da7b47522b748834c896b24f66b1bfeef77c:packages/hosted-execution/src/game-tools.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
  try {
    const legacy = await import(target.href) as typeof import("../src/game-tools.ts");
    const pair = response(game);
    expect(legacy.hostedGameToolResponseSchema.parse(pair)).toEqual(pair);
    expect(hostedGameToolResponseSchema.parse(pair)).toEqual(pair);
    const read = { action: "read_game", origin, includePlayers: true };
    expect(legacy.hostedGameToolRequestSchema.parse(read)).toEqual(read);
    const group = response({ ...game, maxPlayers: 10, players: Array.from({ length: 10 }, (_, seat) => ({ ...game.players[0], memberId: `person_${seat}`, seat })) });
    expect(legacy.hostedGameToolResponseSchema.safeParse(group).success).toBe(false);
    expect(hostedGameToolResponseSchema.parse(group)).toEqual(group);
  } finally { await rm(target, { force: true }); }
});

it("accepts group edit IDs and bounded majority responses without widening pair requests", () => {
  const tasks = Array.from({ length: 10 }, (_, seat) => ({ seat, text: "Walk" }));
  const update = { operation: "edit_terms", gameId: game.id, expectedTermsVersion: 1, proposalId: "proposal_group",
    terms: { defaultTask: "Walk", tasks: tasks.map(({ seat, text }) => ({ memberId: `member_${seat}`, text })), schedule: { count: 5 }, stakes: [{ kind: "prize", item: "Lunch" }] } };
  const request = { action: "update_game", origin, update };
  expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
  const { proposalId: _proposalId, ...oldUpdate } = update;
  expect(hostedGameToolRequestSchema.safeParse({ ...request, update: oldUpdate }).success).toBe(true);
  expect(hostedGameToolRequestSchema.safeParse({ ...request, update: { ...update, proposalId: "bad" } }).success).toBe(false);
  const pendingChange = { id: update.proposalId, proposedByMemberId: "member_0", expectedTermsVersion: 1, origin: "chat", deliveryStatus: "conversation", startsOn: null,
    effectiveFromDay: 0, change: { kind: "edit", defaultTask: "Walk", tasks }, yesNeeded: 5,
    votes: tasks.map(({ seat }) => ({ memberId: `member_${seat}`, vote: seat === 0 ? "yes" : "no" })) };
  const payload = response({ ...game, maxPlayers: 10, pendingChange });
  expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  for (const invalid of [{ votes: [...pendingChange.votes, { memberId: "extra", vote: "yes" }] }, { votes: [{ memberId: "member_0", vote: "maybe" }] }, { yesNeeded: -1 },
    { change: { ...pendingChange.change, tasks: [{ seat: 10, text: "Walk" }] } }, { change: { ...pendingChange.change, tasks: [] } }]) {
    expect(hostedGameToolResponseSchema.safeParse(response({ ...game, pendingChange: { ...pendingChange, ...invalid } })).success).toBe(false);
  }
  const pair = { action: "update_game", origin, update: { operation: "propose", gameId: game.id, expectedTermsVersion: 1, proposalId: "proposal_pair", change: pendingChange.change } };
  expect(hostedGameToolRequestSchema.safeParse(pair).success).toBe(false);
  expect(hostedGameToolRequestSchema.safeParse({ ...pair, update: { ...pair.update, change: { kind: "edit", tasks: tasks.slice(0, 3) } } }).success).toBe(false);
});


it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("Plan A preserves the previous group wire and pair bytes in both directions", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const target = new URL(`../src/.game-plan-a-legacy-${randomUUID()}.ts`, import.meta.url);
  await writeFile(target, execFileSync("git", ["show", "b2694496c0665990fa0fd283b5041e5018a38d3e:packages/hosted-execution/src/game-tools.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
  try {
    const previous = await import(target.href) as typeof import("../src/game-tools.ts");
    const ask = { action: "update_game", origin, update: { operation: "propose", gameId: game.id,
      proposalId: "proposal_earlier", expectedTermsVersion: 1, change: { kind: "start_now" } } };
    expect(previous.hostedGameToolRequestSchema.parse(ask)).toEqual(hostedGameToolRequestSchema.parse(ask));
    const pending = response({ ...game, maxPlayers: 10, pendingChange: { id: "proposal_earlier", proposedByMemberId: "player_first",
      expectedTermsVersion: 1, change: { kind: "start_now" }, startsOn: "2030-04-01", effectiveFromDay: 0,
      origin: "app", deliveryStatus: "queued", votes: [{ memberId: "player_first", vote: "yes" }], yesNeeded: 1 } });
    expect(previous.hostedGameToolResponseSchema.parse(pending)).toEqual(hostedGameToolResponseSchema.parse(pending));
    const refused = { action: "update_game", result: { status: "rejected", error: "Start now is unavailable." } };
    expect(hostedGameToolResponseSchema.parse(refused)).toEqual(previous.hostedGameToolResponseSchema.parse(refused));
    expect(JSON.stringify(hostedGameToolResponseSchema.parse(response(game)))).toBe(JSON.stringify(previous.hostedGameToolResponseSchema.parse(response(game))));
  } finally { await rm(target, { force: true }); }
});
