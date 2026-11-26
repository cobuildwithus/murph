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
  const allowed = (env.MURPH_HEALTH_RECORD_MEMBER_IDS ?? "").split(",").some(entry => entry.trim() === memberId);
  return allowed && isHealthFeedEnabled(memberId, env) ? { timed: true, route: false } as const : undefined;
}

export function assertHealthRecordEnabled(memberId: string): void {
  if (!healthRecordCapability(memberId)) throw gameNotFound();
}

export function assertHealthFeedEnabled(memberId: string): void {
  if (!isHealthFeedEnabled(memberId)) throw gameNotFound();
}
