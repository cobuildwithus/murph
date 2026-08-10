import type { OAuthStateRecord } from "@murphai/device-syncd/types";
import { describe, expect, it, vi } from "vitest";

import { DeviceProviderApplicationIngressStore } from "@/src/lib/device-sync/provider-applications/ingress-store";

describe("DeviceProviderApplicationIngressStore", () => {
  it("carries the same exact application binding through OAuth state and connection commit", async () => {
    const binding = {
      applicationId: "dpa_123",
      provider: "strava" as const,
      revision: 4,
    };
    const createOAuthStateWithProviderApplication = vi.fn(
      async (record: OAuthStateRecord) => record,
    );
    const consumeOAuthStateWithProviderApplication = vi.fn(async () => ({
      status: "missing" as const,
    }));
    const upsertConnectionWithProviderApplication = vi.fn(async () => ({
      account: { id: "dsc_123" },
      previousAccount: null,
    }));
    const delegate = {
      consumeOAuthStateWithProviderApplication,
      createOAuthStateWithProviderApplication,
      upsertConnectionWithProviderApplication,
    } as never;
    const store = new DeviceProviderApplicationIngressStore(binding, delegate);
    const oauthState = {
      state: "state_123",
      ownerId: "member_123",
      provider: "strava",
      returnTo: null,
      metadata: {},
      createdAt: "2026-08-10T00:00:00.000Z",
      expiresAt: "2026-08-10T01:00:00.000Z",
    };
    const connection = {
      connectedAt: "2026-08-10T00:01:00.000Z",
      credential: {
        kind: "oauth_tokens" as const,
        tokens: {
          accessToken: "access",
          accessTokenExpiresAt: null,
          refreshToken: "refresh",
        },
      },
      externalAccountId: "athlete_123",
      existingAccountPolicy: "replace" as const,
      ownerId: "member_123",
      provider: "strava",
      scopes: ["activity:read_all"],
    };

    await store.createOAuthState(oauthState);
    await store.consumeOAuthState(
      oauthState.state,
      oauthState.createdAt,
      oauthState.provider,
      oauthState.ownerId ?? undefined,
    );
    await store.upsertConnection(connection);

    expect(createOAuthStateWithProviderApplication).toHaveBeenCalledWith(
      oauthState,
      binding,
    );
    expect(consumeOAuthStateWithProviderApplication).toHaveBeenCalledWith(
      oauthState.state,
      oauthState.createdAt,
      binding,
      oauthState.provider,
      oauthState.ownerId,
    );
    expect(upsertConnectionWithProviderApplication).toHaveBeenCalledWith(
      connection,
      binding,
    );
  });
});
