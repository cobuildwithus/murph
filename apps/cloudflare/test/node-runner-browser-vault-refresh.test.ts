import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createReplica: vi.fn(),
  measureReplicaBytes: vi.fn((replica: unknown) => JSON.stringify(replica).length),
  publishReplica: vi.fn(),
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
        publishRef: mocks.publishReplica,
        write: mocks.writeReplica,
      },
      workspacePort: {
        read: mocks.workspaceRead,
      },
    })),
  };
});

describe("refreshHostedBrowserVaultReplica", () => {
  beforeEach(() => {
    mocks.measureReplicaBytes.mockImplementation(() => 256);
    mocks.publishReplica.mockImplementation(async (input: {
      replicaRef: ReturnType<typeof createReplicaRef>;
    }) => ({
      published: true,
      workspace: {
        ...createWorkspace(input.replicaRef.sourceBundleHash),
        browserVaultReplicaRef: input.replicaRef,
      },
    }));
  });

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
      status: "published",
    });
    expect(mocks.publishReplica).toHaveBeenCalledWith({
      expectedSourceStateHash: sourceStateHash,
      replicaRef: createReplicaRef(sourceStateHash),
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
      status: "published",
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
      status: "published",
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
    expect(mocks.publishReplica).not.toHaveBeenCalled();
  });

  it("keeps same-source publish conflicts retryable after writing", async () => {
    const sourceStateHash = "e".repeat(64);
    mocks.workspaceRead.mockResolvedValue({
      workspace: createWorkspace(sourceStateHash),
    });
    mocks.warmVaultRoot.mockReturnValue("/warm/vault");
    mocks.readWarmSourceStateHash.mockResolvedValue(null);
    mocks.restoreWorkspace.mockResolvedValue({
      vaultRoot: "/restored/vault",
    });
    mocks.createReplica.mockResolvedValue(createReplica(sourceStateHash));
    mocks.writeReplica.mockResolvedValue(createReplicaRef(sourceStateHash));
    mocks.publishReplica.mockResolvedValue({
      published: false,
      workspace: createWorkspace(sourceStateHash),
    });

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
      status: "publish_conflict",
    });
    expect(mocks.writeReplica).toHaveBeenCalledOnce();
    expect(mocks.publishReplica).toHaveBeenCalledWith({
      expectedSourceStateHash: sourceStateHash,
      replicaRef: createReplicaRef(sourceStateHash),
    });
  });

  it("does not write or publish when refresh is aborted before publish", async () => {
    const sourceStateHash = "f".repeat(64);
    const replicaReady = createDeferred<ReturnType<typeof createReplica>>();
    const abortController = new AbortController();
    mocks.workspaceRead.mockResolvedValue({
      workspace: createWorkspace(sourceStateHash),
    });
    mocks.warmVaultRoot.mockReturnValue("/warm/vault");
    mocks.readWarmSourceStateHash.mockResolvedValue(null);
    mocks.restoreWorkspace.mockResolvedValue({
      vaultRoot: "/restored/vault",
    });
    mocks.createReplica.mockImplementation(async () => await replicaReady.promise);
    mocks.writeReplica.mockResolvedValue(createReplicaRef(sourceStateHash));

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const refresh = refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      sourceStateHash,
      userId: "member_123",
    }, {
      signal: abortController.signal,
    });
    await vi.waitFor(() => expect(mocks.createReplica).toHaveBeenCalledOnce());

    abortController.abort(new Error("foreground_invocation"));
    replicaReady.resolve(createReplica(sourceStateHash));

    await expect(refresh).rejects.toThrow("foreground_invocation");
    expect(mocks.writeReplica).not.toHaveBeenCalled();
    expect(mocks.publishReplica).not.toHaveBeenCalled();
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    reject,
    resolve,
  };
}
