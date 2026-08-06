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
import {
  HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION,
  HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION_HEADER,
} from "../src/workspace-snapshot-store.ts";

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

  it.each(["source_active", "destination_active"] as const)(
    "leaves %s cutover cold restore to the role-aware fenced control plane",
    async (cutoverPhase) => {
      const fixture = await createSnapshotFixture();
      try {
        const onPreparationUnavailable = vi.fn();

        await expect(prepareHostedWorkspaceSnapshotRestore({
          configSource: {
            ...createPresignConfig(),
            HOSTED_R2_CUTOVER_PHASE: cutoverPhase,
          },
          crypto: fixture.cryptoContext,
          onPreparationUnavailable,
          userId: TEST_USER_ID,
          workspace: fixture.workspace,
        })).resolves.toBeNull();

        expect(onPreparationUnavailable).not.toHaveBeenCalled();
      } finally {
        fixture.dataKey.fill(0);
        fixture.rootKey.fill(0);
      }
    },
  );

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

  it("uses the binding route before the legacy URL carried by prepared restore data", async () => {
    const fixture = await createSnapshotFixture();
    const getUrl = createPreparedGetUrl("prepared-snapshot.enc");
    const fetchMock = vi.fn(async () => new Response("unavailable", {
      headers: {
        [HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION_HEADER]:
          HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION,
      },
      status: 500,
    }));
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
      })).rejects.toThrow(
        /Hosted workspace snapshot binding object read failed with HTTP 500/u,
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(readRequestUrl)).toEqual([
        `http://workspace-snapshots.worker/workspace-snapshots/${fixture.ref.snapshotId}/object`,
        `http://workspace-snapshots.worker/workspace-snapshots/${fixture.ref.snapshotId}/object`,
      ]);
      expect(fetchMock.mock.calls.map(readRequestUrl)).not.toContain(getUrl);
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it.each([
    ["unversioned success", null],
    ["unsupported version", "99"],
  ] as const)("fails closed on %s without compatibility fallback", async (
    _caseLabel,
    responseVersion,
  ) => {
    const fixture = await createSnapshotFixture();
    const getUrl = createPreparedGetUrl("prepared-version-rejection.enc");
    let bodyCanceled = false;
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      cancel: () => {
        bodyCanceled = true;
      },
    }), {
      headers: responseVersion === null
        ? undefined
        : {
          [HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION_HEADER]: responseVersion,
        },
      status: 200,
    }));
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(fixture, getUrl),
      timeoutMs: 5_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      await expect(port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-prepared-version-rejection",
        ref: fixture.ref,
      })).rejects.toThrow("Hosted workspace snapshot object read version is unsupported.");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(readRequestUrl(fetchMock.mock.calls[0])).toBe(
        `http://workspace-snapshots.worker/workspace-snapshots/${fixture.ref.snapshotId}/object`,
      );
      expect(readRequestUrl(fetchMock.mock.calls[0])).not.toBe(getUrl);
      expect(bodyCanceled).toBe(true);
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("uses a still-valid prepared URL directly after an old-Worker miss", async () => {
    const fixture = await createSnapshotFixture();
    const getUrl = createPreparedGetUrl("prepared-old-worker-fallback.enc");
    const events: string[] = [];
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = readRequestUrl(args);
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/object`)) {
        events.push("object");
        return new Response("old Worker route missing", { status: 404 });
      }
      if (url === getUrl) {
        events.push("prepared-get");
        return new Response("unavailable", { status: 500 });
      }
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/presign-get`)) {
        events.push("unexpected-presign");
      }
      return new Response("unexpected", { status: 500 });
    });
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(fixture, getUrl),
      timeoutMs: 5_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      await expect(port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-prepared-old-worker-fallback",
        ref: fixture.ref,
      })).rejects.toThrow(/Hosted workspace snapshot fetch failed with HTTP 500/u);
      expect(events).toEqual(["object", "prepared-get"]);
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("refreshes a prepared URL that enters the safety window during an old-Worker miss", async () => {
    vi.useFakeTimers();
    const fixture = await createSnapshotFixture();
    const issuedAtMs = Date.parse("2026-08-06T12:00:00.000Z");
    vi.setSystemTime(issuedAtMs);
    const staleGetUrl = createPreparedGetUrl("aging-prepared.enc", 10, issuedAtMs);
    const freshGetUrl = createPreparedGetUrl("fresh-presigned.enc", 60, issuedAtMs + 6_000);
    const events: string[] = [];
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = readRequestUrl(args);
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/object`)) {
        events.push("object");
        vi.setSystemTime(issuedAtMs + 6_000);
        return new Response("old Worker route missing", { status: 404 });
      }
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/presign-get`)) {
        events.push("presign");
        return jsonResponse({
          expiresAt: new Date(issuedAtMs + 66_000).toISOString(),
          getUrl: freshGetUrl,
        });
      }
      if (url === freshGetUrl) {
        events.push("fresh-get");
        return new Response("unavailable", { status: 500 });
      }
      if (url === staleGetUrl) {
        events.push("stale-get");
      }
      return new Response("unexpected", { status: 500 });
    });
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(fixture, staleGetUrl),
      timeoutMs: 5_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      await expect(port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-aging-prepared-old-worker-fallback",
        ref: fixture.ref,
      })).rejects.toThrow(/Hosted workspace snapshot fetch failed with HTTP 500/u);
      expect(events).toEqual(["object", "presign", "fresh-get"]);
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
      vi.useRealTimers();
    }
  });

  it("refreshes compatibility access when a midstream retry reaches the URL safety window", async () => {
    const fixture = await createSnapshotFixture();
    const issuedAtMs = Date.parse("2026-08-06T12:00:00.000Z");
    let virtualNowMs = issuedAtMs;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => virtualNowMs);
    const agingGetUrl = createPreparedGetUrl("midstream-aging.enc", 10, issuedAtMs);
    const freshGetUrl = createPreparedGetUrl("midstream-fresh.enc", 60, issuedAtMs + 6_000);
    const events: string[] = [];
    let objectRequestCount = 0;
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = readRequestUrl(args);
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/object`)) {
        objectRequestCount += 1;
        events.push(`object-${objectRequestCount}`);
        return new Response("old Worker route missing", { status: 404 });
      }
      if (url === agingGetUrl) {
        events.push("aging-get");
        let prefixSent = false;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!prefixSent) {
              prefixSent = true;
              controller.enqueue(new Uint8Array(16));
              virtualNowMs = issuedAtMs + 6_000;
              return;
            }
            controller.error(new TypeError("compatibility stream reset"));
          },
        }), {
          headers: {
            "content-length": String(fixture.ref.archive.encryptedByteSize),
          },
          status: 200,
        });
      }
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/presign-get`)) {
        events.push("presign");
        return jsonResponse({
          expiresAt: new Date(issuedAtMs + 66_000).toISOString(),
          getUrl: freshGetUrl,
        });
      }
      if (url === freshGetUrl) {
        events.push("fresh-get");
        return new Response("unavailable", { status: 500 });
      }
      return new Response("unexpected", { status: 500 });
    });
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(fixture, agingGetUrl),
      timeoutMs: 30_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      const restore = port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-midstream-aging-restore",
        ref: fixture.ref,
      });
      await expect(restore).rejects.toThrow(
        /Hosted workspace snapshot fetch failed with HTTP 500/u,
      );
      expect(events).toEqual([
        "object-1",
        "aging-get",
        "object-2",
        "presign",
        "fresh-get",
      ]);
    } finally {
      dateNowSpy.mockRestore();
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("keeps one compatibility deadline across response headers and body", async () => {
    vi.useFakeTimers();
    const fixture = await createSnapshotFixture();
    const issuedAtMs = Date.parse("2026-08-06T12:00:00.000Z");
    vi.setSystemTime(issuedAtMs);
    const getUrl = createPreparedGetUrl("shared-deadline.enc", 60, issuedAtMs);
    const events: string[] = [];
    let objectRequestCount = 0;
    let bodyCanceled = false;
    let resolveBodyCanceled: (() => void) | null = null;
    const bodyCanceledPromise = new Promise<void>((resolve) => {
      resolveBodyCanceled = resolve;
    });
    let resolveCompatibilityStarted: (() => void) | null = null;
    const compatibilityStarted = new Promise<void>((resolve) => {
      resolveCompatibilityStarted = resolve;
    });
    let resolveBodyOpened: (() => void) | null = null;
    const bodyOpened = new Promise<void>((resolve) => {
      resolveBodyOpened = resolve;
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = readRequestUrl(args);
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/object`)) {
        objectRequestCount += 1;
        events.push(`object-${objectRequestCount}`);
        if (objectRequestCount === 1) {
          return new Response("old Worker route missing", { status: 404 });
        }
        return new Response("current Worker unavailable", {
          headers: {
            [HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION_HEADER]:
              HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION,
          },
          status: 500,
        });
      }
      if (url === getUrl) {
        events.push("compatibility-get");
        resolveCompatibilityStarted?.();
        resolveCompatibilityStarted = null;
        await new Promise<void>((resolve) => setTimeout(resolve, 40_000));
        return new Response(new ReadableStream<Uint8Array>({
          cancel: () => {
            bodyCanceled = true;
            resolveBodyCanceled?.();
            resolveBodyCanceled = null;
          },
          start: () => {
            resolveBodyOpened?.();
            resolveBodyOpened = null;
          },
        }), {
          headers: {
            "content-length": String(fixture.ref.archive.encryptedByteSize),
          },
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(fixture, getUrl),
      timeoutMs: 120_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      const restore = port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-shared-deadline-restore",
        ref: fixture.ref,
      });
      const rejected = expect(restore).rejects.toThrow(
        "The operation was aborted due to timeout",
      );
      await compatibilityStarted;
      await vi.advanceTimersByTimeAsync(40_000);
      await bodyOpened;
      await vi.advanceTimersByTimeAsync(16_000);
      await bodyCanceledPromise;
      await vi.runAllTimersAsync();
      await rejected;

      expect(events).toEqual([
        "object-1",
        "compatibility-get",
      ]);
      expect(Date.now() - issuedAtMs).toBeLessThan(60_000);
      expect(bodyCanceled).toBe(true);
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
      vi.useRealTimers();
    }
  });

  it("does not retry an active compatibility GET after caller cancellation", async () => {
    const fixture = await createSnapshotFixture();
    const getUrl = createPreparedGetUrl("caller-cancel.enc");
    const abortController = new AbortController();
    const abortReason = new Error("caller canceled compatibility restore");
    const events: string[] = [];
    let compatibilityBodyCancelCount = 0;
    let resolveCompatibilityBodyOpened: (() => void) | null = null;
    const compatibilityBodyOpened = new Promise<void>((resolve) => {
      resolveCompatibilityBodyOpened = resolve;
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = readRequestUrl(args);
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/object`)) {
        events.push("object");
        return new Response("old Worker route missing", { status: 404 });
      }
      if (url === getUrl) {
        events.push("compatibility-get");
        return new Response(new ReadableStream<Uint8Array>({
          cancel: () => {
            compatibilityBodyCancelCount += 1;
          },
          start: () => {
            resolveCompatibilityBodyOpened?.();
            resolveCompatibilityBodyOpened = null;
          },
        }), {
          headers: {
            "content-length": String(fixture.ref.archive.encryptedByteSize),
          },
          status: 200,
        });
      }
      events.push("unexpected");
      return new Response("unexpected", { status: 500 });
    });
    const port = createCloudflareWorkspaceSnapshotPort({
      boundUserId: TEST_USER_ID,
      fetchImpl: fetchMock as typeof fetch,
      preparedSnapshotRestore: createPreparedRestore(fixture, getUrl),
      timeoutMs: 30_000,
      workspaceCheckpointBridge: createWorkspaceCheckpointBridge(),
    });

    try {
      const restore = port.restoreWorkspaceSnapshot({
        durableRoot: "/tmp/unused-caller-cancel-restore",
        ref: fixture.ref,
        signal: abortController.signal,
      });
      await compatibilityBodyOpened;
      abortController.abort(abortReason);

      await expect(restore).rejects.toBe(abortReason);
      expect(events).toEqual(["object", "compatibility-get"]);
      expect(compatibilityBodyCancelCount).toBe(1);
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

  it("ignores an expired prepared URL and still attempts the binding route", async () => {
    const fixture = await createSnapshotFixture();
    const fetchMock = vi.fn(async () => new Response("binding unavailable", {
      headers: {
        [HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION_HEADER]:
          HOSTED_WORKSPACE_SNAPSHOT_OBJECT_READ_VERSION,
      },
      status: 500,
    }));
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
        /Hosted workspace snapshot binding object read failed with HTTP 500/u,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(readRequestUrl)).toEqual([
        `http://workspace-snapshots.worker/workspace-snapshots/${fixture.ref.snapshotId}/object`,
        `http://workspace-snapshots.worker/workspace-snapshots/${fixture.ref.snapshotId}/object`,
      ]);
    } finally {
      fixture.dataKey.fill(0);
      fixture.rootKey.fill(0);
    }
  });

  it("falls back through presign when the current runner reaches an old Worker", async () => {
    const fixture = await createSnapshotFixture();
    const getUrl = "https://r2.example.test/fallback-snapshot.enc";
    const events: string[] = [];
    let resolvePresignStarted: (() => void) | null = null;
    const presignStarted = new Promise<void>((resolve) => {
      resolvePresignStarted = resolve;
    });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = readRequestUrl(args);
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/data-key/unwrap`)) {
        events.push("unwrap");
        await presignStarted;
        return jsonResponse({ dataKey: fixture.dataKeyBase64 });
      }
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/object`)) {
        events.push("object");
        return new Response("old Worker route missing", { status: 404 });
      }
      if (url.endsWith(`/workspace-snapshots/${fixture.ref.snapshotId}/presign-get`)) {
        events.push("presign");
        resolvePresignStarted?.();
        resolvePresignStarted = null;
        return jsonResponse({
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          getUrl,
        });
      }
      if (url === getUrl) {
        events.push("get");
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
      expect(events).toEqual([
        "unwrap",
        "object",
        "presign",
        "get",
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
