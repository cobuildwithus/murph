import { describe, expect, it, vi } from "vitest";

import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  checkpointHostedRuntimeBridgeWorkspace,
  type HostedRuntimeBridgeBundleWriteContext,
  type HostedRuntimeBridgeCheckpointLeaseError,
  type HostedRuntimeBridgeCheckpointContext,
  type HostedRuntimeBridgeCheckpointLease,
} from "@murphai/assistant-runtime/hosted-invocation";

const BASE_LEASE: HostedRuntimeBridgeCheckpointLease = {
  attemptId: "attempt_1",
  leaseGeneration: "7",
  userId: "member_123",
  workspaceVersion: "4",
};

const BASE_REQUEST: HostedWorkspaceCheckpointRequest = {
  attemptId: "attempt_1",
  expectedWorkspaceVersion: "4",
  leaseGeneration: "7",
  nextWakeAt: null,
  nextWakeReason: null,
  reason: "import",
  redactedStatus: {
    importedConversationSeq: "1",
  },
  snapshotRef: null,
};

const WRITTEN_REF: HostedExecutionBundleRef = {
  hash: "a".repeat(64),
  key: "users/bundles/user_hash/vault/bundle.bundle.json",
  size: 12,
  updatedAt: "2026-04-27T00:00:01.000Z",
};

function createCheckpointResponse(input: {
  checkpointed: boolean;
  snapshotRef: HostedWorkspaceCheckpointRequest["snapshotRef"];
  userId?: string;
  version?: string;
}): HostedWorkspaceCheckpointResponse {
  return {
    checkpointed: input.checkpointed,
    workspace: {
      checkpointedAt: input.checkpointed ? "2026-04-27T00:00:02.000Z" : null,
      createdAt: "2026-04-27T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: input.snapshotRef,
      updatedAt: "2026-04-27T00:00:02.000Z",
      userId: input.userId ?? "member_123",
      version: input.version ?? "5",
    },
  };
}

function requireFlatBundleRef(
  snapshotRef: HostedWorkspaceCheckpointRequest["snapshotRef"],
): HostedExecutionBundleRef | null {
  if (!snapshotRef) {
    return null;
  }
  if ("hash" in snapshotRef) {
    return snapshotRef;
  }
  throw new TypeError("Expected a flat hosted execution bundle ref.");
}

describe("checkpointHostedRuntimeBridgeWorkspace", () => {
  it("snapshots, writes the bundle, and calls web checkpoint in order", async () => {
    const calls: string[] = [];
    const initialLease = { ...BASE_LEASE };
    const bundleWriteLease = { ...BASE_LEASE };
    const webCheckpointLease = { ...BASE_LEASE };
    const readCurrentLease = vi.fn<() => HostedRuntimeBridgeCheckpointLease>(() => {
      calls.push("lease");
      return webCheckpointLease;
    })
      .mockImplementationOnce(() => {
        calls.push("lease");
        return initialLease;
      })
      .mockImplementationOnce(() => {
        calls.push("lease");
        return bundleWriteLease;
      })
      .mockImplementationOnce(() => {
        calls.push("lease");
        return webCheckpointLease;
      });
    const snapshotWorkspace = vi.fn((context: HostedRuntimeBridgeCheckpointContext) => {
      void context;
      calls.push("snapshot");
      return Uint8Array.from([1, 2, 3]);
    });
    const writeBundle = vi.fn(({ bundle }: HostedRuntimeBridgeBundleWriteContext) => {
      calls.push(`write:${bundle.join(",")}`);
      return WRITTEN_REF;
    });
    const checkpointWorkspace = vi.fn((request: HostedWorkspaceCheckpointRequest) => {
      calls.push(`checkpoint:${requireFlatBundleRef(request.snapshotRef)?.key ?? "null"}`);
      return createCheckpointResponse({
        checkpointed: true,
        snapshotRef: request.snapshotRef,
      });
    });

    const result = await checkpointHostedRuntimeBridgeWorkspace({
      checkpointWorkspace,
      readCurrentLease,
      request: BASE_REQUEST,
      snapshotWorkspace,
      userId: "member_123",
      writeBundle,
    });

    expect(result).toEqual(createCheckpointResponse({
      checkpointed: true,
      snapshotRef: WRITTEN_REF,
    }));
    expect(calls).toEqual([
      "lease",
      "snapshot",
      "lease",
      "write:1,2,3",
      "lease",
      `checkpoint:${WRITTEN_REF.key}`,
      "lease",
    ]);
    expect(snapshotWorkspace.mock.calls[0]?.[0].lease).toBe(initialLease);
    expect(writeBundle.mock.calls[0]?.[0].lease).toBe(bundleWriteLease);
    expect(checkpointWorkspace).toHaveBeenCalledWith({
      ...BASE_REQUEST,
      snapshotRef: WRITTEN_REF,
    });
  });

  it("rejects a stale lease before snapshotting", async () => {
    const snapshotWorkspace = vi.fn();
    const writeBundle = vi.fn();
    const checkpointWorkspace = vi.fn();

    await expect(
      checkpointHostedRuntimeBridgeWorkspace({
        checkpointWorkspace,
        readCurrentLease: () => ({
          ...BASE_LEASE,
          leaseGeneration: "8",
        }),
        request: BASE_REQUEST,
        snapshotWorkspace,
        userId: "member_123",
        writeBundle,
      }),
    ).rejects.toMatchObject({
      code: "stale_lease_generation",
      stage: "before_snapshot",
    } satisfies Partial<HostedRuntimeBridgeCheckpointLeaseError>);

    expect(snapshotWorkspace).not.toHaveBeenCalled();
    expect(writeBundle).not.toHaveBeenCalled();
    expect(checkpointWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    ["stale_user", { userId: "member_other" }],
    ["stale_attempt", { attemptId: "attempt_2" }],
  ] as const)("rejects a %s lease before snapshotting", async (code, leasePatch) => {
    const snapshotWorkspace = vi.fn();
    const writeBundle = vi.fn();
    const checkpointWorkspace = vi.fn();

    await expect(
      checkpointHostedRuntimeBridgeWorkspace({
        checkpointWorkspace,
        readCurrentLease: () => ({
          ...BASE_LEASE,
          ...leasePatch,
        }),
        request: BASE_REQUEST,
        snapshotWorkspace,
        userId: "member_123",
        writeBundle,
      }),
    ).rejects.toMatchObject({
      code,
      stage: "before_snapshot",
    } satisfies Partial<HostedRuntimeBridgeCheckpointLeaseError>);

    expect(snapshotWorkspace).not.toHaveBeenCalled();
    expect(writeBundle).not.toHaveBeenCalled();
    expect(checkpointWorkspace).not.toHaveBeenCalled();
  });

  it("allows a newer workspace version lease after snapshot before bundle upload", async () => {
    const readCurrentLease = vi.fn()
      .mockReturnValue({
        ...BASE_LEASE,
        workspaceVersion: "5",
      })
      .mockReturnValueOnce(BASE_LEASE)
      .mockReturnValueOnce({
        ...BASE_LEASE,
        workspaceVersion: "5",
      });
    const snapshotWorkspace = vi.fn(() => Uint8Array.from([4, 5, 6]));
    const writeBundle = vi.fn(() => WRITTEN_REF);
    const checkpointWorkspace = vi.fn((request: HostedWorkspaceCheckpointRequest) =>
      createCheckpointResponse({
        checkpointed: true,
        snapshotRef: request.snapshotRef,
        version: "5",
      })
    );

    const result = await checkpointHostedRuntimeBridgeWorkspace({
      checkpointWorkspace,
      readCurrentLease,
      request: BASE_REQUEST,
      snapshotWorkspace,
      userId: "member_123",
      writeBundle,
    });

    expect(result.checkpointed).toBe(true);
    expect(snapshotWorkspace).toHaveBeenCalledTimes(1);
    expect(writeBundle).toHaveBeenCalledTimes(1);
    expect(checkpointWorkspace).toHaveBeenCalledTimes(1);
  });

  it("rejects a lease that becomes stale after upload before web checkpoint", async () => {
    const readCurrentLease = vi.fn()
      .mockReturnValueOnce(BASE_LEASE)
      .mockReturnValueOnce(BASE_LEASE)
      .mockReturnValueOnce({
        ...BASE_LEASE,
        attemptId: "attempt_2",
      });
    const snapshotWorkspace = vi.fn(() => Uint8Array.from([4, 5, 6]));
    const writeBundle = vi.fn(() => WRITTEN_REF);
    const checkpointWorkspace = vi.fn();

    await expect(
      checkpointHostedRuntimeBridgeWorkspace({
        checkpointWorkspace,
        readCurrentLease,
        request: BASE_REQUEST,
        snapshotWorkspace,
        userId: "member_123",
        writeBundle,
      }),
    ).rejects.toMatchObject({
      code: "stale_attempt",
      stage: "before_web_checkpoint",
    } satisfies Partial<HostedRuntimeBridgeCheckpointLeaseError>);

    expect(snapshotWorkspace).toHaveBeenCalledTimes(1);
    expect(writeBundle).toHaveBeenCalledTimes(1);
    expect(checkpointWorkspace).not.toHaveBeenCalled();
  });

  it("returns the web CAS conflict response without mutating local state", async () => {
    const doState = {
      workspaceVersion: "4",
    };
    const conflictResponse = createCheckpointResponse({
      checkpointed: false,
      snapshotRef: null,
      version: "5",
    });

    const result = await checkpointHostedRuntimeBridgeWorkspace({
      checkpointWorkspace: vi.fn(() => conflictResponse),
      readCurrentLease: vi.fn(() => BASE_LEASE),
      request: BASE_REQUEST,
      snapshotWorkspace: vi.fn(() => new ArrayBuffer(0)),
      userId: "member_123",
      writeBundle: vi.fn(() => WRITTEN_REF),
    });

    expect(result).toBe(conflictResponse);
    expect(result.checkpointed).toBe(false);
    expect(doState).toEqual({
      workspaceVersion: "4",
    });
  });
});
