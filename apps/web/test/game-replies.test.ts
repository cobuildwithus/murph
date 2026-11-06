import { describe, expect, it } from "vitest";
import { replyEligibility, replyReadAccess, replyReceiptMatches, replyView, type ReplyContext, type ReplyMetadata } from "@/src/lib/game/replies";
import { visibleEntryIds } from "@/src/lib/game/views";
import type { GameEntryKind } from "@/src/lib/game/contract";
import type { RuleState } from "@/src/lib/game/rules";

const now = new Date("2026-11-04T12:00:00Z");
const reply = { entryId: "post-owner", authorMemberId: "peer" };
function context(kind: GameEntryKind = "words"): ReplyContext {
  const state: RuleState = {
    game: { id: "game-replies", seats: 2, status: "live", createdBy: "owner", lengthDays: 7, startsOn: null, inviteExpiresAt: null,
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] } },
    players: ["owner", "peer"].map((memberId, seat) => ({ memberId, seat, dayOne: "2026-11-04", timeZone: "UTC" })),
    entries: ["owner", "peer"].map(memberId => ({ id: `post-${memberId}`, memberId, dayIndex: 0, attempt: 1,
      kind, mediaKeys: [], receivedAt: now, withdrawnAt: null, blurHash: null })),
  };
  return { state, visibleEntryIds: visibleEntryIds(state, "peer"), hiddenMemberIds: new Set(), reportedMemberIds: new Set() };
}

describe("private post reply decisions", () => {
  it.each(["photo", "words", "reps", "heart_rate", "route"] as const)("allows %s only to the other player", kind => {
    const ctx = context(kind);
    expect(replyEligibility("peer", reply.entryId, ctx, now, false)).toBeNull();
    expect(replyEligibility("owner", reply.entryId, ctx, now, false)).toBe("NOT_A_PLAYER");
    expect(replyReadAccess("peer", reply, ctx)).toBe(true);
    expect(replyReadAccess("owner", reply, ctx)).toBe(true);
    expect(replyReadAccess("third", reply, ctx)).toBe(false);
    expect(replyEligibility("peer", reply.entryId, ctx, now, true)).toBe("REPLY_USED");
  });
  it("refuses excuses, groups, absent authors, withdrawn posts, locked/hidden entries and mismatched entries", () => {
    expect(replyReadAccess("peer", reply, context("excuse"))).toBe(false);
    const ctx = context();
    ctx.state.game.seats = 10;
    expect(replyEligibility("peer", reply.entryId, ctx, now, false)).toBe("NOT_A_PLAYER");
    ctx.state.game.seats = 2;
    for (const authorMemberId of ["third", "owner"]) expect(replyReadAccess("owner", { ...reply, authorMemberId }, ctx)).toBe(false);
    expect(replyReadAccess("peer", { ...reply, entryId: "another-game-entry" }, ctx)).toBe(false);
    ctx.state.entries[0].withdrawnAt = now;
    expect(replyReadAccess("owner", reply, ctx)).toBe(false);
    ctx.state.entries[0].withdrawnAt = null;
    ctx.visibleEntryIds = new Set();
    expect(replyReadAccess("peer", reply, ctx)).toBe(false);
  });
  it.each(["hiddenMemberIds", "reportedMemberIds"] as const)("hides both ways via %s even on the receiver's own post", field => {
    const ctx = context();
    for (const [viewer, other] of [["owner", "peer"], ["peer", "owner"]]) {
      ctx[field] = new Set([other]);
      expect(replyReadAccess(viewer, reply, ctx)).toBe(false);
      expect(replyEligibility(viewer, reply.entryId, ctx, now, false)).toBe("NOT_A_PLAYER");
    }
  });
  it.each(["settled", "void", "invited", "negotiating"] as const)("keeps reads in %s but refuses writes", status => {
    const ctx = context(); ctx.state.game.status = status;
    expect(replyReadAccess("peer", reply, ctx)).toBe(true);
    expect(replyEligibility("peer", reply.entryId, ctx, now, false)).toBe("GAME_NOT_LIVE");
  });
  it("uses the canonical due clock and refuses departed players", () => {
    const ctx = context();
    expect(replyEligibility("peer", reply.entryId, ctx, new Date("2026-12-01"), false)).toBe("GAME_NOT_LIVE");
    ctx.state.players[1].leftAt = now;
    expect(replyReadAccess("peer", reply, ctx)).toBe(false);
  });
  it("binds content-free replay receipts to actor, game and entry", () => {
    const receipt = { actor: "peer", gameId: "game-replies", payload: { entryId: reply.entryId } };
    expect(replyReceiptMatches(receipt, "peer", "game-replies", reply.entryId)).toBe(true);
    expect(replyReceiptMatches(receipt, "owner", "game-replies", reply.entryId)).toBe(false);
    expect(replyReceiptMatches(receipt, "peer", "other-game", reply.entryId)).toBe(false);
    expect(replyReceiptMatches(receipt, "peer", "game-replies", "other-entry")).toBe(false);
    expect(replyReceiptMatches({ ...receipt, payload: null }, "peer", "game-replies", reply.entryId)).toBe(false);
  });
  it("returns only display fields, with mine from the author", () => {
    const metadata: ReplyMetadata = { ...reply, id: "reply-id", kind: "text", textEncrypted: "sealed", durationMs: null, levels: [], createdAt: now };
    expect(replyView(metadata, "peer", "Nice work")).toEqual({ id: "reply-id", kind: "text", text: "Nice work", createdAt: now.toISOString(), mine: true });
    expect(replyView({ ...metadata, kind: "voice", textEncrypted: null, durationMs: 1200, levels: Array(32).fill(50) }, "owner", null))
      .toEqual({ id: "reply-id", kind: "voice", durationMs: 1200, levels: Array(32).fill(50), createdAt: now.toISOString(), mine: false });
  });
});
