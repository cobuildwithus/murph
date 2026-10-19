import { parseCommaSeparatedList } from "../primitives";

type GameEnv = Readonly<Record<string, string | undefined>>;

/**
 * The weekly game ships dark. `MURPH_GAME_ENABLED=true|false` decides; unset
 * means on outside production only. A non-empty comma-separated
 * `MURPH_GAME_MEMBER_ALLOWLIST` further limits it to those member ids.
 */
export function isGameEnabledFor(memberId: string, env: GameEnv = process.env): boolean {
  if (!isGameEnabled(env)) return false;
  const allowlist = parseCommaSeparatedList(env.MURPH_GAME_MEMBER_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(memberId);
}

/** The global switch alone, for surfaces with no signed-in member (invite links). */
export function isGameEnabled(env: GameEnv = process.env): boolean {
  const flag = env.MURPH_GAME_ENABLED;
  return flag === "true" || (flag !== "false" && env.NODE_ENV !== "production");
}

/**
 * Time travel exists only outside real production, whatever the flags say.
 * On Vercel the deployment kind decides (previews run with NODE_ENV=production);
 * elsewhere NODE_ENV does.
 */
export function areGameDevToolsAllowed(env: GameEnv = process.env): boolean {
  const deployment = env.VERCEL_ENV?.trim().toLowerCase();
  return deployment ? deployment !== "production" : env.NODE_ENV !== "production";
}

const MURPH_APP_URL_SCHEME = "ai.withmurph.app";

/**
 * The Murph app link an invite page opens. `MURPH_GAME_APP_URL_SCHEME`
 * overrides the scheme (local stacks set the Debug app's `ai.withmurph.app.dev`);
 * anything that isn't a plain URL scheme falls back to the Murph app's own.
 */
export function gameInviteAppUrl(token: string, env: GameEnv = process.env): string {
  const configured = env.MURPH_GAME_APP_URL_SCHEME?.trim() ?? "";
  const scheme = /^[a-z][a-z0-9+.-]*$/iu.test(configured) ? configured : MURPH_APP_URL_SCHEME;
  return `${scheme}://invite/${encodeURIComponent(token)}`;
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
