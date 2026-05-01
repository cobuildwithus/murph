import type { HostedStoredDeviceSyncAccount } from "./prisma-store";

export interface HostedTokenExport {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  tokenVersion: number;
  keyVersion: string;
  exportedAt: string;
}

export type HostedStoredTokenBundle = {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
};

const TOKEN_REFRESH_LEEWAY_MS = 5 * 60_000;

export function buildTokenExport(
  tokenBundle: HostedStoredTokenBundle,
  exportedAt: string,
): HostedTokenExport {
  return {
    accessToken: tokenBundle.accessToken,
    refreshToken: tokenBundle.refreshToken ?? null,
    accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt ?? null,
    tokenVersion: tokenBundle.tokenVersion,
    keyVersion: tokenBundle.keyVersion,
    exportedAt,
  };
}

export function buildStoredTokenBundle(
  account: HostedStoredDeviceSyncAccount | null,
): HostedStoredTokenBundle | null {
  if (!account || account.credential.kind !== "oauth_tokens") {
    return null;
  }

  const tokens = account.credential.tokens;

  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? account.accessTokenExpiresAt ?? null,
    keyVersion: account.keyVersion,
    refreshToken: tokens.refreshToken ?? null,
    tokenVersion: account.tokenVersion,
  };
}

export function shouldRefreshHostedToken(accessTokenExpiresAt: string | null, now: string): boolean {
  if (!accessTokenExpiresAt) {
    return false;
  }

  return Date.parse(accessTokenExpiresAt) <= Date.parse(now) + TOKEN_REFRESH_LEEWAY_MS;
}
