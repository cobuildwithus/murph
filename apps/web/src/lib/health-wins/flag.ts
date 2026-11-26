import { isGameEnabled } from "../game/access";
import { gameNotFound } from "../game/http/errors";

type FlagEnv = Readonly<Record<string, string | undefined>>;

/** An allowlist names members, or `*` for every member. */
function lists(ids: string | undefined, memberId: string): boolean {
  return (ids ?? "").split(",").some(entry => {
    const id = entry.trim();
    return id === "*" || (id !== "" && id === memberId);
  });
}

/** The feed's authors: a list of members, or "everyone" for `*`; none when games are off. */
export function healthFeedAuthors(env: FlagEnv = process.env): string[] | "everyone" {
  if (!isGameEnabled(env)) return [];
  const ids = (env.MURPH_HEALTH_FEED_MEMBER_IDS ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
  return ids.includes("*") ? "everyone" : ids;
}

export function isHealthFeedEnabled(memberId: string, env: FlagEnv = process.env): boolean {
  return isGameEnabled(env) && lists(env.MURPH_HEALTH_FEED_MEMBER_IDS, memberId);
}

export function isHealthDietEnabled(memberId: string, env: FlagEnv = process.env): boolean {
  return isHealthFeedEnabled(memberId, env) && lists(env.MURPH_HEALTH_DIET_MEMBER_IDS, memberId);
}

export function isHealthPayoffEnabled(memberId: string, env: FlagEnv = process.env): boolean {
  return isHealthFeedEnabled(memberId, env) && lists(env.MURPH_HEALTH_PAYOFF_MEMBER_IDS, memberId);
}

export function healthRecordCapability(memberId: string, env: FlagEnv = process.env) {
  if (!lists(env.MURPH_HEALTH_RECORD_MEMBER_IDS, memberId) || !isHealthFeedEnabled(memberId, env)) return undefined;
  return { timed: true, route: lists(env.MURPH_HEALTH_ROUTE_MEMBER_IDS, memberId) } as const;
}

export function assertHealthRecordEnabled(memberId: string, capability: "timed" | "route" = "timed"): void {
  if (!healthRecordCapability(memberId)?.[capability]) throw gameNotFound();
}

export function assertHealthFeedEnabled(memberId: string): void {
  if (!isHealthFeedEnabled(memberId)) throw gameNotFound();
}
