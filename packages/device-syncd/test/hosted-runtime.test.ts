import { describe, expect, it } from "vitest";

import * as hostedRuntime from "../src/hosted-runtime.ts";
import {
  buildHostedExecutionDeviceSyncConnectLinkPath,
  normalizeHostedDeviceSyncJobHints,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncWakeHint,
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncDirtyPendingRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  resolveHostedDeviceSyncWakeContext,
  sanitizeHostedRuntimeErrorText,
} from "../src/hosted-runtime.ts";

describe("parseHostedExecutionDeviceSyncRuntimeApplyRequest", () => {
  it("parses staged dirty ack overlays on dirty-pending requests", () => {
    expect(
      parseHostedExecutionDeviceSyncDirtyPendingRequest(
        {
          limit: 10,
          stagedDirtyAcks: [
            {
              connectionId: "dsc_123",
              processedDirtyPayloadIds: ["dsp_1", "dsp_2"],
              processedRevision: "42",
            },
          ],
        },
        "trusted-user",
      ),
    ).toEqual({
      limit: 10,
      stagedDirtyAcks: [
        {
          connectionId: "dsc_123",
          processedDirtyPayloadIds: ["dsp_1", "dsp_2"],
          processedRevision: "42",
        },
      ],
      userId: "trusted-user",
    });
  });

  it("rejects oversized staged dirty ack overlays on dirty-pending requests", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncDirtyPendingRequest(
        {
          stagedDirtyAcks: Array.from(
            {
              length:
                hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_RECORD_LIMIT + 1,
            },
            (_, index) => ({
              connectionId: `dsc_${index}`,
              processedRevision: "42",
            }),
          ),
        },
        "trusted-user",
      )
    ).toThrowError(/stagedDirtyAcks must include no more than 200 entries/u);

    expect(() =>
      parseHostedExecutionDeviceSyncDirtyPendingRequest(
        {
          stagedDirtyAcks: [
            {
              connectionId: "dsc_1",
              processedDirtyPayloadIds: Array.from({ length: 3_000 }, (_, index) =>
                `dsp_left_${index}`
              ),
              processedRevision: "42",
            },
            {
              connectionId: "dsc_2",
              processedDirtyPayloadIds: Array.from({ length: 2_001 }, (_, index) =>
                `dsp_right_${index}`
              ),
              processedRevision: "43",
            },
          ],
        },
        "trusted-user",
      )
    ).toThrowError(/processedDirtyPayloadIds must include no more than 5000 total entries/u);
  });

  it("parses hosted runtime link and snapshot payloads with normalized timestamps", () => {
    expect(buildHostedExecutionDeviceSyncConnectLinkPath("oura/webhook")).toBe(
      "/api/internal/device-sync/connect-targets/oura%2Fwebhook/connect-link",
    );
    expect(
      parseHostedExecutionDeviceSyncConnectLinkResponse({
        authorizationUrl: "https://sync.example.test/oauth",
        expiresAt: "2026-04-07T00:00:00.000Z",
        provider: "oura",
        providerLabel: "Oura",
      }),
    ).toEqual({
      authorizationUrl: "https://sync.example.test/oauth",
      connectUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "oura",
      providerLabel: "Oura",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          connectionId: null,
          provider: "oura",
        },
        "trusted-user",
      ),
    ).toEqual({
      connectionId: null,
      includeCredentialMaterial: false,
      provider: "oura",
      userId: "trusted-user",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          includeCredentialMaterial: true,
          provider: "oura",
        },
        "trusted-user",
      ),
    ).toEqual({
      includeCredentialMaterial: true,
      provider: "oura",
      userId: "trusted-user",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-07T00:00:00+00:00",
              createdAt: "2026-04-06T23:59:59+00:00",
              displayName: "Oura User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {
                __proto__: "blocked",
                accountTier: "pro",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: null,
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: "2026-04-07T01:00:00+00:00",
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle: {
                accessToken: "access-token",
                accessTokenExpiresAt: "2026-04-07T02:00:00+00:00",
                keyVersion: "kv_1",
                refreshToken: null,
                tokenVersion: 3,
              },
            },
          },
        ],
        generatedAt: "2026-04-07T00:00:00.000Z",
        userId: "user_123",
      }),
    ).toEqual({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-06T23:59:59.000Z",
            displayName: "Oura User",
            externalAccountId: "oura-user-1",
            id: "conn_123",
            metadata: {
              accountTier: "pro",
            },
            provider: "oura",
            scopes: ["daily"],
            status: "active",
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          credential: {
            kind: "oauth_tokens",
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: "2026-04-07T02:00:00.000Z",
              keyVersion: "kv_1",
              refreshToken: null,
              tokenVersion: 3,
            },
          },
        },
      ],
      generatedAt: "2026-04-07T00:00:00.000Z",
      userId: "user_123",
    });
  });

  it("rejects non-object and invalid hosted runtime snapshot requests", () => {
    for (const value of [null, "not-json-object", ["not-json-object"]]) {
      expect(() =>
        parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(value, "trusted-user"),
      ).toThrowError(/Hosted device-sync runtime snapshot request must be an object/u);
    }

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          includeCredentialMaterial: "true",
        },
        "trusted-user",
      ),
    ).toThrowError(
      /Hosted device-sync runtime snapshot request includeCredentialMaterial must be a boolean/u,
    );
  });

  it("keeps only the supported internal projection paths", () => {
    expect(hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH).toBe(
      "/api/internal/device-sync/runtime/snapshot",
    );
    expect(hostedRuntime.HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH).toBe(
      "/api/internal/device-sync/runtime/apply",
    );
    expect("buildHostedExecutionUserDeviceSyncRuntimePath" in hostedRuntime).toBe(false);
  });

  it("parses provider-config credential snapshots without token material", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-12T08:00:00+00:00",
            createdAt: "2026-04-12T07:55:00+00:00",
            displayName: "Junction",
            externalAccountId: "junction-user-1",
            id: "conn_junction",
            metadata: {
              accountTier: "team",
            },
            provider: "junction",
            scopes: [],
            setupExpiresAt: "2026-04-12T08:15:00+00:00",
            setupPhase: "pending_link",
            status: "active",
            updatedAt: "2026-04-12T08:01:00+00:00",
          },
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
            credentialMetadata: {
              Authorization: "Bearer secret",
              authHeader: "Bearer header-secret",
              clientUserId: "raw-client-user",
              clientUserIdHash: "hash_client_user",
              client: "raw-client",
              credentialNote: "Authorization: Bearer secret-token",
              hmacSecret: "secret",
              opaqueNote: "abc123def456ghi789jkl012mno345pq",
              owner: "raw-owner",
              ownerId: "raw-owner",
              sourceCount: 2,
              user: "raw-user",
              webhookSecret: "secret",
            },
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            nextReconcileAt: null,
          },
        },
      ],
      generatedAt: "2026-04-12T08:02:00.000Z",
      userId: "user_123",
    });

    expect(parsed.connections[0]).toEqual({
      connection: {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-12T08:00:00.000Z",
        createdAt: "2026-04-12T07:55:00.000Z",
        displayName: "Junction",
        externalAccountId: "junction-user-1",
        id: "conn_junction",
        metadata: {
          accountTier: "team",
        },
        provider: "junction",
        scopes: [],
        setupExpiresAt: "2026-04-12T08:15:00.000Z",
        setupPhase: "pending_link",
        status: "active",
        updatedAt: "2026-04-12T08:01:00.000Z",
      },
      credential: {
        kind: "provider_config",
        providerConfigKey: "junction",
        credentialMetadata: {
          clientUserIdHash: "hash_client_user",
          sourceCount: 2,
        },
      },
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
      },
    });
  });

  it("parses OAuth, redacted OAuth, and none credential snapshots and none credential updates", () => {
    const localState = {
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      nextReconcileAt: null,
    };
    const tokenBundle = {
      accessToken: "access-token",
      accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
      keyVersion: "kv_credential",
      refreshToken: "refresh-token",
      tokenVersion: 9,
    };

    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
              connectedAt: "2026-04-12T08:00:00.000Z",
              createdAt: "2026-04-12T07:55:00.000Z",
              displayName: "Oura",
              externalAccountId: "oura-user-credential",
              id: "conn_oauth_credential",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T08:01:00.000Z",
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle,
            },
            localState,
          },
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-12T08:05:00.000Z",
              createdAt: "2026-04-12T08:05:00.000Z",
              displayName: "Manual",
              externalAccountId: "manual-user-credential",
              id: "conn_none_credential",
              metadata: {},
              provider: "manual",
              scopes: [],
              status: "active",
              updatedAt: "2026-04-12T08:06:00.000Z",
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
            localState,
          },
          {
            connection: {
              accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
              connectedAt: "2026-04-12T08:10:00.000Z",
              createdAt: "2026-04-12T08:10:00.000Z",
              displayName: "Redacted OAuth",
              externalAccountId: "redacted-oauth-user-credential",
              id: "conn_redacted_oauth_credential",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T08:11:00.000Z",
            },
            credential: {
              credentialMetadata: {
                safeCounter: 9,
                tokenHint: "blocked",
                tokenVersionNote: "blocked",
              },
              kind: "oauth_tokens_redacted",
              tokenVersion: 9,
            },
            localState,
          },
        ],
        generatedAt: "2026-04-12T08:07:00.000Z",
        userId: "user_123",
      }),
    ).toEqual({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
            connectedAt: "2026-04-12T08:00:00.000Z",
            createdAt: "2026-04-12T07:55:00.000Z",
            displayName: "Oura",
            externalAccountId: "oura-user-credential",
            id: "conn_oauth_credential",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-12T08:01:00.000Z",
          },
          credential: {
            kind: "oauth_tokens",
            tokenBundle,
          },
          localState,
        },
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-12T08:05:00.000Z",
            createdAt: "2026-04-12T08:05:00.000Z",
            displayName: "Manual",
            externalAccountId: "manual-user-credential",
            id: "conn_none_credential",
            metadata: {},
            provider: "manual",
            scopes: [],
            status: "active",
            updatedAt: "2026-04-12T08:06:00.000Z",
          },
          credential: {
            kind: "none",
            credentialMetadata: {},
          },
          localState,
        },
        {
          connection: {
            accessTokenExpiresAt: "2026-04-12T10:00:00.000Z",
            connectedAt: "2026-04-12T08:10:00.000Z",
            createdAt: "2026-04-12T08:10:00.000Z",
            displayName: "Redacted OAuth",
            externalAccountId: "redacted-oauth-user-credential",
            id: "conn_redacted_oauth_credential",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-12T08:11:00.000Z",
          },
          credential: {
            credentialMetadata: {
              safeCounter: 9,
            },
            kind: "oauth_tokens_redacted",
            tokenVersion: 9,
          },
          localState,
        },
      ],
      generatedAt: "2026-04-12T08:07:00.000Z",
      userId: "user_123",
    });

    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_none_credential",
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
            observedTokenVersion: null,
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      updates: [
        {
          connectionId: "conn_none_credential",
          credential: {
            kind: "none",
            credentialMetadata: {},
          },
          observedTokenVersion: null,
        },
      ],
      userId: "user_123",
    });

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_redacted_oauth_credential",
            credential: {
              credentialMetadata: {},
              kind: "oauth_tokens_redacted",
              tokenVersion: 9,
            },
            observedTokenVersion: 9,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/credential\.kind is not supported for credential mutations/u);
  });

  it("accepts string error fields while keeping timestamp fields strict", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
          observedUpdatedAt: null,
        },
      ],
      userId: "user_123",
    });

    expect(parsed).toEqual({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
          observedUpdatedAt: null,
        },
      ],
      userId: "user_123",
    });
  });

  it("parses sanitized provider failure diagnostics on apply updates", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          failureDiagnostic: {
            accountStatus: "reauthorization_required",
            code: "WHOOP_TOKEN_REQUEST_FAILED",
            details: {
              providerHttpStatus: 400,
              providerHttpStatusText: "Bad Request",
              providerRequestAuthKind: "oauth_client_secret_body",
              providerRequestAuthPlacement: "body_parameters",
              providerRequestBodyFieldCount: 5,
              providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
              providerRequestBodyKind: "form_urlencoded",
              providerRequestContentType: "application_x_www_form_urlencoded",
              providerRequestCredentialPresent: true,
              providerRequestEndpointKind: "whoop_oauth_token",
              providerRequestMethod: "POST",
              providerRequestQueryParameterCount: 0,
              providerResponseErrorCode: "invalid_grant",
              providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
              providerResponseErrorDescriptionFieldPresent: true,
              providerResponseErrorFieldPresent: true,
              providerResponseShapeKind: "json_object",
              providerOAuthErrorCode: "invalid_grant",
              providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
              providerOAuthGrantType: "refresh_token",
              providerOAuthRequestBodyBuilderKind: "url_search_params_record",
              providerOAuthRequestClientAuthPlacement: "body_parameters",
              providerOAuthRequestClientCredentialPresent: true,
              providerOAuthRequestClientIdPresent: true,
              providerOAuthRequestContentType: "application_x_www_form_urlencoded",
              providerOAuthRequestDuplicateParameterCount: 0,
              providerOAuthRequestEncodingKind: "form_urlencoded",
              providerOAuthRequestHasDuplicateParameters: false,
              providerOAuthRequestMethod: "POST",
              providerOAuthRequestOfflineScopePresent: true,
              providerOAuthRequestParameterCount: 5,
              providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
              providerOAuthRequestRefreshCredentialPresent: true,
              providerOAuthRequestScopeCount: 1,
              providerOAuthRequestScopePresent: true,
              providerOAuthRequestScopeValue: "offline",
              providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
              providerOAuthResponseErrorDescriptionFieldPresent: true,
              providerOAuthResponseErrorFieldPresent: true,
              providerOAuthResponseShapeKind: "json_object",
            },
            retryable: false,
          },
          localState: {
            lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
            lastErrorMessage: "WHOOP token request failed.",
            lastSyncErrorAt: "2026-05-19T22:03:27.378Z",
          },
          observedUpdatedAt: "2026-05-19T22:00:44.000Z",
        },
      ],
      userId: "user_123",
    });

    expect(parsed.updates[0]).toMatchObject({
      connectionId: "conn_123",
      failureDiagnostic: {
        accountStatus: "reauthorization_required",
        code: "WHOOP_TOKEN_REQUEST_FAILED",
        details: {
          providerHttpStatus: 400,
          providerHttpStatusText: "Bad Request",
          providerRequestAuthKind: "oauth_client_secret_body",
          providerRequestAuthPlacement: "body_parameters",
          providerRequestBodyFieldCount: 5,
          providerRequestBodyFieldNames: "client_id.client_secret.grant_type.refresh_token.scope",
          providerRequestBodyKind: "form_urlencoded",
          providerRequestContentType: "application_x_www_form_urlencoded",
          providerRequestCredentialPresent: true,
          providerRequestEndpointKind: "whoop_oauth_token",
          providerRequestMethod: "POST",
          providerRequestQueryParameterCount: 0,
          providerResponseErrorCode: "invalid_grant",
          providerResponseErrorDescription: "Refresh token expired. Reconnect WHOOP.",
          providerResponseErrorDescriptionFieldPresent: true,
          providerResponseErrorFieldPresent: true,
          providerResponseShapeKind: "json_object",
          providerOAuthErrorCode: "invalid_grant",
          providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
          providerOAuthGrantType: "refresh_token",
          providerOAuthRequestBodyBuilderKind: "url_search_params_record",
          providerOAuthRequestClientAuthPlacement: "body_parameters",
          providerOAuthRequestClientCredentialPresent: true,
          providerOAuthRequestClientIdPresent: true,
          providerOAuthRequestContentType: "application_x_www_form_urlencoded",
          providerOAuthRequestDuplicateParameterCount: 0,
          providerOAuthRequestEncodingKind: "form_urlencoded",
          providerOAuthRequestHasDuplicateParameters: false,
          providerOAuthRequestMethod: "POST",
          providerOAuthRequestOfflineScopePresent: true,
          providerOAuthRequestParameterCount: 5,
          providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
          providerOAuthRequestRefreshCredentialPresent: true,
          providerOAuthRequestScopeCount: 1,
          providerOAuthRequestScopePresent: true,
          providerOAuthRequestScopeValue: "offline",
          providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
          providerOAuthResponseErrorDescriptionFieldPresent: true,
          providerOAuthResponseErrorFieldPresent: true,
          providerOAuthResponseShapeKind: "json_object",
        },
        retryable: false,
      },
    });
  });

  it("normalizes timestamps and sanitizes secret-bearing local-state fields", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        occurredAt: "2026-04-12T10:15:00+10:00",
        updates: [
          {
            connectionId: "conn_01",
            localState: {
              lastErrorCode: "Authorization: Bearer secret-token",
              lastErrorMessage: "refresh_token=super-secret",
              lastSyncErrorAt: "2026-04-12T10:20:00+10:00",
            },
            observedTokenVersion: 1,
            observedUpdatedAt: null,
            seed: {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-12T09:00:00+10:00",
                createdAt: "2026-04-12T08:00:00+10:00",
                displayName: "Morning sync",
                externalAccountId: "acct_01",
                id: "conn_01",
                metadata: {
                  nickname: "watch",
                },
                provider: "oura",
                scopes: ["daily"],
                status: "active",
                updatedAt: "2026-04-12T10:10:00+10:00",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: null,
                lastSyncErrorAt: null,
                lastSyncStartedAt: null,
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              credential: {
                kind: "none",
                credentialMetadata: {},
              },
            },
          },
        ],
        userId: "user_01",
      }),
    ).toEqual({
      occurredAt: "2026-04-12T00:15:00.000Z",
      updates: [
        {
          connectionId: "conn_01",
          localState: {
            lastErrorCode: "Authorization: [redacted]",
            lastErrorMessage: "refresh_token=[redacted]",
            lastSyncErrorAt: "2026-04-12T00:20:00.000Z",
          },
          observedTokenVersion: 1,
          observedUpdatedAt: null,
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-11T23:00:00.000Z",
              createdAt: "2026-04-11T22:00:00.000Z",
              displayName: "Morning sync",
              externalAccountId: "acct_01",
              id: "conn_01",
              metadata: {
                nickname: "watch",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T00:10:00.000Z",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
          },
        },
      ],
      userId: "user_01",
    });
  });

  it("keeps plain bearer-token phrasing while still redacting token-like values", () => {
    expect(
      sanitizeHostedRuntimeErrorText(
        "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
      ),
    ).toBe(
      "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
    );

    expect(
      sanitizeHostedRuntimeErrorText(
        "authorization=Bearer expired-session-token",
      ),
    ).toBe("authorization=[redacted]");
  });

  it("redacts secret-bearing error fields in runtime apply payloads and seeds", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "access_token=apply-secret",
            lastErrorMessage:
              "authorization=Bearer secret-token refresh_token=refresh-secret eyJhbGciOiJIUzI1NiJ9.payload.signature",
          },
          observedTokenVersion: null,
          observedUpdatedAt: null,
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-06T23:00:00+00:00",
              createdAt: "2026-04-06T22:00:00+00:00",
              displayName: "Seed User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
            },
            localState: {
              lastErrorCode: "refresh_token=seed-secret",
              lastErrorMessage:
                "authorization=Bearer seed-token refresh_token=seed-refresh eyJhbGciOiJIUzI1NiJ9.seed.payload",
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
          },
        },
      ],
      userId: "user_123",
    });

    expect(parsed).toMatchObject({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "access_token=[redacted]",
            lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
          },
          observedTokenVersion: null,
          observedUpdatedAt: null,
          seed: {
            localState: {
              lastErrorCode: "refresh_token=[redacted]",
              lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
            },
          },
        },
      ],
      userId: "user_123",
    });
  });

  it("sanitizes connection metadata updates before they reach durable runtime state", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connection: {
            metadata: {
              "__proto__": "blocked",
              accountTier: "pro",
              attempts: 2,
              nested: {
                secret: "discarded",
              },
              nullValue: null,
              verbose: "x".repeat(257),
            },
          },
          connectionId: "conn_123",
          observedUpdatedAt: null,
        },
      ],
      userId: "user_123",
    });

    expect(parsed.updates[0]?.connection?.metadata).toEqual({
      accountTier: "pro",
      attempts: 2,
      nullValue: null,
    });
  });

  it("parses credential apply mutations and fences credential changes", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_provider_config",
            credential: {
              kind: "provider_config",
              providerConfigKey: "junction",
              credentialMetadata: {
                authHeader: "Bearer drop-me",
                client: "raw-client",
                clientUserId: "raw-client-user",
                clientUserIdHash: "hash_client_user",
                credentialNote: "Authorization: Bearer drop-me",
                opaqueNote: "abc123def456ghi789jkl012mno345pq",
                owner: "raw-owner",
                ownerId: "raw-owner",
                providerApiKey: "drop-me",
                user: "raw-user",
              },
            },
            observedTokenVersion: null,
          },
          {
            connectionId: "conn_clear_tokens",
            credential: {
              clearTokens: true,
              kind: "oauth_tokens",
            },
            observedTokenVersion: 8,
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      updates: [
        {
          connectionId: "conn_provider_config",
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
            credentialMetadata: {
              clientUserIdHash: "hash_client_user",
            },
          },
          observedTokenVersion: null,
        },
        {
          connectionId: "conn_clear_tokens",
          credential: {
            clearTokens: true,
            kind: "oauth_tokens",
          },
          observedTokenVersion: 8,
        },
      ],
      userId: "user_123",
    });

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_provider_config",
            credential: {
              kind: "provider_config",
              providerConfigKey: "junction",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion is required/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_clear_tokens",
            credential: {
              clearTokens: true,
              kind: "oauth_tokens",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion is required/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_provider_config",
            credential: {
              kind: "provider_config",
              providerConfigKey: "junction",
              tokenBundle: null,
            },
            observedTokenVersion: null,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/credential\.tokenBundle is not supported/u);
  });

  it("rejects legacy top-level tokenBundle fields in snapshots and seeds", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-12T08:00:00.000Z",
              createdAt: "2026-04-12T07:55:00.000Z",
              displayName: "Legacy Snapshot",
              externalAccountId: "legacy-snapshot",
              id: "conn_legacy_snapshot",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T08:01:00.000Z",
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            tokenBundle: {
              accessToken: "legacy-access-token",
              accessTokenExpiresAt: null,
              keyVersion: "kv_legacy",
              refreshToken: null,
              tokenVersion: 1,
            },
          },
        ],
        generatedAt: "2026-04-12T08:07:00.000Z",
        userId: "user_123",
      }),
    ).toThrowError(/tokenBundle is not supported/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_legacy_seed",
            seed: {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-12T08:05:00.000Z",
                createdAt: "2026-04-12T08:05:00.000Z",
                displayName: "Legacy Seed",
                externalAccountId: "legacy-seed",
                id: "conn_legacy_seed",
                metadata: {},
                provider: "oura",
                scopes: ["daily"],
                status: "active",
              },
              credential: {
                kind: "none",
                credentialMetadata: {},
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: null,
                lastSyncErrorAt: null,
                lastSyncStartedAt: null,
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              tokenBundle: {
                accessToken: "legacy-seed-access-token",
                accessTokenExpiresAt: null,
                keyVersion: "kv_legacy_seed",
                refreshToken: null,
                tokenVersion: 1,
              },
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/tokenBundle is not supported/u);
  });

  it("parses apply request and response payloads across seed, local-state, and token-bundle branches", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        occurredAt: "2026-04-07T00:00:00+00:00",
        updates: [
          {
            connection: {
              displayName: null,
              metadata: {
                keep: "value",
                nested: {
                  secret: "discarded",
                },
              },
              scopes: ["daily"],
              status: "disconnected",
            },
            connectionId: "conn_123",
            localState: {
              clearError: true,
              lastErrorCode: null,
              lastErrorMessage: "Sync failed",
              lastSyncCompletedAt: null,
              lastSyncErrorAt: "2026-04-07T00:01:00+00:00",
              lastSyncStartedAt: "2026-04-07T00:00:30+00:00",
              lastWebhookAt: null,
              nextReconcileAt: "2026-04-07T01:00:00+00:00",
            },
            observedTokenVersion: null,
            observedUpdatedAt: null,
            sources: [
              {
                displayName: null,
                firstSeenAt: "2026-04-06T23:00:00+00:00",
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSeenAt: "2026-04-07T00:00:00+00:00",
                observedLastSeenAt: null,
                resourceAvailabilitySummary: {
                  activity: true,
                  heartrate: true,
                },
                sourceInstanceKey: "junction_garmin",
                sourceProviderSlug: "garmin",
                status: "connected",
              },
            ],
            seed: {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-06T23:00:00+00:00",
                createdAt: "2026-04-06T22:00:00+00:00",
                displayName: "Seed User",
                externalAccountId: "oura-user-1",
                id: "conn_123",
                metadata: {
                  trace: "seed",
                },
                provider: "oura",
                scopes: ["daily"],
                status: "reauthorization_required",
                updatedAt: "2026-04-06T23:30:00+00:00",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: null,
                lastSyncErrorAt: null,
                lastSyncStartedAt: null,
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              credential: {
                kind: "none",
                credentialMetadata: {},
              },
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle: {
                accessToken: "access-token",
                accessTokenExpiresAt: null,
                keyVersion: "kv_2",
                refreshToken: "refresh-token",
                tokenVersion: 5,
              },
            },
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      occurredAt: "2026-04-07T00:00:00.000Z",
      updates: [
        {
          connection: {
            displayName: null,
            metadata: {
              keep: "value",
            },
            scopes: ["daily"],
            status: "disconnected",
          },
          connectionId: "conn_123",
          localState: {
            clearError: true,
            lastErrorCode: null,
            lastErrorMessage: "Sync failed",
            lastSyncCompletedAt: null,
            lastSyncErrorAt: "2026-04-07T00:01:00.000Z",
            lastSyncStartedAt: "2026-04-07T00:00:30.000Z",
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          observedTokenVersion: null,
          observedUpdatedAt: null,
          sources: [
            {
              displayName: null,
              firstSeenAt: "2026-04-06T23:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: "2026-04-07T00:00:00.000Z",
              observedLastSeenAt: null,
              resourceAvailabilitySummary: {
                activity: true,
                heartrate: true,
              },
              sourceInstanceKey: "junction_garmin",
              sourceProviderSlug: "garmin",
              status: "connected",
            },
          ],
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-06T23:00:00.000Z",
              createdAt: "2026-04-06T22:00:00.000Z",
              displayName: "Seed User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {
                trace: "seed",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "reauthorization_required",
              updatedAt: "2026-04-06T23:30:00.000Z",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            credential: {
              kind: "none",
              credentialMetadata: {},
            },
          },
          credential: {
            kind: "oauth_tokens",
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
              keyVersion: "kv_2",
              refreshToken: "refresh-token",
              tokenVersion: 5,
            },
          },
        },
      ],
      userId: "user_123",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "missing",
            tokenUpdate: "skipped_version_mismatch",
            writeUpdate: "missing",
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      appliedAt: "2026-04-07T02:00:00.000Z",
      updates: [
        {
          connection: null,
          connectionId: "conn_123",
          status: "missing",
          tokenUpdate: "skipped_version_mismatch",
          writeUpdate: "missing",
        },
      ],
      userId: "user_123",
    });
  });

  it("rejects duplicate connection IDs and mismatched trusted user IDs", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
          },
          {
            connection: {
              status: "active",
            },
            connectionId: "conn_123",
            observedUpdatedAt: null,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/duplicate connectionId conn_123/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest(
        {
          updates: [
            {
              connectionId: "conn_123",
              localState: {
                clearError: true,
              },
              observedUpdatedAt: null,
            },
          ],
          userId: "user_123",
        },
        "trusted_user_456",
      ),
    ).toThrowError(/must match the authenticated hosted execution user/u);
  });

  it("rejects invalid hosted runtime enum and scalar fields", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "broken",
            tokenUpdate: "missing",
            writeUpdate: "missing",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/status is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "missing",
            tokenUpdate: "missing",
            writeUpdate: "legacy_inferred",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/writeUpdate is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connection: {
              status: "broken",
            },
            connectionId: "conn_123",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/connection\.status is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              clearError: "yes",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/clearError must be a boolean/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            observedTokenVersion: 0,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion must be a positive integer/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              clearError: true,
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedUpdatedAt is required when connection or localState mutations are present/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
              keyVersion: "kv_1",
              refreshToken: null,
              tokenVersion: 1,
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/tokenBundle is not supported/u);

    const seed = {
      connection: {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-07T00:00:00.000Z",
        createdAt: "2026-04-07T00:00:00.000Z",
        displayName: "Seed User",
        externalAccountId: "ext_seed",
        id: "conn_seed",
        metadata: {},
        provider: "oura",
        scopes: ["daily"],
        status: "active" as const,
      },
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
      },
      credential: {
        kind: "none" as const,
        credentialMetadata: {},
      },
    };

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_seed",
            seed,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedUpdatedAt is required when connection or localState mutations are present/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_seed",
            observedUpdatedAt: null,
            seed,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion is required when credential mutations are present/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              lastSyncErrorAt: "not-a-timestamp",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/lastSyncErrorAt must be an ISO timestamp/u);
  });

  it("requires explicit writeUpdate values in runtime apply responses", () => {
    expect(parseHostedExecutionDeviceSyncRuntimeApplyResponse({
      appliedAt: "2026-04-07T02:00:00.000Z",
      updates: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Applied",
            externalAccountId: "ext_applied",
            id: "conn_applied",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-07T02:00:00.000Z",
          },
          connectionId: "conn_applied",
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "applied",
        },
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Unchanged",
            externalAccountId: "ext_unchanged",
            id: "conn_unchanged",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-07T01:59:00.000Z",
          },
          connectionId: "conn_unchanged",
          status: "updated",
          tokenUpdate: "unchanged",
          writeUpdate: "unchanged",
        },
        {
          connection: null,
          connectionId: "conn_missing",
          status: "missing",
          tokenUpdate: "missing",
          writeUpdate: "missing",
        },
      ],
      userId: "user_123",
    }).updates).toEqual([
      expect.objectContaining({
        connectionId: "conn_applied",
        writeUpdate: "applied",
      }),
      expect.objectContaining({
        connectionId: "conn_unchanged",
        writeUpdate: "unchanged",
      }),
      expect.objectContaining({
        connectionId: "conn_missing",
        writeUpdate: "missing",
      }),
    ]);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-07T00:00:00.000Z",
              createdAt: "2026-04-07T00:00:00.000Z",
              displayName: "Legacy",
              externalAccountId: "ext_legacy",
              id: "conn_legacy",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-07T02:00:00.000Z",
            },
            connectionId: "conn_legacy",
            status: "updated",
            tokenUpdate: "unchanged",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/writeUpdate must be a non-empty string/u);
  });

  it("normalizes hosted wake helpers without mutating the original hint payload", () => {
    const hint = {
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-07T00:10:00.000Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            objectId: "sleep_123",
          },
          priority: 90,
        },
        {
          kind: "reconcile",
          payload: {
            windowStart: "2026-04-06T00:00:00.000Z",
          },
        },
      ],
    };

    const context = resolveHostedDeviceSyncWakeContext({
      hint,
    });
    const normalized = normalizeHostedDeviceSyncJobHints(hint);

    expect(context).toEqual({
      connectionId: null,
      hint,
      provider: null,
    });
    expect(normalized).toEqual([
      {
        availableAt: "2026-04-07T00:10:00.000Z",
        dedupeKey: null,
        kind: "resource",
        maxAttempts: 3,
        payload: {
          objectId: "sleep_123",
        },
        priority: 90,
      },
      {
        kind: "reconcile",
        payload: {
          windowStart: "2026-04-06T00:00:00.000Z",
        },
      },
    ]);

    normalized[0]?.payload && ((normalized[0].payload.objectId as string) = "changed");

    expect(hint.jobs[0]?.payload).toEqual({
      objectId: "sleep_123",
    });
    expect(normalizeHostedDeviceSyncJobHints(null)).toEqual([]);
  });

  it("parses the hosted wake hint owner shape once", () => {
    const parsed = parseHostedExecutionDeviceSyncWakeHint({
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            dataType: "sleep",
            occurredAt: "2026-04-09T00:00:30Z",
            resource: "glucose",
            resourceCategory: "timeseries",
            resourceId: "sleep_123",
            sourceProviderSlug: "dexcom_v3",
          },
          priority: 10,
        },
      ],
      nextReconcileAt: null,
      occurredAt: "2026-04-09T00:01:00Z",
      reason: "webhook_hint",
      resourceCategory: "sleep",
      revokeWarning: {
        code: "TOKEN_REVOKED",
        message: "Token was revoked.",
      },
      scopes: ["sleep"],
      traceId: "trace-123",
    });

    expect(parsed).toEqual({
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00.000Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            dataType: "sleep",
            occurredAt: "2026-04-09T00:00:30.000Z",
            resource: "glucose",
            resourceCategory: "timeseries",
            resourceId: "sleep_123",
            sourceProviderSlug: "dexcom_v3",
          },
          priority: 10,
        },
      ],
      nextReconcileAt: null,
      occurredAt: "2026-04-09T00:01:00.000Z",
      reason: "webhook_hint",
      resourceCategory: "sleep",
      revokeWarning: {
        code: "TOKEN_REVOKED",
        message: "Token was revoked.",
      },
      scopes: ["sleep"],
      traceId: "trace-123",
    });
  });

  it("feeds the parsed owner shape into job-hint normalization", () => {
    const hint = parseHostedExecutionDeviceSyncWakeHint({
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00Z",
          kind: "resource",
          payload: {
            resource: "activity",
            resourceCategory: "summary",
            resourceId: "abc",
            sourceProviderSlug: "oura",
            windowStart: "2026-04-08T00:00:00Z",
          },
        },
      ],
    });

    expect(normalizeHostedDeviceSyncJobHints(hint)).toEqual([
      {
        availableAt: "2026-04-09T00:00:00.000Z",
        kind: "resource",
        payload: {
          resource: "activity",
          resourceCategory: "summary",
          resourceId: "abc",
          sourceProviderSlug: "oura",
          windowStart: "2026-04-08T00:00:00.000Z",
        },
      },
    ]);
  });

  it("drops empty string payload fields from hosted wake job hints", () => {
    const hint = parseHostedExecutionDeviceSyncWakeHint({
      jobs: [
        {
          kind: "resource",
          payload: {
            objectId: "",
            resource: "heartrate",
            resourceCategory: "timeseries",
            sourceProviderSlug: "",
            windowStart: "2026-04-08T00:00:00Z",
          },
        },
      ],
    });

    expect(hint?.jobs?.[0]?.payload).toEqual({
      resource: "heartrate",
      resourceCategory: "timeseries",
      windowStart: "2026-04-08T00:00:00.000Z",
    });
  });

  it("rejects invalid hosted wake job payloads, payload keys, and schedule timestamps", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            kind: "resource",
            payload: ["not", "an", "object"],
          },
        ],
      })
    ).toThrow(/payload/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            kind: "resource",
            payload: {
              refreshToken: "secret",
            },
          },
        ],
      }),
    ).toThrow(/payload\.refreshToken is not supported/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        nextReconcileAt: "tomorrow",
      }),
    ).toThrow(/nextReconcileAt must be an ISO timestamp/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        nextReconcileAt: "2026-04-09T00:00:00.000+25:00",
      }),
    ).toThrow(/nextReconcileAt must be an ISO timestamp/i);

    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            availableAt: "not-a-timestamp",
            kind: "resource",
          },
        ],
      }),
    ).toThrow(/availableAt must be an ISO timestamp/i);
  });
});
