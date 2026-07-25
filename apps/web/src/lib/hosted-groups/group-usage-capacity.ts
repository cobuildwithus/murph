export type HostedGroupUsageCapacityState = "healthy" | "low" | "exhausted";

const HOSTED_GROUP_USAGE_LOW_PERCENT = 20n;

export function classifyHostedGroupUsageCapacity(input: {
  limitUsdMicros: bigint;
  remainingUsdMicros: bigint;
}): HostedGroupUsageCapacityState {
  if (input.remainingUsdMicros <= 0n) {
    return "exhausted";
  }

  const lowThresholdUsdMicros =
    (input.limitUsdMicros * HOSTED_GROUP_USAGE_LOW_PERCENT + 99n) / 100n;
  return input.remainingUsdMicros <= lowThresholdUsdMicros
    ? "low"
    : "healthy";
}

export function calculateHostedGroupUsageRemainingPercent(input: {
  limitUsdMicros: bigint;
  remainingUsdMicros: bigint;
}): number {
  if (input.limitUsdMicros <= 0n || input.remainingUsdMicros <= 0n) {
    return 0;
  }

  const remainingPercent =
    (input.remainingUsdMicros * 100n) / input.limitUsdMicros;
  return Number(remainingPercent > 100n ? 100n : remainingPercent);
}
