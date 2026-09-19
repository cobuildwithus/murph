import type { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

/** Take the campaign lock before inserting the member so current creators
 * expose a retryable setup error. The database insert trigger owns enrollment
 * for both current and older writers, in the canonical creation transaction.
 */
export async function lockHostedRuntimeMemberCreationTx(tx: Prisma.TransactionClient): Promise<void> {
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
}
