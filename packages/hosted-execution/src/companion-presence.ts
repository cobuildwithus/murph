import * as z from "@murphai/contracts/zod-runtime";

export const COMPANION_FOREGROUND_TTL_MS = 45_000;

/**
 * Off for now: members found Murph's "open Murph so Apple Health can sync"
 * texts nagging. Gates the private-chat prompt rule and the automatic Apple
 * Health quiet check-in. Flip to `true` and deploy to bring both back.
 */
export const ASK_TO_OPEN_MURPH_FOR_STALE_APPLE_HEALTH = false;
export const companionHeartbeatSchema = z.object({ state: z.enum(["foreground", "background"]) }).strict();
export const companionPresenceSchema = z.object({
  status: z.enum(["recently_active", "unreachable", "unknown"]),
  lastContactAt: z.isoDateTime().nullable(),
  lastForegroundAt: z.isoDateTime().nullable(),
}).strict();
export type CompanionPresence = z.infer<typeof companionPresenceSchema>;

export function companionPresence(lastContactAt: Date | null, lastForegroundAt: Date | null, now = new Date()): CompanionPresence {
  return {
    status: lastContactAt === null ? "unknown"
      : now.getTime() - lastContactAt.getTime() < COMPANION_FOREGROUND_TTL_MS
        && lastContactAt <= now ? "recently_active" : "unreachable",
    lastContactAt: lastContactAt?.toISOString() ?? null,
    lastForegroundAt: lastForegroundAt?.toISOString() ?? null,
  };
}
