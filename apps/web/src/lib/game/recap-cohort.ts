/** Pre-settlement departures are excluded; later deletion invalidates generated recaps. */
export function groupGameRecapPlayers<T extends { memberId: string | null; leftAt: Date | null }>(game: {
  settledAt: Date | null;
  players: readonly T[];
}): Array<T & { memberId: string }> | null {
  const settledAt = game.settledAt;
  if (!settledAt || game.players.some(player => player.leftAt && player.leftAt >= settledAt)) return null;
  const players = game.players.filter(player => !player.leftAt);
  if (players.length < 2 || !players.every((player): player is T & { memberId: string } => player.memberId !== null)) return null;
  return players;
}
