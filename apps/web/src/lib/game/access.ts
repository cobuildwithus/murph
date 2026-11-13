import { Prisma } from "@prisma/client";

type GameEnv = Readonly<Record<string, string | undefined>>;

/** The global switch as a Prisma filter on `game`. */
export function gameOnWhere(env: GameEnv = process.env): Prisma.GameWhereInput {
  return isGameEnabled(env) ? {} : { id: { in: [] } };
}

/** The global switch as a SQL condition. */
export function gameOnSql(env: GameEnv = process.env): Prisma.Sql {
  return isGameEnabled(env) ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
}

/** The weekly game ships dark: unset means on outside production only. */
export function isGameEnabled(env: GameEnv = process.env): boolean {
  const flag = env.MURPH_GAME_ENABLED;
  return flag === "true" || (flag !== "false" && env.NODE_ENV !== "production");
}

/** Admission only: persisted groups remain readable and settle while this is off. */
export function areGameGroupsEnabled(env: GameEnv = process.env): boolean {
  const flag = env.MURPH_GAME_GROUPS_ENABLED;
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

export { gameInviteAppUrl } from "./app-links";

/** Every media key a member uploads starts with this; posts may only use their own. */
export function mediaKeyPrefixFor(memberId: string): string {
  return `game/${memberId}/`;
}

/** The uploader of a media key, or null when it isn't a game key. */
export function mediaKeyOwner(key: string): string | null {
  const match = /^game\/([A-Za-z0-9_-]+)\//u.exec(key);
  return match ? match[1] : null;
}

/** Producer stays dark until compatible consumers and provider privacy gates are approved. */
export function isPairRecapShowEnabled(maxPlayers: number, env: GameEnv = process.env): boolean {
  return maxPlayers === 2 && env.MURPH_GAME_RECAP_SHOW_ENABLED === "true";
}
export function isRecapMediaVisible(env: GameEnv = process.env): boolean {
  return env.MURPH_GAME_RECAP_MEDIA_VISIBLE !== "false";
}

export function pairRecapShowCapability(maxPlayers: number): { show?: true } {
  return isPairRecapShowEnabled(maxPlayers) ? { show: true } : {};
}
