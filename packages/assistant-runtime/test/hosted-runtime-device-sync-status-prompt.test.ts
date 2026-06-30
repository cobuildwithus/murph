import { describe, expect, it } from "vitest";

import {
  buildHostedDeviceSyncStatusPromptFromSnapshot,
} from "../src/hosted-runtime/device-sync-status-prompt.ts";

type PromptSnapshot = Parameters<
  typeof buildHostedDeviceSyncStatusPromptFromSnapshot
>[0]["snapshot"];

function buildSnapshot(
  overrides: Partial<PromptSnapshot["connections"][number]> = {},
): PromptSnapshot {
  return {
    connections: [
      {
        connection: {
          accessTokenExpiresAt: null,
          connectedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
          displayName: null,
          externalAccountId: "external-account-id",
          id: "connection-id",
          metadata: {},
          provider: "junction",
          scopes: [],
          status: "active",
        },
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        localState: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-06-08T00:00:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-06-29T00:00:00.000Z",
          lastWebhookAt: null,
          nextReconcileAt: null,
        },
        sources: [
          {
            displayName: null,
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "refresh failed",
            lastSeenAt: "2026-06-29T00:00:00.000Z",
            resourceCount: 0,
            sourceProviderSlug: "whoop_v2",
            status: "error",
          },
        ],
        ...overrides,
      },
    ],
    generatedAt: "2026-06-29T12:00:00.000Z",
    userId: "user-id",
  };
}

describe("hosted device sync status prompt", () => {
  it("renders WHOOP token refresh failures as reconnect-required dynamic context", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          label: "WHOOP",
          provider: "whoop",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      snapshot: buildSnapshot(),
    });

    expect(prompt).toContain("Connected wearable sync status for this turn");
    expect(prompt).toContain("WHOOP currently needs reconnect");
    expect(prompt).toContain("source `whoop_v2`");
    expect(prompt).toContain("`TOKEN_REFRESH_FAILED`");
    expect(prompt).toContain("vault-cli device connect whoop --format json");
    expect(prompt).toContain("Do not treat missing wearable data");
    expect(prompt).toContain("verify it with `vault-cli wearables sources list --format json`");
  });

  it("normalizes lowercase reconnect error codes", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          label: "WHOOP",
          provider: "whoop",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      snapshot: buildSnapshot({
        sources: [
          {
            displayName: null,
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastErrorCode: "token_refresh_failed",
            lastErrorMessage: null,
            lastSeenAt: "2026-06-29T00:00:00.000Z",
            resourceCount: 0,
            sourceProviderSlug: "whoop_v2",
            status: "error",
          },
        ],
      }),
    });

    expect(prompt).toContain("`TOKEN_REFRESH_FAILED`");
  });

  it("maps Junction account reauthorization through configured source reconnect targets", () => {
    const snapshot = buildSnapshot();
    const entry = snapshot.connections[0]!;
    const source = entry.sources![0]!;
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          label: "WHOOP",
          provider: "whoop",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      snapshot: {
        ...snapshot,
        connections: [
          {
            ...entry,
            connection: {
              ...entry.connection,
              provider: "junction",
              status: "reauthorization_required",
            },
            sources: [
              {
                ...source,
                lastErrorCode: null,
                status: "connected",
              },
            ],
          },
        ],
      },
    });

    expect(prompt).toContain("WHOOP currently needs reconnect");
    expect(prompt).toContain("account is in error state `REAUTHORIZATION_REQUIRED`");
    expect(prompt).toContain("vault-cli device connect whoop --format json");
    expect(prompt).not.toContain("Junction currently needs reconnect");
    expect(prompt).not.toContain("No hosted reconnect target");
  });

  it("does not render ambiguous generic commands for duplicate WHOOP reconnect targets", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          connectTargetAmbiguous: true,
          label: "WHOOP",
          provider: "whoop",
        },
        {
          connectTarget: "whoop",
          connectTargetAmbiguous: true,
          label: "WHOOP",
          provider: "junction",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      snapshot: buildSnapshot({
        connection: {
          accessTokenExpiresAt: null,
          connectedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
          displayName: "WHOOP",
          externalAccountId: "external-account-id",
          id: "connection-id",
          metadata: {},
          provider: "whoop",
          scopes: [],
          status: "reauthorization_required",
        },
        localState: {
          lastErrorCode: "TOKEN_REFRESH_FAILED",
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-06-08T00:00:00.000Z",
          lastSyncErrorAt: "2026-06-29T00:00:00.000Z",
          lastSyncStartedAt: "2026-06-29T00:00:00.000Z",
          lastWebhookAt: null,
          nextReconcileAt: null,
        },
        sources: [],
      }),
    });

    expect(prompt).toContain("WHOOP currently needs reconnect");
    expect(prompt).toContain("account is in error state `TOKEN_REFRESH_FAILED`");
    expect(prompt).toContain("generic device-connect command is ambiguous");
    expect(prompt).not.toContain("vault-cli device connect whoop --format json");
  });

  it("renders source-specific Junction WHOOP commands even when direct WHOOP is configured", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          connectTargetAmbiguous: true,
          label: "WHOOP",
          provider: "whoop",
        },
        {
          connectTarget: "whoop",
          connectTargetAmbiguous: true,
          connectTargetCommandSafe: true,
          label: "WHOOP",
          provider: "junction",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      snapshot: buildSnapshot(),
    });

    expect(prompt).toContain("WHOOP currently needs reconnect");
    expect(prompt).toContain("source `whoop_v2`");
    expect(prompt).toContain("vault-cli device connect whoop --format json");
    expect(prompt).not.toContain("generic device-connect command is ambiguous");
  });

  it("does not render a source-specific Junction command when the public target resolves elsewhere", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "oura",
          connectTargetAmbiguous: true,
          connectTargetCommandSafe: true,
          label: "Oura",
          provider: "oura",
        },
        {
          connectTarget: "oura",
          connectTargetAmbiguous: true,
          connectTargetCommandSafe: false,
          label: "Oura",
          provider: "junction",
          sourceProviderSlug: "oura",
        },
      ],
      snapshot: buildSnapshot({
        sources: [
          {
            displayName: null,
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: null,
            lastSeenAt: "2026-06-29T00:00:00.000Z",
            resourceCount: 0,
            sourceProviderSlug: "oura",
            status: "error",
          },
        ],
      }),
    });

    expect(prompt).toContain("Oura currently needs reconnect");
    expect(prompt).toContain("source `oura`");
    expect(prompt).toContain("generic device-connect command is ambiguous");
    expect(prompt).not.toContain("vault-cli device connect oura --format json");
  });

  it("maps Junction account reauthorization through the connection source before provider fallback", () => {
    const snapshot = buildSnapshot();
    const entry = snapshot.connections[0]!;
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          label: "WHOOP",
          provider: "junction",
          sourceProviderSlug: "whoop_v2",
        },
        {
          connectTarget: "garmin",
          label: "Garmin",
          provider: "junction",
          sourceProviderSlug: "garmin",
        },
      ],
      snapshot: {
        ...snapshot,
        connections: [
          {
            ...entry,
            connection: {
              ...entry.connection,
              provider: "junction",
              status: "reauthorization_required",
            },
            sources: [
              {
                displayName: null,
                firstSeenAt: "2026-06-01T00:00:00.000Z",
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSeenAt: "2026-06-29T00:00:00.000Z",
                resourceCount: 0,
                sourceProviderSlug: "garmin",
                status: "connected",
              },
            ],
          },
        ],
      },
    });

    expect(prompt).toContain("Garmin currently needs reconnect");
    expect(prompt).toContain("vault-cli device connect garmin --format json");
    expect(prompt).not.toContain("WHOOP currently needs reconnect");
  });

  it("does not render when sources are connected", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          label: "WHOOP",
          provider: "whoop",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      snapshot: buildSnapshot({
        sources: [
          {
            displayName: null,
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-06-29T00:00:00.000Z",
            resourceCount: 0,
            sourceProviderSlug: "whoop_v2",
            status: "connected",
          },
        ],
      }),
    });

    expect(prompt).toBeNull();
  });
});
