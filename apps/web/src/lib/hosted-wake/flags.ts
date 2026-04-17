export function isHostedWakeSimpleProducerDualWriteEnabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = source.HOSTED_WAKE_SIMPLE_PRODUCER_DUALWRITE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
