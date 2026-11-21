import { normalizeIanaTimeZone } from "@murphai/contracts";

/** Protocol selection only. Every service still enforces ordinary game authority. */
export function hasGameMultiplayer(request: Request): boolean {
  return request.headers.get("X-Murph-Game-Multiplayer") === "1";
}

/** A device may have travelled since its last profile update. */
export function gameRequestTimeZone(request: Request): string | null {
  return normalizeIanaTimeZone(new URL(request.url).searchParams.get("timeZone"));
}
