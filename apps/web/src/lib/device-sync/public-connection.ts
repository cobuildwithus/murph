import { createHmac } from "node:crypto";

import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";

export interface HostedBrowserDeviceSyncConnection extends Omit<PublicDeviceSyncAccount, "externalAccountId"> {
  id: string;
}

const HOSTED_PUBLIC_CONNECTION_ID_PREFIX = "dspc_";

export function createHostedBrowserConnectionId(secret: Buffer | Uint8Array | string, connectionId: string): string {
  return `${HOSTED_PUBLIC_CONNECTION_ID_PREFIX}${createHmac("sha256", normalizeSecret(secret))
    .update(connectionId, "utf8")
    .digest("base64url")}`;
}

export function toHostedBrowserDeviceSyncConnection(
  account: PublicDeviceSyncAccount,
  secret: Buffer | Uint8Array | string,
): HostedBrowserDeviceSyncConnection {
  const { externalAccountId: _externalAccountId, id, ...rest } = account;

  return {
    ...rest,
    id: createHostedBrowserConnectionId(secret, id),
  };
}

function normalizeSecret(secret: Buffer | Uint8Array | string): Buffer | Uint8Array {
  if (typeof secret === "string") {
    return Buffer.from(secret, "utf8");
  }

  return secret;
}
