import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";

const VAULT_SCHEMA_VERSION = "murph.vault.v1";

const mocks = vi.hoisted(() => ({
  decodeHostedBundleBase64: vi.fn(),
  mergeVaultSyncImportIntoVault: vi.fn(),
  readVaultSyncImportManifest: vi.fn(),
  restoreVaultSyncImportPack: vi.fn(),
}));

vi.mock("@murphai/core", () => ({
  VAULT_SCHEMA_VERSION: "murph.vault.v1",
  mergeVaultSyncImportIntoVault: mocks.mergeVaultSyncImportIntoVault,
  readVaultSyncImportManifest: mocks.readVaultSyncImportManifest,
  restoreVaultSyncImportPack: mocks.restoreVaultSyncImportPack,
}));

vi.mock("@murphai/runtime-state/node", () => ({
  decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
}));

import { handleHostedVaultSyncImportWake } from "../src/hosted-runtime/events/vault-sync.ts";

describe("handleHostedVaultSyncImportWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the hydrated import pack and returns redacted merge metrics", async () => {
    const wake = buildHostedExecutionVaultSyncImportWake({
      eventId: "evt_vault_sync",
      memberId: "member_123",
      occurredAt: "2026-04-21T00:00:00.000Z",
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
        sourceVaultId: "vault_local",
        sourceVaultTitle: "Local Vault",
      },
    });
    const bundle = new Uint8Array([1, 2, 3]);
    const mergeResult = {
      conflictManifestPath: null,
      conflicts: [],
      imported: {
        jsonlRecords: 1,
        rawFiles: 0,
        textFiles: 0,
      },
      sessionId: "vsi_runtime",
      skipped: {
        duplicates: 0,
        excludedFiles: 2,
      },
    };
    mocks.decodeHostedBundleBase64.mockReturnValue(bundle);
    mocks.restoreVaultSyncImportPack.mockResolvedValue({
      metaRoot: "/tmp/import/meta",
      vaultRoot: "/tmp/import/vault",
      workspaceRoot: "/tmp/import",
    });
    mocks.readVaultSyncImportManifest.mockResolvedValue({
      manifestHash: "sha256:manifest",
      sourceVault: {
        schemaVersion: VAULT_SCHEMA_VERSION,
        title: "Local Vault",
        vaultId: "vault_local",
      },
    });
    mocks.mergeVaultSyncImportIntoVault.mockResolvedValue(mergeResult);

    const result = await handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
      },
      wake,
    });

    expect(mocks.restoreVaultSyncImportPack).toHaveBeenCalledWith({
      bundle,
      workspaceRoot: expect.stringContaining("murph-hosted-vault-sync-import-"),
    });
    expect(mocks.readVaultSyncImportManifest).toHaveBeenCalledWith("/tmp/import/meta");
    expect(mocks.mergeVaultSyncImportIntoVault).toHaveBeenCalledWith({
      importMetaRoot: "/tmp/import/meta",
      importVaultRoot: "/tmp/import/vault",
      sessionId: "vsi_runtime",
      targetVaultRoot: "/tmp/target-vault",
    });
    assert.deepEqual(result, {
      conversationMetrics: null,
      vaultSyncImportResult: mergeResult,
    });
  });

  it("rejects mismatched session references", async () => {
    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_payload",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_wake",
          sourceSchemaVersion: VAULT_SCHEMA_VERSION,
        },
      }),
    })).rejects.toThrow(/sessionId must match/u);
  });

  it("rejects mismatched bundle-derived metadata and empty bundles", async () => {
    const bundle = new Uint8Array([1, 2, 3]);
    mocks.decodeHostedBundleBase64.mockReturnValue(bundle);
    mocks.restoreVaultSyncImportPack.mockResolvedValue({
      metaRoot: "/tmp/import/meta",
      vaultRoot: "/tmp/import/vault",
      workspaceRoot: "/tmp/import",
    });
    mocks.readVaultSyncImportManifest.mockResolvedValueOnce({
      manifestHash: "sha256:payload",
      sourceVault: {
        schemaVersion: VAULT_SCHEMA_VERSION,
        title: null,
        vaultId: null,
      },
    });

    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:wake",
          sessionId: "vsi_runtime",
          sourceSchemaVersion: VAULT_SCHEMA_VERSION,
        },
      }),
    })).rejects.toThrow(/manifest hash must match/u);

    mocks.readVaultSyncImportManifest.mockResolvedValueOnce({
      manifestHash: "sha256:manifest",
      sourceVault: {
        schemaVersion: VAULT_SCHEMA_VERSION,
        title: null,
        vaultId: "vault_payload",
      },
    });
    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_runtime",
          sourceSchemaVersion: VAULT_SCHEMA_VERSION,
          sourceVaultId: "vault_wake",
        },
      }),
    })).rejects.toThrow(/source vault id must match/u);

    mocks.decodeHostedBundleBase64.mockReturnValue(new Uint8Array());
    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_runtime",
          sourceSchemaVersion: VAULT_SCHEMA_VERSION,
        },
      }),
    })).rejects.toThrow(/requires a non-empty import bundle/u);
  });

  it("rejects missing or unsupported source schema versions before restore", async () => {
    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_runtime",
        },
      }),
    })).rejects.toThrow(/canonical wake reference source schema version is required/u);

    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_runtime",
          sourceSchemaVersion: VAULT_SCHEMA_VERSION,
        },
      }),
    })).rejects.toThrow(/side-input payload source schema version is required/u);

    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: "murph.vault.v0",
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_runtime",
          sourceSchemaVersion: VAULT_SCHEMA_VERSION,
        },
      }),
    })).rejects.toThrow(/side-input payload source schema version must be/u);

    expect(mocks.restoreVaultSyncImportPack).not.toHaveBeenCalled();
    expect(mocks.readVaultSyncImportManifest).not.toHaveBeenCalled();
    expect(mocks.mergeVaultSyncImportIntoVault).not.toHaveBeenCalled();
  });

  it("rejects unsupported manifest source schema versions before merge", async () => {
    const bundle = new Uint8Array([1, 2, 3]);
    mocks.decodeHostedBundleBase64.mockReturnValue(bundle);
    mocks.restoreVaultSyncImportPack.mockResolvedValue({
      metaRoot: "/tmp/import/meta",
      vaultRoot: "/tmp/import/vault",
      workspaceRoot: "/tmp/import",
    });
    mocks.readVaultSyncImportManifest.mockResolvedValueOnce({
      manifestHash: "sha256:manifest",
      sourceVault: {
        schemaVersion: "murph.vault.v-next",
        title: null,
        vaultId: null,
      },
    });

    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: VAULT_SCHEMA_VERSION,
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_runtime",
          sourceSchemaVersion: VAULT_SCHEMA_VERSION,
        },
      }),
    })).rejects.toThrow(/restored import manifest source schema version must be/u);

    expect(mocks.mergeVaultSyncImportIntoVault).not.toHaveBeenCalled();
  });
});
