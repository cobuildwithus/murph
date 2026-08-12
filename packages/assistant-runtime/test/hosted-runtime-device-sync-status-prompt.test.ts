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
          setupPhase: "source_confirmed",
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
            lastDataAt: null,
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
  it("reads bounded credential-free snapshots and renders active and reconnecting sources", async () => {
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

        if (request?.provider === "oura") {
          return {
            ...baseSnapshot,
            connections: [],
          };
        }

        return {
          ...baseSnapshot,
          connections: [
            {
              ...baseConnection,
              sources: request?.sourceProviderSlug === "withings"
                ? [withingsSource]
                : [whoopSource],
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
        {
          connectTarget: "oura",
          connectTargetCommandSafe: true,
          label: "Oura",
          provider: "oura",
        },
      ],
    });

    expect(requests).toEqual([
      {
        includeCredentialMaterial: false,
        limit: 4,
        signal: null,
        sourceProviderSlug: "whoop_v2",
      },
      {
        includeCredentialMaterial: false,
        limit: 4,
        signal: null,
        sourceProviderSlug: "withings",
      },
      {
        includeCredentialMaterial: false,
        limit: 4,
        provider: "oura",
        signal: null,
      },
    ]);
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

  it("keeps disabled Junction Strava status visible without offering a reconnect command", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectionAvailable: false,
          connectTarget: "strava",
          connectTargetCommandSafe: false,
          label: "Strava",
          provider: "junction",
          sourceProviderSlug: "strava",
        },
      ],
      snapshot: buildSnapshot({
        sources: [
          {
            displayName: null,
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "refresh failed",
            lastSeenAt: "2026-06-29T00:00:00.000Z",
            lastDataAt: null,
            resourceCount: 0,
            sourceProviderSlug: "strava",
            status: "error",
          },
        ],
      }),
    });

    expect(prompt).toContain("Strava currently needs reconnect");
    expect(prompt).toContain("source `strava`");
    expect(prompt).toContain("No hosted reconnect target is configured for this wearable/source");
    expect(prompt).not.toContain("vault-cli device connect strava --format json");
  });

  it("guides Garmin historical recovery through the confirmed connection reset", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "garmin",
          label: "Garmin",
          provider: "junction",
          sourceProviderSlug: "garmin",
        },
      ],
      snapshot: buildSnapshot({
        sources: [
          {
            displayName: null,
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
            lastErrorMessage: "Historical data remained incomplete.",
            lastSeenAt: "2026-06-29T00:00:00.000Z",
            lastDataAt: null,
            resourceCount: 0,
            sourceProviderSlug: "garmin",
            status: "error",
          },
        ],
      }),
    });

    expect(prompt).toContain("Garmin historical data remained incomplete after bounded sync checks");
    expect(prompt).toContain("Current data may still arrive");
    expect(prompt).toContain("Do not send a connect-only link");
    expect(prompt).toContain("wearable settings");
    expect(prompt).toContain("may also disconnect other wearables on that shared connection");
    expect(prompt).toContain("explicitly confirm the disconnect before reconnecting Garmin");
    expect(prompt).not.toContain("vault-cli device connect garmin --format json");
    expect(prompt).not.toContain("deregisters only Garmin");
  });

  it("ignores stale historical reset markers on non-Garmin sources", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "oura",
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
            lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
            lastErrorMessage: "Historical data remained incomplete.",
            lastSeenAt: "2026-06-29T00:00:00.000Z",
            lastDataAt: null,
            resourceCount: 0,
            sourceProviderSlug: "oura",
            status: "error",
          },
        ],
      }),
    });

    expect(prompt).toBeNull();
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
            lastDataAt: null,
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
    expect(prompt).not.toMatch(/junction/iu);
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
          setupPhase: "source_confirmed",
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
            lastDataAt: null,
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
                lastDataAt: null,
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
            lastDataAt: null,
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

  it("projects established source-less direct accounts without display metadata", () => {
    const snapshot = buildSnapshot();
    const entry = snapshot.connections[0]!;
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [
        {
          connectTarget: "whoop",
          label: "WHOOP",
          provider: "whoop",
        },
      ],
      snapshot: {
        ...snapshot,
        connections: [
          {
            ...entry,
            connection: {
              ...entry.connection,
              displayName: "private-account-display-name",
              provider: "whoop",
            },
            sources: [],
          },
        ],
      },
    });

    expect(prompt).toContain("WHOOP has an active connection");
    expect(prompt).not.toContain("private-account-display-name");
    expect(prompt).not.toContain("external-account-id");
  });

  it("keeps a source-less Junction account unknown", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [],
      snapshot: buildSnapshot({
        sources: [],
      }),
    });

    expect(prompt).toBeNull();
  });

  it.each(["pending_link", "link_returned", "failed", null] as const)(
    "does not treat %s setup as an established connection",
    (setupPhase) => {
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
                setupPhase,
              },
              sources: [
                {
                  ...entry.sources![0]!,
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  status: "connected",
                },
              ],
            },
          ],
        },
      });

      expect(prompt).toBeNull();
    },
  );

  it("does not treat non-connected sources as active without reconnect evidence", () => {
    const snapshot = buildSnapshot();
    const entry = snapshot.connections[0]!;
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [],
      snapshot: {
        ...snapshot,
        connections: [
          {
            ...entry,
            sources: [
              {
                ...entry.sources![0]!,
                lastErrorCode: null,
                lastErrorMessage: null,
                status: "unavailable",
              },
            ],
          },
        ],
      },
    });

    expect(prompt).toBeNull();
  });

  it("does not render reconnect guidance for incomplete setup", () => {
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
              setupPhase: "pending_link",
            },
          },
        ],
      },
    });

    expect(prompt).toBeNull();
  });

  it("returns no context when a bounded snapshot has no matching connections", () => {
    const prompt = buildHostedDeviceSyncStatusPromptFromSnapshot({
      reconnectTargets: [],
      snapshot: {
        connections: [],
        generatedAt: "2026-06-29T12:00:00.000Z",
        userId: "user-id",
      },
    });

    expect(prompt).toBeNull();
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

    expect(prompt).toBeNull();
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
      reconnectTargets: [
        {
          connectTarget: "whoop",
          label: "WHOOP",
          provider: "junction",
          sourceProviderSlug: "whoop_v2",
        },
      ],
    })).resolves.toBeNull();
  });
});
