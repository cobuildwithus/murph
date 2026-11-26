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

export function assertHealthFeedEnabled(memberId: string): void {
  if (!isHealthFeedEnabled(memberId)) throw gameNotFound();
}
