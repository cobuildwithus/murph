import { beforeEach, describe, expect, it, vi } from "vitest";

type SpawnSyncResult = {
  error?: Error;
  status: number | null;
  stderr?: string;
  stdout?: string;
};

const worktreeMocks = vi.hoisted(() => ({
  readFile: vi.fn(async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }),
  spawnSync: vi.fn<() => SpawnSyncResult>(() => ({
    status: 0,
    stderr: "",
    stdout: "",
  })),
}));

vi.mock("node:child_process", () => ({
  spawnSync: worktreeMocks.spawnSync,
}));

vi.mock("node:fs/promises", () => ({
  readFile: worktreeMocks.readFile,
}));

import {
  buildHostedLocalWorktreeConfig,
  ensureHostedLocalWorktreeDatabase,
  formatHostedLocalWorktreeEnv,
  removeCreatedHostedLocalWorktreeDatabaseIfUnpaired,
  resolveHostedLocalWorktreeConfig,
  resolveHostedLocalWorktreeBuildId,
  resolveHostedLocalWorktreeDevConfig,
} from "../../src/dev-hosted-local/worktree.ts";

const ports = {
  minio: 9101,
  temporal: 7301,
  web: 3101,
  worker: 8801,
};

function buildValidHostedLocalWorktreeCryptoStateText(
  overrides: Record<string, string> = {},
): string {
  const privateJwk = JSON.stringify({
    crv: "P-256",
    d: "test-d",
    kty: "EC",
    x: "test-x",
    y: "test-y",
  });
  const publicJwkRecord = {
    crv: "P-256",
    kty: "EC",
    x: "test-x",
    y: "test-y",
  };
  const publicJwk = JSON.stringify(publicJwkRecord);
  const publicKeyPem =
    "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----";
  const authorityVersion =
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/local-test";
  const values = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: authorityVersion,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: publicKeyPem,
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
      [authorityVersion]: {
        publicKeyPem,
        status: "active",
      },
    }),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
      "cloudflare-automation:local",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: privateJwk,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: publicJwk,
    HOSTED_CRYPTO_ENV: "local",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: authorityVersion,
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: publicKeyPem,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: privateJwk,
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: "local-wrap-key",
    HOSTED_DEVICE_ROUTING_INDEX_KEY: "device-routing-key",
    HOSTED_LOG_FINGERPRINT_SECRET: "local-log-fingerprint-secret",
    HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "v1",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: privateJwk,
    HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON: JSON.stringify({
      v1: publicJwkRecord,
    }),
    ...overrides,
  };

  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

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
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
        ".tmp/hosted-local-worktrees/feature-a/cloudflared-linq-webhook.yml",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
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
    expect(rendered).toContain("export MURPH_DEV_LINQ_WEBHOOK_TUNNEL='0'");
    expect(rendered).toContain("export MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER='1'");
    expect(rendered).toContain("export MURPH_DEV_WEB_PORT='3101'");
    expect(rendered).not.toContain(config.databaseUrl);
  });

  it("rejects live Linq tunnel opt-in without a dedicated worktree tunnel", () => {
    expect(() =>
      buildHostedLocalWorktreeConfig({
        env: {
          MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "1",
          MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "dev",
        },
        ports,
        slug: "feature-a",
      })
    ).toThrow("live Linq tunnel delivery requires");
  });

  it("allows explicit live Linq opt-in with a dedicated worktree tunnel", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "required",
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
          ".tmp/cloudflared-linq-webhook.feature-a.yml",
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "feature-a",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env).toMatchObject({
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "required",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
        ".tmp/cloudflared-linq-webhook.feature-a.yml",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "feature-a",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "0",
    });
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

  it("uses deterministic preferred ports when probing is disabled", async () => {
    const config = await resolveHostedLocalWorktreeConfig({
      env: {},
      probePorts: false,
      slug: "feature-a",
    });
    const repeated = await resolveHostedLocalWorktreeConfig({
      env: {},
      probePorts: false,
      slug: "feature-a",
    });

    expect(config.ports).toEqual(repeated.ports);
    expect(worktreeMocks.readFile).not.toHaveBeenCalled();
    expect(config.urls.webBaseUrl).toBe(`http://127.0.0.1:${config.ports.web}`);
    expect(config.urls.workerBaseUrl).toBe(`http://127.0.0.1:${config.ports.worker}`);
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

  it("validates paired crypto state when the explicit database create skip flag is set", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_SKIP_WORKTREE_DB_CREATE: "1",
      },
      ports,
      slug: "feature-a",
    });
    worktreeMocks.readFile.mockResolvedValueOnce(
      buildValidHostedLocalWorktreeCryptoStateText(),
    );

    await expect(ensureHostedLocalWorktreeDatabase(config)).resolves.toEqual({
      created: false,
    });

    expect(worktreeMocks.readFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars"),
      "utf8",
    );
    expect(worktreeMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("refuses the database create skip flag when paired crypto state is missing", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_SKIP_WORKTREE_DB_CREATE: "1",
      },
      ports,
      slug: "feature-a",
    });

    await expect(ensureHostedLocalWorktreeDatabase(config)).rejects.toThrow(
      "paired hosted-local crypto state file is missing",
    );

    expect(worktreeMocks.spawnSync).not.toHaveBeenCalled();
  });

  it("creates the slug-specific local database when createdb succeeds", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });

    await expect(ensureHostedLocalWorktreeDatabase(config)).resolves.toEqual({
      created: true,
    });

    expect(worktreeMocks.readFile).not.toHaveBeenCalled();
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
    worktreeMocks.readFile.mockResolvedValueOnce(
      buildValidHostedLocalWorktreeCryptoStateText(),
    );

    await expect(ensureHostedLocalWorktreeDatabase(config)).resolves.toEqual({
      created: false,
    });

    expect(worktreeMocks.readFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars"),
      "utf8",
    );
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

  it("refuses to reuse a slug database when its paired crypto state is missing", async () => {
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
    await expect(ensureHostedLocalWorktreeDatabase(config)).rejects.toThrow(
      "paired hosted-local crypto state file is missing",
    );
  });

  it("refuses to reuse a slug database when its paired crypto state is truncated", async () => {
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
    worktreeMocks.readFile.mockResolvedValueOnce('HOSTED_CRYPTO_ENV="local"\n');

    await expect(ensureHostedLocalWorktreeDatabase(config)).rejects.toThrow(
      "paired hosted-local crypto state file is incomplete",
    );
  });

  it("drops a newly created slug database only while crypto state is still unpaired", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });

    await expect(
      removeCreatedHostedLocalWorktreeDatabaseIfUnpaired(config),
    ).resolves.toEqual({
      removed: true,
      unpaired: true,
    });

    expect(worktreeMocks.spawnSync).toHaveBeenCalledWith(
      "dropdb",
      expect.arrayContaining([
        "--host",
        "127.0.0.1",
        "--port",
        "5432",
        "--username",
        "postgres",
        "--if-exists",
        "murph_dev_feature_a",
      ]),
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
  });

  it("keeps a newly created slug database after durable crypto state exists", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    worktreeMocks.readFile.mockResolvedValueOnce(
      buildValidHostedLocalWorktreeCryptoStateText(),
    );

    await expect(
      removeCreatedHostedLocalWorktreeDatabaseIfUnpaired(config),
    ).resolves.toEqual({
      removed: false,
      unpaired: false,
    });

    expect(worktreeMocks.spawnSync).not.toHaveBeenCalled();
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

  it("resolves the stack config used by the worktree profile", () => {
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

  it("derives the same hashed build id as runner cleanup", () => {
    expect(resolveHostedLocalWorktreeBuildId("feature-a")).toMatch(
      /^sha256-[a-f0-9]{24}$/u,
    );
    expect(resolveHostedLocalWorktreeBuildId("feature-a")).toBe(
      resolveHostedLocalWorktreeBuildId("feature-a"),
    );
  });
});
