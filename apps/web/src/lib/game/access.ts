import { parseCommaSeparatedList } from "../primitives";

/**
 * The weekly game ships dark. `MURPH_GAME_ENABLED=true|false` decides; unset
 * means on outside production only. A non-empty comma-separated
 * `MURPH_GAME_MEMBER_ALLOWLIST` further limits it to those member ids.
 */
export function isGameEnabledFor(memberId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const flag = env.MURPH_GAME_ENABLED;
  const enabled = flag === "true" || (flag !== "false" && env.NODE_ENV !== "production");
  if (!enabled) return false;
  const allowlist = parseCommaSeparatedList(env.MURPH_GAME_MEMBER_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(memberId);
}

/** Every media key a member uploads starts with this; posts may only use their own. */
export function mediaKeyPrefixFor(memberId: string): string {
  return `game/${memberId}/`;
}

/** The uploader of a media key, or null when it isn't a game key. */
export function mediaKeyOwner(key: string): string | null {
  const match = /^game\/([A-Za-z0-9_-]+)\//u.exec(key);
  return match ? match[1] : null;
}
