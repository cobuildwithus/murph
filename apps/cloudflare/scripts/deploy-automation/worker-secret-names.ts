import {
  deviceSyncProviderRuntimeSecretEnvKeys,
} from "@murphai/device-syncd/config";
import {
  getHostedAssistantCapabilityEnvNames,
} from "@murphai/hosted-execution/assistant-capabilities";

const HOSTED_WORKER_OPTIONAL_PROVIDER_SECRET_NAMES =
  getHostedAssistantCapabilityEnvNames({ owner: "worker-secret" });

export const HOSTED_WORKER_REQUIRED_SECRET_NAMES = [
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_LOG_FINGERPRINT_SECRET",
  "HOSTED_R2_PRESIGN_ACCESS_KEY_ID",
  "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  "MURPH_DATA_API_KEY",
  "OPENAI_API_KEY",
] as const;

export const HOSTED_WORKER_OPTIONAL_SECRET_NAMES = [
  "CLOUDFLARE_IMAGES_API_KEY",
  "DEVICE_SYNC_SECRET",
  ...deviceSyncProviderRuntimeSecretEnvKeys,
  ...HOSTED_WORKER_OPTIONAL_PROVIDER_SECRET_NAMES,
  "HOSTED_AI_USAGE_REPORTING_SECRET",
  "HOSTED_EMAIL_SIGNING_SECRET",
  "LINQ_WEBHOOK_SECRET",
] as const;
