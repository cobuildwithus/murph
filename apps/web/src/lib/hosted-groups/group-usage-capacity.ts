export type HostedGroupUsageCapacityState = "healthy" | "low" | "exhausted";

const HOSTED_GROUP_USAGE_LOW_PERCENT = 20n;

export function calculateHostedGroupIncludedUsageUsedPercent(input: {
  limitUsdMicros: bigint;
  spentUsdMicros: bigint;
}): number | null {
  if (input.limitUsdMicros <= 0n) {
    return null;
  }
  if (input.spentUsdMicros <= 0n) {
    return 0;
  }
  if (input.spentUsdMicros >= input.limitUsdMicros) {
    return 100;
  }

  const usedPercent = Number(
    (input.spentUsdMicros * 100n) / input.limitUsdMicros,
  );
  return Math.max(1, usedPercent);
}

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
