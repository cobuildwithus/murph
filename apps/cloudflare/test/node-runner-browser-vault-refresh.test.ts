import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createReplica: vi.fn(),
  measureReplicaBytes: vi.fn((replica: unknown) => JSON.stringify(replica).length),
  publishReplica: vi.fn(),
  warmVaultRoot: vi.fn(),
  writeReplica: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-runtime")>(
    "@murphai/assistant-runtime",
  );

  return {
    ...actual,
    createHostedBrowserVaultReplicaForSourceState: mocks.createReplica,
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
    })),
  };
});

const FIXED_NOW = "2026-05-08T00:00:00.000Z";

describe("refreshHostedBrowserVaultReplica", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    mocks.createReplica.mockImplementation(async (input: {
      sourceStateHash: string;
    }) => createReplica(input.sourceStateHash));
    mocks.measureReplicaBytes.mockImplementation(() => 256);
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

  it("generates from the live warm vault and publishes the latest replica ref", async () => {
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
    expect(mocks.createReplica).toHaveBeenCalledWith(expect.objectContaining({
      generatedAt: FIXED_NOW,
      sourceStateHash,
      vaultRoot: "/warm/vault",
    }));
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
      maxBytes: 256,
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
    const replicaReady = createDeferred<ReturnType<typeof createReplica>>();
    const abortController = new AbortController();
    mocks.createReplica.mockImplementation(async () => await replicaReady.promise);

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
    await vi.waitFor(() => expect(mocks.createReplica).toHaveBeenCalledOnce());

    abortController.abort(new Error("foreground_invocation"));
    replicaReady.resolve(createReplica("f".repeat(64)));

    await expect(refresh).rejects.toThrow("foreground_invocation");
    expect(mocks.writeReplica).not.toHaveBeenCalled();
    expect(mocks.publishReplica).not.toHaveBeenCalled();
  });
});

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
