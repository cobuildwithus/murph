import { isGameEnabled } from "../game/access";
import { gameNotFound } from "../game/http/errors";

type FlagEnv = Readonly<Record<string, string | undefined>>;

export function healthFeedMemberIds(env: FlagEnv = process.env): string[] {
  if (!isGameEnabled(env)) return [];
  return (env.MURPH_HEALTH_FEED_MEMBER_IDS ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
}

export function isHealthFeedEnabled(memberId: string, env: FlagEnv = process.env): boolean {
  return healthFeedMemberIds(env).includes(memberId);
}

export function healthRecordCapability(memberId: string, env: FlagEnv = process.env) {
  const includesMember = (ids: string | undefined) => ids?.split(",").some(entry => entry.trim() === memberId) ?? false;
  if (!includesMember(env.MURPH_HEALTH_RECORD_MEMBER_IDS) || !isHealthFeedEnabled(memberId, env)) return undefined;
  return { timed: true, route: includesMember(env.MURPH_HEALTH_ROUTE_MEMBER_IDS) } as const;
}

export function assertHealthRecordEnabled(memberId: string, capability: "timed" | "route" = "timed"): void {
  if (!healthRecordCapability(memberId)?.[capability]) throw gameNotFound();
}

export function assertHealthFeedEnabled(memberId: string): void {
  if (!isHealthFeedEnabled(memberId)) throw gameNotFound();
}
