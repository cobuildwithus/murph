import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedRunnerChildLauncherDirectories: vi.fn(),
  createHostedRunnerChildProcessEnv: vi.fn(() => ({})),
  markHostedBrowserVaultRefreshFailed: vi.fn(),
  readHostedBrowserVaultRefreshState: vi.fn(),
  resolveHostedRunnerTsxImportSpecifier: vi.fn(() => "tsx"),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("@murphai/assistant-runtime", () => ({
  markHostedBrowserVaultRefreshFailed: mocks.markHostedBrowserVaultRefreshFailed,
  readHostedBrowserVaultRefreshState: mocks.readHostedBrowserVaultRefreshState,
}));

vi.mock("../src/runner-child-launcher.ts", () => ({
  createHostedRunnerChildLauncherDirectories: mocks.createHostedRunnerChildLauncherDirectories,
  createHostedRunnerChildProcessEnv: mocks.createHostedRunnerChildProcessEnv,
  resolveHostedRunnerTsxImportSpecifier: mocks.resolveHostedRunnerTsxImportSpecifier,
}));

import {
  BrowserVaultBackgroundRefreshManager,
} from "../src/browser-vault-refresh/background-manager.ts";

describe("BrowserVaultBackgroundRefreshManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.readHostedBrowserVaultRefreshState.mockResolvedValue({
      dirty: true,
      nextAttemptAt: null,
    });
  });

  it("does not spawn a child when foreground abort wins during launch preparation", async () => {
    let resolveLauncherDirectories!: (value: {
      cacheRoot: string;
      homeRoot: string;
      huggingFaceRoot: string;
      tempRoot: string;
    }) => void;
    const launcherDirectories = new Promise<{
      cacheRoot: string;
      homeRoot: string;
      huggingFaceRoot: string;
      tempRoot: string;
    }>((resolve) => {
      resolveLauncherDirectories = resolve;
    });
    mocks.createHostedRunnerChildLauncherDirectories.mockReturnValue(launcherDirectories);
    const manager = new BrowserVaultBackgroundRefreshManager();

    const scheduled = manager.scheduleIfDirty({
      internalWorkerProxyToken: "background-token",
      localInternalProxyBaseUrl: null,
      userId: "member_123",
      vaultRoot: "/tmp/browser-vault-warm-root",
    });
    await vi.waitFor(() => {
      expect(mocks.createHostedRunnerChildLauncherDirectories).toHaveBeenCalledOnce();
    });

    manager.abort("foreground invocation starting");
    resolveLauncherDirectories({
      cacheRoot: "/tmp/browser-vault-warm-root/cache",
      homeRoot: "/tmp/browser-vault-warm-root/home",
      huggingFaceRoot: "/tmp/browser-vault-warm-root/hf-home",
      tempRoot: "/tmp/browser-vault-warm-root/tmp",
    });
    await scheduled;

    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
