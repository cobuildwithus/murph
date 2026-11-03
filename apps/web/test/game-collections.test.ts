import { describe, expect, it } from "vitest";
import { firstOpenSeat, isGameMemberSet, isPairRoster, sameGameMembers } from "../src/lib/game/roster";
import { gamePairLoreFingerprint } from "../src/lib/game/pair-fingerprint";
import { attemptsUsed, completedEntry, decideSettle, gameDayOne, hasUnlockedDay, indexGameEntries, liveEntry, type RuleEntry, type RuleState } from "../src/lib/game/rules";
import { buildGameHistoryView, buildGameView, visibleEntryIds, type GameViewInput } from "../src/lib/game/views";

const NOW = new Date("2026-10-12T12:00:00Z");

function stateFor(count: number, lengthDays = 7): RuleState {
  return {
    game: { id: "collection-game", status: "live", createdBy: "player-0", lengthDays, seats: count,
      inviteExpiresAt: null, startsOn: null,
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: lengthDays }, stakes: [{ key: "prize", kind: "prize" }] }] } },
    players: Array.from({ length: count }, (_, seat) => ({ memberId: `player-${seat}`, seat, dayOne: "2026-10-12", timeZone: "UTC" })),
    entries: [],
  };
}

function post(memberId: string, dayIndex = 0, attempt = 1, extra: Partial<RuleEntry> = {}): RuleEntry {
  return { id: `${memberId}-${dayIndex}-${attempt}`, memberId, dayIndex, attempt, kind: attempt ? "photo" : "excuse",
    mediaKeys: [`game/${memberId}/${dayIndex}/${attempt}`], receivedAt: NOW, withdrawnAt: null, blurHash: "blur", ...extra };
}

function viewInput(state: RuleState): GameViewInput {
  return { state, viewerId: "player-0", now: NOW, round: 1, previousGameId: null, startedAt: NOW,
    words: { v: 1, versions: [{ n: 1, tasks: state.players.map(({ seat }) => ({ seat, text: `Task ${seat}` })), stakes: [{ key: "prize", item: "Breakfast" }] }] },
    names: new Map(state.players.map(({ memberId, seat }) => [memberId, `Name ${seat}`])),
    avatarKeys: new Map(), relationships: new Map(), invitee: null, inviteToken: null, inviteExpiresAt: null,
    entryWords: new Map(state.entries.map(({ id }) => [id, { text: `Caption ${id}` }])),
    result: null, recap: null, tickets: [] };
}

describe("bounded game collections", () => {
  it.each([2, 3, 10])("compares an unordered %i-member roster without admitting a group as a pair", (count) => {
    const ids = stateFor(count).players.map(({ memberId }) => memberId);
    expect(isGameMemberSet(ids)).toBe(true);
    expect(sameGameMembers(ids, [...ids].reverse())).toBe(true);
    expect(isPairRoster(ids)).toBe(count === 2);
    expect(sameGameMembers(ids, [...ids.slice(1), "outsider"])).toBe(false);
    expect(sameGameMembers(ids, ids.slice(1))).toBe(false);
    expect(sameGameMembers(ids, [...ids, "extra"])).toBe(false);
    expect(sameGameMembers(ids, ids.map(() => ids[0]))).toBe(false);
  });

  it("rejects incomplete, duplicate and overflowing member sets", () => {
    for (const ids of [[], ["only"], ["same", "same"], stateFor(11).players.map(({ memberId }) => memberId)]) {
      expect(isGameMemberSet(ids)).toBe(false);
      expect(() => gamePairLoreFingerprint(ids)).toThrow();
    }
  });

  it("keeps pair hash bytes and gives each bounded member set a stable identity", () => {
    expect(gamePairLoreFingerprint(["member-a", "member-b"])).toBe("78886ef1c33c23273f9cdab32323e051");
    for (const count of [3, 10]) {
      const ids = stateFor(count).players.map(({ memberId }) => memberId);
      expect(gamePairLoreFingerprint(ids)).toBe(gamePairLoreFingerprint([...ids].reverse()));
      expect(gamePairLoreFingerprint(ids)).not.toBe(gamePairLoreFingerprint(ids.slice(1)));
    }
  });

  it("uses seat membership and a shared calendar origin rather than array positions", () => {
    expect(firstOpenSeat([])).toBe(0);
    expect(firstOpenSeat([{ seat: 2 }, { seat: 0 }, { seat: 4 }])).toBe(1);
    expect(firstOpenSeat([{ seat: 2 }, { seat: 0 }, { seat: 1 }])).toBe(3);
    expect(gameDayOne([{ dayOne: null }, { dayOne: "2026-10-12" }])).toBe("2026-10-12");
    expect(gameDayOne([])).toBeNull();
  });

  it("indexes retakes, excuses, withdrawals and incomplete posts without changing credit or unlock", () => {
    const entries = [post("player-1"), post("player-0", 0, 1, { withdrawnAt: NOW }),
      post("player-0", 0, 2, { incomplete: true }), post("player-0", 1, 0), post("player-0", 2)];
    const index = indexGameEntries(entries);
    for (const source of [entries, index]) {
      expect(liveEntry(source, "player-0", 0)).toBe(entries[2]);
      expect(completedEntry(source, "player-0", 0)).toBeNull();
      expect(attemptsUsed(source, "player-0", 0)).toBe(2);
      expect(hasUnlockedDay(source, "player-0", 0)).toBe(true);
      expect(liveEntry(source, "player-0", 1)).toBeNull();
      expect(hasUnlockedDay(source, "player-0", 1)).toBe(false);
      expect(completedEntry(source, "player-0", 2)).toBe(entries[4]);
      expect(liveEntry(source, "missing", 0)).toBeNull();
    }
    entries[2].withdrawnAt = NOW;
    expect(liveEntry(index, "player-0", 0)).toBeNull();
    expect(hasUnlockedDay(index, "player-0", 0)).toBe(true);
  });

  it("bounds entry work at ten players, 365 days and three rows per player/day", () => {
    const state = stateFor(10, 365);
    let memberReads = 0;
    state.entries = state.players.flatMap(({ memberId }) => Array.from({ length: 365 }, (_, day) => day).flatMap((day) =>
      [0, 1, 2].map((attempt) => ({ ...post(memberId, day, attempt, { withdrawnAt: attempt === 1 ? NOW : null }),
        get memberId() { memberReads += 1; return memberId; } }))));
    const input = viewInput(state);
    memberReads = 0;
    const settled = decideSettle(state);
    expect(settled.result.scores.map(({ score }) => score)).toEqual(Array(10).fill(365));
    expect(settled.tickets).toEqual([]);
    expect(memberReads).toBeLessThanOrEqual(state.entries.length * 3);
    memberReads = 0;
    const view = buildGameView(input);
    expect(view.days).toHaveLength(365);
    expect(view.days[364].others).toHaveLength(9);
    // Linear roster scans (streaks) are allowed; player x day x all-entry scans are not.
    expect(memberReads).toBeLessThanOrEqual(state.entries.length * (state.players.length + 6));
  });
});

describe("canonical game state and viewer visibility", () => {
  it.each(["void", "settled"] as const)("preserves the complete %s pair wire view when a blocked opponent is masked", (status) => {
    const state = stateFor(2);
    state.entries = [post("player-0"), post("player-1")];
    state.game.status = status;
    const input = viewInput(state);
    input.result = status === "settled" ? decideSettle(state).result : null;
    input.tickets = [{ id: "ticket", gameId: state.game.id, stakeKey: "prize", owedBySeats: [1], owedToSeats: [0], players: state.players, status: "open", createdAt: NOW, redeemedAt: null }];
    const before = structuredClone(state);
    const masked = { ...input, hiddenMemberIds: new Set(["player-1"]) };
    const legacy = { ...input, state: { ...state, players: state.players.slice(0, 1), entries: state.entries.slice(0, 1) },
      departed: [{ seat: 1, name: "Name 1" }], tickets: input.tickets.map((ticket) => ({ ...ticket, players: state.players.map(player => ({ ...player, memberId: player.seat === 1 ? null : player.memberId })) })) };
    expect(buildGameView(masked)).toEqual(buildGameView(legacy));
    expect(visibleEntryIds(state, input.viewerId, undefined, masked.hiddenMemberIds)).toEqual(new Set([state.entries[0].id]));
    expect(buildGameHistoryView(masked)).toBeNull();
    expect(state).toEqual(before);
    expect(decideSettle(state)).toEqual(decideSettle(before));
  });

  it("masks every blocked participant while reports hide only the reported artifact", () => {
    const state = stateFor(4);
    state.entries = state.players.map(({ memberId }) => post(memberId));
    const input = { ...viewInput(state), hiddenMemberIds: new Set(["player-1", "player-2"]), hiddenEntryIds: new Set([state.entries[3].id]) };
    const before = decideSettle(state);
    const view = buildGameView(input);
    expect(view.players.filter((player) => player.left).map(({ seat }) => seat)).toEqual([1, 2]);
    expect(view.days[0].others).toEqual([{ seat: 3, status: "posted", hidden: true, entry: null }]);
    expect(view.players[3].score).toBe(1);
    expect(visibleEntryIds(state, input.viewerId, input.hiddenEntryIds, input.hiddenMemberIds)).toEqual(new Set([state.entries[0].id]));
    expect(decideSettle(state)).toEqual(before);
    expect(buildGameView({ ...input, hiddenEntryIds: undefined }).days[0].others[0].entry?.entryId).toBe(state.entries[3].id);
  });

  it("preserves withdrawn unlocks without granting visibility to an unseated viewer", () => {
    const state = stateFor(3);
    state.entries = [post("player-0", 0, 1, { withdrawnAt: NOW }), post("player-1"), post("player-2")];
    expect(visibleEntryIds(state, "player-0", undefined, new Set(["player-1"]))).toEqual(new Set([state.entries[2].id]));
    expect(visibleEntryIds(state, "outsider")).toEqual(new Set());
  });
});
