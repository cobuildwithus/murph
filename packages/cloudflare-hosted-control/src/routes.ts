import { requireCloudflareHostedControlUserId } from "./user-id.ts";

export const CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE =
  "BROWSER_VAULT_REPLICA_NOT_FOUND";

export const CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS = {
  browserVaultSession: {
    method: "POST",
    suffix: "browser-vault/session",
  },
  runtimeEnsureProcessing: {
    method: "POST",
    suffix: "runtime/ensure-processing",
  },
  runtimePrewarm: {
    method: "POST",
    suffix: "runtime/prewarm",
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

export function buildCloudflareHostedControlRuntimeEnsureProcessingPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("runtimeEnsureProcessing", userId);
}

export function buildCloudflareHostedControlRuntimePrewarmPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("runtimePrewarm", userId);
}

export function buildCloudflareHostedControlUserDataDeletionPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("userDataDelete", userId);
}

export function buildCloudflareHostedControlBrowserVaultSessionPath(userId: string): string {
  return buildCloudflareHostedControlUserRoutePath("browserVaultSession", userId);
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
