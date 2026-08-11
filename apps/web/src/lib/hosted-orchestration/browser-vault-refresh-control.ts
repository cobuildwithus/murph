import "server-only";

import { createHash } from "node:crypto";

const BROWSER_VAULT_REFRESH_CONTROL_OCCURRED_AT = "1970-01-01T00:00:00.000Z";

export const HOSTED_BROWSER_VAULT_REFRESH_RUNTIME_CONTROL_EVENT_ID_PREFIX =
  "runtime-control:browser-vault-refresh:";

export function buildHostedBrowserVaultRefreshRuntimeControlEvent(input: {
  userId: string;
  workspaceVersion: string;
}): {
  eventId: string;
  occurredAt: string;
} {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      userId: input.userId,
      version: 2,
      workspaceVersion: input.workspaceVersion,
    }))
    .digest("hex")
    .slice(0, 32);

  return {
    eventId:
      `${HOSTED_BROWSER_VAULT_REFRESH_RUNTIME_CONTROL_EVENT_ID_PREFIX}${fingerprint}`,
    occurredAt: BROWSER_VAULT_REFRESH_CONTROL_OCCURRED_AT,
  };
}

export function isHostedBrowserVaultRefreshRuntimeControlEvent(input: {
  eventId: string;
  occurredAt: Date;
  userId: string;
  workspaceVersion: string;
}): boolean {
  const expected = buildHostedBrowserVaultRefreshRuntimeControlEvent({
    userId: input.userId,
    workspaceVersion: input.workspaceVersion,
  });

  return input.eventId === expected.eventId
    && input.occurredAt.toISOString() === expected.occurredAt;
}
