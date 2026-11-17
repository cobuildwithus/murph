import "server-only";
import { after } from "next/server";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { runWithFreshHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { settleProgressHealthInBackground } from "./health-reader";
import { settleProgressFriends } from "./friends-reader";

/** Failure belongs to the background batch, never the already-built Prizes response. */
export function scheduleProgressSettlement(auth: HostedNativeMemberAuth): void {
  after(async () => {
    let failed = false;
    for (const settle of [settleProgressHealthInBackground, settleProgressFriends]) {
      try {
        await runWithFreshHostedDomainRootUnwrapCache(() => settle(auth));
      } catch {
        failed = true;
      }
    }
    if (failed) console.error("PROGRESS_BACKGROUND_SETTLEMENT_FAILED");
  });
}
