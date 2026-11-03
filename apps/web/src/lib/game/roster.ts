/** Collection bounds are separate from the pair-only product admission rule. */
export const GAME_MAX_PLAYERS = 10;

export function isPairRoster(roster: readonly unknown[]): boolean {
  return roster.length === 2;
}

export function isGameMemberSet(memberIds: readonly string[]): boolean {
  return memberIds.length >= 2 && memberIds.length <= GAME_MAX_PLAYERS
    && new Set(memberIds).size === memberIds.length;
}

export function sameGameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return isGameMemberSet(actual) && isGameMemberSet(expected)
    && actual.length === expected.length && actual.every((id) => expected.includes(id));
}

/** Seats are references; find the first unused one without relying on array order. */
export function firstOpenSeat(roster: readonly { seat: number }[]): number {
  const seats = new Set(roster.map((player) => player.seat));
  let seat = 0;
  while (seats.has(seat)) seat += 1;
  return seat;
}
