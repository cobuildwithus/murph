import { runHostedDeviceSyncDirtySweeper } from "@/src/lib/device-sync/dirty-sweeper";
import { runHostedDeviceSyncDueReconcileSweeper } from "@/src/lib/device-sync/due-reconcile-sweeper";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const [dirtySweep, dueReconcileSweep] = await Promise.allSettled([
    runHostedDeviceSyncDirtySweeper(),
    runHostedDeviceSyncDueReconcileSweeper(),
  ]);

  if (dirtySweep.status === "rejected" || dueReconcileSweep.status === "rejected") {
    console.warn("Hosted device-sync sweeper cron failed.", {
      dirtySweeperErrorName: describeErrorName(dirtySweep),
      dirtySweeperFailed: dirtySweep.status === "rejected",
      dueReconcileSweeperErrorName: describeErrorName(dueReconcileSweep),
      dueReconcileSweeperFailed: dueReconcileSweep.status === "rejected",
    });

    if (dirtySweep.status === "rejected") {
      throw dirtySweep.reason;
    }
    if (dueReconcileSweep.status === "rejected") {
      throw dueReconcileSweep.reason;
    }
    throw new Error("Hosted device-sync sweeper cron failed without an error reason.");
  }

  return jsonOk({
    dueReconcileSweeper: dueReconcileSweep.value,
    sweeper: dirtySweep.value,
  });
});

function describeErrorName<T>(
  result: PromiseSettledResult<T>,
): string | null {
  if (result.status === "fulfilled") {
    return null;
  }

  return result.reason instanceof Error ? result.reason.name : "unknown";
}
