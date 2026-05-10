import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  measureReplicaBytes: vi.fn((replica: unknown) => JSON.stringify(replica).length),
  prepareReplica: vi.fn(),
  publishReplica: vi.fn(),
  readWorkspace: vi.fn(),
  warmVaultRoot: vi.fn(),
  writeReplica: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-runtime")>(
    "@murphai/assistant-runtime",
  );

  return {
    ...actual,
    createHostedBrowserVaultReplicaRefreshFromWorkspace: mocks.prepareReplica,
  };
});

vi.mock("../src/node-runner-isolated.ts", () => {
  return {
    resolveHostedRunnerWarmWorkspaceVaultRoot: mocks.warmVaultRoot,
    runHostedWorkspaceInvocationIsolatedDetailed: vi.fn(),
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
        read: mocks.readWorkspace,
      },
    })),
  };
});

const FIXED_NOW = "2026-05-08T00:00:00.000Z";

describe("refreshHostedBrowserVaultReplica", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    mocks.prepareReplica.mockImplementation(async (input: {
      sourceStateHash: string;
    }) => createPreparation(input.sourceStateHash));
    mocks.measureReplicaBytes.mockImplementation(() => 256);
    mocks.readWorkspace.mockResolvedValue({
      fetchedAt: FIXED_NOW,
      workspace: createWorkspace(),
    });
    mocks.warmVaultRoot.mockReturnValue("/warm/vault");
    mocks.writeReplica.mockImplementation(async (input: {
      replica: ReturnType<typeof createReplica>;
    }) => createReplicaRef(input.replica.source.sourceBundleHash));
    mocks.publishReplica.mockImplementation(async (input: {
      replicaRef: ReturnType<typeof createReplicaRef>;
    }) => ({
      published: true,
      workspace: null,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("restores the live workspace before building and publishing the latest replica ref", async () => {
    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    });

    const sourceStateHash = result.status === "published"
      ? result.replicaRef.sourceBundleHash
      : "";
    expect(result).toMatchObject({
      replicaRef: createReplicaRef(sourceStateHash),
      status: "published",
    });
    expect(mocks.prepareReplica).toHaveBeenCalledWith(expect.objectContaining({
      generatedAt: FIXED_NOW,
      platform: expect.objectContaining({
        workspacePort: expect.objectContaining({
          read: mocks.readWorkspace,
        }),
      }),
      sourceStateHash,
      vaultRoot: "/warm/vault",
      workspace: createWorkspace(),
    }));
    expect(mocks.readWorkspace).toHaveBeenCalledOnce();
    expect(sourceStateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(mocks.publishReplica).toHaveBeenCalledWith({
      replicaRef: createReplicaRef(sourceStateHash),
    });
  });

  it("returns a terminal degraded status without writing when the replica exceeds the byte cap", async () => {
    mocks.measureReplicaBytes.mockReturnValueOnce(257);

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    });

    expect(result).toEqual({
      byteLength: 257,
      content: createContentSummary(),
      maxBytes: 256,
      restore: createRestoreSummary(),
      source: createSourceSummary(),
      status: "refresh_failed_too_large",
    });
    expect(mocks.writeReplica).not.toHaveBeenCalled();
    expect(mocks.publishReplica).not.toHaveBeenCalled();
  });

  it("keeps latest-ref publish conflicts retryable after writing", async () => {
    mocks.publishReplica.mockResolvedValue({
      published: false,
      workspace: null,
    });

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    });

    expect(result).toEqual({
      status: "publish_conflict",
    });
    expect(mocks.writeReplica).toHaveBeenCalledOnce();
    expect(mocks.publishReplica).toHaveBeenCalledWith(expect.objectContaining({
      replicaRef: expect.objectContaining({
        sourceBundleHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    }));
  });

  it("does not write or publish when refresh is aborted before publish", async () => {
    const replicaReady = createDeferred<ReturnType<typeof createPreparation>>();
    const abortController = new AbortController();
    mocks.prepareReplica.mockImplementation(async () => await replicaReady.promise);

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const refresh = refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    }, {
      signal: abortController.signal,
    });
    await vi.waitFor(() => expect(mocks.prepareReplica).toHaveBeenCalledOnce());

    abortController.abort(new Error("foreground_invocation"));
    replicaReady.resolve(createPreparation("f".repeat(64)));

    await expect(refresh).rejects.toThrow("foreground_invocation");
    expect(mocks.writeReplica).not.toHaveBeenCalled();
    expect(mocks.publishReplica).not.toHaveBeenCalled();
  });

  it("publishes after a successful write even if the refresh is preempted", async () => {
    const abortController = new AbortController();
    mocks.writeReplica.mockImplementationOnce(async (input: {
      replica: ReturnType<typeof createReplica>;
    }) => {
      abortController.abort(new Error("foreground_invocation"));
      return createReplicaRef(input.replica.source.sourceBundleHash);
    });

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    }, {
      signal: abortController.signal,
    });

    expect(result.status).toBe("published");
    expect(mocks.writeReplica).toHaveBeenCalledOnce();
    expect(mocks.publishReplica).toHaveBeenCalledOnce();
  });

  it("does not publish when restored source exists but the replica has no private content", async () => {
    mocks.prepareReplica.mockResolvedValueOnce({
      ...createPreparation("f".repeat(64)),
      content: createContentSummary({ hasPrivateContent: false }),
    });

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    });

    expect(result).toMatchObject({
      status: "refresh_failed_empty_source",
    });
    expect(mocks.writeReplica).not.toHaveBeenCalled();
    expect(mocks.publishReplica).not.toHaveBeenCalled();
  });

  it("does not publish an empty null-bootstrap workspace", async () => {
    mocks.prepareReplica.mockResolvedValueOnce({
      ...createPreparation("f".repeat(64)),
      content: createContentSummary({ hasPrivateContent: false }),
      source: createSourceSummary({ fileCount: 0, totalBytes: 0 }),
    });

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    });

    expect(result).toMatchObject({
      status: "refresh_skipped_no_source",
    });
    expect(mocks.writeReplica).not.toHaveBeenCalled();
    expect(mocks.publishReplica).not.toHaveBeenCalled();
  });

  it("keeps a missing web workspace retryable without building an empty replica", async () => {
    mocks.readWorkspace.mockResolvedValueOnce({
      fetchedAt: FIXED_NOW,
      workspace: null,
    });

    const { refreshHostedBrowserVaultReplica } = await import("../src/node-runner.ts");
    const result = await refreshHostedBrowserVaultReplica({
      runtime: {
        forwardedEnv: {},
        platformEnv: {},
        userEnv: {},
      },
      userId: "member_123",
    });

    expect(result).toEqual({
      status: "workspace_missing",
    });
    expect(mocks.prepareReplica).not.toHaveBeenCalled();
    expect(mocks.writeReplica).not.toHaveBeenCalled();
    expect(mocks.publishReplica).not.toHaveBeenCalled();
  });
});

function createWorkspace() {
  return {
    createdAt: "2026-05-07T00:00:00.000Z",
    snapshotRef: null,
    updatedAt: "2026-05-07T00:00:00.000Z",
    userId: "member_123",
    version: "workspace-1",
  };
}

function createPreparation(sourceStateHash: string) {
  return {
    content: createContentSummary(),
    replica: createReplica(sourceStateHash),
    restore: createRestoreSummary(),
    source: createSourceSummary(),
  };
}

function createContentSummary(input: {
  hasPrivateContent?: boolean;
} = {}) {
  return {
    entities: input.hasPrivateContent === false ? 0 : 1,
    hasPrivateContent: input.hasPrivateContent ?? true,
    metricGoalProgressRows: 0,
    metricRows: 0,
    metricSelectionRows: 24,
    searchRows: input.hasPrivateContent === false ? 0 : 1,
    sourceHealthRows: 0,
    timelineRows: 0,
    weeklySampleSummaries: 0,
  };
}

function createRestoreSummary() {
  return {
    mode: "snapshot",
    restoreWasCold: true,
  };
}

function createSourceSummary(input: {
  fileCount?: number;
  totalBytes?: number;
} = {}) {
  return {
    fileCount: input.fileCount ?? 1,
    totalBytes: input.totalBytes ?? 128,
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
