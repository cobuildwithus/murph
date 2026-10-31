import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hostedGameToolRequestSchema, hostedGameToolResponseSchema } from "../src/game-tools.ts";

const origin = { kind: "accepted_input", assistantInputId: "ain_synthetic" };
const game = {
  id: "game_synthetic", status: "live", lengthDays: 7, startsOn: "2030-04-01",
  terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], schedule: { days: [0, 1, 2, 3, 4] }, stakes: [{ kind: "winner_gets", item: "Choose the next game" }] },
  players: [{ memberId: "player_first", seat: 0, firstName: "Alex", dayOne: "2030-04-01", timeZone: "UTC" }, { memberId: "player_second", seat: 1, firstName: "Sam", dayOne: "2030-04-01", timeZone: "UTC" }],
  pendingChange: null,
  changeControls: { canStartNow: false, canEdit: true, canEditSchedule: true, canEditStartDate: false, editableFromDay: 1 },
};
const response = <T extends object>(value: T) => ({ action: "read_game", result: { status: "ok", state: { games: [value] } } });

describe("additive game reader compatibility", () => {
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

it.skipIf(process.env.MURPH_VERIFY_GAME_INCOMPLETE_SKEW !== "1")("keeps old-runtime responses compatible while Web accepts the next runtime's corrections", async () => {
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
