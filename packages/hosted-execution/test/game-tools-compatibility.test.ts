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
const response = (value: object) => ({ action: "read_game", result: { status: "ok", state: { games: [value] } } });

describe("additive game reader compatibility", () => {
  it("preserves legacy requests and responses without new optional fields", () => {
    for (const request of [
      { action: "read_game", origin },
      { action: "update_game", origin, update: { operation: "approve", gameId: game.id, proposalId: "proposal_synthetic" } },
    ]) expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
    const payload = response(game);
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
  });

  it.each(["pending", "queued", "sent", "failed", "conversation"])("reads %s proposal delivery while preserving negotiation fields", (deliveryStatus) => {
    const change = { kind: "edit", startsOn: null, tasks: [{ seat: 0, text: "Walk outside" }, { seat: 1, text: "Read a chapter" }], stakes: [{ kind: "per_miss", item: "Pick a song" }], stakesApplyToWholeGame: true };
    const payload = response({ ...game, status: "negotiating", changeControls: { ...game.changeControls, canEditTasks: true, canEditStakes: true }, pendingChange: { id: "proposal_synthetic", proposedByMemberId: "player_first", expectedTermsVersion: 1, change, effectiveFromDay: 0, deliveryStatus, startsOn: null } });
    expect(hostedGameToolResponseSchema.parse(payload)).toEqual(payload);
    const request = { action: "update_game", origin, update: { operation: "propose", gameId: game.id, proposalId: "proposal_synthetic", expectedTermsVersion: 1, change } };
    expect(hostedGameToolRequestSchema.parse(request)).toEqual(request);
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
    const progress = { checkedAt: "2030-04-01T12:00:00Z", players: [{ memberId: "player_first", score: 0, target: 5, currentDayIndex: 0, currentEntryId: null, attemptsRemaining: 2, days: Array.from({ length: 29 }, (_, dayIndex) => ({ dayIndex, date: "2030-04-01", status: "upcoming" })) }] };
    expect(hostedGameToolResponseSchema.safeParse(response({ ...game, progress })).success).toBe(false);
  });
});
