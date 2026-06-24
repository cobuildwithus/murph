import { describe, expect, it, vi } from "vitest";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2FingerprintSha256,
  buildHostedWorkspaceSnapshotV2Aad,
  decodeHostedWorkspaceSnapshotV2DataKey,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  wrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import type {
  HostedUserCryptoContext,
} from "../src/hosted-crypto/runtime-user-crypto-context.ts";
import {
  parseHostedExecutionRunnerJobInput,
} from "../src/runner-job-transport.ts";
import {
  createCloudflareWorkspaceSnapshotPort,
} from "../src/runtime-platform/workspace-snapshot-port.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "../src/storage-paths.ts";
import {
  createRuntimeProcessingCommandBudget,
  RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE,
} from "../src/user-runner/runtime-command-budget.ts";
import {
  runHostedWorkspaceSnapshotRestorePreparationWithinBudget,
} from "../src/user-runner/runtime-invocation.ts";
import {
  prepareHostedWorkspaceSnapshotRestore,
  type HostedWorkspaceSnapshotPreparedRestore,
} from "../src/workspace-snapshot-restore-preparation.ts";

const TEST_USER_ID = "member_snapshot_restore_prepare";
const TEST_ROOT_KEY_ID = "root_key_snapshot_restore_prepare";

interface SnapshotFixture {
  cryptoContext: HostedUserCryptoContext;
  dataKey: Uint8Array;
  dataKeyBase64: string;
  ref: HostedWorkspaceSnapshotV2Ref;
  rootKey: Uint8Array;
  workspace: HostedWorkspaceState;
}

describe("workspace snapshot restore preparation", () => {
  it("unwraps the data key and presigns the selected snapshot before runner dispatch", async () => {
    const fixture = await createSnapshotFixture();
    try {
      const prepared = await prepareHostedWorkspaceSnapshotRestore({
        configSource: createPresignConfig(),
        crypto: fixture.cryptoContext,
        userId: TEST_USER_ID,
        workspace: fixture.workspace,
      });

      expect(prepared).not.toBeNull();
      expect(prepared?.snapshotFingerprint).toBe(
        buildHostedWorkspaceSnapshotV2FingerprintSha256(fixture.ref),
      );
      const getUrl = new URL(prepared?.getUrl ?? "");
      expect(getUrl.hostname).toBe("account123.r2.cloudflarestorage.com");
      expect(getUrl.pathname).toContain("/murph-test/");
      expect(getUrl.searchParams.get("X-Amz-Date")).toMatch(/^\d{8}T\d{6}Z$/u);
      expect(getUrl.searchParams.get("X-Amz-Expires")).toBe("3600");

      const decoded = decodeHostedWorkspaceSnapshotV2DataKey(
        prepared?.dataKey ?? "",
      );
      try {
        expect(decoded).toEqual(fixture.dataKey);
      } finally {
        decoded.fill(0);
      }
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("carries prepared restore data through the existing runner job transport", async () => {
    const fixture = await createSnapshotFixture();
    try {
      const prepared = await prepareHostedWorkspaceSnapshotRestore({
        configSource: createPresignConfig(),
        crypto: fixture.cryptoContext,
        userId: TEST_USER_ID,
        workspace: fixture.workspace,
      });
      if (!prepared) {
        throw new Error("Expected a prepared snapshot restore fixture.");
      }

      const parsed = parseHostedExecutionRunnerJobInput({
        kind: "workspace-invocation",
        preparedSnapshotRestore: prepared,
        request: {
          attemptId: "attempt_snapshot_restore_prepare",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspace: fixture.workspace,
          workspaceVersion: fixture.workspace.version,
        },
      });

      expect(parsed.preparedSnapshotRestore).toEqual(prepared);
      expect(() => parseHostedExecutionRunnerJobInput({
        kind: "workspace-invocation",
        preparedSnapshotRestore: {
          ...prepared,
          snapshotFingerprint: "not-a-sha256",
        },
        request: {
          attemptId: "attempt_snapshot_restore_prepare",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspace: fixture.workspace,
          workspaceVersion: fixture.workspace.version,
        },
      })).toThrow(/snapshotFingerprint/u);
      expect(() => parseHostedExecutionRunnerJobInput({
        kind: "workspace-invocation",
        preparedSnapshotRestore: {
          ...prepared,
          getUrl: "not a url",
        },
        request: {
          attemptId: "attempt_snapshot_restore_prepare",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspace: fixture.workspace,
          workspaceVersion: fixture.workspace.version,
        },
      })).toThrow(
        "Hosted execution runner job input.preparedSnapshotRestore.getUrl must be a valid URL.",
      );
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("keeps ref-binding validation fatal while treating control-plane reads as best effort", async () => {
    const fixture = await createSnapshotFixture();
    try {
      const onPresignUnavailable = vi.fn();
      await expect(prepareHostedWorkspaceSnapshotRestore({
        configSource: {},
        crypto: fixture.cryptoContext,
        onPreparationUnavailable: onPresignUnavailable,
        userId: TEST_USER_ID,
        workspace: fixture.workspace,
      })).resolves.toBeNull();
      expect(onPresignUnavailable).toHaveBeenCalledOnce();

      // A snapshot wrapped under a now-rotated root must not clear the runner
      // write fence: a matching warm-clean marker can warm-restore without ever
      // resolving the historical key. The fenced cold path still fails closed
      // because it re-attempts the same control-plane reads under the fence.
      const onMissingRootUnavailable = vi.fn();
      await expect(prepareHostedWorkspaceSnapshotRestore({
        configSource: createPresignConfig(),
        crypto: {
          ...fixture.cryptoContext,
          async resolveKeyById() {
            return null;
          },
          rootKeyId: "root_key_missing_from_runtime_context",
        },
        onPreparationUnavailable: onMissingRootUnavailable,
        userId: TEST_USER_ID,
        workspace: fixture.workspace,
      })).resolves.toBeNull();
      expect(onMissingRootUnavailable).toHaveBeenCalledOnce();
      expect(onMissingRootUnavailable.mock.calls[0]?.[0]).toMatchObject({
        message: "Hosted workspace snapshot root key is unavailable.",
      });

      const onResolveFailureUnavailable = vi.fn();
      const resolveFailure = new Error("Hosted historical root lookup transient failure.");
      await expect(prepareHostedWorkspaceSnapshotRestore({
        configSource: createPresignConfig(),
        crypto: {
          ...fixture.cryptoContext,
          async resolveKeyById() {
            throw resolveFailure;
          },
          rootKeyId: "root_key_missing_from_runtime_context",
        },
        onPreparationUnavailable: onResolveFailureUnavailable,
        userId: TEST_USER_ID,
        workspace: fixture.workspace,
      })).resolves.toBeNull();
      expect(onResolveFailureUnavailable).toHaveBeenCalledOnce();
      expect(onResolveFailureUnavailable.mock.calls[0]?.[0]).toBe(resolveFailure);

      const onFatalUnavailable = vi.fn();
      await expect(prepareHostedWorkspaceSnapshotRestore({
        configSource: createPresignConfig(),
        crypto: fixture.cryptoContext,
        onPreparationUnavailable: onFatalUnavailable,
        userId: TEST_USER_ID,
        workspace: {
          ...fixture.workspace,
          snapshotRef: {
            ...fixture.ref,
            encryption: {
              ...fixture.ref.encryption,
              rootKeyId: "root_key_mismatch",
            },
          },
        },
      })).rejects.toThrow(
        "Hosted workspace snapshot wrapped data key root did not match its ref.",
      );
      expect(onFatalUnavailable).not.toHaveBeenCalled();
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("uses prepared restore data without calling unwrap or presign control routes", async () => {
    const fixture = await createSnapshotFixture();
    const getUrl = createPreparedGetUrl("prepared-snapshot.enc");
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 500 }));
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(fixture, getUrl),
      timeoutMs: 5_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      await expect(port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-prepared-snapshot-restore",
        ref: fixture.ref,
      })).rejects.toThrow(/Hosted workspace snapshot fetch failed with HTTP 500/u);

      expect(fetchMock).toHaveBeenCalled();
      for (const call of fetchMock.mock.calls) {
        expect(readRequestUrl(call)).toBe(getUrl);
      }
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("fails closed before fetch when prepared data targets another snapshot", async () => {
    const fixture = await createSnapshotFixture();
    const fetchMock = vi.fn(async () => new Response("unexpected", { status: 500 }));
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: {
        ...createPreparedRestore(fixture, createPreparedGetUrl("mismatch.enc")),
        snapshotFingerprint: "f".repeat(64),
      },
      timeoutMs: 5_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      await expect(port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-mismatched-snapshot-restore",
        ref: fixture.ref,
      })).rejects.toThrow(
        "Hosted workspace snapshot prepared restore did not match the selected snapshot.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("fails closed before fetch when prepared data is expired", async () => {
    const fixture = await createSnapshotFixture();
    const fetchMock = vi.fn(async () => new Response("unexpected", { status: 500 }));
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(
        fixture,
        createPreparedGetUrl("expired.enc", 1, Date.now() - 60_000),
      ),
      timeoutMs: 5_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      await expect(port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-expired-snapshot-restore",
        ref: fixture.ref,
      })).rejects.toThrow(
        "Hosted workspace snapshot prepared restore URL is expired or too close to expiry.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("starts legacy unwrap and presign fallback reads in parallel", async () => {
    const fixture = await createSnapshotFixture();
    const getUrl = "https://r2.example.test/fallback-snapshot.enc";
    const unwrapStarted = createDeferred<void>();
    const presignStarted = createDeferred<void>();
    const events: string[] = [];
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = readRequestUrl(args);
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/data-key/unwrap`)) {
        events.push("unwrap:start");
        unwrapStarted.resolve();
        await withBarrierTimeout(presignStarted.promise);
        events.push("unwrap:end");
        return jsonResponse({ dataKey: fixture.dataKeyBase64 });
      }
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/presign-get`)) {
        events.push("presign:start");
        presignStarted.resolve();
        await withBarrierTimeout(unwrapStarted.promise);
        events.push("presign:end");
        return jsonResponse({
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          getUrl,
        });
      }
      if (url === getUrl) {
        return new Response("unavailable", { status: 500 });
      }
      return new Response("unexpected", { status: 500 });
    });
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      await expect(port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-fallback-snapshot-restore",
        ref: fixture.ref,
      })).rejects.toThrow(/Hosted workspace snapshot fetch failed with HTTP 500/u);
      expect(events.slice(0, 2).sort()).toEqual([
        "presign:start",
        "unwrap:start",
      ]);
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });
});

describe("runHostedWorkspaceSnapshotRestorePreparationWithinBudget", () => {
  it("runs the operation directly when no budget is configured", async () => {
    const onBudgetTimeout = vi.fn();
    const expected: HostedWorkspaceSnapshotPreparedRestore = {
      dataKey: "00".repeat(32),
      getUrl: "https://r2.example.test/object.enc?X-Amz-Date=20260623T000000Z&X-Amz-Expires=60",
      snapshotFingerprint: "a".repeat(64),
    };

    await expect(runHostedWorkspaceSnapshotRestorePreparationWithinBudget({
      budget: null,
      onBudgetTimeout,
      operation: async () => expected,
      stepTimeoutMs: 60_000,
    })).resolves.toBe(expected);
    expect(onBudgetTimeout).not.toHaveBeenCalled();
  });

  it("treats a budget step timeout as preparation unavailable instead of clearing the fence", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-24T00:00:00.000Z"));
      const onBudgetTimeout = vi.fn();
      const budget = createRuntimeProcessingCommandBudget({
        commandTimeoutMs: null,
        startedAtMs: Date.now(),
        // Margin is 1000ms, so an effective deadline of +2ms keeps the step's
        // setTimeout small enough to fire deterministically under fake timers.
        webControlTimeoutMs: 1002,
      });

      const promise = runHostedWorkspaceSnapshotRestorePreparationWithinBudget({
        budget,
        onBudgetTimeout,
        operation: () => new Promise<HostedWorkspaceSnapshotPreparedRestore>(() => {}),
        stepTimeoutMs: 60_000,
      });

      await vi.advanceTimersByTimeAsync(50);

      await expect(promise).resolves.toBeNull();
      expect(onBudgetTimeout).toHaveBeenCalledOnce();
      expect(onBudgetTimeout.mock.calls[0]?.[0]).toMatchObject({
        message: RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates non-budget errors from the operation", async () => {
    const onBudgetTimeout = vi.fn();
    const innerError = new Error("inner-prep-failure");
    const budget = createRuntimeProcessingCommandBudget({
      commandTimeoutMs: null,
      startedAtMs: Date.now(),
      webControlTimeoutMs: 60_000,
    });

    await expect(runHostedWorkspaceSnapshotRestorePreparationWithinBudget({
      budget,
      onBudgetTimeout,
      operation: async () => {
        throw innerError;
      },
      stepTimeoutMs: 60_000,
    })).rejects.toBe(innerError);
    expect(onBudgetTimeout).not.toHaveBeenCalled();
  });
});

async function createSnapshotFixture(): Promise<SnapshotFixture> {
  const snapshotId = "snapshot_restore_prepare_test";
  const objectKey = await hostedWorkspaceSnapshotObjectKey({
    snapshotId,
    userId: TEST_USER_ID,
  });
  const aad = buildHostedWorkspaceSnapshotV2Aad({
    objectKey,
    snapshotId,
    userId: TEST_USER_ID,
  });
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const dataKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const wrappedDataKey = await wrapHostedWorkspaceSnapshotV2DataKey({
    aad,
    dataKey,
    rootKey,
    rootKeyId: TEST_ROOT_KEY_ID,
  });
  const ref: HostedWorkspaceSnapshotV2Ref = {
    archive: {
      compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
      encryptedByteSize: 128,
      encryptedObjectSha256: "a".repeat(64),
      fileCount: 1,
      format: "tar",
      plaintextArchiveSha256: "b".repeat(64),
      totalPlainBytes: 64,
    },
    createdAt: "2026-06-23T00:00:00.000Z",
    encryption: {
      aad,
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: TEST_ROOT_KEY_ID,
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey,
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: TEST_USER_ID,
  };
  const workspace: HostedWorkspaceState = {
    checkpointedAt: "2026-06-23T00:00:00.000Z",
    createdAt: "2026-06-23T00:00:00.000Z",
    snapshotRef: ref,
    updatedAt: "2026-06-23T00:00:00.000Z",
    userId: TEST_USER_ID,
    version: "7",
  };
  const cryptoContext = {
    cacheMaxAgeMs: 60_000,
    cryptoContextVersion: "1",
    domain: "runtime",
    envelope: {} as HostedUserCryptoContext["envelope"],
    fetchedAtMs: Date.now(),
    keysById: {
      [TEST_ROOT_KEY_ID]: rootKey,
    },
    async resolveKeyById(rootKeyId: string) {
      return rootKeyId === TEST_ROOT_KEY_ID ? rootKey : null;
    },
    rootKey,
    rootKeyId: TEST_ROOT_KEY_ID,
  } satisfies HostedUserCryptoContext;

  return {
    cryptoContext,
    dataKey,
    dataKeyBase64: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
    ref,
    rootKey,
    workspace,
  };
}

function createPresignConfig(): Record<string, string> {
  return {
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "test-access-key",
    HOSTED_R2_PRESIGN_ACCOUNT_ID: "account123",
    HOSTED_R2_PRESIGN_BUCKET_NAME: "murph-test",
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "test-secret-key",
  };
}

function createPreparedRestore(
  fixture: SnapshotFixture,
  getUrl: string,
): HostedWorkspaceSnapshotPreparedRestore {
  return {
    dataKey: fixture.dataKeyBase64,
    getUrl,
    snapshotFingerprint: buildHostedWorkspaceSnapshotV2FingerprintSha256(fixture.ref),
  };
}

function createPreparedGetUrl(
  pathname: string,
  expiresSeconds = 60,
  issuedAtMs = Date.now(),
): string {
  const issuedAt = new Date(issuedAtMs).toISOString()
    .replace(/[:-]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `https://r2.example.test/${pathname}?X-Amz-Date=${issuedAt}&X-Amz-Expires=${expiresSeconds}&X-Amz-Signature=test`;
}

function createWorkspaceCheckpointBridge() {
  return {
    readCurrentLease: () => ({
      attemptId: "attempt_snapshot_restore_prepare",
      leaseGeneration: "7",
      userId: TEST_USER_ID,
      workspaceVersion: "7",
    }),
  };
}

function readRequestUrl(args: readonly unknown[]): string {
  const [input, init] = args;
  if (input instanceof Request) {
    return input.url;
  }
  if (input instanceof URL || typeof input === "string") {
    return new Request(input, init as RequestInit | undefined).url;
  }
  throw new TypeError("Expected fetch-compatible request input.");
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function withBarrierTimeout(promise: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Expected unwrap and presign restore reads to overlap."));
        }, 250);
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}
