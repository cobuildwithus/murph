import { beforeEach, describe, expect, it, vi } from "vitest";

const secureBoxMocks = vi.hoisted(() => ({
  openOne: vi.fn(),
  openMany: vi.fn(),
  sealOne: vi.fn(),
  sealMany: vi.fn(),
}));

vi.mock("../src/lib/hosted-crypto/secure-box", () => ({
  openHostedUserSecureBoxString: secureBoxMocks.openOne,
  openHostedUserSecureBoxStrings: secureBoxMocks.openMany,
  sealHostedUserSecureBoxString: secureBoxMocks.sealOne,
  sealHostedUserSecureBoxStrings: secureBoxMocks.sealMany,
}));

vi.mock("@murphai/runtime-state", () => ({
  parseSerializedHostedSecureBoxEnvelope: (value: string) => ({
    rootKeyId: value.split(":")[1],
  }),
}));

import {
  prepareHostedRuntimeApplyTokenWrites,
  readHostedRuntimeApplyConnectionSecretMaterial,
} from "../src/lib/device-sync/prisma-store/connection-secrets";
import type { HostedConnectionRecord } from "../src/lib/device-sync/prisma-store/connection-records";

let transactionActive = false;

beforeEach(() => {
  transactionActive = false;
  secureBoxMocks.openOne.mockReset();
  secureBoxMocks.openMany.mockReset();
  secureBoxMocks.sealOne.mockReset();
  secureBoxMocks.sealMany.mockReset();

  secureBoxMocks.openMany.mockImplementation(async (input: {
    entries: ReadonlyArray<{ value: string | null | undefined }>;
  }) => {
    expect(transactionActive).toBe(false);
    return input.entries.map((entry) =>
      entry.value ? `plain:${entry.value}` : null
    );
  });
  secureBoxMocks.sealMany.mockImplementation(async (input: {
    entries: ReadonlyArray<{ value: string }>;
    lane: string;
  }) => {
    expect(transactionActive).toBe(false);
    return input.entries.map(
      (entry, index) => `sealed:device-root-active:${input.lane}:${index}:${entry.value}`,
    );
  });
});

describe("device-sync runtime apply secret preparation", () => {
  it("batches the N=100 no-op authority read into two historical-root owners", async () => {
    const records = Array.from({ length: 100 }, (_, index) =>
      buildHostedConnectionRecord(index));

    const material = await readHostedRuntimeApplyConnectionSecretMaterial({
      records,
    });

    expect(material.size).toBe(100);
    expect(secureBoxMocks.openMany).toHaveBeenCalledTimes(2);
    expect(secureBoxMocks.openOne).not.toHaveBeenCalled();

    const externalEntries = secureBoxMocks.openMany.mock.calls[0]![0].entries;
    const tokenEntries = secureBoxMocks.openMany.mock.calls[1]![0].entries;
    expect(externalEntries).toHaveLength(100);
    expect(tokenEntries).toHaveLength(200);
    const historicalRootReferences = new Set([
      ...externalEntries.map((entry: { value: string }) => entry.value),
      ...tokenEntries.map((entry: { value: string }) => entry.value),
    ]);
    expect(historicalRootReferences.size).toBe(300);
    expect(material.get("conn_000")).toEqual({
      externalAccountId: "plain:external:root-external-000",
      tokenBundle: {
        accessToken: "plain:access:root-access-000",
        accessTokenExpiresAt: "2026-04-07T00:00:00.000Z",
        keyVersion: "hosted-device-secure-box:v1",
        refreshToken: "plain:refresh:root-refresh-000",
        tokenVersion: 3,
      },
    });
  });

  it("preseals an N=100 token incident through two set seal calls before BEGIN", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => {
      const record = buildHostedConnectionRecord(index);
      return {
        externalAccountId: `account-${index}`,
        record,
        tokenBundle: {
          accessToken: `new-access-${index}`,
          accessTokenExpiresAt: "2026-04-08T00:00:00.000Z",
          keyVersion: "runtime-key-version-is-not-storage-authority",
          refreshToken: `new-refresh-${index}`,
          tokenVersion: 4,
        },
      };
    });

    const prepared = await prepareHostedRuntimeApplyTokenWrites({ entries });

    expect(prepared.size).toBe(100);
    expect(secureBoxMocks.sealMany).toHaveBeenCalledTimes(2);
    expect(secureBoxMocks.sealOne).not.toHaveBeenCalled();
    expect(secureBoxMocks.sealMany.mock.calls[0]?.[0].entries).toHaveLength(100);
    expect(secureBoxMocks.sealMany.mock.calls[1]?.[0].entries).toHaveLength(200);
    expect(
      secureBoxMocks.sealMany.mock.calls.reduce(
        (count, [call]) => count + call.entries.length,
        0,
      ),
    ).toBe(300);
    expect([...prepared.values()].every((entry) =>
      entry.rootKeyId === "device-root-active"
      && entry.keyVersion === "hosted-device-secure-box:v1"
      && entry.tokenVersion === 4
    )).toBe(true);
  });
});

function buildHostedConnectionRecord(index: number): HostedConnectionRecord {
  const suffix = String(index).padStart(3, "0");
  return {
    accessTokenEncrypted: `access:root-access-${suffix}`,
    accessTokenExpiresAt: new Date("2026-04-07T00:00:00.000Z"),
    connectedAt: new Date("2026-04-06T09:00:00.000Z"),
    createdAt: new Date("2026-04-06T09:00:00.000Z"),
    credentialKind: "oauth_tokens",
    credentialMetadataJson: {},
    displayName: `Device ${suffix}`,
    externalAccountIdEncrypted: `external:root-external-${suffix}`,
    id: `conn_${suffix}`,
    keyVersion: "hosted-device-secure-box:v1",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadataJson: {},
    nextReconcileAt: null,
    provider: "oura",
    providerAccountBlindIndex: `blind-${suffix}`,
    providerApplicationId: null,
    providerApplicationRevision: null,
    providerConfigKey: null,
    refreshLeaseExpiresAt: null,
    refreshLeaseOwner: null,
    refreshLeaseTokenVersion: null,
    refreshTokenEncrypted: `refresh:root-refresh-${suffix}`,
    scopesJson: [],
    setupExpiresAt: null,
    setupPhase: null,
    status: "active",
    tokenVersion: 3,
    updatedAt: new Date("2026-04-06T10:00:00.000Z"),
    userId: "user_123",
  };
}
