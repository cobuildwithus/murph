import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hostedInvocationLoaded: false,
  hostedRuntimeLoaded: false,
  restoreHostedWorkspaceRuntimeJobWorkspace: vi.fn(),
}));

vi.mock("../src/hosted-runtime/workspace-restore.ts", async () => {
  const actual = await vi.importActual<
    typeof import("../src/hosted-runtime/workspace-restore.ts")
  >("../src/hosted-runtime/workspace-restore.ts");
  return {
    ...actual,
    restoreHostedWorkspaceRuntimeJobWorkspace:
      mocks.restoreHostedWorkspaceRuntimeJobWorkspace,
  };
});

vi.mock("../src/hosted-runtime.ts", () => {
  mocks.hostedRuntimeLoaded = true;
  return {};
});

vi.mock("../src/hosted-invocation.ts", () => {
  mocks.hostedInvocationLoaded = true;
  return {};
});

import type {
  HostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedAssistantWorkspaceRuntimeJobInput,
} from "../src/hosted-runtime/models.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createJob(
  workspace?: HostedWorkspaceReadResponse["workspace"],
): HostedAssistantWorkspaceRuntimeJobInput {
  return {
    request: {
      attemptId: "attempt_prepared_restore",
      leaseGeneration: "1",
      ...(workspace === undefined ? {} : { workspace }),
      userId: "member_prepared_restore",
      workspaceVersion: workspace?.version ?? "0",
    },
  };
}

function createPlatform(
  read: () => Promise<HostedWorkspaceReadResponse>,
): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {
        return undefined;
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    workspacePort: {
      read,
      async checkpoint() {
        throw new Error("Preparation must not checkpoint the workspace.");
      },
    },
  };
}

describe("hosted workspace restore preparation", () => {
  test("starts restore before the full invocation module executes", async () => {
    vi.resetModules();
    mocks.hostedInvocationLoaded = false;
    mocks.hostedRuntimeLoaded = false;
    mocks.restoreHostedWorkspaceRuntimeJobWorkspace.mockReset();
    const restoreGate = createDeferred<never>();
    mocks.restoreHostedWorkspaceRuntimeJobWorkspace.mockImplementation(
      async () => await restoreGate.promise,
    );
    const read = vi.fn(async () => ({
      fetchedAt: "2026-08-27T15:00:00.000Z",
      workspace: null,
    }));
    const { startHostedWorkspaceRestorePreparation } = await import(
      "../src/hosted-workspace-restore-preparation.ts"
    );

    const preparation = startHostedWorkspaceRestorePreparation({
      job: createJob(null),
      platform: createPlatform(read),
      signal: null,
      vaultRoot: "/tmp/prepared-restore",
    });

    expect(mocks.hostedInvocationLoaded).toBe(false);
    expect(mocks.hostedRuntimeLoaded).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.restoreHostedWorkspaceRuntimeJobWorkspace).toHaveBeenCalledOnce();

    await import("../src/hosted-invocation.ts");
    expect(mocks.hostedInvocationLoaded).toBe(true);
    expect(mocks.hostedRuntimeLoaded).toBe(false);
    expect(preparation.promise).toBeInstanceOf(Promise);
  });

  test("propagates abort while the authoritative workspace read is pending", async () => {
    mocks.restoreHostedWorkspaceRuntimeJobWorkspace.mockReset();
    const readGate = createDeferred<HostedWorkspaceReadResponse>();
    const read = vi.fn(async () => await readGate.promise);
    const abortController = new AbortController();
    const abortError = new Error("Synthetic prepared restore abort.");
    const { startHostedWorkspaceRestorePreparation } = await import(
      "../src/hosted-workspace-restore-preparation.ts"
    );

    const preparation = startHostedWorkspaceRestorePreparation({
      job: createJob(),
      platform: createPlatform(read),
      signal: abortController.signal,
      vaultRoot: "/tmp/prepared-restore-abort",
    });

    expect(read).toHaveBeenCalledOnce();
    abortController.abort(abortError);

    await expect(preparation.promise).rejects.toBe(abortError);
    expect(mocks.restoreHostedWorkspaceRuntimeJobWorkspace).not.toHaveBeenCalled();
  });

  test("binds preparation to one exact request and vault root", async () => {
    mocks.restoreHostedWorkspaceRuntimeJobWorkspace.mockReset();
    const restoreGate = createDeferred<never>();
    mocks.restoreHostedWorkspaceRuntimeJobWorkspace.mockImplementation(
      async () => await restoreGate.promise,
    );
    const read = vi.fn(async () => ({
      fetchedAt: "2026-08-27T15:00:00.000Z",
      workspace: null,
    }));
    const job = createJob(null);
    const { startHostedWorkspaceRestorePreparation } = await import(
      "../src/hosted-workspace-restore-preparation.ts"
    );
    const preparation = startHostedWorkspaceRestorePreparation({
      job,
      platform: createPlatform(read),
      signal: null,
      vaultRoot: "/tmp/prepared-restore-bound",
    });
    const assertLive = vi.fn();

    expect(() => preparation.adoptRuntimeAbortGuard({
      assertLive,
      job: {
        ...job,
        request: { ...job.request },
      },
      vaultRoot: preparation.vaultRoot,
    })).toThrow(/does not match the invocation/);
    expect(() => preparation.adoptRuntimeAbortGuard({
      assertLive,
      job,
      vaultRoot: "/tmp/other-restore-root",
    })).toThrow(/does not match the invocation/);
    expect(() => preparation.adoptRuntimeAbortGuard({
      assertLive,
      job,
      vaultRoot: preparation.vaultRoot,
    })).not.toThrow();
    expect(() => preparation.adoptRuntimeAbortGuard({
      assertLive,
      job,
      vaultRoot: preparation.vaultRoot,
    })).toThrow(/already consumed/);
  });
});
