// Amortize workspace restore/checkpoint costs across a bounded backlog drain.
// Foreground cancellation and the independent job limit still end a pass sooner.
export const HOSTED_DEVICE_SYNC_PASS_TIMEOUT_MS = 300_000;
export const HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_TIMEOUT_MS = 45_000;
