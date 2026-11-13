import { describe, expect, it, vi } from "vitest";
import { decideNewTerms, decideSettle, isBothWinEarnable, isBothWinOfferDue, mergeStakeSlots, parseStoredTerms, validChangedStakes, type RuleState, type StoredStake } from "../src/lib/game/rules";
import { decideApprovedGameChange, decideGameChange, gameChangeRefusal, parsePendingGameChange } from "../src/lib/game/changes";
import { prepareGameChangeWords, readPendingGameChange } from "../src/lib/game/change-words";
import { termsView, ticketView } from "../src/lib/game/views";
import { buildRecapFallback } from "../src/lib/game/recap-fallback";
import { parseGameChange } from "../src/lib/game/command";
import { moderateGameCommand } from "../src/lib/game/moderation";
import { addDays, dayStartInstant } from "../src/lib/game/time";

vi.mock("../src/lib/game/crypto", () => ({
  openGameTexts: async (items: { value: string }[]) => items.map(item => item.value),
  sealGameText: async (_target: unknown, text: string) => text,
}));
const prize: StoredStake = { kind: "prize", key: "prize" };
const both: StoredStake = { kind: "both_get", key: "both" };
function state(lengthDays = 7, completed = 5): RuleState {
  const players = ["ava", "leo"].map((memberId, seat) => ({ memberId, seat, dayOne: "2030-04-01", timeZone: "UTC" }));
  return { game: { id: "both_win_game", createdBy: "ava", status: "live", seats: 2, lengthDays, startsOn: null,
    inviteExpiresAt: null, chatContainerMemberId: "room", terms: { v: 1, versions: [{ n: 1, fromDay: 0,
      schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [prize] }] } }, players,
    entries: players.flatMap(player => Array.from({ length: completed }, (_, dayIndex) => ({ id: `${player.memberId}_${dayIndex}`,
      memberId: player.memberId, dayIndex, attempt: 1, kind: "words", mediaKeys: [], blurHash: null,
      receivedAt: new Date(`${addDays(player.dayOne, dayIndex)}T14:00:00Z`), withdrawnAt: null }))) };
}
const now = (day: number, hour = 14) => new Date(`${addDays("2030-04-01", day)}T${String(hour).padStart(2, "0")}:00:00Z`);

describe("both-win readers", () => {
  it.each([
    { completed: 7, withBoth: true, expected: 2 },
    { completed: 7, withBoth: false, expected: 0 },
    { completed: 6, withBoth: true, expected: 0 },
  ])("settles perfect and tied games: %j", ({ completed, withBoth, expected }) => {
    const s = state(7, completed); if (withBoth) s.game.terms.versions[0].stakes.push(both);
    const tickets = decideSettle(s).tickets;
    expect(tickets).toHaveLength(expected);
    if (expected) expect(tickets).toEqual([
      { stakeKey: "both", owedBySeats: [1], owedToSeats: [0] }, { stakeKey: "both", owedBySeats: [0], owedToSeats: [1] },
    ]);
  });
  it.each(["prize", "dare"] as const)("does not issue a both-win ticket to a unique winner beside a %s", kind => {
    const s = state(7, 7); s.game.terms.versions[0].stakes = [{ ...prize, kind }, both];
    expect(decideSettle(s).tickets).toHaveLength(2);
    s.entries.pop();
    expect(decideSettle(s).tickets).toEqual([{ stakeKey: "prize", owedBySeats: [1], owedToSeats: [0] }]);
  });
  it("uses the capped any-days perfect result", () => {
    const s = state(7, 3); s.game.terms.versions[0].schedule = { count: 3 }; s.game.terms.versions[0].stakes.push(both);
    expect(decideSettle(s).tickets).toHaveLength(2);
    expect(isBothWinEarnable(s, now(3))).toBe(false);
  });
  it("merges only the named slot and preserves legacy replacement", () => {
    const replacement = { kind: "dare" as const, key: "replacement" };
    expect(mergeStakeSlots([prize], [both])).toEqual([prize, both]);
    expect(mergeStakeSlots([prize, both], [replacement])).toEqual([replacement, both]);
    expect(mergeStakeSlots([prize, both], [{ ...both, key: "new" }])).toEqual([prize, { ...both, key: "new" }]);
    expect(mergeStakeSlots([prize], [both, replacement])).toEqual([replacement, both]);
    expect(mergeStakeSlots<StoredStake>([{ kind: "per_miss", key: "old" }], [replacement])).toEqual([replacement]);
    expect(mergeStakeSlots<StoredStake>([{ kind: "per_miss", key: "old" }, prize], [replacement])).toEqual([replacement]);
  });
  it("accepts both-win asks and sealed approvals while create and legacy games refuse them", () => {
    const s = state(); s.game.terms.versions[0].stakes.push(both);
    expect(parseStoredTerms(s.game.terms).versions[0].stakes).toEqual([prize, both]);
    const change = { kind: "edit" as const, stakes: [{ kind: "both_get" as const, item: "Dinner out together" }] };
    const pending = { v: 2, id: "proposal", proposedByMemberId: "ava", expectedTermsVersion: 1, effectiveFromDay: 5,
      startsOn: null, deliveryStatus: "conversation", origin: "chat", change: { kind: "edit" }, stakes: [both], termsWordsEncrypted: "sealed" };
    expect(parsePendingGameChange(pending)?.stakes).toEqual([both]);
    expect(() => decideApprovedGameChange(s, "leo", parsePendingGameChange(pending)!, now(4))).not.toThrow();
    expect(() => decideGameChange(s, "ava", change, now(4))).not.toThrow();
    for (const kind of ["winner_gets", "per_miss"] as const) {
      s.game.terms.versions[0].stakes = [{ ...prize, kind }];
      expect(() => decideGameChange(s, "ava", change, now(4))).toThrow("A game can have one prize or dare and one prize you both get.");
    }
    expect(() => decideNewTerms({ tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }],
      schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: change.stakes }, { newKey: () => "key", today: "2030-03-31" })).toThrow("Choose one prize or dare.");
  });
  it("rejects duplicate slots, group and mixed legacy games, and more than two command entries", () => {
    const s = state();
    const message = "A game can have one prize or dare and one prize you both get.";
    for (const delta of [[], [both, both], [prize, { ...prize, kind: "dare" as const }], [{ kind: "per_miss" as const, key: "legacy" }]]) {
      expect(() => validChangedStakes(s, delta)).toThrow(message);
    }
    s.game.seats = 10; expect(() => validChangedStakes(s, [both])).toThrow(message);
    s.game.seats = 2; s.game.terms.versions[0].stakes.push({ kind: "winner_gets", key: "legacy" });
    expect(() => validChangedStakes(s, [both])).toThrow(message);
    for (const stakes of [[], [prize, both, both]]) expect(() => parseGameChange({ kind: "edit", stakes })).toThrow(message);
    expect(parseGameChange({ kind: "edit", stakes: [{ kind: "both_get", item: "Dinner" }] })).toMatchObject({ stakes: [{ kind: "both_get", item: "Dinner" }] });
  });
  it("refuses a new both-win prize after a miss, expires an older ask, and permits an ordinary prize edit", () => {
    const s = state(); const change = { kind: "edit" as const, stakes: [{ kind: "both_get" as const, item: "Dinner" }] };
    expect(() => decideGameChange(s, "ava", change, now(4))).not.toThrow();
    const pending = { id: "proposal", proposedByMemberId: "ava", expectedTermsVersion: 1, effectiveFromDay: 5,
      startsOn: null, deliveryStatus: "conversation" as const, origin: "chat" as const, change: { kind: "edit" as const }, stakes: [both] };
    s.entries = s.entries.filter(entry => entry.memberId !== "leo" || entry.dayIndex !== 4);
    const message = "A day has been missed, so a prize you both get can no longer be earned in this game.";
    expect(() => decideGameChange(s, "ava", change, now(5))).toThrow(message);
    expect(() => decideApprovedGameChange(s, "leo", pending, now(5))).toThrow(message);
    expect(gameChangeRefusal(s, pending, now(5))).toBe(message);
    s.game.terms.versions[0].stakes.push(both);
    expect(() => decideGameChange(s, "ava", { kind: "edit", stakes: [{ kind: "prize", item: "Choose lunch" }] }, now(5))).not.toThrow();
  });
  it("moderates both-win money through the existing prize check", () => {
    expect(() => moderateGameCommand({ type: "proposeChange", gameId: "game", proposalId: "proposal", expectedTermsVersion: 1,
      change: { kind: "edit", stakes: [{ kind: "both_get", item: "50 dollars" }] } })).toThrow("This can't be posted.");
  });
  it("prepares a both-win delta while retaining the primary words and keys", async () => {
    const s = state();
    const words = { v: 1, versions: [{ n: 1, tasks: [], stakes: [{ key: "prize", item: "Choose lunch" }] }] };
    const prepared = await prepareGameChangeWords({ id: "game", wordsOwnerMemberId: "ava", terms: JSON.parse(JSON.stringify(s.game.terms)),
      termsWordsEncrypted: JSON.stringify(words) }, { kind: "edit", stakes: [{ kind: "both_get", item: "Dinner" }] }, 1);
    expect(prepared.stakes).toEqual([{ kind: "both_get", key: expect.any(String) }]);
    const next = JSON.parse(prepared.termsWordsEncrypted!).versions.at(-1);
    expect(next.stakes).toEqual([{ key: "prize", item: "Choose lunch" }, { key: prepared.stakes![0].key, item: "Dinner" }]);
    expect(next.stakes.map((stake: { key: string }) => stake.key)).toEqual(mergeStakeSlots(s.game.terms.versions[0].stakes, prepared.stakes!).map(stake => stake.key));
  });
  it.each([false, true])("keeps encrypted and structural keys equal for an older prize edit (both=%s)", async hasBoth => {
    const s = state(); if (hasBoth) s.game.terms.versions[0].stakes.push(both);
    const words = { v: 1 as const, versions: [{ n: 1, tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }],
      stakes: [{ key: "prize", item: "Choose lunch" }, ...(hasBoth ? [{ key: "both", item: "Dinner out together" }] : [])] }] };
    const row = { id: "game", wordsOwnerMemberId: "ava", terms: JSON.parse(JSON.stringify(s.game.terms)), termsWordsEncrypted: JSON.stringify(words) };
    const prepared = await prepareGameChangeWords(row, { kind: "edit", stakes: [{ kind: "dare", item: "Sing" }] }, 1);
    const merged = mergeStakeSlots(s.game.terms.versions[0].stakes, prepared.stakes!);
    const next = JSON.parse(prepared.termsWordsEncrypted!).versions.at(-1);
    expect(next.stakes.map((stake: { key: string }) => stake.key)).toEqual(merged.map(stake => stake.key));
    const pending = await readPendingGameChange({ ...row, pendingChange: JSON.parse(JSON.stringify({ v: 2, id: "proposal", proposedByMemberId: "ava",
      expectedTermsVersion: 1, effectiveFromDay: 5, startsOn: null, deliveryStatus: "pending", change: { kind: "edit" }, ...prepared })) });
    expect(pending?.change).toEqual({ kind: "edit", stakes: [{ kind: "dare", item: "Sing" }] });
    if (hasBoth) expect(next.stakes).toContainEqual({ key: "both", item: "Dinner out together" });
  });
  it("presents the prize first and gives each player one held both-win ticket", () => {
    const s = state(7, 7); s.game.terms.versions[0].stakes = [both, prize];
    const words = { v: 1 as const, versions: [{ n: 1, tasks: [], stakes: [{ key: "prize", item: "Lunch" }, { key: "both", item: "Dinner" }] }] };
    expect(termsView(s, words).stakes.map(stake => stake.kind)).toEqual(["prize", "both_get"]);
    const tickets = decideSettle(s).tickets.map((ticket, i) => ({ ...ticket, id: `ticket_${i}`, gameId: s.game.id,
      useBy: now(20), createdAt: now(7), redeemedAt: null, status: "open" as const, players: s.players }));
    for (const viewer of ["ava", "leo"]) {
      const views = tickets.map(ticket => ticketView(ticket, words, viewer, now(8), s.game.terms));
      expect(views.filter(ticket => ticket.youHold)).toHaveLength(1);
      expect(views.every(ticket => ticket.kind === "both_get" && !ticket.left)).toBe(true);
    }
  });
  it("keeps ordinary recap lines and names the earned prize only when supplied", () => {
    const result = [{ name: "Ava", score: 7 }, { name: "Leo", score: 7 }];
    expect(buildRecapFallback(result).chatLine).toBe("The game ended in a 7–7 tie.");
    expect(buildRecapFallback(result, "dinner out together").chatLine).toBe("Both of you did every day. You both get dinner out together.");
    expect(buildRecapFallback(result, "your prize").chatLine).toBe("Both of you did every day. You both get your prize.");
    expect(buildRecapFallback([{ name: "Ava", score: 7 }, { name: "Leo", score: 6 }]).chatLine).toBe("Ava won 7–6.");
  });
});

describe("both-win currentness needed by the reader dispatch guard", () => {
  it.each([3, 4, 5, 7, 14])("requires two thirds of %i scheduled days, with one left", length => {
    const threshold = Math.ceil(2 * length / 3);
    expect(isBothWinOfferDue(state(length, threshold - 1), now(threshold - 2))).toBe(false);
    expect(isBothWinOfferDue(state(length, threshold), now(threshold - 1))).toBe(true);
    expect(isBothWinOfferDue(state(length, threshold), now(threshold, 9))).toBe(true);
    expect(isBothWinOfferDue(state(length, length), now(length - 1))).toBe(false);
  });
  it("counts weekdays, ignores days off and refuses count schedules and group games", () => {
    const s = state(7, 4); s.game.terms.versions[0].schedule = { days: [0, 1, 2, 3, 4] };
    expect(isBothWinOfferDue(s, now(3))).toBe(true);
    s.game.terms.versions[0].stakes.push(both); expect(isBothWinOfferDue(s, now(3))).toBe(false);
    s.game.terms.versions[0].stakes.pop(); s.game.seats = 10; expect(isBothWinOfferDue(s, now(3))).toBe(false);
    s.game.seats = 2; s.game.terms.versions[0].schedule = { count: 5 }; expect(isBothWinOfferDue(s, now(3))).toBe(false);
  });
  it("allows a shared prize before either calendar has begun", () => {
    const s = state(7, 0); s.game.status = "negotiating";
    s.players = s.players.map(player => ({ ...player, dayOne: null }));
    expect(isBothWinEarnable(s, now(-1))).toBe(true);
    expect(isBothWinOfferDue(s, now(-1))).toBe(false);
  });
  it("uses each player's grace hour and rejects the missed-day-5 then day-6 case", () => {
    const s = state(7, 5); s.players[1].timeZone = "America/New_York";
    s.entries = s.entries.filter(entry => entry.memberId !== "leo" || entry.dayIndex !== 4);
    const boundary = dayStartInstant("2030-04-06", "America/New_York");
    expect(isBothWinEarnable(s, new Date(boundary.getTime() + 59 * 60_000))).toBe(true);
    expect(isBothWinEarnable(s, new Date(boundary.getTime() + 60 * 60_000))).toBe(false);
    s.entries.push({ ...s.entries[0], id: "later", memberId: "leo", dayIndex: 5 });
    expect(isBothWinOfferDue(s, now(5))).toBe(false);
    const missed = state(7, 5); missed.entries[0].incomplete = true;
    expect(isBothWinOfferDue(missed, now(4))).toBe(false);
  });
});
