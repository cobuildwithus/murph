import type { HostedStoredDeviceSyncAccount } from "./prisma-store";

export type HostedStoredTokenBundle = {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
};

export function buildStoredTokenBundle(
  account: HostedStoredDeviceSyncAccount | null,
): HostedStoredTokenBundle | null {
  if (
    !account
    || account.credential.kind !== "oauth_tokens"
    || !account.keyVersion
    || typeof account.tokenVersion !== "number"
  ) {
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
