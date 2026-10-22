import "server-only";
import * as z from "@murphai/contracts/zod-runtime";

import { APPLE_PUSH_TOPICS, type ApplePushTarget } from "../apple-push/send";
import { getPrisma } from "../prisma";
import { requirePersonalMember } from "./member-access";

// The route is only an address for waking one companion installation. Features
// that use it own their own enrollment and decide when a wake is warranted.
export const companionPushRouteRegistrationSchema = z.object({
  alertsAllowed: z.boolean(),
  environment: z.enum(["development", "production"]),
  installationId: z.string().uuid(),
  token: z.string().regex(/^[a-f0-9]{64,200}$/u),
  topic: z.enum(APPLE_PUSH_TOPICS),
}).strict();
export type CompanionPushRouteRegistration = z.infer<typeof companionPushRouteRegistrationSchema>;

export const companionPushRouteDeletionSchema = z.object({ installationId: z.string().uuid() }).strict();

const transactionOptions = { maxWait: 5_000, timeout: 5_000 };

export async function registerCompanionPushRoute(memberId: string, registration: CompanionPushRouteRegistration): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    await requirePersonalMember(tx, memberId);
    const current = await tx.companionPushRoute.findUnique({ where: { userId: memberId } });
    const sameAddress = current
      && current.installationId === registration.installationId
      && current.token === registration.token
      && current.environment === registration.environment
      && current.topic === registration.topic;
    // A wearable-only registration cannot move another installation's game
    // enrollment. Same-address permission refreshes keep its session binding.
    const data = { ...registration, gameSessionId: sameAddress ? current.gameSessionId : null, updatedAt: new Date() };
    await tx.companionPushRoute.upsert({ where: { userId: memberId }, create: { userId: memberId, ...data }, update: data });
  }, transactionOptions);
}

// Deletion reduces authority, so it needs only the authenticated member and
// must keep working after access or consent ends.
export async function deleteCompanionPushRoute(memberId: string, installationId: string): Promise<void> {
  await getPrisma().companionPushRoute.deleteMany({ where: { installationId, userId: memberId } });
}

export async function readCompanionPushRoute(
  memberId: string,
  installationId: string,
): Promise<{ alertsAllowed: boolean; target: ApplePushTarget } | null> {
  const route = await getPrisma().companionPushRoute.findUnique({ where: { userId: memberId } });
  if (!route || route.installationId !== installationId) return null;
  const parsed = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true })
    .safeParse({ environment: route.environment, token: route.token, topic: route.topic });
  return parsed.success ? { alertsAllowed: route.alertsAllowed, target: parsed.data } : null;
}

// Apple rejected this exact token. A newer registration is left untouched.
export async function forgetCompanionPushRoute(memberId: string, token: string): Promise<void> {
  await getPrisma().companionPushRoute.deleteMany({ where: { token, userId: memberId } });
}
