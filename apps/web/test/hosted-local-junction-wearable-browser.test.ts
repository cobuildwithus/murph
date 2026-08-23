import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const kernelLifecycleMocks = vi.hoisted(() => {
  const connectOverCDP = vi.fn();
  const createAutomationBrowser = vi.fn();
  const deleteBrowserByIdOrName = vi.fn();
  const ensureProfile = vi.fn();
  const launch = vi.fn();
  const spawn = vi.fn();

  class KernelComputerClient {
    createAutomationBrowser = createAutomationBrowser;
    deleteBrowserByIdOrName = deleteBrowserByIdOrName;
    ensureProfile = ensureProfile;
  }

  return {
    connectOverCDP,
    createAutomationBrowser,
    deleteBrowserByIdOrName,
    ensureProfile,
    KernelComputerClient,
    launch,
    spawn,
  };
});

vi.mock("node:child_process", () => ({
  spawn: kernelLifecycleMocks.spawn,
}));

vi.mock("@playwright/test", () => ({
  chromium: {
    connectOverCDP: kernelLifecycleMocks.connectOverCDP,
    launch: kernelLifecycleMocks.launch,
  },
}));

vi.mock("../src/lib/computer-use/kernel-client.ts", () => ({
  KernelComputerClient: kernelLifecycleMocks.KernelComputerClient,
}));

import {
  buildKernelCliEnvironmentForTest,
  buildKernelTunnelArgumentsForTest,
  closeHostedLocalJunctionBrowserSessionForTest,
  completeExternalJunctionAuthorizationForTest,
  completeHostedLocalJunctionAuthorizationForTest,
  openHostedLocalJunctionBrowserSessionForTest,
  readHostedLocalJunctionBrowserConfigForTest,
  sanitizeHostedLocalJunctionBrowserFailureForTest,
  stopHostedLocalJunctionKernelTunnelForTest,
} from "../scripts/run-hosted-local-junction-wearable-browser";

interface FakeKernelTunnelChild extends EventEmitter {
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
  signalCode: NodeJS.Signals | null;
}

function createKernelTunnelChild(input: {
  exitOnTerminate?: boolean;
  pid?: number;
} = {}): FakeKernelTunnelChild {
  const child = new EventEmitter() as FakeKernelTunnelChild;
  child.exitCode = null;
  child.pid = input.pid ?? 43_123;
  child.signalCode = null;
  child.kill = vi.fn((signal: NodeJS.Signals) => {
    if (input.exitOnTerminate !== false) {
      child.signalCode = signal;
      child.emit("exit", null, signal);
    }
    return true;
  });
  return child;
}

function createConfig(environment: Record<string, string | undefined> = {}) {
  return readHostedLocalJunctionBrowserConfigForTest({
    CI: "true",
    NODE_ENV: "test",
    MURPH_E2E_CONNECT_URL:
      "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=whoop",
    MURPH_E2E_HOSTED_SESSION_COOKIE: "opaque-session",
    MURPH_E2E_PROVIDER_EMAIL: "browser-canary@example.invalid",
    MURPH_E2E_PROVIDER_HEADLESS: "0",
    MURPH_E2E_PROVIDER_PASSWORD: "opaque-password",
    MURPH_E2E_PROVIDER_SOURCE: "whoop",
    MURPH_E2E_PROVIDER_TIMEOUT_MS: "30000",
    MURPH_E2E_WEB_BASE_URL: "https://app.example.test",
    ...environment,
  });
}

function emptyLocator() {
  return {
    count: vi.fn(async () => 0),
    elementHandles: vi.fn(async () => []),
    filter: vi.fn(() => emptyLocator()),
    includesControl: vi.fn(() => false),
    nth: vi.fn(),
  };
}

function actionLocator(click: () => void) {
  const action = {
    and: vi.fn((other: { includesControl?: (candidate: object) => boolean }) => ({
      count: vi.fn(async () => other.includesControl?.(action) ? 1 : 0),
    })),
    click: vi.fn(async () => {
      click();
    }),
    getAttribute: vi.fn(async () => null),
    innerText: vi.fn(async () => "Continue"),
    isEnabled: vi.fn(async () => true),
    isVisible: vi.fn(async () => true),
  };
  return {
    count: vi.fn(async () => 1),
    includesControl: vi.fn((candidate: object) => candidate === action),
    nth: vi.fn(() => action),
  };
}

function roleLocator(
  controls: Array<{
    accessibleName?: string;
    ariaLabel?: string;
    checked?: boolean;
    detachAfterFirstText?: boolean;
    enabled?: boolean;
    onCheck?: () => void;
    onClick?: () => void;
    text: string;
    value?: string;
    visible?: boolean;
  }>,
) {
  const elementHandle = (control: (typeof controls)[number]) => {
    let detached = false;
    return {
      click: vi.fn(async () => {
        if (detached) throw new Error("detached synthetic-private-marker");
        control.onClick?.();
      }),
      dispose: vi.fn(async () => undefined),
      evaluate: vi.fn(async (
        _callback: unknown,
        other: { testControl?: (typeof controls)[number] },
      ) => {
        if (detached) throw new Error("detached synthetic-private-marker");
        return other.testControl === control;
      }),
      innerText: vi.fn(async () => {
        if (detached) throw new Error("detached synthetic-private-marker");
        if (control.detachAfterFirstText) detached = true;
        return control.text;
      }),
      isEnabled: vi.fn(async () => !detached && (control.enabled ?? true)),
      isVisible: vi.fn(async () => !detached && (control.visible ?? true)),
      testControl: control,
    };
  };
  return {
    count: vi.fn(async () => controls.length),
    elementHandles: vi.fn(async () => controls.map(elementHandle)),
    filter: vi.fn(({ hasText }: { hasText: RegExp }) =>
      roleLocator(controls.filter((control) => hasText.test(control.text)))
    ),
    includesControl: vi.fn((candidate: (typeof controls)[number]) =>
      controls.includes(candidate)
    ),
    nth: vi.fn((index: number) => {
      const control = controls[index];
      return {
        and: vi.fn((other: {
          includesControl?: (candidate: (typeof controls)[number]) => boolean;
        }) => ({
          count: vi.fn(async () =>
            control !== undefined && other.includesControl?.(control) ? 1 : 0
          ),
        })),
        check: vi.fn(async () => {
          if (!control) return;
          control.checked = true;
          control.onCheck?.();
        }),
        click: vi.fn(async () => control?.onClick?.()),
        evaluate: vi.fn(async () => control?.text ?? ""),
        getAttribute: vi.fn(async (name: string) => {
          if (name === "aria-label") return control?.ariaLabel ?? null;
          if (name === "value") return control?.value ?? null;
          return null;
        }),
        innerText: vi.fn(async () => control?.text ?? ""),
        isChecked: vi.fn(async () => control?.checked ?? false),
        isEnabled: vi.fn(async () => control?.enabled ?? true),
        isVisible: vi.fn(async () => control?.visible ?? true),
      };
    }),
  };
}

function authorizationFrame(input: {
  buttons?: Parameters<typeof roleLocator>[0];
  checkboxes?: Parameters<typeof roleLocator>[0];
  links?: Parameters<typeof roleLocator>[0];
}) {
  return {
    getByRole: vi.fn((
      role: string,
      options?: { exact?: boolean; name?: RegExp | string },
    ) => {
      const controls = role === "button"
        ? input.buttons ?? []
        : role === "link"
        ? input.links ?? []
        : role === "checkbox"
        ? input.checkboxes ?? []
        : [];
      const requestedName = options?.name;
      return roleLocator(requestedName
        ? controls.filter((control) => {
          const accessibleName = control.accessibleName ?? control.text;
          return typeof requestedName === "string"
            ? options.exact
              ? accessibleName === requestedName
              : accessibleName.includes(requestedName)
            : requestedName.test(accessibleName);
        })
        : controls);
    }),
    url: () => "https://id.whoop.com/sign-in",
  };
}

describe("hosted-local Junction wearable browser authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the local browser transport unless the caller selects Kernel", () => {
    const config = createConfig();

    expect(config.browserTransport).toBe("local");
    expect(config.kernelApiKey).toBeNull();
  });

  it("accepts only a headless WHOOP Kernel browser on explicit localhost", () => {
    const config = createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=whoop",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "1",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    });

    expect(config.browserTransport).toBe("kernel");
    expect(config.browserChannel).toBeUndefined();
    expect(config.kernelApiKey).toBe("kernel-test-key");
    expect(config.kernelCliPath).toBe("/opt/kernel-tools/kernel");
    expect(config.manualAuthorizationAllowed).toBe(false);
  });

  it("accepts a headed Garmin Kernel browser in CI without manual authorization", () => {
    const config = createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=garmin",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "0",
      MURPH_E2E_PROVIDER_SOURCE: "garmin",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    });

    expect(config).toMatchObject({
      browserTransport: "kernel",
      disclosureSourceName: "Garmin",
      headless: false,
      label: "Garmin",
      manualAuthorizationAllowed: false,
      source: "garmin",
    });
  });

  it("keeps Kernel unavailable to Oura, headed WHOOP, and manual runs", () => {
    const expectedError =
      "Kernel browser transport requires unattended Garmin or headless WHOOP authorization.";
    expect(() => createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=oura",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_OTP: "123456",
      MURPH_E2E_PROVIDER_PASSWORD: undefined,
      MURPH_E2E_PROVIDER_SOURCE: "oura",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    })).toThrow(expectedError);

    expect(() => createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=whoop",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "0",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    })).toThrow(expectedError);

    expect(() => createConfig({
      CI: undefined,
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=garmin",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "0",
      MURPH_E2E_PROVIDER_SOURCE: "garmin",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    })).toThrow(expectedError);
  });

  it("rejects Kernel without its exact authority and loopback CLI contract", () => {
    expect(() => createConfig({
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "1",
    })).toThrow("requires KERNEL_API_KEY");

    expect(() => createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "1",
    })).toThrow(
      "Kernel browser transport requires an explicit http://localhost:<port>",
    );
  });

  it("builds an exact reverse tunnel with a narrowly inherited environment", () => {
    expect(buildKernelTunnelArgumentsForTest("kernel-session-1", 43123)).toEqual([
      "browsers",
      "ssh",
      "kernel-session-1",
      "-R",
      "43123:localhost:43123",
    ]);
    expect(buildKernelCliEnvironmentForTest("kernel-test-key", {
      HOME: "/workspace/operator",
      JUNCTION_API_KEY: "must-not-pass",
      LANG: "en_US.UTF-8",
      MURPH_E2E_PROVIDER_PASSWORD: "must-not-pass",
      NODE_ENV: "production",
      PATH: "/usr/bin",
    })).toEqual({
      HOME: "/workspace/operator",
      KERNEL_API_KEY: "kernel-test-key",
      LANG: "en_US.UTF-8",
      NODE_ENV: "production",
      PATH: "/usr/bin",
    });
  });

  it("creates and tears down the exact owned Garmin Kernel browser and tunnel", async () => {
    const child = createKernelTunnelChild();
    const clearCookies = vi.fn(async () => undefined);
    const browser = {
      close: vi.fn(async () => undefined),
      contexts: vi.fn(() => [{ clearCookies }]),
    };
    const config = createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=garmin",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "0",
      MURPH_E2E_PROVIDER_SOURCE: "garmin",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    });
    const parentExitListenersBefore = process.listenerCount("exit");

    kernelLifecycleMocks.ensureProfile.mockResolvedValueOnce(undefined);
    kernelLifecycleMocks.createAutomationBrowser.mockResolvedValueOnce({
      cdpWsUrl: "wss://cdp.example.test/session/capability-secret",
      sessionId: "kernel-session-1",
    });
    kernelLifecycleMocks.spawn.mockReturnValueOnce(child);
    kernelLifecycleMocks.connectOverCDP.mockResolvedValueOnce(browser);
    kernelLifecycleMocks.deleteBrowserByIdOrName.mockResolvedValueOnce(undefined);

    const session = await openHostedLocalJunctionBrowserSessionForTest(config);
    expect(process.listenerCount("exit")).toBe(parentExitListenersBefore + 1);
    expect(kernelLifecycleMocks.spawn).toHaveBeenCalledWith(
      "/opt/kernel-tools/kernel",
      [
        "browsers",
        "ssh",
        "kernel-session-1",
        "-R",
        "43123:localhost:43123",
      ],
      expect.objectContaining({
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
      }),
    );

    await closeHostedLocalJunctionBrowserSessionForTest(session, config);

    expect(kernelLifecycleMocks.ensureProfile).toHaveBeenCalledWith(
      "murph-junction-garmin-canary",
    );
    expect(kernelLifecycleMocks.createAutomationBrowser).toHaveBeenCalledWith({
      headless: false,
      profileName: "murph-junction-garmin-canary",
      saveChanges: true,
      timeoutSeconds: 90,
    });
    expect(kernelLifecycleMocks.connectOverCDP).toHaveBeenCalledWith(
      "wss://cdp.example.test/session/capability-secret",
      { timeout: 30_000 },
    );
    expect(clearCookies).toHaveBeenCalledWith({ domain: "localhost" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(kernelLifecycleMocks.deleteBrowserByIdOrName).toHaveBeenCalledWith(
      "kernel-session-1",
    );
    expect(process.listenerCount("exit")).toBe(parentExitListenersBefore);
  });

  it("keeps the real tunnel child alive until owned cleanup", async () => {
    const { spawn: actualSpawn } = await vi.importActual<
      typeof import("node:child_process")
    >("node:child_process");
    const browser = {
      close: vi.fn(async () => undefined),
      contexts: vi.fn(() => [{ clearCookies: vi.fn(async () => undefined) }]),
    };
    const config = createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=whoop",
      MURPH_E2E_KERNEL_CLI_PATH: fileURLToPath(
        new URL("fixtures/kernel-tunnel-stdin.sh", import.meta.url),
      ),
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "1",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    });
    const parentExitListenersBefore = process.listenerCount("exit");
    let session: Awaited<
      ReturnType<typeof openHostedLocalJunctionBrowserSessionForTest>
    > | null = null;

    kernelLifecycleMocks.ensureProfile.mockResolvedValueOnce(undefined);
    kernelLifecycleMocks.createAutomationBrowser.mockResolvedValueOnce({
      cdpWsUrl: "wss://cdp.example.test/session/capability-secret",
      sessionId: "kernel-session-real-child",
    });
    kernelLifecycleMocks.spawn.mockImplementationOnce(actualSpawn);
    kernelLifecycleMocks.connectOverCDP.mockResolvedValueOnce(browser);
    kernelLifecycleMocks.deleteBrowserByIdOrName.mockResolvedValueOnce(undefined);

    try {
      session = await openHostedLocalJunctionBrowserSessionForTest(config);
      const tunnel = session.kernelTunnel;
      expect(tunnel).not.toBeNull();
      if (!tunnel) throw new Error("Expected the Kernel tunnel fixture to start.");

      const exitedBeforeCleanup = await Promise.race([
        new Promise<boolean>((resolve) => {
          tunnel.child.once("exit", () => resolve(true));
        }),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 200);
        }),
      ]);
      expect(exitedBeforeCleanup).toBe(false);
      expect(tunnel.child.exitCode).toBeNull();
      expect(tunnel.child.signalCode).toBeNull();

      await closeHostedLocalJunctionBrowserSessionForTest(session, config);
      session = null;

      expect(tunnel.child.signalCode).toBe("SIGTERM");
      expect(process.listenerCount("exit")).toBe(parentExitListenersBefore);
    } finally {
      if (session) {
        await closeHostedLocalJunctionBrowserSessionForTest(session, config)
          .catch(() => undefined);
      }
    }
  });

  it("deletes the created Kernel browser when CDP exposes no context", async () => {
    const child = createKernelTunnelChild();
    const config = createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=whoop",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "1",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    });
    const parentExitListenersBefore = process.listenerCount("exit");

    kernelLifecycleMocks.ensureProfile.mockResolvedValueOnce(undefined);
    kernelLifecycleMocks.createAutomationBrowser.mockResolvedValueOnce({
      cdpWsUrl: "wss://cdp.example.test/session/capability-secret",
      sessionId: "kernel-session-2",
    });
    kernelLifecycleMocks.spawn.mockReturnValueOnce(child);
    kernelLifecycleMocks.connectOverCDP.mockResolvedValueOnce({
      contexts: vi.fn(() => []),
    });
    kernelLifecycleMocks.deleteBrowserByIdOrName.mockResolvedValueOnce(undefined);

    await expect(
      openHostedLocalJunctionBrowserSessionForTest(config),
    ).rejects.toThrow("Kernel browser did not expose its persistent context.");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(kernelLifecycleMocks.deleteBrowserByIdOrName).toHaveBeenCalledWith(
      "kernel-session-2",
    );
    expect(process.listenerCount("exit")).toBe(parentExitListenersBefore);
  });

  it("force-stops only the owned Kernel tunnel process group", async () => {
    vi.useFakeTimers();
    const child = createKernelTunnelChild({
      exitOnTerminate: false,
      pid: 43_124,
    });
    const processKill = vi.spyOn(process, "kill").mockImplementation(
      ((processId: number, signal?: NodeJS.Signals | number) => {
        expect(processId).toBe(-43_124);
        expect(signal).toBe("SIGKILL");
        child.signalCode = "SIGKILL";
        child.emit("exit", null, "SIGKILL");
        return true;
      }) as typeof process.kill,
    );
    const removeParentExitHandler = vi.fn();

    try {
      const stopped = stopHostedLocalJunctionKernelTunnelForTest({
        child,
        processId: child.pid,
        removeParentExitHandler,
        spawnFailed: false,
      } as never);
      await vi.advanceTimersByTimeAsync(5_000);
      await stopped;

      expect(removeParentExitHandler).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(processKill).toHaveBeenCalledWith(-43_124, "SIGKILL");
    } finally {
      processKill.mockRestore();
      vi.useRealTimers();
    }
  });

  it("redacts Kernel authority and the complete CDP capability URL", () => {
    const config = createConfig({
      KERNEL_API_KEY: "kernel-test-key",
      MURPH_E2E_CONNECT_URL:
        "http://localhost:43123/connect#deviceConnectIntent=opaque&connectSource=whoop",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_PROVIDER_HEADLESS: "1",
      MURPH_E2E_WEB_BASE_URL: "http://localhost:43123",
    });

    const sanitized = sanitizeHostedLocalJunctionBrowserFailureForTest(
      new Error(
        "kernel-test-key failed at wss://cdp.example.test/session/capability-secret?token=query-secret",
      ),
      config,
    );

    expect(sanitized).not.toContain("kernel-test-key");
    expect(sanitized).not.toContain("capability-secret");
    expect(sanitized).not.toContain("query-secret");
    expect(sanitized).not.toContain("wss://");
    expect(sanitized).toContain("[redacted-url]");
  });

  it("fails a continuous external challenge after the bounded grace period", async () => {
    let now = 0;
    const page = {
      frames: () => [{ url: () => "https://challenges.cloudflare.com/frame" }],
      title: vi.fn(async () => "Sign in"),
      url: () => "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).rejects.toThrow(
      "WHOOP authorization was blocked by an external provider challenge.",
    );
    expect(now).toBe(15_000);
  });

  it("keeps one blocked window across alternating challenge and no-action polls", async () => {
    let now = 0;
    const page = {
      frames: () => now % 2_000 === 0
        ? [{ url: () => "https://challenges.cloudflare.com/frame" }]
        : [{ url: () => "https://id.whoop.com/sign-in" }],
      getByRole: vi.fn(() => emptyLocator()),
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Sign in"),
      url: () => "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).rejects.toThrow(
      "WHOOP authorization was blocked by an external provider challenge.",
    );
    expect(now).toBe(15_000);
  });

  it("resets the blocked window only after an automated action is clicked", async () => {
    let actionClicked = false;
    let atMurph = false;
    let challengeWaitsAfterClick = 0;
    let now = 0;
    const page = {
      frames: () => !actionClicked && now === 14_000
        ? [{ url: () => "https://id.whoop.com/sign-in" }]
        : [{ url: () => "https://challenges.cloudflare.com/frame" }],
      getByRole: vi.fn((role: string, options?: { name?: RegExp }) => {
        if (
          role === "button"
          && !actionClicked
          && now === 14_000
          && options?.name?.test("Continue")
        ) {
          return actionLocator(() => {
            actionClicked = true;
          });
        }
        return emptyLocator();
      }),
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Sign in"),
      url: () => atMurph
        ? "https://app.example.test/home"
        : "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
        if (actionClicked && duration === 1_000) {
          challengeWaitsAfterClick += 1;
          if (challengeWaitsAfterClick === 14) {
            atMurph = true;
          }
        }
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).resolves.toBeUndefined();
    expect(actionClicked).toBe(true);
    expect(now).toBe(28_750);
  });

  it("uses denial-safe rendered text when the accessible name masks GRANT", async () => {
    let atMurph = false;
    let positiveClicked = false;
    let negativeClicked = false;
    let replacedCandidateClicked = false;
    let now = 0;
    const mainFrame = authorizationFrame({
      buttons: [
        {
          accessibleName: "Review changing data access",
          detachAfterFirstText: true,
          onClick: () => {
            replacedCandidateClicked = true;
          },
          text: "GRANT",
        },
        {
          accessibleName: "Cancel data access",
          onClick: () => {
            negativeClicked = true;
          },
          text: "GRANT",
        },
        {
          accessibleName: "Review requested data access",
          ariaLabel: "Review requested data access",
          onClick: () => {
            positiveClicked = true;
            atMurph = true;
          },
          text: "GRANT",
        },
      ],
    });
    const page = {
      frames: () => [mainFrame],
      getByRole: mainFrame.getByRole,
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Authorize"),
      url: () => atMurph
        ? "https://app.example.test/home"
        : "https://id.whoop.com/consent",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).resolves.toBeUndefined();
    expect(negativeClicked).toBe(false);
    expect(positiveClicked).toBe(true);
    expect(replacedCandidateClicked).toBe(false);
    expect(now).toBe(750);
  });

  it.each([
    {
      environment: {},
      providerUrl: "https://id.whoop.com/consent",
      text: "Review requested data access",
      value: "GRANT",
    },
    {
      environment: {
        MURPH_E2E_CONNECT_URL:
          "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=oura",
        MURPH_E2E_PROVIDER_OTP: "123456",
        MURPH_E2E_PROVIDER_SOURCE: "oura",
      },
      providerUrl: "https://id.ouraring.com/consent",
      text: "GRANT",
      value: undefined,
    },
    {
      environment: {
        MURPH_E2E_CONNECT_URL:
          "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
        MURPH_E2E_PROVIDER_SOURCE: "garmin",
      },
      providerUrl: "https://connect.garmin.com/oauth2Confirm",
      text: "GRANT",
      value: undefined,
    },
  ])("does not broaden rendered fallback outside the WHOOP GRANT button", async ({
    environment,
    providerUrl,
    text,
    value,
  }) => {
    let clicked = false;
    let now = 0;
    const mainFrame = authorizationFrame({
      buttons: [{
        accessibleName: "Review requested data access",
        onClick: () => {
          clicked = true;
        },
        text,
        value,
      }],
    });
    const page = {
      frames: () => [mainFrame],
      getByRole: mainFrame.getByRole,
      locator: vi.fn(() => emptyLocator()),
      mainFrame: () => mainFrame,
      title: vi.fn(async () => "Authorize"),
      url: () => providerUrl,
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(environment),
      () => now,
    )).rejects.toThrow("did not expose an automated authorization action");
    expect(clicked).toBe(false);
    expect(now).toBe(15_000);
  });

  it.each(["true", " TRUE ", "1"])(
    "keeps headed CI=%j automated and bounds a provider page with no action",
    async (ci) => {
    let now = 0;
    const config = createConfig({ CI: ci });
    const mainFrame = authorizationFrame({});
    const page = {
      frames: () => [mainFrame],
      getByRole: mainFrame.getByRole,
      locator: vi.fn(() => emptyLocator()),
      mainFrame: () => mainFrame,
      title: vi.fn(async () => "Sign in"),
      url: () => "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    expect(config.manualAuthorizationAllowed).toBe(false);
    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      config,
      () => now,
    )).rejects.toThrow(
      [
        "WHOOP did not expose an automated authorization action.",
        "Authorization surface: childFrames=0 mainActions=0",
        "mainEnabledActions=0 mainOtherActions=0 childActions=0",
        "childEnabledActions=0 childOtherActions=0",
        "mainUncheckedCheckboxes=0 childUncheckedCheckboxes=0.",
      ].join(" "),
    );
    expect(now).toBe(15_000);
    },
  );

  it("uses Playwright action state and attributes child-frame controls", async () => {
    let now = 0;
    const mainFrame = authorizationFrame({
      buttons: [
        { accessibleName: "Continue", enabled: false, text: "" },
        { text: "Proceed" },
      ],
      links: [{ text: "Privacy policy" }],
    });
    const childFrame = authorizationFrame({
      buttons: [{ text: "Authorize" }, { text: "Proceed" }],
      checkboxes: [{ checked: false, text: "Required consent" }],
    });
    const page = {
      frames: () => [mainFrame, childFrame],
      getByRole: mainFrame.getByRole,
      locator: vi.fn(() => emptyLocator()),
      mainFrame: () => mainFrame,
      title: vi.fn(async () => "Sign in"),
      url: () => "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).rejects.toThrow([
      "Authorization surface: childFrames=1 mainActions=1",
      "mainEnabledActions=0 mainOtherActions=2 childActions=1",
      "childEnabledActions=1 childOtherActions=1",
      "mainUncheckedCheckboxes=0 childUncheckedCheckboxes=1.",
    ].join(" "));
  });

  it("completes Garmin's exact two-step consent flow", async () => {
    let step: "selection" | "confirmation" | "murph" = "selection";
    let now = 0;
    let saveClicks = 0;
    let agreeClicks = 0;
    let cancelClicked = false;
    let disagreeClicked = false;
    const checkboxes = [
      { checked: false, text: "" },
      { checked: false, text: "" },
      { checked: false, text: "" },
    ];
    const selectionFrame = authorizationFrame({
      buttons: [
        {
          onClick: () => {
            saveClicks += 1;
            if (checkboxes.every((checkbox) => checkbox.checked)) {
              step = "confirmation";
            }
          },
          text: "Save",
        },
        {
          onClick: () => {
            cancelClicked = true;
          },
          text: "Cancel",
        },
      ],
      checkboxes,
      links: [
        { text: "Learn More" },
        { text: "Privacy Policy" },
      ],
    });
    const confirmationFrame = authorizationFrame({
      buttons: [
        {
          onClick: () => {
            agreeClicks += 1;
            step = "murph";
          },
          text: "Agree",
        },
        {
          onClick: () => {
            disagreeClicked = true;
          },
          text: "Do Not Agree",
        },
      ],
    });
    const currentFrame = () => step === "selection"
      ? selectionFrame
      : confirmationFrame;
    const page = {
      frames: () => [currentFrame()],
      getByRole: (...args: Parameters<typeof selectionFrame.getByRole>) =>
        currentFrame().getByRole(...args),
      locator: vi.fn(() => emptyLocator()),
      mainFrame: currentFrame,
      title: vi.fn(async () => "Garmin Partner Auth"),
      url: () => step === "murph"
        ? "https://app.example.test/home"
        : step === "confirmation"
        ? [
          "https://connect.garmin.com/partner/oauthConfirm",
          "?oauth_token=opaque&oauth_callback=opaque",
          "&permissionsUpdated=1&selectedCapabilities=opaque",
        ].join("")
        : [
          "https://connect.garmin.com/partner/oauthConfirm",
          "?oauth_token=opaque&oauth_callback=opaque",
        ].join(""),
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig({
        MURPH_E2E_CONNECT_URL:
          "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
        MURPH_E2E_PROVIDER_SOURCE: "garmin",
      }),
      () => now,
    )).resolves.toBeUndefined();

    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
    expect(saveClicks).toBe(1);
    expect(agreeClicks).toBe(1);
    expect(cancelClicked).toBe(false);
    expect(disagreeClicked).toBe(false);
    expect(now).toBe(1_500);
  });

  it("fails closed on a partial Garmin consent progression marker pair", async () => {
    let agreeClicks = 0;
    const mainFrame = authorizationFrame({
      buttons: [{
        onClick: () => {
          agreeClicks += 1;
        },
        text: "Agree",
      }],
    });
    const page = {
      frames: () => [mainFrame],
      getByRole: mainFrame.getByRole,
      locator: vi.fn(() => emptyLocator()),
      mainFrame: () => mainFrame,
      title: vi.fn(async () => "Garmin Partner Auth"),
      url: () => [
        "https://connect.garmin.com/partner/oauthConfirm",
        "?oauth_token=opaque&oauth_callback=opaque&permissionsUpdated=1",
      ].join(""),
      waitForTimeout: vi.fn(async () => undefined),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig({
        MURPH_E2E_CONNECT_URL:
          "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
        MURPH_E2E_PROVIDER_SOURCE: "garmin",
      }),
    )).rejects.toThrow(
      "Garmin consent exposed an invalid progression state.",
    );
    expect(agreeClicks).toBe(0);
  });

  it.each([
    { checkboxCount: 2, saveCount: 1 },
    { checkboxCount: 3, saveCount: 2 },
  ])(
    "fails closed when the exact Garmin consent shape changes (%o)",
    async ({ checkboxCount, saveCount }) => {
      let now = 0;
      const mainFrame = authorizationFrame({
        buttons: Array.from({ length: saveCount }, () => ({ text: "Save" })),
        checkboxes: Array.from({ length: checkboxCount }, () => ({
          checked: false,
          text: "",
        })),
      });
      const page = {
        frames: () => [mainFrame],
        getByRole: mainFrame.getByRole,
        locator: vi.fn(() => emptyLocator()),
        mainFrame: () => mainFrame,
        title: vi.fn(async () => "Garmin Partner Auth"),
        url: () => "https://connect.garmin.com/partner/oauthConfirm",
        waitForTimeout: vi.fn(async (duration: number) => {
          now += duration;
        }),
      };

      await expect(completeExternalJunctionAuthorizationForTest(
        page as never,
        createConfig({
          MURPH_E2E_CONNECT_URL:
            "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
          MURPH_E2E_PROVIDER_SOURCE: "garmin",
        }),
        () => now,
      )).rejects.toThrow(
        checkboxCount === 2
          ? "Garmin consent expected exactly 3 data-sharing checkboxes."
          : "Garmin consent did not expose one enabled Save action.",
      );
    },
  );

  it("submits Garmin consent only once while the first Save result is unresolved", async () => {
    let now = 0;
    let saveClicks = 0;
    const mainFrame = authorizationFrame({
      buttons: [{
        onClick: () => {
          saveClicks += 1;
        },
        text: "Save",
      }],
      checkboxes: Array.from({ length: 3 }, () => ({
        checked: false,
        text: "",
      })),
    });
    const page = {
      frames: () => [mainFrame],
      getByRole: mainFrame.getByRole,
      locator: vi.fn(() => emptyLocator()),
      mainFrame: () => mainFrame,
      title: vi.fn(async () => "Garmin Partner Auth"),
      url: () => "https://connect.garmin.com/partner/oauthConfirm",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig({
        MURPH_E2E_CONNECT_URL:
          "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
        MURPH_E2E_PROVIDER_SOURCE: "garmin",
      }),
      () => now,
    )).rejects.toThrow(
      "Garmin consent Save did not advance the consent flow.",
    );
    expect(saveClicks).toBe(1);
    expect(now).toBe(15_000);
  });

  it("leaves exact Garmin consent untouched for a headed manual run", async () => {
    let now = 0;
    let saveClicks = 0;
    const checkboxes = Array.from({ length: 3 }, () => ({
      checked: false,
      text: "",
    }));
    const mainFrame = authorizationFrame({
      buttons: [{
        onClick: () => {
          saveClicks += 1;
        },
        text: "Save",
      }],
      checkboxes,
    });
    const page = {
      frames: () => [mainFrame],
      getByRole: mainFrame.getByRole,
      locator: vi.fn(() => emptyLocator()),
      mainFrame: () => mainFrame,
      title: vi.fn(async () => "Garmin Partner Auth"),
      url: () => "https://connect.garmin.com/partner/oauthConfirm",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };
    const config = createConfig({
      CI: undefined,
      MURPH_E2E_CONNECT_URL:
        "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
      MURPH_E2E_PROVIDER_SOURCE: "garmin",
    });

    expect(config.manualAuthorizationAllowed).toBe(true);
    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      config,
      () => now,
    )).rejects.toThrow(
      "Timed out before Junction returned the browser to Murph.",
    );
    expect(checkboxes.every((checkbox) => !checkbox.checked)).toBe(true);
    expect(saveClicks).toBe(0);
    expect(now).toBe(30_000);
  });

  it("always disables manual completion in headless mode", () => {
    expect(createConfig({
      CI: undefined,
      MURPH_E2E_PROVIDER_HEADLESS: "1",
    }).manualAuthorizationAllowed).toBe(false);
  });

  it("requires a password for Garmin", () => {
    expect(() => createConfig({
      MURPH_E2E_CONNECT_URL:
        "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
      MURPH_E2E_PROVIDER_PASSWORD: undefined,
      MURPH_E2E_PROVIDER_SOURCE: "garmin",
    })).toThrow(
      "Hosted-local Junction Garmin browser runner requires MURPH_E2E_PROVIDER_PASSWORD",
    );
  });

  it("uses stable Chrome only for automated headed CI authorization", () => {
    expect(createConfig().browserChannel).toBe("chrome");
    expect(createConfig({ CI: undefined }).browserChannel).toBeUndefined();
    expect(createConfig({
      MURPH_E2E_PROVIDER_HEADLESS: "1",
    }).browserChannel).toBeUndefined();
  });

  it("permits manual waiting only for a headed non-CI run", async () => {
    let atMurph = false;
    let waits = 0;
    const config = createConfig({ CI: undefined });
    const page = {
      frames: () => [{ url: () => "https://id.whoop.com/sign-in" }],
      getByRole: vi.fn(() => emptyLocator()),
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Sign in"),
      url: () => atMurph
        ? "https://app.example.test/home"
        : "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async () => {
        waits += 1;
        if (waits === 20) {
          atMurph = true;
        }
      }),
    };

    expect(config.manualAuthorizationAllowed).toBe(true);
    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      config,
      () => waits * 1_000,
    )).resolves.toBeUndefined();
  });

  it("permits a headed non-CI operator to complete a classified challenge", async () => {
    let atMurph = false;
    let waits = 0;
    const config = createConfig({ CI: undefined });
    const page = {
      frames: () => [{ url: () => "https://challenges.cloudflare.com/frame" }],
      title: vi.fn(async () => "Just a moment..."),
      url: () => atMurph
        ? "https://app.example.test/home"
        : "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async () => {
        waits += 1;
        if (waits === 20) {
          atMurph = true;
        }
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      config,
      () => waits * 1_000,
    )).resolves.toBeUndefined();
    expect(waits).toBe(20);
  });

  it("requires an OTP up front for headed Oura CI", () => {
    expect(() => createConfig({
      MURPH_E2E_CONNECT_URL:
        "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=oura",
      MURPH_E2E_PROVIDER_PASSWORD: undefined,
      MURPH_E2E_PROVIDER_SOURCE: "oura",
    })).toThrow(
      "requires a current MURPH_E2E_PROVIDER_OTP unless it is a headed non-CI run",
    );
  });

  it.each([302, 200])("requires the exact Murph callback with status %i", async (status) => {
    const config = createConfig();
    const response = {
      status: () => status,
      url: () =>
        "https://app.example.test/api/device-sync/connect/junction/callback?state=opaque",
    };
    const page = {
      url: () => "https://app.example.test/home",
      waitForResponse: vi.fn(async (predicate: (value: typeof response) => boolean) => {
        expect(predicate({
          ...response,
          url: () =>
            "https://app.example.test.example.invalid/api/device-sync/connect/junction/callback",
        })).toBe(false);
        expect(predicate({
          ...response,
          url: () => "https://app.example.test/api/device-sync/connect/junction/callback-lookalike",
        })).toBe(false);
        expect(predicate(response)).toBe(true);
        return response;
      }),
    };

    const result = expect(completeHostedLocalJunctionAuthorizationForTest(
      page as never,
      config,
    ));
    if (status === 302) {
      await result.resolves.toBeUndefined();
    } else {
      await result.rejects.toThrow(
        "Murph did not complete the Junction callback redirect.",
      );
    }
  });
});
