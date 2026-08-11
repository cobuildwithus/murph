import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_LOCAL_MINIO_MIRROR_IMAGE } from "../../src/dev-hosted-local/minio-image-contract.ts";

const runtimeMocks = vi.hoisted(() => ({
  spawnChildProcess: vi.fn(),
  terminateChildProcessAndWait: vi.fn(async () => {}),
  waitForHealthyHttpEndpoint: vi.fn(async () => {}),
}));

const childProcessMocks = vi.hoisted(() => ({
  spawnedChildren: [] as Array<EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
  }>,
  spawnResponses: [] as Array<{
    error?: Error;
    exitCode?: number;
    hang?: boolean;
    stderr?: string;
    stdout?: string;
  }>,
  spawn: vi.fn((command: string, args: readonly string[]) => {
    const child = new EventEmitter();
    const defaultResponse = command === "docker"
      && args[0] === "network"
      && args[1] === "inspect"
      ? { stdout: "172.17.0.1\n" }
      : {};
    const response = childProcessMocks.spawnResponses.shift() ?? defaultResponse;
    Object.assign(child, {
      kill: vi.fn(() => true),
      stderr: new EventEmitter(),
      stdout: new EventEmitter(),
    });
    childProcessMocks.spawnedChildren.push(child as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
    });
    if (!response.hang) {
      queueMicrotask(() => {
        if (response.error) {
          child.emit("error", response.error);
          return;
        }
        if (response.stdout) {
          (child as EventEmitter & { stdout: EventEmitter }).stdout.emit("data", response.stdout);
        }
        if (response.stderr) {
          (child as EventEmitter & { stderr: EventEmitter }).stderr.emit("data", response.stderr);
        }
        child.emit("exit", response.exitCode ?? 0);
      });
    }
    return child;
  }),
}));

const netMocks = vi.hoisted(() => ({
  listenErrors: [] as Error[],
  listens: [] as Array<{
    host: string;
    port: number;
  }>,
}));

const httpMocks = vi.hoisted(() => ({
  healthStatuses: [] as Array<"error" | number>,
  request: vi.fn((_: unknown, onResponse: (response: EventEmitter & {
    resume: () => void;
    statusCode?: number;
  }) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      destroy: () => void;
      end: () => void;
      setTimeout: (timeoutMs: number, callback: () => void) => void;
    };
    request.destroy = vi.fn();
    request.setTimeout = vi.fn();
    request.end = () => {
      const next = httpMocks.healthStatuses.shift() ?? 200;
      queueMicrotask(() => {
        if (next === "error") {
          request.emit("error", new Error("minio health failed"));
          return;
        }
        const response = new EventEmitter() as EventEmitter & {
          resume: () => void;
          statusCode?: number;
        };
        response.statusCode = next;
        response.resume = vi.fn();
        onResponse(response);
        response.emit("end");
      });
    };
    return request;
  }),
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

vi.mock("node:http", () => ({
  default: {
    request: httpMocks.request,
  },
}));

vi.mock("node:net", () => ({
  default: {
    createServer: () => {
      const server = new EventEmitter() as EventEmitter & {
        address: () => { port: number };
        close: (callback: (error?: Error) => void) => void;
        listen: (port: number, host: string) => void;
      };
      let boundPort = 49_000 + netMocks.listens.length;
      server.address = () => ({ port: boundPort });
      server.close = (callback) => queueMicrotask(() => callback());
      server.listen = (port, host) => {
        boundPort = port === 0 ? boundPort : port;
        netMocks.listens.push({ host, port: boundPort });
        const listenError = netMocks.listenErrors.shift();
        if (listenError) {
          queueMicrotask(() => server.emit("error", listenError));
          return;
        }
        queueMicrotask(() => server.emit("listening"));
      };
      return server;
    },
  },
}));

vi.mock("../../src/dev-hosted-local/runtime.ts", () => runtimeMocks);

describe("hosted-local MinIO sidecar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    childProcessMocks.spawnedChildren = [];
    childProcessMocks.spawnResponses = [];
    httpMocks.healthStatuses = [];
    netMocks.listenErrors = [];
    netMocks.listens = [];
  });

  it("starts a container-reachable S3-compatible endpoint for hosted-local E2E", async () => {
    const child = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess.mockReturnValueOnce(child);
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    const server = await maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      pullImage: async () => true,
      tempDir: ".tmp/hosted-local-minio-test",
    });

    expect(server?.process).toBe(child);
    expect(server?.containerName).toMatch(/^murph-hosted-local-r2-/u);
    const expectedControlHost = process.platform === "linux" ? "172.17.0.1" : "127.0.0.1";
    const expectedEndpointHost = process.platform === "linux"
      ? "172.17.0.1"
      : "host.docker.internal";
    const dockerEnv = runtimeMocks.spawnChildProcess.mock.calls[0]?.[3] as Record<string, string>;
    expect(dockerEnv.MINIO_ROOT_USER).toMatch(/^murph-local-[a-f0-9]{24}$/u);
    expect(dockerEnv.MINIO_ROOT_PASSWORD).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(dockerEnv.MINIO_ROOT_USER).not.toBe("hosted-local-r2-access-key");
    expect(dockerEnv.MINIO_ROOT_PASSWORD).not.toBe("hosted-local-r2-secret-key");
    expect(server?.env).toEqual(expect.objectContaining({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: dockerEnv.MINIO_ROOT_USER,
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "hosted-local-r2-account",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-local-r2-bundles",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT:
        expect.stringMatching(new RegExp(`^http://${expectedControlHost.replace(/\./gu, "\\.")}:\\d+$`, "u")),
      HOSTED_R2_PRESIGN_ENDPOINT:
        expect.stringMatching(new RegExp(`^http://${expectedEndpointHost.replace(/\./gu, "\\.")}:\\d+$`, "u")),
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: dockerEnv.MINIO_ROOT_PASSWORD,
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    }));
    expect(server?.env).not.toHaveProperty("MURPH_HOSTED_LOCAL_PROFILE");
    if (process.platform === "linux") {
      expect(server?.env).toHaveProperty(
        "MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST",
        "172.17.0.1",
      );
    } else {
      expect(server?.env).not.toHaveProperty("MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST");
    }
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["rm", "-f"]),
      expect.objectContaining({ stdio: "ignore" }),
    );
    const dockerArgs = runtimeMocks.spawnChildProcess.mock.calls[0]?.[2] as string[];
    const publishArg = dockerArgs[dockerArgs.indexOf("-p") + 1];
    const volumeArg = dockerArgs[dockerArgs.indexOf("-v") + 1];
    const expectedPublishHost = process.platform === "linux" ? "172.17.0.1" : "127.0.0.1";
    expect(publishArg).toEqual(
      expect.stringMatching(new RegExp(`^${expectedPublishHost.replace(/\./gu, "\\.")}:\\d+:9000$`, "u")),
    );
    expect(volumeArg).toBe(".tmp/hosted-local-minio-test/minio-r2:/data");
    expect(dockerArgs).toContain("murph.hosted-local.role=r2-minio");
    expect(dockerArgs).toContain("murph.hosted-local.build-id=build-test");
    expect(dockerArgs).toContain("murph.hosted-local.e2e=1");
    expect(dockerArgs).toContain("MINIO_REGION_NAME");
    // GHCR first; the upstream ref is only the fallback when that is unreachable.
    expect(dockerArgs).toContain(HOSTED_LOCAL_MINIO_MIRROR_IMAGE);
    if (typeof process.getuid === "function" && typeof process.getgid === "function") {
      expect(dockerArgs).toEqual(expect.arrayContaining([
        "--user",
        `${process.getuid()}:${process.getgid()}`,
      ]));
    }
    expect(runtimeMocks.spawnChildProcess.mock.calls[0]?.[3]).toEqual(expect.objectContaining({
      MINIO_REGION_NAME: "auto",
    }));
    expect(runtimeMocks.waitForHealthyHttpEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        host: expectedControlHost,
        label: "minio",
      }),
    );
    if (process.platform === "linux") {
      expect(childProcessMocks.spawn).toHaveBeenCalledWith(
        "docker",
        [
          "network",
          "inspect",
          "bridge",
          "--format",
          "{{range .IPAM.Config}}{{if .Gateway}}{{.Gateway}}{{end}}{{end}}",
        ],
        expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
      );
    } else {
      expect(childProcessMocks.spawn).not.toHaveBeenCalledWith(
        "docker",
        expect.arrayContaining(["network", "inspect", "bridge"]),
        expect.anything(),
      );
    }
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "docker",
      [
        "ps",
        "-aq",
        "--filter",
        "label=murph.hosted-local.role=r2-minio",
        "--filter",
        "label=murph.hosted-local.build-id=build-test",
      ],
      expect.objectContaining({ stdio: ["ignore", "pipe", "ignore"] }),
    );
  });

  it("removes owned stale MinIO containers before checking whether the publish port is still busy", async () => {
    netMocks.listenErrors = [new Error("busy")];
    childProcessMocks.spawnResponses = [
      ...(process.platform === "linux" ? [{ stdout: "172.17.0.1\n" }] : []),
    ];
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    await expect(maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_DEV_MINIO_PORT: "49123",
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    })).rejects.toThrow("MURPH_DEV_MINIO_PORT port 49123 is already in use");

    expect(childProcessMocks.spawn.mock.calls.some(([, args]) => args[0] === "rm"))
      .toBe(true);
    expect(runtimeMocks.spawnChildProcess).not.toHaveBeenCalled();
  });

  it("fails symbolic Docker host aliases on Linux when the bridge gateway cannot be resolved", async () => {
    if (process.platform !== "linux") {
      expect(process.platform).not.toBe("linux");
      return;
    }
    childProcessMocks.spawnResponses = [
      {
        exitCode: 1,
        stderr: "bridge unavailable",
      },
    ];
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    await expect(maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    })).rejects.toThrow("bridge unavailable");
    expect(runtimeMocks.spawnChildProcess).not.toHaveBeenCalled();
  });

  it("starts a complete local R2 presign sidecar for the normal hosted-local dev profile", async () => {
    const child = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess.mockReturnValueOnce(child);
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    const server = await maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    });

    expect(server?.process).toBe(child);
    const dockerEnv = runtimeMocks.spawnChildProcess.mock.calls[0]?.[3] as Record<string, string>;
    expect(dockerEnv.MINIO_ROOT_USER).toMatch(/^murph-local-[a-f0-9]{24}$/u);
    expect(dockerEnv.MINIO_ROOT_PASSWORD).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(server?.env).toEqual(expect.objectContaining({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: dockerEnv.MINIO_ROOT_USER,
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "hosted-local-r2-account",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-local-r2-bundles",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/u),
      HOSTED_R2_PRESIGN_ENDPOINT: expect.stringMatching(/^http:\/\/host\.docker\.internal:\d+$/u),
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: dockerEnv.MINIO_ROOT_PASSWORD,
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
    }));
    expect(server?.env).not.toHaveProperty("MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED");
    expect(runtimeMocks.spawnChildProcess).toHaveBeenCalledWith(
      "minio",
      "docker",
      expect.arrayContaining(["run"]),
      expect.objectContaining({
        MINIO_ROOT_PASSWORD: dockerEnv.MINIO_ROOT_PASSWORD,
        MINIO_ROOT_USER: dockerEnv.MINIO_ROOT_USER,
      }),
      expect.any(Object),
    );
    const dockerArgs = runtimeMocks.spawnChildProcess.mock.calls[0]?.[2] as string[];
    const volumeArg = dockerArgs[dockerArgs.indexOf("-v") + 1];
    expect(dockerArgs).not.toContain("murph.hosted-local.e2e=1");
    expect(volumeArg).toEqual(
      expect.stringMatching(/[\\/]\.tmp[\\/]hosted-local-minio-r2:\/data$/u),
    );
  });

  it("allows overriding the interactive dev MinIO data directory", async () => {
    const child = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess.mockReturnValueOnce(child);
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    await maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_DEV_MINIO_DATA_DIR: ".tmp/custom-hosted-local-minio",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    });

    const dockerArgs = runtimeMocks.spawnChildProcess.mock.calls[0]?.[2] as string[];
    const volumeArg = dockerArgs[dockerArgs.indexOf("-v") + 1];
    expect(volumeArg).toEqual(
      expect.stringMatching(/[\\/]\.tmp[\\/]custom-hosted-local-minio:\/data$/u),
    );
  });

  it("starts MinIO for worktree-scoped dev env with worktree-local data", async () => {
    const child = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess.mockReturnValueOnce(child);
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    const server = await maybeStartHostedLocalMinio({
      buildId: "worktree-feature-a",
      containerHost: "host.docker.internal",
      env: {
        MURPH_DEV_MINIO_DATA_DIR: ".tmp/hosted-local-worktrees/feature-a/minio-r2",
        MURPH_DEV_WORKTREE_SCOPE: "feature-a",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    });

    expect(server?.process).toBe(child);
    expect(server?.env).toEqual(expect.objectContaining({
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
    }));
    expect(server?.env).not.toHaveProperty("MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED");
    const dockerArgs = runtimeMocks.spawnChildProcess.mock.calls[0]?.[2] as string[];
    const volumeArg = dockerArgs[dockerArgs.indexOf("-v") + 1];
    expect(volumeArg).toEqual(
      expect.stringMatching(/[\\/]\.tmp[\\/]hosted-local-worktrees[\\/]feature-a[\\/]minio-r2:\/data$/u),
    );
    expect(dockerArgs).not.toContain("murph.hosted-local.e2e=1");
  });

  it("accepts an exact Docker bridge gateway and marks the hosted-local R2 endpoint for private bridge presign", async () => {
    childProcessMocks.spawnResponses = [
      { stdout: "172.17.0.1\n" },
      {},
      { stdout: "" },
    ];
    const child = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess.mockReturnValueOnce(child);
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    const server = await maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "172.17.0.1",
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      pullImage: async () => true,
      tempDir: ".tmp/hosted-local-minio-test",
    });

    expect(server?.env).toEqual(expect.objectContaining({
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: expect.stringMatching(/^http:\/\/172\.17\.0\.1:\d+$/u),
      HOSTED_R2_PRESIGN_ENDPOINT: expect.stringMatching(/^http:\/\/172\.17\.0\.1:\d+$/u),
      MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: "172.17.0.1",
    }));
    const dockerArgs = runtimeMocks.spawnChildProcess.mock.calls[0]?.[2] as string[];
    expect(dockerArgs[dockerArgs.indexOf("-p") + 1]).toEqual(
      expect.stringMatching(/^172\.17\.0\.1:\d+:9000$/u),
    );
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "docker",
      [
        "network",
        "inspect",
        "bridge",
        "--format",
        "{{range .IPAM.Config}}{{if .Gateway}}{{.Gateway}}{{end}}{{end}}",
      ],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("rejects arbitrary private and LAN hosts that are not the exact Docker bridge gateway", async () => {
    childProcessMocks.spawnResponses = [
      { stdout: "172.17.0.1\n" },
    ];
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    await expect(maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "192.168.1.20",
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    })).rejects.toThrow("rejects arbitrary private/LAN hosts");
    expect(runtimeMocks.spawnChildProcess).not.toHaveBeenCalled();
  });

  it("uses label-scoped cleanup for stale hosted-local MinIO containers", async () => {
    childProcessMocks.spawnResponses = [
      {},
      { stdout: "container-a\ncontainer-b\n" },
      {},
    ];
    const { cleanupHostedLocalMinioContainerBestEffort } = await import("../../src/dev-hosted-local/minio.ts");

    await cleanupHostedLocalMinioContainerBestEffort(
      { DOCKER_CONFIG: ".tmp/docker-config" },
      "murph-hosted-local-r2-build-test",
    );

    expect(childProcessMocks.spawn).toHaveBeenNthCalledWith(
      2,
      "docker",
      [
        "ps",
        "-aq",
        "--filter",
        "label=murph.hosted-local.role=r2-minio",
        "--filter",
        "label=murph.hosted-local.build-id=build-test",
      ],
      expect.objectContaining({
        env: { DOCKER_CONFIG: ".tmp/docker-config" },
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    expect(childProcessMocks.spawn).toHaveBeenNthCalledWith(
      3,
      "docker",
      ["rm", "-f", "container-a", "container-b"],
      expect.objectContaining({ stdio: "ignore" }),
    );
  });

  it("uses E2E labels for hosted-local E2E MinIO cleanup", async () => {
    childProcessMocks.spawnResponses = [
      { stdout: "container-a\ncontainer-b\n" },
      {},
    ];
    const { cleanupHostedLocalMinioE2eContainersBestEffort } = await import("../../src/dev-hosted-local/minio.ts");

    await cleanupHostedLocalMinioE2eContainersBestEffort({
      DOCKER_CONFIG: ".tmp/docker-config",
    });

    expect(childProcessMocks.spawn).toHaveBeenNthCalledWith(
      1,
      "docker",
      [
        "ps",
        "-aq",
        "--filter",
        "label=murph.hosted-local.role=r2-minio",
        "--filter",
        "label=murph.hosted-local.e2e=1",
      ],
      expect.objectContaining({
        env: { DOCKER_CONFIG: ".tmp/docker-config" },
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    expect(childProcessMocks.spawn).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["rm", "-f", "container-a", "container-b"],
      expect.objectContaining({ stdio: "ignore" }),
    );
  });

  it("bounds a hung exact-child MinIO removal command", async () => {
    vi.useFakeTimers();
    childProcessMocks.spawnResponses = [
      { hang: true },
      {},
    ];
    const { cleanupHostedLocalMinioContainerBestEffort } = await import("../../src/dev-hosted-local/minio.ts");

    try {
      const cleanup = cleanupHostedLocalMinioContainerBestEffort(
        { DOCKER_CONFIG: ".tmp/docker-config" },
        "murph-hosted-local-r2-build-test",
      );
      await vi.runAllTimersAsync();

      await expect(cleanup).resolves.toBeUndefined();
      expect(childProcessMocks.spawnedChildren[0]?.kill).toHaveBeenCalledOnce();
      expect(childProcessMocks.spawnedChildren[0]?.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hung exact-child MinIO listing command", async () => {
    vi.useFakeTimers();
    childProcessMocks.spawnResponses = [{ hang: true }];
    const { cleanupHostedLocalMinioE2eContainersBestEffort } = await import("../../src/dev-hosted-local/minio.ts");

    try {
      const cleanup = cleanupHostedLocalMinioE2eContainersBestEffort({
        DOCKER_CONFIG: ".tmp/docker-config",
      });
      await vi.runAllTimersAsync();

      await expect(cleanup).resolves.toBeUndefined();
      const timedOutChild = childProcessMocks.spawnedChildren[0];
      expect(timedOutChild?.kill).toHaveBeenCalledOnce();
      expect(timedOutChild?.kill).toHaveBeenCalledWith("SIGKILL");
      expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
      expect(() => {
        timedOutChild?.emit("exit", 0);
        timedOutChild?.emit("error", new Error("late Docker error"));
      }).not.toThrow();
      expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an early Docker listing error best-effort", async () => {
    childProcessMocks.spawnResponses = [{
      error: new Error("docker unavailable"),
    }];
    const { cleanupHostedLocalMinioE2eContainersBestEffort } = await import("../../src/dev-hosted-local/minio.ts");

    await expect(cleanupHostedLocalMinioE2eContainersBestEffort({
      DOCKER_CONFIG: ".tmp/docker-config",
    })).resolves.toBeUndefined();

    expect(childProcessMocks.spawnedChildren[0]?.kill).not.toHaveBeenCalled();
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("restarts the same hosted-local R2 sidecar when health is lost", async () => {
    const firstChild = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    const restartedChild = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(restartedChild);
    httpMocks.healthStatuses = [503];
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    const server = await maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      pullImage: async () => true,
      tempDir: ".tmp/hosted-local-minio-test",
    });
    if (!server) {
      throw new Error("Expected hosted-local MinIO server.");
    }

    await expect(server.ensureReady()).resolves.toBe(restartedChild);

    expect(server.process).toBe(restartedChild);
    expect(server.processes()).toEqual([firstChild, restartedChild]);
    expect(runtimeMocks.spawnChildProcess).toHaveBeenCalledTimes(2);
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "murph-hosted-local-r2-build-test"],
      expect.objectContaining({ stdio: "ignore" }),
    );
  });

  it("does not restart hosted-local R2 when the health probe is ready", async () => {
    const child = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess.mockReturnValueOnce(child);
    httpMocks.healthStatuses = [200];
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    const server = await maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      pullImage: async () => true,
      tempDir: ".tmp/hosted-local-minio-test",
    });
    if (!server) {
      throw new Error("Expected hosted-local MinIO server.");
    }

    await expect(server.ensureReady()).resolves.toBeNull();

    expect(server.process).toBe(child);
    expect(server.processes()).toEqual([child]);
    expect(runtimeMocks.spawnChildProcess).toHaveBeenCalledTimes(1);
  });

  it("removes the named MinIO container and label-matching stale containers on startup failure", async () => {
    childProcessMocks.spawnResponses = [
      ...(process.platform === "linux" ? [{ stdout: "172.17.0.1\n" }] : []),
      {},
      { stdout: "" },
      {},
      { stdout: "" },
      {},
      { stdout: "stale-container\n" },
      {},
    ];
    const child = {
      child: new EventEmitter(),
      name: "minio",
      stderrTail: () => "",
      stderrText: () => "",
      stdoutTail: () => "",
      stdoutText: () => "",
    };
    runtimeMocks.spawnChildProcess.mockReturnValueOnce(child);
    runtimeMocks.waitForHealthyHttpEndpoint.mockRejectedValueOnce(new Error("minio unhealthy"));
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    await expect(maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    })).rejects.toThrow("minio unhealthy");

    expect(runtimeMocks.terminateChildProcessAndWait).toHaveBeenCalledWith(
      child.child,
      { signal: "SIGTERM" },
    );
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "murph-hosted-local-r2-build-test"],
      expect.objectContaining({ stdio: "ignore" }),
    );
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "stale-container"],
      expect.objectContaining({ stdio: "ignore" }),
    );
  });

  it("fails fast when MinIO is skipped without explicit hosted-local R2 endpoints", async () => {
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    await expect(maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        MURPH_DEV_SKIP_MINIO: "1",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    })).rejects.toThrow("MURPH_DEV_SKIP_MINIO=1 requires explicit hosted-local R2 presign endpoints and credentials");
    expect(runtimeMocks.spawnChildProcess).not.toHaveBeenCalled();
  });

  it("accepts explicit hosted-local R2 presign env when MinIO is intentionally skipped", async () => {
    const { maybeStartHostedLocalMinio } = await import("../../src/dev-hosted-local/minio.ts");

    await expect(maybeStartHostedLocalMinio({
      buildId: "build:test",
      containerHost: "host.docker.internal",
      env: {
        HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "explicit-access-key",
        HOSTED_R2_PRESIGN_ACCOUNT_ID: "explicit-account",
        HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
        HOSTED_R2_PRESIGN_BUCKET_NAME: "explicit-bucket",
        HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9000",
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000",
        HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "explicit-secret",
        MURPH_DEV_SKIP_MINIO: "1",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      tempDir: ".tmp/hosted-local-minio-test",
    })).resolves.toBeNull();
    expect(runtimeMocks.spawnChildProcess).not.toHaveBeenCalled();
  });
});
