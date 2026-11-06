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

/** Deleted seats remain in storage; only extant identities can authorize work. */
export function gameMemberIds(rows: readonly { memberId: string | null }[]): string[] {
  return rows.flatMap(row => row.memberId === null ? [] : [row.memberId]);
}

/** A rule participant has the scheduling metadata required by the SQL check. */
export function hasGameIdentity<T extends { memberId: string | null; timeZone: string | null }>(row: T): row is T & { memberId: string; timeZone: string } {
  return row.memberId !== null && row.timeZone !== null;
}
