import { describe, expect, it } from "vitest";

import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-ingress";
import {
  DEVICE_SYNC_METADATA_DELETE,
  mergeStoredDeviceSyncMetadataPatch,
} from "../src/shared.ts";

describe("sanitizeStoredDeviceSyncMetadata", () => {
  it("drops secret-like keys before connection metadata is persisted or mirrored", () => {
    expect(
      sanitizeStoredDeviceSyncMetadata({
        syncMode: "polling",
        accessToken: "access-token",
        refresh_token: "refresh-token",
        authHeader: "Bearer auth-token",
        authorization: "Bearer secret",
        clientSecret: "client-secret",
        credential: "credential-material",
        apiKey: "api-key",
        session: "session",
        sessionHandle: "session-handle",
        sessionId: "session-id",
        sessionHash: "session-hash",
        sessionKey: "session-key",
        webhookSecret: "webhook-secret",
        webhookSignature: "webhook-signature",
        hmacSecret: "hmac-secret",
        secret: "generic-secret",
        token: "generic-token",
        accessTokenHash: "token-hash",
        passwordHash: "password-hash",
        sessionIdHash: "session-hash",
        account: "raw-account",
        accountHashedId: "raw-account-id",
        accountIdentifier: "raw-account-identifier",
        athleteId: "athlete-id",
        client: "raw-client",
        external: "raw-external",
        externalAccount: "raw-external-account",
        externalAccountId: "external-account-id",
        externalAccountRawId: "raw-external-account-id",
        externalIdentifier: "raw-external-identifier",
        member: "raw-member",
        memberIdentifier: "raw-member-identifier",
        memberId: "member-id",
        owner: "raw-owner",
        ownerIdentifier: "raw-owner-identifier",
        profile: "raw-profile",
        profileIdentifier: "raw-profile-identifier",
        profileId: "profile-id",
        providerAccount: "raw-provider-account",
        providerAccountHashIdentifier: "raw-provider-account-identifier",
        providerAccountIdentifier: "raw-provider-account-identifier",
        providerConnectionId: "provider-connection-id",
        subject: "raw-subject",
        subjectIdentifier: "raw-subject-identifier",
        sourceInstanceId: "source-instance-id",
        sourceId: "source-id",
        subjectId: "subject-id",
        user: "raw-user",
        userHashId: "raw-user-id",
        userIdentifier: "raw-user-identifier",
        ownerId: "owner-id",
        userId: "user-id",
        deviceId: "device-id",
        id: "raw-id",
        hashlessUserId: "raw-user-id",
        hashedExternalAccountId: "hash-ok",
        ownerBlindIndex: "blind-index-ok",
        sourceIdHash: "source-hash-ok",
        unhashedExternalAccountId: "raw-account-id",
      }),
    ).toEqual({
      hashedExternalAccountId: "hash-ok",
      ownerBlindIndex: "blind-index-ok",
      sourceIdHash: "source-hash-ok",
      syncMode: "polling",
    });
  });
});

describe("mergeStoredDeviceSyncMetadataPatch", () => {
  it("keeps patch keys when existing metadata is already capped", () => {
    const existing = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`existing${index}`, `value-${index}`]),
    );

    const merged = mergeStoredDeviceSyncMetadataPatch(existing, {
      retryStatus: "retrying",
      retryAttempts: 1,
    });

    expect(merged).toMatchObject({
      retryAttempts: 1,
      retryStatus: "retrying",
    });
    expect(Object.keys(merged)).toHaveLength(16);
    expect(merged.existing0).toBe("value-0");
    expect(merged.existing14).toBeUndefined();
    expect(merged.existing15).toBeUndefined();
  });

  it("lets patch keys override existing values", () => {
    expect(
      mergeStoredDeviceSyncMetadataPatch(
        { retryStatus: "retrying", source: "initial" },
        { retryStatus: "complete" },
      ),
    ).toEqual({
      retryStatus: "complete",
      source: "initial",
    });
  });

  it("uses null as the supported clearing tombstone", () => {
    expect(
      mergeStoredDeviceSyncMetadataPatch(
        { retryStatus: "retrying", retryLastEmptyAt: "2026-04-02T00:00:00.000Z" },
        { retryLastEmptyAt: null },
      ),
    ).toEqual({
      retryLastEmptyAt: null,
      retryStatus: "retrying",
    });
  });

  it("deletes only keys carrying the explicit patch instruction", () => {
    expect(
      mergeStoredDeviceSyncMetadataPatch(
        { legacyCoverage: "v1|garmin", nullableStatus: "pending", retained: true },
        {
          legacyCoverage: DEVICE_SYNC_METADATA_DELETE,
          nullableStatus: null,
        },
      ),
    ).toEqual({
      nullableStatus: null,
      retained: true,
    });
  });

  it("ignores undefined patch values and retains existing metadata", () => {
    expect(
      mergeStoredDeviceSyncMetadataPatch(
        { retryAttempts: 3, retryStatus: "retrying" },
        { retryAttempts: undefined },
      ),
    ).toEqual({
      retryStatus: "retrying",
      retryAttempts: 3,
    });
  });

  it("drops secret-like and raw identifier patch keys before merging", () => {
    expect(
      mergeStoredDeviceSyncMetadataPatch(
        { retryStatus: "retrying" },
        {
          externalAccountId: "external-account-id",
          hmacSecret: "hmac-secret",
          providerConnectionId: "provider-connection-id",
          sourceId: "source-id",
          token: "generic-token",
          webhookSecret: "webhook-secret",
        },
      ),
    ).toEqual({
      retryStatus: "retrying",
    });
  });
});
