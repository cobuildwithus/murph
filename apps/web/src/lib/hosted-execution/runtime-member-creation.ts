import type { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

/** Creation, unlike a missing route for an existing member, proves this is a
 * new runtime. Serialize against campaign start in the creation transaction.
 * The FK-free owner survives account deletion so cleanup keeps the same route.
 * A pre-existing owner is a conflicting identity, never permission to overwrite
 * generation, migration or resource authority.
 */
export async function initializeHostedRuntimeMemberRouteTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  // Signup may already hold contact or family locks. Never wait here behind an
  // exclusive campaign transition while holding those earlier locks.
  const gates = await tx.$queryRaw<Array<{ phase: string }>>`
    SELECT phase FROM hosted_runtime_cutover WHERE id = 'runtime' FOR SHARE NOWAIT
  `.catch(cause => { throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_CREATION_RETRY", httpStatus: 503, retryable: true,
    message: "Account setup is temporarily busy. Please try again shortly.", cause,
  }); });
  const phase = gates[0]?.phase;
  if (phase !== "legacy" && phase !== "draining" && phase !== "rolling" && phase !== "postgres") {
    throw new Error("Hosted runtime creation requires a known cutover state.");
  }
  if (phase === "legacy" || phase === "draining") return;
  await tx.hostedRuntimeOwner.create({ data: { userId, migrationPhase: "postgres" } });
}
