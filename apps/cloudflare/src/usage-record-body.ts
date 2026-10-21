import { HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES } from "@murphai/hosted-execution/runtime-control";
import { incrementCliTimingDrop, normalizeCliTiming } from "@murphai/runtime-state/cli-timing";

// Datagram/cardinality caps do not bound the merged HTTP request. Trim only
// optional timing, on a copy, before serialization/signing at each transport boundary.
export function boundUsageRequestCliTiming<T extends { usage: object }>(
  input: T,
): T {
  const sourceProfile = "turnProfileJson" in input.usage ? input.usage.turnProfileJson : null;
  if (!sourceProfile || typeof sourceProfile !== "object" || Array.isArray(sourceProfile)
    || !("cliTiming" in sourceProfile)) return input;

  const profile: Record<string, unknown> = { ...sourceProfile };
  const timing = normalizeCliTiming(profile.cliTiming);
  delete profile.cliTiming;
  const body = { ...input, usage: { ...input.usage, turnProfileJson: profile } };
  if (!timing) return body;

  profile.cliTiming = timing;
  while (new TextEncoder().encode(JSON.stringify(body)).byteLength > HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES) {
    const dropped = timing.commands.pop();
    if (!dropped) {
      // Even the coverage counters do not fit. Absence means unavailable, not
      // zero calls. Never shrink legacy accounting, even if it is oversized.
      delete profile.cliTiming;
      break;
    }
    timing.droppedCalls = incrementCliTimingDrop(timing.droppedCalls, dropped.calls);
  }
  return body;
}
