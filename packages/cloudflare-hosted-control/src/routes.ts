import { requireCloudflareHostedControlUserId } from "./user-id.ts";

export const CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE =
  "BROWSER_VAULT_REPLICA_NOT_FOUND";
export const CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_CAPTURE_ID_HEADER =
  "x-murph-meal-photo-capture-id";
export const CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_KEY_HEADER =
  "x-murph-meal-photo-key";
export const CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_SHA256_HEADER =
  "x-murph-meal-photo-sha256";
export const CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_CAPTURE_ID_HEADER =
  "x-murph-environment-voice-capture-id";
export const CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_KEY_HEADER =
  "x-murph-environment-voice-key";
export const CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_SHA256_HEADER =
  "x-murph-environment-voice-sha256";

export const CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS = {
  browserVaultSession: {
    method: "POST",
    suffix: "browser-vault/session",
  },
  environmentVoiceStage: {
    method: "POST",
    suffix: "environment-voice/stage",
  },
  environmentVoiceDelete: {
    method: "DELETE",
    suffix: "environment-voice/delete",
  },
  inferenceVerification: {
    method: "POST",
    suffix: "inference/verify",
  },
  mealPhotoStage: {
    method: "POST",
    suffix: "meal-photos/stage",
  },
  mealPhotoDelete: {
    method: "DELETE",
    suffix: "meal-photos/delete",
  },
  runtimeEnsureProcessing: {
    method: "POST",
    suffix: "runtime/ensure-processing",
  },
  runtimeShellPrewarm: {
    method: "POST",
    suffix: "runtime/shell-prewarm",
  },
  runtimeHealthDataConsentReconcile: {
    method: "POST",
    suffix: "runtime/health-data-consent",
  },
  telegramUsageLimitNotice: {
    method: "POST",
    suffix: "telegram/usage-limit-notice",
  },
  userDataDelete: {
    method: "POST",
    suffix: "account-data/delete",
  },
  status: {
    method: "GET",
    suffix: "status",
  },
} as const;

export type CloudflareHostedControlUserRouteName =
  keyof typeof CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS;

export type CloudflareHostedControlUserRouteParams = Readonly<Record<string, string>>;

export function buildCloudflareHostedControlUserStatusPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("status", userId);
}

export function buildCloudflareHostedControlInferenceVerificationPath(
  userId: string,
): string {
  return buildCloudflareHostedControlUserRoutePath(
    "inferenceVerification",
    userId,
  );
}

export function buildCloudflareHostedControlRuntimeEnsureProcessingPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("runtimeEnsureProcessing", userId);
}

export function buildCloudflareHostedControlRuntimeShellPrewarmPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("runtimeShellPrewarm", userId);
}

export function buildCloudflareHostedControlRuntimeHealthDataConsentPath(
  userId: string,
): string {
  return buildCloudflareHostedControlUserRoutePath(
    "runtimeHealthDataConsentReconcile",
    userId,
  );
}

export function buildCloudflareHostedControlTelegramUsageLimitNoticePath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("telegramUsageLimitNotice", userId);
}

export function buildCloudflareHostedControlUserDataDeletionPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("userDataDelete", userId);
}

export function buildCloudflareHostedControlBrowserVaultSessionPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("browserVaultSession", userId);
}

export function buildCloudflareHostedControlMealPhotoStagePath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("mealPhotoStage", userId);
}

export function buildCloudflareHostedControlMealPhotoDeletePath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("mealPhotoDelete", userId);
}

export function buildCloudflareHostedControlEnvironmentVoiceStagePath(
  userId: string,
): string {
  return buildCloudflareHostedControlUserRoutePath(
    "environmentVoiceStage",
    userId,
  );
}

export function buildCloudflareHostedControlEnvironmentVoiceDeletePath(
  userId: string,
): string {
  return buildCloudflareHostedControlUserRoutePath(
    "environmentVoiceDelete",
    userId,
  );
}

export function matchCloudflareHostedControlUserRoutePath(
  routeName: CloudflareHostedControlUserRouteName,
  pathname: string,
): CloudflareHostedControlUserRouteParams | null {
  const prefix = "/internal/users/";
  const suffix = `/${CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS[routeName].suffix}`;

  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }

  const userId = pathname.slice(prefix.length, pathname.length - suffix.length);

  if (!userId || userId.includes("/")) {
    return null;
  }

  return { userId };
}

function buildCloudflareHostedControlUserRoutePath(
  routeName: CloudflareHostedControlUserRouteName,
  userId: string,
): string {
  const normalizedUserId = requireCloudflareHostedControlUserId(userId);
  return `/internal/users/${encodeURIComponent(normalizedUserId)}/${
    CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS[routeName].suffix
  }`;
}
