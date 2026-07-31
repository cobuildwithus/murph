import "server-only";

import { createHash } from "node:crypto";

const BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS = 60_000;

export function buildHostedBrowserVaultRefreshRuntimeControlEvent(input: {
  nowMs?: number;
  userId: string;
  workspaceVersion: string;
}): {
  eventId: string;
  occurredAt: string;
} {
  const nowMs = input.nowMs ?? Date.now();
  const bucketMs = Math.floor(
    nowMs / BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS,
  ) * BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      bucketMs,
      userId: input.userId,
      version: 1,
      workspaceVersion: input.workspaceVersion,
    }))
    .digest("hex")
    .slice(0, 32);

  return {
    eventId: `runtime-control:browser-vault-refresh:${fingerprint}`,
    occurredAt: new Date(bucketMs).toISOString(),
  };
}

export function isHostedBrowserVaultRefreshRuntimeControlEvent(input: {
  eventId: string;
  occurredAt: Date;
  userId: string;
  workspaceVersion: string;
}): boolean {
  const expected = buildHostedBrowserVaultRefreshRuntimeControlEvent({
    nowMs: input.occurredAt.getTime(),
    userId: input.userId,
    workspaceVersion: input.workspaceVersion,
  });

  return input.eventId === expected.eventId
    && input.occurredAt.toISOString() === expected.occurredAt;
}
