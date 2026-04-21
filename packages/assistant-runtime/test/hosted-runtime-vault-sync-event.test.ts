import assert from "node:assert/strict";

import { describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  decodeHostedBundleBase64: vi.fn(),
  mergeVaultSyncImportIntoVault: vi.fn(),
  restoreVaultSyncImportPack: vi.fn(),
}));

vi.mock("@murphai/core", () => ({
  mergeVaultSyncImportIntoVault: mocks.mergeVaultSyncImportIntoVault,
  restoreVaultSyncImportPack: mocks.restoreVaultSyncImportPack,
}));

vi.mock("@murphai/runtime-state/node", () => ({
  decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
}));

import { handleHostedVaultSyncImportWake } from "../src/hosted-runtime/events/vault-sync.ts";

describe("handleHostedVaultSyncImportWake", () => {
  it("restores the hydrated import pack and returns redacted merge metrics", async () => {
    const wake = buildHostedExecutionVaultSyncImportWake({
      eventId: "evt_vault_sync",
      memberId: "member_123",
      occurredAt: "2026-04-21T00:00:00.000Z",
      vaultSync: {
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
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
    mocks.mergeVaultSyncImportIntoVault.mockResolvedValue(mergeResult);

    const result = await handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
        sourceVaultId: "vault_local",
        sourceVaultTitle: "Local Vault",
      },
      wake,
    });

    expect(mocks.restoreVaultSyncImportPack).toHaveBeenCalledWith({
      bundle,
      workspaceRoot: expect.stringContaining("murph-hosted-vault-sync-import-"),
    });
    expect(mocks.mergeVaultSyncImportIntoVault).toHaveBeenCalledWith({
      importMetaRoot: "/tmp/import/meta",
      importVaultRoot: "/tmp/import/vault",
      sessionId: "vsi_runtime",
      targetVaultRoot: "/tmp/target-vault",
    });
    assert.deepEqual(result, {
      conversationMetrics: null,
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: mergeResult,
    });
  });

  it("rejects mismatched session references", async () => {
    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_payload",
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          sessionId: "vsi_wake",
        },
      }),
    })).rejects.toThrow(/sessionId must match/u);
  });

  it("rejects missing or mismatched side-input metadata and empty bundles", async () => {
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
          localManifestHash: "sha256:wake",
          sessionId: "vsi_runtime",
        },
      }),
    })).rejects.toThrow(/manifest hash must match/u);

    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        localManifestHash: "sha256:payload",
        sessionId: "vsi_runtime",
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:wake",
          sessionId: "vsi_runtime",
        },
      }),
    })).rejects.toThrow(/manifest hash must match/u);

    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
        sourceVaultId: "vault_payload",
      },
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId: "evt_vault_sync",
        memberId: "member_123",
        occurredAt: "2026-04-21T00:00:00.000Z",
        vaultSync: {
          localManifestHash: "sha256:manifest",
          sessionId: "vsi_runtime",
          sourceVaultId: "vault_wake",
        },
      }),
    })).rejects.toThrow(/source vault id must match/u);

    mocks.decodeHostedBundleBase64.mockReturnValue(new Uint8Array());
    await expect(handleHostedVaultSyncImportWake({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "",
        localManifestHash: "sha256:manifest",
        sessionId: "vsi_runtime",
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
    })).rejects.toThrow(/requires a non-empty import bundle/u);
  });
});
