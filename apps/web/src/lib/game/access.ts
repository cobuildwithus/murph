import { Prisma } from "@prisma/client";

import { parseCommaSeparatedList } from "../primitives";

type GameEnv = Readonly<Record<string, string | undefined>>;

/**
 * The weekly game ships dark. `MURPH_GAME_ENABLED=true|false` decides; unset
 * means on outside production only. A non-empty comma-separated
 * `MURPH_GAME_MEMBER_ALLOWLIST` names the members on the list; empty means
 * everyone is. A listed member can do everything, including start a game.
 */
export function isGameEnabledFor(memberId: string, env: GameEnv = process.env): boolean {
  if (!isGameEnabled(env)) return false;
  const listed = listedGameMembers(env);
  return listed === null || listed.includes(memberId);
}

/** The people who decide whether a game is on. */
export interface GamePeople {
  players: readonly { memberId: string }[];
  /** An addressed rematch's invitee, who isn't seated until they accept. */
  inviteeMemberId?: string | null;
}

/**
 * Invite-only: a game is on when the global switch is on and at least one of
 * its people is on the list. Its people are its players and, for a rematch
 * still waiting on its addressee, that invitee, so an open invite is on when
 * its creator is listed. Anyone may play a game that is on; a game that is off
 * is invisible to everyone. `gameOnWhere` and `gameOnSql` are this same rule
 * for database reads.
 */
export function isGameOn(game: GamePeople, env: GameEnv = process.env): boolean {
  return [...game.players.map((player) => player.memberId), game.inviteeMemberId]
    .some((memberId) => typeof memberId === "string" && isGameEnabledFor(memberId, env));
}

/** `isGameOn` as a Prisma filter on `game`. */
export function gameOnWhere(env: GameEnv = process.env): Prisma.GameWhereInput {
  if (!isGameEnabled(env)) return { id: { in: [] } };
  const listed = listedGameMembers(env);
  return listed === null ? {} : { OR: [{ players: { some: { memberId: { in: [...listed] } } } }, { inviteeMemberId: { in: [...listed] } }] };
}

/** `isGameOn` as a SQL condition on the `game` row named `alias`. */
export function gameOnSql(alias: "game", env: GameEnv = process.env): Prisma.Sql {
  if (!isGameEnabled(env)) return Prisma.sql`FALSE`;
  const listed = listedGameMembers(env);
  if (listed === null) return Prisma.sql`TRUE`;
  const game = Prisma.raw(alias);
  return Prisma.sql`(${game}.invitee_member_id IN (${Prisma.join(listed)})
    OR EXISTS (SELECT 1 FROM game_player listed WHERE listed.game_id = ${game}.id AND listed.member_id IN (${Prisma.join(listed)})))`;
}

function listedGameMembers(env: GameEnv): readonly string[] | null {
  const allowlist = parseCommaSeparatedList(env.MURPH_GAME_MEMBER_ALLOWLIST);
  return allowlist.length === 0 ? null : allowlist;
}

/** The global switch alone. */
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
