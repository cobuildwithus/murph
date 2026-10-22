import { requireCloudflareHostedControlUserId } from "./user-id.ts";

export const CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE =
  "BROWSER_VAULT_REPLICA_NOT_FOUND";
export const CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_CAPTURE_ID_HEADER =
  "x-murph-meal-photo-capture-id";
export const CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_KEY_HEADER =
  "x-murph-meal-photo-key";
export const CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_SHA256_HEADER =
  "x-murph-meal-photo-sha256";
/** A weekly game photo's own name: `<sha256 of the plaintext>.<jpg|heic>`. */
export const CLOUDFLARE_HOSTED_CONTROL_GAME_MEDIA_ID_HEADER =
  "x-murph-game-media-id";
export const CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS = {
  browserVaultSession: {
    method: "POST",
    suffix: "browser-vault/session",
  },
  gameImageStage: { method: "POST", suffix: "game-images/stage" },
  gameImageDelivery: { method: "GET", suffix: "game-images/delivery" },
  gameImageStat: { method: "GET", suffix: "game-images/stat" },
  gameMediaDelete: {
    method: "DELETE",
    suffix: "game-media/delete",
  },
  gameMediaRead: {
    method: "GET",
    suffix: "game-media/read",
  },
  gameMediaStage: {
    method: "POST",
    suffix: "game-media/stage",
  },
  gameMediaStat: {
    method: "GET",
    suffix: "game-media/stat",
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
  voiceControl: {
    method: "POST",
    suffix: "runtime/voice",
  },
  runtimeHealthDataConsentReconcile: {
    method: "POST",
    suffix: "runtime/health-data-consent",
  },
  telegramUsageLimitNotice: {
    method: "POST",
    suffix: "telegram/usage-limit-notice",
  },
  runtimeResourcePurge: {
    method: "POST",
    suffix: "runtime/resource-purge",
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

export function buildCloudflareHostedControlRuntimeResourcePurgePath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("runtimeResourcePurge", userId);
}

export function buildCloudflareHostedControlUserStatusPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("status", userId);
}

export function buildCloudflareHostedControlRuntimeEnsureProcessingPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("runtimeEnsureProcessing", userId);
}

export function buildCloudflareHostedControlRuntimeHealthDataConsentPath(
  userId: string,
): string {
  return buildCloudflareHostedControlUserRoutePath(
    "runtimeHealthDataConsentReconcile",
    userId,
  );
}

export function buildCloudflareHostedControlVoiceControlPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("voiceControl", userId);
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

export function buildCloudflareHostedControlGameMediaPath(
  routeName: "gameMediaDelete" | "gameMediaRead" | "gameMediaStage" | "gameMediaStat" | "gameImageStage" | "gameImageDelivery" | "gameImageStat",
  userId: string,
): string {
  return buildCloudflareHostedControlUserRoutePath(routeName, userId);
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
