import { describe, expect, it } from "vitest";

import {
  buildHostedDeviceSyncStatusPrompt,
  buildHostedDeviceSyncStatusPromptFromSnapshot,
} from "../src/hosted-runtime/device-sync-status-prompt.ts";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime/platform.ts";

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
  it("reads one credential-free snapshot and renders active and reconnecting sources", async () => {
    const requests: Array<Parameters<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>[0]> = [];
    const baseSnapshot = buildSnapshot();
    const baseConnection = baseSnapshot.connections[0]!;
    const whoopSource = baseConnection.sources![0]!;
    const withingsSource = {
      ...whoopSource,
      displayName: "Withings",
      lastErrorCode: null,
      lastErrorMessage: null,
      sourceProviderSlug: "withings",
      status: "connected" as const,
    };
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ackDirtyStateProcessed: async () => {
        throw new Error("not used");
      },
      applyUpdates: async () => {
        throw new Error("not used");
      },
      createConnectLink: async () => {
        throw new Error("not used");
      },
      fetchDirtyStates: async () => {
        throw new Error("not used");
      },
      fetchSnapshot: async (request) => {
        requests.push(request);

        return {
          ...baseSnapshot,
          connections: [
            {
              ...baseConnection,
              sources: [whoopSource, withingsSource],
            },
          ],
        };
      },
    };

    const prompt = await buildHostedDeviceSyncStatusPrompt({
      deviceSyncPort,
      reconnectTargets: [
        {
          connectTarget: "whoop",
          connectTargetCommandSafe: true,
          label: "WHOOP",
          provider: "junction",
          sourceProviderSlug: "whoop_v2",
        },
        {
          connectTarget: "withings",
          connectTargetCommandSafe: true,
          label: "Withings",
          provider: "junction",
          sourceProviderSlug: "withings",
        },
      ],
    });

    expect(requests).toEqual([{
      includeCredentialMaterial: false,
      signal: null,
    }]);
    expect(prompt).toContain("WHOOP currently needs reconnect");
    expect(prompt).toContain("source `whoop_v2`");
    expect(prompt).toContain("Withings has an active connection");
    expect(prompt).not.toContain("Withings currently needs reconnect");
  });

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

    expect(prompt).toContain("Wearable connection status for this turn");
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

  it("renders connected sources without account identifiers or reconnect guidance", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [],
      snapshot: buildSnapshot({
        sources: [
          {
            displayName: "private-source-display-name",
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

    expect(prompt).toContain("WHOOP has an active connection");
    expect(prompt).toContain("Treat every active or reconnect-required wearable above as already set up");
    expect(prompt).not.toContain("needs reconnect");
    expect(prompt).not.toContain("external-account-id");
    expect(prompt).not.toContain("connection-id");
    expect(prompt).not.toContain("private-source-display-name");
    expect(prompt).not.toContain("user-id");
  });

  it("projects source-less active accounts as generic active-wearable context", () => {
    const snapshot = buildSnapshot();
    const entry = snapshot.connections[0]!;
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [],
      snapshot: {
        ...snapshot,
        connections: [
          {
            ...entry,
            connection: {
              ...entry.connection,
              displayName: "private-account-display-name",
            },
            sources: [],
          },
        ],
      },
    });

    expect(prompt).toContain("An active wearable connection exists");
    expect(prompt).not.toContain(
      "No active or reconnect-required wearable connection is present",
    );
    expect(prompt).not.toContain("private-account-display-name");
    expect(prompt).not.toContain("external-account-id");
  });

  it("renders an authoritative absence when the snapshot has no current connections", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [],
      snapshot: {
        connections: [],
        generatedAt: "2026-06-29T12:00:00.000Z",
        userId: "user-id",
      },
    });

    expect(prompt).toContain(
      "No active or reconnect-required wearable connection is present",
    );
    expect(prompt).not.toContain("user-id");
  });

  it("does not treat disconnected accounts as active or reconnect-required", () => {
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
      ],
      snapshot: {
        ...snapshot,
        connections: [
          {
            ...entry,
            connection: {
              ...entry.connection,
              status: "disconnected",
            },
          },
        ],
      },
    });

    expect(prompt).toContain(
      "No active or reconnect-required wearable connection is present",
    );
    expect(prompt).not.toContain("WHOOP currently needs reconnect");
  });

  it("returns no context when the authoritative snapshot is unavailable", async () => {
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ackDirtyStateProcessed: async () => {
        throw new Error("not used");
      },
      applyUpdates: async () => {
        throw new Error("not used");
      },
      createConnectLink: async () => {
        throw new Error("not used");
      },
      fetchDirtyStates: async () => {
        throw new Error("not used");
      },
      fetchSnapshot: async () => {
        throw new Error("unavailable");
      },
    };

    await expect(buildHostedDeviceSyncStatusPrompt({
      deviceSyncPort,
      reconnectTargets: [],
    })).resolves.toBeNull();
  });
});
