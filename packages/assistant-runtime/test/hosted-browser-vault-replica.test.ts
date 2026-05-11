import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostedCanonicalWriteReceipt,
  HostedCanonicalWriteReceiptAction,
  HostedCanonicalWriteReceiptContentRef,
} from "@murphai/core";

vi.unmock("@murphai/contracts");
vi.unmock("@murphai/query");
vi.unmock("@murphai/query/browser");
vi.unmock("@murphai/runtime-state/node");

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@murphai/contracts");
  vi.doUnmock("@murphai/query");
  vi.doUnmock("@murphai/query/browser");
  vi.doUnmock("@murphai/runtime-state/node");
});

describe("hosted browser-vault replica refresh preparation", () => {
  it("summarizes restored canonical source separately from default metric selection rows", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const { listCanonicalSourceManifest } = await import("@murphai/query");
    const {
      createHostedBrowserVaultReplicaRefreshFromWorkspace,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const experimentPath = path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md");
    try {
      await writeVaultFile(vaultRoot, experimentPath, [
        "---",
        "experimentId: exp_trial",
        "slug: trial",
        "title: Private Trial",
        "status: active",
        "startedOn: 2026-05-01",
        "---",
        "# Private Trial",
        "",
        "Private browser-vault content.",
        "",
      ].join("\n"));

      const directManifest = await listCanonicalSourceManifest(vaultRoot);
      expect(directManifest.map((entry) => entry.relativePath)).toEqual([experimentPath]);

      const prepared = await createHostedBrowserVaultReplicaRefreshFromWorkspace({
        generatedAt: "2026-05-10T00:00:00.000Z",
        platform: createPlatform(),
        sourceStateHash: "a".repeat(64),
        vaultRoot,
        workspace: null,
      });

      expect(prepared.source.fileCount).toBe(1);
      expect(prepared.source.totalBytes).toBeGreaterThan(0);
      expect(prepared.content.entities).toBe(1);
      expect(prepared.content.searchRows).toBe(1);
      expect(prepared.content.metricSelectionRows).toBeGreaterThan(0);
      expect(prepared.content.hasPrivateContent).toBe(true);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(`${vaultRoot}-operator-home`, { force: true, recursive: true });
    }
  });

  it("marks refresh dirty only for query-source canonical write receipt actions", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const {
      markHostedBrowserVaultRefreshDirtyForReceiptBestEffort,
      readHostedBrowserVaultRefreshState,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-dirty-"));
    try {
      await markHostedBrowserVaultRefreshDirtyForReceiptBestEffort({
        now: () => "2026-05-10T00:00:00.000Z",
        receipt: createReceipt([{
          kind: "raw_upsert",
          targetRelativePath: "raw/documents/2026/05/doc/file.pdf",
          byteLength: 12,
          effect: "copy",
          mediaType: "application/pdf",
          originalFileName: "file.pdf",
          sha256: "b".repeat(64),
          contentRef: createContentRef(),
        }]),
        vaultRoot,
      });
      expect((await readHostedBrowserVaultRefreshState({ vaultRoot })).dirty).toBe(false);

      await markHostedBrowserVaultRefreshDirtyForReceiptBestEffort({
        now: () => "2026-05-10T00:01:00.000Z",
        receipt: createReceipt([{
          kind: "text_upsert",
          targetRelativePath: VAULT_LAYOUT.coreDocument,
          byteLength: 12,
          effect: "reuse",
          sha256: "c".repeat(64),
          contentRef: createContentRef(),
        }]),
        vaultRoot,
      });
      expect((await readHostedBrowserVaultRefreshState({ vaultRoot })).dirty).toBe(false);

      await markHostedBrowserVaultRefreshDirtyForReceiptBestEffort({
        now: () => "2026-05-10T00:02:00.000Z",
        receipt: createReceipt([{
          kind: "jsonl_append",
          targetRelativePath: path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "2026-05.jsonl"),
          appendByteLength: 12,
          appendSha256: "d".repeat(64),
          baseByteLength: 0,
          baseSha256: "0".repeat(64),
          contentRef: createContentRef(),
          originalSize: 0,
        }]),
        vaultRoot,
      });
      let state = await readHostedBrowserVaultRefreshState({ vaultRoot });
      expect(state.dirty).toBe(true);
      expect(state.dirtyReason).toBe("query_source_changed");

      await markHostedBrowserVaultRefreshDirtyForReceiptBestEffort({
        now: () => "2026-05-10T00:03:00.000Z",
        receipt: createReceipt([{
          kind: "delete",
          targetRelativePath: VAULT_LAYOUT.coreDocument,
          existedBefore: true,
        }]),
        vaultRoot,
      });
      state = await readHostedBrowserVaultRefreshState({ vaultRoot });
      expect(state.dirtyReason).toBe("query_source_deleted");
      expect(state.dirtySince).toBe("2026-05-10T00:02:00.000Z");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});

function createReceipt(actions: HostedCanonicalWriteReceiptAction[]): HostedCanonicalWriteReceipt {
  return {
    schema: "murph.hosted-canonical-write-receipt.v1",
    operationId: "op_browser_vault_dirty",
    operationType: "test",
    summary: "test",
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    occurredAt: "2026-05-10T00:00:00.000Z",
    committedAt: "2026-05-10T00:00:00.000Z",
    actions,
  };
}

function createContentRef(): HostedCanonicalWriteReceiptContentRef {
  return {
    byteSize: 12,
    sha256: "a".repeat(64),
  };
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const filePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function createPlatform() {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
    workspacePort: {
      async checkpoint() {
        throw new Error("Browser-vault refresh preparation must not checkpoint.");
      },
    },
  };
}
