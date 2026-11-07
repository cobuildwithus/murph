import * as z from "@murphai/contracts/zod-runtime";

export const COMPANION_FOREGROUND_TTL_MS = 45_000;
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
