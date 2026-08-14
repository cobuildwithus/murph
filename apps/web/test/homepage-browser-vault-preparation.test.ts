import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
} from "@murphai/contracts/browser-vault";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  assertBrowserVaultMemberAuthority: vi.fn(),
  getPrisma: vi.fn(),
  readHostedWorkspace: vi.fn(),
  signalHostedBrowserVaultRefreshRuntime: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/src/lib/browser-vault/authority", () => ({
  assertBrowserVaultMemberAuthority: mocks.assertBrowserVaultMemberAuthority,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedBrowserVaultRefreshRuntime:
    mocks.signalHostedBrowserVaultRefreshRuntime,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  readHostedWorkspace: mocks.readHostedWorkspace,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import {
  scheduleHomepageBrowserVaultPreparation,
} from "@/src/lib/browser-vault/homepage-preparation";

const MEMBER_ID = "member_homepage";
const SOURCE_HASH = "a".repeat(64);
const prisma = { label: "homepage-preparation-prisma" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T18:00:00.000Z"));
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue(prisma);
  mocks.assertBrowserVaultMemberAuthority.mockResolvedValue(undefined);
  mocks.readHostedWorkspace.mockResolvedValue({
    browserVaultReplicaRef: createReplicaRef(),
  });
  mocks.signalHostedBrowserVaultRefreshRuntime.mockResolvedValue({
    signalAccepted: true,
    workflowId: `hosted-user-runtime:${MEMBER_ID}`,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("homepage browser-vault preparation", () => {
  it("registers only after-response work and does not start preparation inline", () => {
    scheduleHomepageBrowserVaultPreparation({ memberId: MEMBER_ID });

    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.assertBrowserVaultMemberAuthority).not.toHaveBeenCalled();
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
  });

  it("checks member authority and leaves a fresh replica untouched", async () => {
    scheduleHomepageBrowserVaultPreparation({ memberId: MEMBER_ID });

    await runScheduledAfterTask();

    expect(mocks.assertBrowserVaultMemberAuthority).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma,
    });
    expect(mocks.readHostedWorkspace).toHaveBeenCalledWith({
      prisma,
      userId: MEMBER_ID,
    });
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing",
      replicaRef: null,
    },
    {
      label: "invalid",
      replicaRef: { schema: "invalid-replica-ref" },
    },
    {
      label: "generation-stale",
      replicaRef: createReplicaRef({
        generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1,
      }),
    },
    {
      label: "age-stale",
      replicaRef: createReplicaRef({
        generatedAt: "2026-08-11T17:59:59.999Z",
      }),
    },
  ])("reuses the durable refresh signal when the replica is $label", async ({
    replicaRef,
  }) => {
    mocks.readHostedWorkspace.mockResolvedValue({
      browserVaultReplicaRef: replicaRef,
    });

    scheduleHomepageBrowserVaultPreparation({ memberId: MEMBER_ID });
    await runScheduledAfterTask();

    expect(mocks.signalHostedBrowserVaultRefreshRuntime).toHaveBeenCalledWith({
      prisma,
      userId: MEMBER_ID,
    });
  });

  it("stops before freshness reads when browser-vault member authority is absent", async () => {
    mocks.assertBrowserVaultMemberAuthority.mockRejectedValue(
      new Error("launch consent missing"),
    );

    scheduleHomepageBrowserVaultPreparation({ memberId: MEMBER_ID });
    await expect(runScheduledAfterTask()).resolves.toBeUndefined();

    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
  });

  it.each([
    {
      fail: () => {
        mocks.readHostedWorkspace.mockRejectedValue(
          new Error("workspace unavailable"),
        );
      },
      label: "freshness read failure",
    },
    {
      fail: () => {
        mocks.readHostedWorkspace.mockResolvedValue({
          browserVaultReplicaRef: null,
        });
        mocks.signalHostedBrowserVaultRefreshRuntime.mockRejectedValue(
          new Error("Temporal unavailable"),
        );
      },
      label: "durable refresh signaling failure",
    },
  ])("isolates $label from homepage delivery", async ({ fail }) => {
    fail();

    scheduleHomepageBrowserVaultPreparation({ memberId: MEMBER_ID });

    await expect(runScheduledAfterTask()).resolves.toBeUndefined();
  });

  it("does not run preparation inline when after-response registration is unavailable", () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error("after unavailable");
    });

    expect(() =>
      scheduleHomepageBrowserVaultPreparation({ memberId: MEMBER_ID })
    ).not.toThrow();
    expect(mocks.assertBrowserVaultMemberAuthority).not.toHaveBeenCalled();
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalHostedBrowserVaultRefreshRuntime).not.toHaveBeenCalled();
  });
});

async function runScheduledAfterTask(): Promise<void> {
  const task = mocks.after.mock.calls[0]?.[0];
  if (typeof task !== "function") {
    throw new Error("Expected a homepage browser-vault after-response task.");
  }
  await task();
}

function createReplicaRef(
  overrides: Partial<HostedBrowserVaultReplicaRef> = {},
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: "2026-08-13T17:30:00.000Z",
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: SOURCE_HASH,
    ...overrides,
  };
}
