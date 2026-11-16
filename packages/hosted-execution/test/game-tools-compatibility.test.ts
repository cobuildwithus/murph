import { GAME_RECAP_GENERATION_RETIRED } from "../src/runtime-control.ts";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHostedRuntimeGroupToolRequest, parseHostedRuntimeGroupToolResponse } from "../src/parsers/runtime-control.ts";
import { hostedGameToolRequestSchema, hostedGameToolResponseSchema } from "../src/game-tools.ts";
import { recapVideoDraftSchema } from "@murphai/contracts/recap-show";
import { parseHostedExecutionEvent } from "../src/parsers.ts";
import { buildGamePrivateEveningInstructions, buildGamePrivateKickoffInstructions } from "../src/runtime-control.ts";

const origin = { kind: "accepted_input", assistantInputId: "ain_synthetic" };

it.skipIf(process.env.MURPH_VERIFY_RECAP_SKEW !== "1")("base runners accept show receipts while new Web accepts historical long replay requests", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const suffix = randomUUID();
  const oldStory = new URL(`../../contracts/src/.recap-skew-${suffix}.ts`, import.meta.url);
  const oldTools = new URL(`../src/.recap-skew-${suffix}.ts`, import.meta.url);
  const base = "9d0adef6908eb2b99521615ac33d5347fbff0f0c";
  const source = (file: string) => execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" });
  await writeFile(oldStory, source("packages/contracts/src/recap-show.ts"), { flag: "wx" });
  await writeFile(oldTools, source("packages/hosted-execution/src/game-tools.ts").replaceAll('"@murphai/contracts/recap-show"', JSON.stringify(`../../contracts/src/.recap-skew-${suffix}.ts`)), { flag: "wx" });
  try {
    const old = await import(oldTools.href) as typeof import("../src/game-tools.ts");
    const story = { pages: [{ background: "paper", blocks: [{ kind: "scene", scene: { cast: ["Leo", "Ava"], prompt: "Synthetic train scene.", faceY: 0.3 } }] }], chatLine: "The train arrived." };
    for (const action of ["read_game", "write_recap"]) {
      const receipt = { action, result: { status: "ok", chatLine: story.chatLine } };
      expect(old.hostedGameToolResponseSchema.parse(receipt)).toEqual(receipt);
      expect(old.hostedGameToolResponseSchema.safeParse({ ...receipt, result: { ...receipt.result, recap: story } }).success).toBe(false);
    }
    const request = { action: "write_recap", origin: { kind: "game_recap", gameId: "game_synthetic", eventId: "game-recap:game_synthetic" }, recap: { ...story, treatment: "x".repeat(60) } };
    expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
  } finally { await Promise.all([rm(oldStory, { force: true }), rm(oldTools, { force: true })]); }
});

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
// What Web returns after a day correction changes a finished game's outcome: an existing receipt status, the
// existing optional chatLine, and a settled game that lists its days only while they can still be corrected.
const settledCorrection = (progress?: object) => ({ action: "update_game", result: { status: "ok", dayOutcome: { date: "2030-04-03", status: "credited" },
  chatLine: "Alex's check-in for Wednesday, April 3 now counts. That changes the result. The game ended in a 6–6 tie.",
  state: { games: [{ ...game, status: "settled", ...(progress ? { progress } : {}),
    result: { scores: [{ memberId: "player_first", seat: 0, score: 6, misses: 1 }, { memberId: "player_second", seat: 1, score: 6, misses: 1 }], tickets: [] } }] } } });
const settledDays = { checkedAt: "2030-04-09T12:00:00Z", players: [{ memberId: "player_first", score: 6, target: 7, currentDayIndex: null, currentEntryId: null, attemptsRemaining: 0,
  days: [{ dayIndex: 2, date: "2030-04-03", status: "posted" }] }] };

it("reads a finished game's day correction with no new field", () => {
  for (const payload of [settledCorrection(settledDays), settledCorrection()]) {
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
    expect(parseHostedRuntimeGroupToolResponse(payload)).toEqual(payload);
  }
});

it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("the runner deployed before this change reads a finished game's day correction", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const suffix = randomUUID();
  const oldTools = new URL(`../src/.settled-correction-skew-${suffix}.ts`, import.meta.url);
  // The public main commit the hosted runner was built from when this change was written.
  await writeFile(oldTools, execFileSync("git", ["show", "ebf25597213aca48a42f216018f6dfc6d5b2ab32:packages/hosted-execution/src/game-tools.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
  try {
    const old = await import(oldTools.href) as typeof import("../src/game-tools.ts");
    for (const payload of [settledCorrection(settledDays), settledCorrection()]) expect(old.hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
    // And new Web still reads what that runner sends for the same request.
    const request = { action: "update_game", origin, update: { operation: "mark_complete", gameId: game.id, date: "2030-04-03", text: "Read a chapter" } };
    expect(old.hostedGameToolRequestSchema.parse(request)).toEqual(hostedGameToolRequestSchema.parse(request));
  } finally { await rm(oldTools, { force: true }); }
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
  it("builds bounded private game notices from own tasks without peer private words", () => {
    const offer = buildGamePrivateKickoffInstructions({ messageKind: "new_person", task: "100 pushups", otherFirstNames: ["Sam"] });
    const rhythm = buildGamePrivateKickoffInstructions({ messageKind: "new_rhythm", task: "3 lifts", otherFirstNames: ["Sam"] });
    const evening = buildGamePrivateEveningInstructions({ tasks: ["100 pushups"] });
    expect(offer).toContain("100 pushups"); expect(offer).toContain("Sam"); expect(offer).toContain("one question");
    expect(rhythm).toContain("every evening, or only when you're running behind");
    expect(evening).toContain("100 pushups");
    for (const instructions of [offer, rhythm, evening]) expect(instructions).not.toMatch(/read_game|update_game|player status|another player's task in data/iu);
  });
  it("accepts private reminder requests and additive reach results before producers turn on", () => {
    const direct = { action: "my_game_reminders", operation: "set", origin, minutes: 1080, gameId: game.id, on: true, everyDay: true, text: true };
    expect(parseHostedRuntimeGroupToolRequest(direct)).toEqual(direct);
    expect(parseHostedRuntimeGroupToolRequest({ action: "update_game", origin,
      update: { operation: "set_reminder", gameId: game.id, minutes: 1080, on: true } })).toMatchObject({ action: "update_game" });
    expect(parseHostedRuntimeGroupToolResponse({ action: "update_game", result: { status: "ok", reaches: "text" } })).toMatchObject({ result: { reaches: "text" } });
    expect(parseHostedRuntimeGroupToolResponse({ action: "update_game", result: { status: "ok" } })).toMatchObject({ result: { status: "ok" } });
    expect(parseHostedRuntimeGroupToolResponse({ action: "my_game_reminders", result: { status: "ok", reaches: "none",
      reminders: { minutes: 1080, push: true, text: false, canText: false, games: [] } } })).toMatchObject({ result: { reaches: "none" } });
  });
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


it.each(["mark_incomplete", "restore_day", "mark_complete"])("accepts %s only with a date and no player selector", (operation) => {
  const request = { action: "update_game", origin, update: { operation, gameId: game.id, date: "2030-04-01" } };
  expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
  for (const extra of [{ memberId: "another" }, { proposalId: "proposal_synthetic" }, { date: "yesterday" }]) {
    expect(hostedGameToolRequestSchema.safeParse({ ...request, update: { ...request.update, ...extra } }).success).toBe(false);
  }
  // Only the newer correction carries the speaker's own words for a counted day's post.
  const words = { ...request, update: { ...request.update, text: "Read a chapter" } };
  expect(hostedGameToolRequestSchema.safeParse(words).success).toBe(operation === "mark_complete");
  expect(hostedGameToolRequestSchema.safeParse({ ...words, update: { ...words.update, text: "x".repeat(141) } }).success).toBe(false);
  for (const status of ["marked_incomplete", "credited", "words_needed"]) {
    const payload = { action: "update_game", result: { status: "ok", state: { games: [game] }, dayOutcome: { date: "2030-04-01", status } } };
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  }
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


describe("recap video tool contract", () => {
  const recapOrigin = { kind: "game_recap", gameId: "game_synthetic", eventId: "game-recap:game_synthetic" };
  const generation = "a".repeat(32), hash = (char: string) => char.repeat(64);
  const video = { hash: hash("c"), byteLength: 3_000_000, referenceIds: [hash("d")], parts: [
    { storageKey: `recap/${generation}/${hash("e")}.mp4`, hash: hash("e"), byteLength: 2_000_000 },
    { storageKey: `recap/${generation}/${hash("f")}.mp4`, hash: hash("f"), byteLength: 1_000_000 }] };
  const recap = { pages: [{ background: "paper", blocks: [{ kind: "headline", text: "The mat stayed put" }] }], chatLine: "The mat stayed put." };
  const write = { action: "write_recap", origin: recapOrigin, recap, assets: [] };
  const upload = (file: object) => ({ action: "read_game", origin: recapOrigin, recapRead: { kind: "upload", referenceIds: [], bytes: "AAAA", ...file } });
  const part = { slot: "video-0", mediaType: "video/mp4" };

  it("keeps every request and result without a video exactly as it was", () => {
    for (const request of [write, { action: "read_game", origin: recapOrigin, recapRead: { kind: "recover" } }, { action: "read_game", origin: recapOrigin, recapRead: { kind: "recover", failed: true } },
      upload({ slot: "scene-0", mediaType: "image/jpeg", referenceIds: [hash("d")] }), upload({ slot: "song", mediaType: "audio/mpeg" })]) {
      expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
    }
    const result = { action: "write_recap", result: { status: "ok", chatLine: recap.chatLine } };
    expect(hostedGameToolResponseSchema.parse(result)).toEqual(result);
    expect(hostedGameToolResponseSchema.parse(result).result).not.toHaveProperty("recapVideo");
  });

  it("accepts a part upload only as an MP4 slice in a video slot with no sources of its own", () => {
    for (const slot of ["video-0", "video-3"]) expect(hostedGameToolRequestSchema.parse(upload({ ...part, slot }))).toEqual(upload({ ...part, slot }));
    for (const file of [{ ...part, slot: "video-4" }, { ...part, slot: "scene-0" }, { slot: "video-0", mediaType: "image/jpeg" }, { slot: "song", mediaType: "video/mp4" },
      { ...part, referenceIds: [hash("d")] }, { ...part, wordsTimestamps: [] }]) {
      expect(hostedGameToolRequestSchema.safeParse(upload(file)).success).toBe(false);
    }
    // The largest part still fits the upload's base64 bound.
    const largest = Buffer.alloc(2_000_000).toString("base64");
    expect(largest.length).toBeLessThanOrEqual(2_800_000);
    expect(hostedGameToolRequestSchema.safeParse(upload({ ...part, bytes: largest })).success).toBe(true);
  });

  it("carries a video candidate with a write and the accepted identity, or none, in a result", () => {
    expect(hostedGameToolRequestSchema.parse({ ...write, video })).toEqual({ ...write, video });
    expect(recapVideoDraftSchema.parse(video)).toEqual(video);
    // The candidate is optional: one Web cannot read is left for selection to drop, and the recap's write still parses.
    for (const candidate of [{ ...video, durationMs: 51_033 }, { ...video, byteLength: 3_000_001 }, { ...video, parts: [] }, null, "not a candidate"]) {
      expect(recapVideoDraftSchema.safeParse(candidate).success).toBe(false);
      expect(hostedGameToolRequestSchema.parse({ ...write, video: candidate })).toEqual({ ...write, video: candidate });
    }
    expect(hostedGameToolRequestSchema.safeParse({ ...write, videos: video }).success).toBe(false);
    const recover = { action: "read_game", origin: recapOrigin, recapRead: { kind: "recover", video: true } };
    expect(hostedGameToolRequestSchema.parse(recover)).toEqual(recover);
    expect(hostedGameToolRequestSchema.safeParse({ ...recover, recapRead: { kind: "recover", video: false } }).success).toBe(false);
    for (const recapVideo of [null, { generationId: generation, hash: video.hash, byteLength: video.byteLength }]) {
      for (const action of ["write_recap", "read_game"]) {
        const result = { action, result: { status: "ok", chatLine: recap.chatLine, recapVideo } };
        expect(parseHostedRuntimeGroupToolResponse(result)).toEqual(result);
      }
    }
    expect(hostedGameToolResponseSchema.safeParse({ action: "write_recap", result: { status: "ok", recapVideo: { hash: video.hash, byteLength: video.byteLength } } }).success).toBe(false);
    expect(hostedGameToolResponseSchema.safeParse({ action: "write_recap", result: { status: "ok", recapVideo: { generationId: generation, hash: video.hash, byteLength: video.byteLength, storageKey: "recap/forged.mp4" } } }).success).toBe(false);
  });

  it.skipIf(process.env.MURPH_VERIFY_RECAP_SKEW !== "1")("is refused whole by the previous release, so Web answers with an identity only when asked", async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const suffix = randomUUID(), base = "fa02b3ce62e03f5c7469d46bcf677f0faad41dcb";
    const oldStory = new URL(`../../contracts/src/.recap-video-skew-${suffix}.ts`, import.meta.url);
    const oldTools = new URL(`../src/.recap-video-skew-${suffix}.ts`, import.meta.url);
    const source = (file: string) => execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" });
    await writeFile(oldStory, source("packages/contracts/src/recap-show.ts"), { flag: "wx" });
    await writeFile(oldTools, source("packages/hosted-execution/src/game-tools.ts").replaceAll('"@murphai/contracts/recap-show"', JSON.stringify(`../../contracts/src/.recap-video-skew-${suffix}.ts`)), { flag: "wx" });
    try {
      const old = await import(oldTools.href) as typeof import("../src/game-tools.ts");
      const result = { action: "write_recap", result: { status: "ok", chatLine: recap.chatLine } };
      // An older runner reads today's result and refuses one that carries the identity, even as null.
      expect(old.hostedGameToolResponseSchema.parse(result)).toEqual(result);
      expect(old.hostedGameToolResponseSchema.safeParse({ ...result, result: { ...result.result, recapVideo: null } }).success).toBe(false);
      // An older Web refuses the part, the candidate and the identity request; requests without them are unchanged.
      expect(old.hostedGameToolRequestSchema.parse(write)).toEqual(write);
      expect(old.hostedGameToolRequestSchema.safeParse(upload(part)).success).toBe(false);
      expect(old.hostedGameToolRequestSchema.safeParse({ ...write, video }).success).toBe(false);
      expect(old.hostedGameToolRequestSchema.safeParse({ action: "read_game", origin: recapOrigin, recapRead: { kind: "recover", video: true } }).success).toBe(false);
    } finally { await Promise.all([rm(oldStory, { force: true }), rm(oldTools, { force: true })]); }
  });
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

it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1")("keeps group Prove it corrections compatible in both runner/Web directions", async () => {
  const target = new URL(`../src/.game-talk-skew-${randomUUID()}.ts`, import.meta.url);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await writeFile(target, execFileSync("git", ["show", "b2694496c0665990fa0fd283b5041e5018a38d3e:packages/hosted-execution/src/game-tools.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
  try {
    const old = await import(target.href) as typeof import("../src/game-tools.ts");
    const correction = { action: "update_game", origin, update: { operation: "mark_incomplete", gameId: game.id, date: "2030-04-01" } };
    const group = response({ ...game, maxPlayers: 10, pendingInviteeCount: 2 });
    for (const reader of [old, { hostedGameToolRequestSchema, hostedGameToolResponseSchema }]) {
      expect(reader.hostedGameToolRequestSchema.parse(correction)).toEqual(correction);
      expect(reader.hostedGameToolResponseSchema.parse(group)).toEqual(group);
      for (const extra of [{ actorMemberId: "another" }, { memberId: "another" }, { invitationSeat: 2 }, { note: "private" }]) {
        expect(reader.hostedGameToolRequestSchema.safeParse({ ...correction, update: { ...correction.update, ...extra } }).success).toBe(false);
      }
      expect(reader.hostedGameToolResponseSchema.safeParse(response({ ...game, maxPlayers: 10, talkNote: "private" })).success).toBe(false);
    }
  } finally { await rm(target, { force: true }); }
});

it("accepts durable recap retirement in the existing error field", () => {
  const response = { action: "read_game", result: { status: "unavailable", error: GAME_RECAP_GENERATION_RETIRED } };
  expect(GAME_RECAP_GENERATION_RETIRED).toBe("recap_generation_retired");
  expect(hostedGameToolResponseSchema.parse(response)).toEqual(response);
});


it("both-win rollback-floor readers accept waiting asks, terms and reciprocal settled tickets", () => {
  const base = { ...game, players: game.players.map((player, seat) => ({ ...player, firstName: seat ? "Leo" : "Ava" })),
    terms: { ...game.terms, stakes: [{ kind: "prize", item: "Choose lunch" }, { kind: "both_get", item: "Dinner out together" }] } };
  const pendingChange = { id: "proposal_both", proposedByMemberId: "player_first", expectedTermsVersion: 1,
    origin: "chat", deliveryStatus: "conversation", effectiveFromDay: 5, startsOn: null,
    change: { kind: "edit", stakes: [{ kind: "both_get", item: "Dinner out together" }] } };
  const result = { scores: base.players.map(player => ({ memberId: player.memberId, seat: player.seat, score: 5, misses: 0 })),
    tickets: base.players.map((player, seat) => ({ owedToMemberId: player.memberId,
      owedByMemberId: base.players[1 - seat].memberId, what: "Dinner out together", count: 1, status: "open" })) };
  for (const fixture of [{ ...base, pendingChange }, base, { ...base, status: "settled", result }]) {
    const wire = response(fixture);
    expect(parseHostedRuntimeGroupToolResponse(wire)).toEqual(wire);
  }
  expect(parseHostedRuntimeGroupToolRequest({ action: "update_game", origin,
    update: { operation: "propose", gameId: game.id, proposalId: "proposal_both", expectedTermsVersion: 1, change: pendingChange.change } })).toMatchObject({ action: "update_game" });
  expect(hostedGameToolRequestSchema.safeParse({ action: "update_game", origin,
    update: { operation: "create", gameId: game.id, terms: { tasks: base.players.map(player => ({ memberId: player.memberId, text: "Walk" })),
      schedule: game.terms.schedule, stakes: pendingChange.change.stakes } } }).success).toBe(false);
});

it("parses private Not for me reads, replacements and results through runtime control", () => {
  const action = "my_game_not_for_me";
  expect(parseHostedRuntimeGroupToolRequest({ action, origin, operation: "read" })).toEqual({ action, origin, operation: "read" });
  expect(parseHostedRuntimeGroupToolRequest({ action, origin, operation: "set", activities: ["dance", "yoga", "dance"] }))
    .toEqual({ action, origin, operation: "set", activities: ["yoga", "dance"] });
  expect(parseHostedRuntimeGroupToolRequest({ action, origin, operation: "set", activities: [] })).toMatchObject({ activities: [] });
  for (const activities of [undefined, ["water"], [1], null]) {
    expect(() => parseHostedRuntimeGroupToolRequest({ action, origin, operation: "set", activities })).toThrow();
  }
  const response = { action, result: { status: "ok", activities: ["swimming", "yoga"] } };
  expect(parseHostedRuntimeGroupToolResponse(response)).toEqual(response);
});
