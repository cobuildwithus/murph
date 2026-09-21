import {
  buildHostedLiveUsageRecord,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import type { HostedRuntimeUsageRecordPort } from "./platform.ts";

/** A call is never resumed under the same id after losing its runtime owner. */
export function createHostedLiveUsageRecorder(input: {
  memberId: string;
  sessionId: string;
  port: HostedRuntimeUsageRecordPort;
  stopVoice(): void;
}) {
  let recordedMs = 0;
  let latestMs = 0;
  let pending: { record: AssistantUsageRecord; endMs: number } | null = null;
  let inFlight: Promise<void> | null = null;
  let failed = false;

  const write = async (): Promise<void> => {
    while (recordedMs < latestMs) {
      // Retain the exact record after an ambiguous response, including its
      // timestamp, so an explicit flush replays the immutable ledger identity.
      pending ??= {
        record: buildHostedLiveUsageRecord({
          memberId: input.memberId,
          sessionId: input.sessionId,
          occurredAt: new Date().toISOString(),
          startDurationMs: recordedMs,
          endDurationMs: latestMs,
        }),
        endMs: latestMs,
      };
      // Website voice does not authorize a fallback notice on another channel.
      const result = await input.port.recordUsage(pending.record, null);
      recordedMs = pending.endMs;
      pending = null;
      if (!result.platformAiUsageAllowedAfter) input.stopVoice();
    }
  };
  const flush = (): Promise<void> => {
    if (!inFlight) {
      inFlight = write().catch((error: unknown) => {
        failed = true;
        input.stopVoice();
        throw error;
      }).finally(() => {
        inFlight = null;
        if (!failed && recordedMs < latestMs) void flush().catch(() => {});
      });
    }
    return inFlight;
  };

  return {
    observe(seconds: number): void {
      const milliseconds = Math.round(seconds * 1000);
      if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(milliseconds)) {
        failed = true;
        input.stopVoice();
        return;
      }
      latestMs = Math.max(latestMs, milliseconds);
      if (!failed) void flush().catch(() => {});
    },
    // The call owner joins this after native closure. Failure remains visible;
    // a missing provider receipt never fabricates additional duration.
    flush,
  };
}
