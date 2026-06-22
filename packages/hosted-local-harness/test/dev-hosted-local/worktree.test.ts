import { beforeEach, describe, expect, it, vi } from "vitest";

type SpawnSyncResult = {
  error?: Error;
  status: number | null;
  stderr?: string;
  stdout?: string;
};

const worktreeMocks = vi.hoisted(() => ({
  cleanupHostedLocalMinioBuildContainersBestEffort: vi.fn(async () => {}),
  cleanupHostedRunnerContainers: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }),
  rename: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
  spawnSync: vi.fn<() => SpawnSyncResult>(() => ({
    status: 0,
    stderr: "",
    stdout: "",
  })),
  terminateKnownHostedLocalProcessResidue: vi.fn(() => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("node:child_process", () => ({
  spawnSync: worktreeMocks.spawnSync,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: worktreeMocks.mkdir,
  readFile: worktreeMocks.readFile,
  rename: worktreeMocks.rename,
  rm: worktreeMocks.rm,
  writeFile: worktreeMocks.writeFile,
}));

vi.mock("../../src/dev-hosted-local/minio.ts", () => ({
  cleanupHostedLocalMinioBuildContainersBestEffort:
    worktreeMocks.cleanupHostedLocalMinioBuildContainersBestEffort,
}));

vi.mock("../../src/dev-hosted-local/runtime.ts", () => ({
  cleanupHostedRunnerContainers: worktreeMocks.cleanupHostedRunnerContainers,
}));

vi.mock("../../src/dev-hosted-local/stack.ts", () => ({
  terminateKnownHostedLocalProcessResidue:
    worktreeMocks.terminateKnownHostedLocalProcessResidue,
}));

import {
  buildHostedLocalWorktreeConfig,
  buildHostedLocalWorktreeManifest,
  ensureHostedLocalWorktreeDatabase,
  formatHostedLocalWorktreeEnv,
  resolveHostedLocalWorktreeConfig,
  resolveHostedLocalWorktreeBuildId,
  resolveHostedLocalWorktreeDevConfig,
  stopHostedLocalWorktreeResources,
  writeHostedLocalWorktreeManifest,
} from "../../src/dev-hosted-local/worktree.ts";

const ports = {
  minio: 9101,
  temporal: 7301,
  web: 3101,
  worker: 8801,
};

describe("hosted-local worktree config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worktreeMocks.readFile.mockImplementation(async () => {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });
    worktreeMocks.spawnSync.mockImplementation(() => ({
      status: 0,
      stderr: "",
      stdout: "",
    }));
  });

  it("derives isolated non-secret config from the slug", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_WEB_PORT: "3000",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.slug).toBe("feature-a");
    expect(config.databaseName).toBe("murph_dev_feature_a");
    expect(config.buildId).toBe("worktree-feature-a");
    expect(config.manifestPath).toBe(
      ".tmp/hosted-local-worktrees/feature-a/manifest.json",
    );
    expect(config.paths).toMatchObject({
      cryptoStatePath:
        ".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars",
      linqWebhookRegistrationCachePath:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      linqWebhookTunnelConfigPath:
        ".tmp/hosted-local-worktrees/feature-a/cloudflared-linq-webhook.yml",
      minioDataDir: ".tmp/hosted-local-worktrees/feature-a/minio-r2",
      tempDir: ".tmp/hosted-local-worktrees/feature-a/temp",
      wranglerPersistDir: "../.tmp/hosted-local-worktrees/feature-a/wrangler-state",
    });
    expect(config.env).toMatchObject({
      MURPH_HOSTED_LOCAL_PROFILE: "worktree",
      MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH:
        ".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars",
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      MURPH_DEV_MINIO_PORT: "9101",
      MURPH_DEV_TEMPORAL: "managed",
      MURPH_DEV_TEMPORAL_PORT: "7301",
      MURPH_DEV_WEB_PORT: "3101",
      MURPH_DEV_WORKER_PORT: "8801",
      NEXT_DIST_DIR_MODE: "smoke",
      NEXT_DIST_DIR_SUFFIX: "feature-a",
    });

    const rendered = formatHostedLocalWorktreeEnv(config);
    expect(rendered).toContain("export MURPH_DEV_DATABASE_URL='[redacted]'");
    expect(rendered).toContain("export MURPH_DEV_WEB_PORT='3101'");
    expect(rendered).not.toContain(config.databaseUrl);
  });

  it("preserves an existing loopback local database authority while replacing the database name", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_DATABASE_URL: "postgresql://postgres@localhost:6543/existing_db",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.databaseUrl).toBe(
      "postgresql://postgres@localhost:6543/murph_dev_feature_a",
    );
  });

  it("probes available ports for the default config resolution path", async () => {
    const config = await resolveHostedLocalWorktreeConfig({
      env: {},
      slug: "feature-a",
    });

    expect(config.ports.web).toBeGreaterThanOrEqual(3100);
    expect(config.ports.web).toBeLessThan(3400);
    expect(config.ports.worker).toBeGreaterThanOrEqual(8800);
    expect(config.ports.worker).toBeLessThan(9100);
    expect(config.ports.temporal).toBeGreaterThanOrEqual(7300);
    expect(config.ports.temporal).toBeLessThan(7600);
    expect(config.ports.minio).toBeGreaterThanOrEqual(9100);
    expect(config.ports.minio).toBeLessThan(9400);
  });

  it("rejects slugs that cannot safely name local resources", () => {
    expect(() =>
      buildHostedLocalWorktreeConfig({
        env: {},
        ports,
        slug: "a",
      })
    ).toThrow("worktree slug");
    expect(() =>
      buildHostedLocalWorktreeConfig({
        env: {},
        ports,
        slug: "../bad",
      })
    ).toThrow("worktree slug");
    expect(() =>
      buildHostedLocalWorktreeConfig({
        env: {},
        ports,
        slug: "Bad",
      })
    ).toThrow("worktree slug");
  });

  it("builds a non-secret manifest", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    const manifest = buildHostedLocalWorktreeManifest(config);

    expect(manifest).toMatchObject({
      buildId: "worktree-feature-a",
      databaseName: "murph_dev_feature_a",
      profileName: "worktree",
      schemaVersion: 1,
      slug: "feature-a",
    });
    expect(JSON.stringify(manifest)).not.toContain(config.databaseUrl);
  });

  it("writes the manifest atomically without persisting database credentials", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });

    const manifest = await writeHostedLocalWorktreeManifest(config);

    expect(manifest.slug).toBe("feature-a");
    expect(worktreeMocks.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(".tmp/hosted-local-worktrees/feature-a"),
      { mode: 0o700, recursive: true },
    );
    expect(worktreeMocks.writeFile).toHaveBeenCalledTimes(1);
    const [tempPath, contents, writeOptions] = worktreeMocks.writeFile.mock.calls[0]!;
    expect(String(tempPath)).toContain("manifest.json.");
    expect(String(contents)).toContain('"slug": "feature-a"');
    expect(String(contents)).not.toContain(config.databaseUrl);
    expect(writeOptions).toMatchObject({
      encoding: "utf8",
      mode: 0o600,
    });
    expect(worktreeMocks.rename).toHaveBeenCalledWith(
      tempPath,
      expect.stringContaining(".tmp/hosted-local-worktrees/feature-a/manifest.json"),
    );
  });

  it("skips local database setup when the explicit skip flag is set", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_SKIP_WORKTREE_DB_CREATE: "1",
      },
      ports,
      slug: "feature-a",
    });

    await ensureHostedLocalWorktreeDatabase(config);

    expect(worktreeMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("creates the slug-specific local database when createdb succeeds", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });

    await ensureHostedLocalWorktreeDatabase(config);

    expect(worktreeMocks.spawnSync).toHaveBeenCalledTimes(1);
    expect(worktreeMocks.spawnSync).toHaveBeenCalledWith(
      "createdb",
      expect.arrayContaining([
        "--host",
        "127.0.0.1",
        "--port",
        "5432",
        "--username",
        "postgres",
        "murph_dev_feature_a",
      ]),
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
  });

  it("accepts an existing local database when psql can connect", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    worktreeMocks.spawnSync
      .mockReturnValueOnce({
        status: 1,
        stderr: "database already exists",
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stderr: "",
        stdout: "1",
      });

    await ensureHostedLocalWorktreeDatabase(config);

    expect(worktreeMocks.spawnSync).toHaveBeenNthCalledWith(
      2,
      "psql",
      expect.arrayContaining([
        "--dbname",
        "murph_dev_feature_a",
        "--command",
        "select 1",
      ]),
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
  });

  it("redacts database diagnostics when local database setup fails", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    worktreeMocks.spawnSync
      .mockReturnValueOnce({
        status: 1,
        stderr: "could not connect to postgresql://postgres@127.0.0.1:5432/murph_dev_feature_a",
        stdout: "",
      })
      .mockReturnValueOnce({
        status: 1,
        stderr: "password postgres rejected",
        stdout: "",
      });

    let message = "";
    try {
      await ensureHostedLocalWorktreeDatabase(config);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("Unable to create or reach local Postgres database");
    expect(message).toContain("postgresql://<redacted>");
    expect(message).toContain("password <redacted>");
    expect(message).not.toContain("postgres@127.0.0.1");
  });

  it("rejects non-loopback or non-Postgres database URLs before shelling out", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });

    await expect(
      ensureHostedLocalWorktreeDatabase({
        ...config,
        databaseUrl: "mysql://postgres@127.0.0.1:5432/murph_dev_feature_a",
      }),
    ).rejects.toThrow("PostgreSQL");
    await expect(
      ensureHostedLocalWorktreeDatabase({
        ...config,
        databaseUrl: "postgresql://postgres@db.example.test:5432/murph_dev_feature_a",
      }),
    ).rejects.toThrow("loopback Postgres");
    expect(worktreeMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("resolves the stack config used by worktree down", () => {
    const config = resolveHostedLocalWorktreeDevConfig({
      env: {},
      slug: "feature-a",
    });

    expect(config.linqWebhookRegistrationCachePath).toBe(
      ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
    );
    expect(config.temporal.mode).toBe("managed");
    expect(config.workerPersistDir).toBe(
      "../.tmp/hosted-local-worktrees/feature-a/wrangler-state",
    );
  });

  it("normalizes slugs before deriving stack config ports", () => {
    const config = resolveHostedLocalWorktreeDevConfig({
      env: {},
      slug: " feature-a ",
    });

    expect(config.webPort).toBe(
      resolveHostedLocalWorktreeDevConfig({
        env: {},
        slug: "feature-a",
      }).webPort,
    );
  });

  it("stops only slug-scoped process, runner, and MinIO resources", async () => {
    await stopHostedLocalWorktreeResources({
      env: {},
      slug: "feature-a",
    });

    expect(worktreeMocks.terminateKnownHostedLocalProcessResidue).toHaveBeenCalledWith(
      expect.objectContaining({
        owned: expect.objectContaining({
          cloudflareWorker: true,
          linqTunnel: true,
          stripe: true,
          web: true,
        }),
        signal: "SIGTERM",
        stripeForwardUrl: expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:\d+\/api\/hosted-onboarding\/stripe\/webhook$/u,
        ),
      }),
    );
    expect(worktreeMocks.cleanupHostedRunnerContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          MURPH_HOSTED_LOCAL_PROFILE: "worktree",
          NEXT_DIST_DIR_SUFFIX: "feature-a",
        }),
        ignoreErrors: true,
        scope: "current-build",
      }),
    );
    expect(
      worktreeMocks.cleanupHostedLocalMinioBuildContainersBestEffort,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_HOSTED_LOCAL_PROFILE: "worktree",
      }),
      "worktree-feature-a",
    );
    expect(worktreeMocks.rm).toHaveBeenCalledWith(
      expect.stringContaining(".tmp/hosted-local-worktrees/feature-a/manifest.json"),
      { force: true },
    );
  });

  it("uses manifest ports when stopping a probed-port worktree", async () => {
    worktreeMocks.readFile.mockResolvedValueOnce(JSON.stringify({
      ports: {
        minio: 9108,
        temporal: 7308,
        web: 3108,
        worker: 8808,
      },
      profileName: "worktree",
      schemaVersion: 1,
      slug: "feature-a",
    }));

    await stopHostedLocalWorktreeResources({
      env: {},
      slug: "feature-a",
    });

    expect(worktreeMocks.terminateKnownHostedLocalProcessResidue).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          temporal: expect.objectContaining({
            port: 7308,
          }),
          webPort: 3108,
          workerPort: 8808,
        }),
        stripeForwardUrl:
          "http://127.0.0.1:3108/api/hosted-onboarding/stripe/webhook",
      }),
    );
    expect(
      worktreeMocks.cleanupHostedLocalMinioBuildContainersBestEffort,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_DEV_MINIO_PORT: "9108",
      }),
      "worktree-feature-a",
    );
  });

  it("derives the same hashed build id as runner cleanup", () => {
    expect(resolveHostedLocalWorktreeBuildId("feature-a")).toMatch(
      /^sha256-[a-f0-9]{24}$/u,
    );
    expect(resolveHostedLocalWorktreeBuildId("feature-a")).toBe(
      resolveHostedLocalWorktreeBuildId("feature-a"),
    );
  });
});
