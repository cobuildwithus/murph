import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";

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

  it("publishes an empty current replica instead of leaving stale data visible", async () => {
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const workspace = createWorkspaceState({
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-10T00:00:00.000Z",
    });
    const publishRef = vi.fn(async (input: { replicaRef: HostedBrowserVaultReplicaRef }) => ({
      published: true,
      workspace: {
        ...workspace,
        browserVaultReplicaRef: input.replicaRef,
      },
    }));
    const write = vi.fn(async (input: { replica: unknown }) =>
      createReplicaRefFromReplica(input.replica)
    );

    try {
      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        generatedAt: "2026-05-10T00:01:00.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        vaultRoot,
        workspace,
      });

      expect(result).toMatchObject({
        status: "published",
        source: {
          fileCount: 0,
          totalBytes: 0,
        },
      });
      expect(write).toHaveBeenCalledOnce();
      expect(publishRef).toHaveBeenCalledOnce();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not publish when a runtime wake arrives during refresh", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const {
      createCoalescingRuntimeWakeSignal,
    } = await import("../src/hosted-runtime/runtime-wake.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const workspace = createWorkspaceState({
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-10T00:00:00.000Z",
    });
    const publishRef = vi.fn(async (input: { replicaRef: HostedBrowserVaultReplicaRef }) => ({
      published: true,
      workspace: {
        ...workspace,
        browserVaultReplicaRef: input.replicaRef,
      },
    }));
    const write = vi.fn(async (input: { replica: unknown }) => {
      runtimeWakeSignal.notify();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createReplicaRefFromReplica(input.replica);
    });

    try {
      await writeVaultFile(
        vaultRoot,
        path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md"),
        "---\nexperimentId: exp_trial\nslug: trial\nstatus: active\n---\n# Trial\n",
      );
      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        generatedAt: "2026-05-10T00:01:00.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        runtimeWakeSignal,
        vaultRoot,
        workspace,
      });

      expect(result).toMatchObject({
        status: "deferred_runtime_wake",
      });
      expect(write).toHaveBeenCalledOnce();
      expect(publishRef).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("aborts publish when a runtime wake arrives during publish", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const {
      createCoalescingRuntimeWakeSignal,
    } = await import("../src/hosted-runtime/runtime-wake.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const workspace = createWorkspaceState({
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-10T00:00:00.000Z",
    });
    const publishCommitted = vi.fn();
    const publishRef = vi.fn(async (input: {
      replicaRef: HostedBrowserVaultReplicaRef;
      signal?: AbortSignal | null;
    }) => {
      runtimeWakeSignal.notify();
      await new Promise<void>((resolve) => {
        if (input.signal?.aborted) {
          resolve();
          return;
        }
        input.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      if (!input.signal?.aborted) {
        publishCommitted();
      }
      return {
        published: true,
        workspace: {
          ...workspace,
          browserVaultReplicaRef: input.replicaRef,
        },
      };
    });
    const write = vi.fn(async (input: { replica: unknown }) =>
      createReplicaRefFromReplica(input.replica)
    );

    try {
      await writeVaultFile(
        vaultRoot,
        path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md"),
        "---\nexperimentId: exp_trial\nslug: trial\nstatus: active\n---\n# Trial\n",
      );
      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        generatedAt: "2026-05-10T00:01:00.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        runtimeWakeSignal,
        vaultRoot,
        workspace,
      });

      expect(result).toMatchObject({
        status: "deferred_runtime_wake",
      });
      expect(write).toHaveBeenCalledOnce();
      expect(publishRef).toHaveBeenCalledOnce();
      expect(publishCommitted).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const filePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function createPlatform(
  overrides: Partial<HostedRuntimePlatform> = {},
): HostedRuntimePlatform {
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
    ...overrides,
  };
}

function createWorkspaceState(
  overrides: Partial<HostedWorkspaceState> = {},
): HostedWorkspaceState {
  return {
    checkpointedAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: "2026-05-10T00:00:00.000Z",
    userId: "member_123",
    version: "1",
    ...overrides,
  };
}

function createReplicaRefFromReplica(replica: unknown): HostedBrowserVaultReplicaRef {
  const record = requireRecord(replica, "replica");
  const source = requireRecord(record.source, "replica.source");
  const sourceBundleHash = requireString(source.sourceBundleHash, "replica.source.sourceBundleHash");
  const dataVersion = requireString(source.dataVersion, "replica.source.dataVersion");
  const generatedAt = requireString(record.generatedAt, "replica.generatedAt");
  const byteLength = new TextEncoder().encode(JSON.stringify(replica)).byteLength;

  return {
    byteLength,
    dataVersion,
    generatedAt,
    keyId: `browser-vault-replica:${dataVersion.slice(0, 12)}`,
    objectKey: `users/browser-vault-replicas/member_123/${dataVersion}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}
