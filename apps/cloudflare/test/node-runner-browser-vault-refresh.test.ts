import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createReplica: vi.fn(),
  measureReplicaBytes: vi.fn((replica: unknown) => JSON.stringify(replica).length),
  readWarmSourceStateHash: vi.fn(),
  restoreWorkspace: vi.fn(),
  warmVaultRoot: vi.fn(),
  workspaceRead: vi.fn(),
  writeReplica: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-runtime")>(
    "@murphai/assistant-runtime",
  );

  return {
    ...actual,
    createHostedBrowserVaultReplicaForSourceState: mocks.createReplica,
    readHostedBrowserVaultWarmSourceStateHash: mocks.readWarmSourceStateHash,
    restoreHostedWorkspaceRuntimeJobWorkspace: mocks.restoreWorkspace,
  };
});

vi.mock("../src/node-runner-isolated.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/node-runner-isolated.ts")>(
    "../src/node-runner-isolated.ts",
  );

  return {
    ...actual,
    resolveHostedRunnerWarmWorkspaceVaultRoot: mocks.warmVaultRoot,
  };
});

vi.mock("../src/browser-vault-limits.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/browser-vault-limits.ts")>(
    "../src/browser-vault-limits.ts",
  );

  return {
    ...actual,
    HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES: 256,
    measureHostedBrowserVaultReplicaBytes: mocks.measureReplicaBytes,
  };
});

vi.mock("../src/runtime-platform.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime-platform.ts")>(
    "../src/runtime-platform.ts",
  );

  return {
    ...actual,
    buildHostedExecutionRuntimePlatform: vi.fn(() => ({
      browserVaultReplicaPort: {
        write: mocks.writeReplica,
      },
      workspacePort: {
        read: mocks.workspaceRead,
      },
    })),
  };
});

describe("refreshHostedBrowserVaultReplica", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates from the warm vault when its source-state marker matches", async () => {
    const sourceStateHash = "a".repeat(64);
    mocks.workspaceRead.mockResolvedValue({
      workspace: createWorkspace(sourceStateHash),
    });
    mocks.warmVaultRoot.mockReturnValue("/warm/vault");
    mocks.readWarmSourceStateHash.mockResolvedValue(sourceStateHash);
    mocks.createReplica.mockResolvedValue(createReplica(sourceStateHash));
    mocks.writeReplica.mockResolvedValue(createReplicaRef(sourceStateHash));

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      sourceStateHash,
      userId: "member_123",
    });

    expect(result).toMatchObject({
      replicaRef: createReplicaRef(sourceStateHash),
      status: "written",
    });
    expect(mocks.createReplica).toHaveBeenCalledWith(expect.objectContaining({
      sourceStateHash,
      vaultRoot: "/warm/vault",
    }));
    expect(mocks.restoreWorkspace).not.toHaveBeenCalled();
  });

  it("falls back to cold restore when the warm marker does not match", async () => {
    const sourceStateHash = "b".repeat(64);
    mocks.workspaceRead.mockResolvedValue({
      workspace: createWorkspace(sourceStateHash),
    });
    mocks.warmVaultRoot.mockReturnValue("/warm/vault");
    mocks.readWarmSourceStateHash.mockResolvedValue("c".repeat(64));
    mocks.restoreWorkspace.mockResolvedValue({
      vaultRoot: "/restored/vault",
    });
    mocks.createReplica.mockResolvedValue(createReplica(sourceStateHash));
    mocks.writeReplica.mockResolvedValue(createReplicaRef(sourceStateHash));

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      sourceStateHash,
      userId: "member_123",
    });

    expect(result).toMatchObject({
      replicaRef: createReplicaRef(sourceStateHash),
      status: "written",
    });
    expect(mocks.restoreWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.createReplica).toHaveBeenCalledWith(expect.objectContaining({
      sourceStateHash,
      vaultRoot: "/restored/vault",
    }));
  });

  it("falls back to cold restore when warm replica generation fails", async () => {
    const sourceStateHash = "d".repeat(64);
    mocks.workspaceRead.mockResolvedValue({
      workspace: createWorkspace(sourceStateHash),
    });
    mocks.warmVaultRoot.mockReturnValue("/warm/vault");
    mocks.readWarmSourceStateHash.mockResolvedValue(sourceStateHash);
    mocks.restoreWorkspace.mockResolvedValue({
      vaultRoot: "/restored/vault",
    });
    mocks.createReplica
      .mockRejectedValueOnce(new Error("warm vault unavailable"))
      .mockResolvedValueOnce(createReplica(sourceStateHash));
    mocks.writeReplica.mockResolvedValue(createReplicaRef(sourceStateHash));

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      sourceStateHash,
      userId: "member_123",
    });

    expect(result).toMatchObject({
      replicaRef: createReplicaRef(sourceStateHash),
      status: "written",
    });
    expect(mocks.restoreWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.createReplica).toHaveBeenNthCalledWith(1, expect.objectContaining({
      vaultRoot: "/warm/vault",
    }));
    expect(mocks.createReplica).toHaveBeenNthCalledWith(2, expect.objectContaining({
      vaultRoot: "/restored/vault",
    }));
  });

  it("returns a terminal degraded status without writing when the replica exceeds the byte cap", async () => {
    const sourceStateHash = "d".repeat(64);
    mocks.workspaceRead.mockResolvedValue({
      workspace: createWorkspace(sourceStateHash),
    });
    mocks.warmVaultRoot.mockReturnValue("/warm/vault");
    mocks.readWarmSourceStateHash.mockResolvedValue(null);
    mocks.restoreWorkspace.mockResolvedValue({
      vaultRoot: "/restored/vault",
    });
    mocks.createReplica.mockResolvedValue(createReplica(sourceStateHash));
    mocks.measureReplicaBytes.mockReturnValueOnce(257);

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      sourceStateHash,
      userId: "member_123",
    });

    expect(result).toEqual({
      byteLength: 257,
      maxBytes: 256,
      status: "refresh_failed_too_large",
    });
    expect(mocks.writeReplica).not.toHaveBeenCalled();
  });
});

function createWorkspace(sourceStateHash: string) {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: "2026-05-08T00:00:00.000Z",
    createdAt: "2026-05-08T00:00:00.000Z",
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: {
      hash: sourceStateHash,
      key: `cloudflare-workspace-bundles/${sourceStateHash}.bundle`,
      schema: "murph.hosted-execution-bundle-ref.v1",
      size: 123,
    },
    updatedAt: "2026-05-08T00:00:00.000Z",
    userId: "member_123",
    version: "1",
  };
}

function createReplica(sourceStateHash: string) {
  return {
    schema: "murph.browser-vault-replica",
    source: {
      dataVersion: `data-${sourceStateHash.slice(0, 8)}`,
      sourceBundleHash: sourceStateHash,
    },
  };
}

function createReplicaRef(sourceStateHash: string) {
  return {
    byteLength: 256,
    dataVersion: `data-${sourceStateHash.slice(0, 8)}`,
    keyId: "browser-vault-replica:data",
    objectKey: `browser-vault-replicas/member_123/${sourceStateHash}.json.enc`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "runtime-root-v1",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: sourceStateHash,
  };
}
