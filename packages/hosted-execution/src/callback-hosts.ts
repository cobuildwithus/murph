export const HOSTED_EXECUTION_CALLBACK_HOSTS = {
  artifacts: "artifacts.worker",
  commit: "commit.worker",
  email: "email.worker",
  sideEffects: "side-effects.worker",
} as const;

export const HOSTED_EXECUTION_PROXY_HOSTS = {
  deviceSync: "device-sync.worker",
  usage: "usage.worker",
} as const;

export const DEFAULT_HOSTED_EXECUTION_ARTIFACTS_BASE_URL =
  `http://${HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts}`;
export const DEFAULT_HOSTED_EXECUTION_COMMIT_BASE_URL =
  `http://${HOSTED_EXECUTION_CALLBACK_HOSTS.commit}`;
export const DEFAULT_HOSTED_EXECUTION_DEVICE_SYNC_PROXY_BASE_URL =
  `http://${HOSTED_EXECUTION_PROXY_HOSTS.deviceSync}`;
export const DEFAULT_HOSTED_EXECUTION_EMAIL_BASE_URL =
  `http://${HOSTED_EXECUTION_CALLBACK_HOSTS.email}`;
export const DEFAULT_HOSTED_EXECUTION_SIDE_EFFECTS_BASE_URL =
  `http://${HOSTED_EXECUTION_CALLBACK_HOSTS.sideEffects}`;
export const DEFAULT_HOSTED_EXECUTION_USAGE_PROXY_BASE_URL =
  `http://${HOSTED_EXECUTION_PROXY_HOSTS.usage}`;
