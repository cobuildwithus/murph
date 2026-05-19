import { runHostedDeviceSyncDirtySweeper } from "@/src/lib/device-sync/dirty-sweeper";
import {
  runHostedDeviceSyncDueReconcileSweeper,
  type HostedDeviceSyncDueReconcileSweeperResult,
} from "@/src/lib/device-sync/due-reconcile-sweeper";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const [dirtySweep, dueReconcileSweep] = await Promise.allSettled([
    runHostedDeviceSyncDirtySweeper(),
    runHostedDeviceSyncDueReconcileSweeper(),
  ]);

  const dueReconcileWakeAppendFailed =
    dueReconcileSweep.status === "fulfilled" && hasDueReconcileWakeAppendFailures(dueReconcileSweep.value);

  if (
    dirtySweep.status === "rejected" ||
    dueReconcileSweep.status === "rejected" ||
    dueReconcileWakeAppendFailed
  ) {
    console.warn("Hosted device-sync sweeper cron failed.", {
      dirtySweeperErrorName: describeErrorName(dirtySweep),
      dirtySweeperFailed: dirtySweep.status === "rejected",
      dueReconcileWakeAppendFailed,
      dueReconcileWakeNotAppended: dueReconcileSweep.status === "fulfilled"
        ? dueReconcileSweep.value.wakeNotAppended
        : null,
      dueReconcileSweeperErrorName: describeErrorName(dueReconcileSweep),
      dueReconcileSweeperFailed: dueReconcileSweep.status === "rejected",
    });

    if (dirtySweep.status === "rejected") {
      throw dirtySweep.reason;
    }
    if (dueReconcileSweep.status === "rejected") {
      throw dueReconcileSweep.reason;
    }
    if (dueReconcileWakeAppendFailed) {
      throw new Error("Hosted device-sync due reconcile sweeper failed to append one or more wakes.");
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

function hasDueReconcileWakeAppendFailures(
  result: HostedDeviceSyncDueReconcileSweeperResult,
): boolean {
  return result.wakeFailed > 0 || result.wakeNotAppended > 0;
}
