import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import type { PrismaClient } from "@prisma/client";
import type { BetterAuthOptions } from "better-auth";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { authLookupKey, openAuthRecord, sealAuthRecord } from "./record-crypto";

type Storage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;
const stateSchema = z.object({
  count: z.number().int().min(0).max(10_000),
  startedAt: z.number().int().min(0), window: z.number().int().min(1).max(86_400),
}).strict();

// Better Auth's public customStorage contract has an atomic consume operation.
// Reuse encrypted pre-auth verification storage with a reserved identifier; raw
// IPs/contacts never enter durable storage. This also serves route-level contact
// budgets when the owner invokes server API methods rather than auth.handler.
export function hostedAuthRateLimitStorage(prisma: PrismaClient): Storage {
  return {
    async consume(key, rule) {
      if (!key || key.length > 2048 || !Number.isSafeInteger(rule.max) || rule.max < 1 || rule.max > 10_000
        || !Number.isSafeInteger(rule.window) || rule.window < 1 || rule.window > 86_400) {
        throw new TypeError("Invalid authentication rate limit.");
      }
      const digest = authLookupKey("verification", "rate-limit", key);
      const id = `arl_${digest}`;
      return prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
        const row = await tx.hostedAuthRecord.findUnique({ where: { model_id: { model: "verification", id } } });
        const current = row ? await openAuthRecord(row, tx) : null;
        const state = current && typeof current.value === "string" ? stateSchema.parse(JSON.parse(current.value)) : null;
        const now = Date.now();
        // A changed rule begins only after the previous admitted window ends.
        const active = state && now < state.startedAt + state.window * 1000;
        if (active && state.count >= rule.max) {
          return { allowed: false, retryAfter: Math.max(1, Math.ceil((state.startedAt + state.window * 1000 - now) / 1000)) };
        }
        const next = active
          ? { ...state, count: state.count + 1 }
          : { count: 1, startedAt: now, window: rule.window };
        const data = await sealAuthRecord("verification", {
          id, identifier: `auth-rate-limit:v1:${digest}`, value: JSON.stringify(next),
          createdAt: current?.createdAt ?? new Date(now), updatedAt: new Date(now),
          expiresAt: new Date(next.startedAt + next.window * 1000),
        }, tx);
        await tx.hostedAuthRecord.upsert({ where: { model_id: { model: "verification", id } }, create: data, update: data });
        return { allowed: true, retryAfter: null };
      }), { maxWait: 5_000, timeout: 5_000 });
    },
  };
}
