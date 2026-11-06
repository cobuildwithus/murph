/** Protocol selection only. Every service still enforces ordinary game authority. */
export function hasGameMultiplayer(request: Request): boolean {
  return request.headers.get("X-Murph-Game-Multiplayer") === "1";
}
