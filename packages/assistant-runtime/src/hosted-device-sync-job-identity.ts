import { createHash } from "node:crypto";

// Logical job identity carried across hosted cold handoff. Recovery writes the
// retained key into the wake hint, and hydration enqueues that exact key, so
// telemetry that digests these keys follows one job through restores.

/** Key a retained row carries into its handoff hint. */
export function resolveHostedDeviceSyncRetainedJobDedupeKey(job: {
  dedupeKey: string | null;
  id: string;
}): string {
  return job.dedupeKey
    ?? `hosted-device-sync-job:${createHash("sha256").update(job.id).digest("hex")}`;
}

/** Key hydration assigns to an incoming wake job hint. */
export function resolveHostedDeviceSyncWakeJobDedupeKey(input: {
  hint: { dedupeKey?: string | null };
  index: number;
  wake: { eventId: string };
}): string {
  return input.hint.dedupeKey
    ?? `hosted-device-sync-wake:${createHash("sha256")
      .update(JSON.stringify([input.wake.eventId, input.index]))
      .digest("hex")}`;
}
