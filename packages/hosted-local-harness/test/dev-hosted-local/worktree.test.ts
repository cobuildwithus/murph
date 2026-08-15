import process from "node:process";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SpawnSyncResult = {
  error?: Error;
  status: number | null;
  stderr?: string;
  stdout?: string;
};

type SpawnSyncMock = (
  command: string,
  args?: readonly string[],
  options?: unknown,
) => SpawnSyncResult;

const worktreeMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }),
  rm: vi.fn(async () => {}),
  spawnSync: vi.fn<SpawnSyncMock>(() => ({
    status: 0,
    stderr: "",
    stdout: "",
  })),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("node:child_process", () => ({
  spawnSync: worktreeMocks.spawnSync,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: worktreeMocks.mkdir,
  readFile: worktreeMocks.readFile,
  rm: worktreeMocks.rm,
  writeFile: worktreeMocks.writeFile,
}));

import {
  acquireHostedLocalWorktreeLock,
  buildHostedLocalWorktreeConfig,
  ensureHostedLocalWorktreeDatabase,
  formatHostedLocalWorktreeEnv,
  prepareHostedLocalWorktreeLinqTunnelConfig,
  removeCreatedHostedLocalWorktreeDatabaseIfCryptoStateMissing,
  resolveHostedLocalWorktreeConfig,
  resolveHostedLocalWorktreeBuildId,
  resolveHostedLocalWorktreeDevConfig,
} from "../../src/dev-hosted-local/worktree.ts";
import { applyHostedLocalProfile } from "../../src/profiles.ts";

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
    HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET:
      "local-private-media-capability-secret",
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      "local-provider-egress-signing-secret",
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
    worktreeMocks.mkdir.mockResolvedValue(undefined);
    worktreeMocks.rm.mockResolvedValue(undefined);
    worktreeMocks.writeFile.mockResolvedValue(undefined);
  });

  it("derives isolated non-secret config from the slug", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_WEB_PORT: "3000",
        MURPH_DEV_REUSE_EXISTING_WORKER: "1",
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
      wranglerPersistDir: "../.tmp/hosted-local-worktrees/feature-a/wrangler-state",
    });
    expect(config.env).toMatchObject({
      MURPH_DEV_WORKTREE_SCOPE: "feature-a",
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
      MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH:
        ".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars",
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
        ".tmp/hosted-local-worktrees/feature-a/cloudflared-linq-webhook.yml",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
      DEVICE_SYNC_PUBLIC_BASE_URL: "http://localhost:3101/api/device-sync",
      HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS:
        "http://localhost:3101,http://127.0.0.1:3101",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://localhost:3101",
      HOSTED_WEB_BASE_URL: "http://localhost:3101",
      MURPH_DEV_MINIO_PORT: "9101",
      MURPH_DEV_REUSE_EXISTING_WORKER: "0",
      MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
      MURPH_DEV_TEMPORAL: "managed",
      MURPH_DEV_TEMPORAL_PORT: "7301",
      MURPH_DEV_WEB_HOST: "localhost",
      MURPH_DEV_WEB_PORT: "3101",
      MURPH_DEV_WORKER_PORT: "8801",
      NEXT_DIST_DIR_MODE: "smoke",
      NEXT_DIST_DIR_SUFFIX: "feature-a",
    });
    expect(config.urls.webBaseUrl).toBe("http://localhost:3101");

    const rendered = formatHostedLocalWorktreeEnv(config);
    expect(rendered).toContain("export MURPH_HOSTED_LOCAL_PROFILE='dev'");
    expect(rendered).toContain("export MURPH_DEV_WORKTREE_SCOPE='feature-a'");
    expect(rendered).toContain("export MURPH_DEV_DATABASE_URL='[redacted]'");
    expect(rendered).toContain("export MURPH_DEV_LINQ_WEBHOOK_TUNNEL='0'");
    expect(rendered).toContain("export MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER='1'");
    expect(rendered).toContain("export MURPH_DEV_SKIP_STRIPE_LISTEN='1'");
    expect(rendered).toContain("export MURPH_DEV_WEB_HOST='localhost'");
    expect(rendered).toContain("export MURPH_DEV_WEB_PORT='3101'");
    expect(rendered).toContain("export DEVICE_SYNC_PUBLIC_BASE_URL='http://localhost:3101/api/device-sync'");
    expect(rendered).toContain("export HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS='http://localhost:3101,http://127.0.0.1:3101'");
    expect(rendered).toContain("export HOSTED_ONBOARDING_PUBLIC_BASE_URL='http://localhost:3101'");
    expect(rendered).toContain("export HOSTED_WEB_BASE_URL='http://localhost:3101'");
    expect(rendered).not.toContain("MURPH_DEV_TEMP_DIR");
    expect(rendered).not.toContain(config.databaseUrl);
  });

  it("removes inherited web session authority from worktree config", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        HOSTED_APP_SESSION_HMAC_KEY: "web-session-authority",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(formatHostedLocalWorktreeEnv(config)).not.toContain(
      "HOSTED_APP_SESSION_HMAC_KEY",
    );
  });

  it("allows an explicit 127 worktree web host while accepting both browser origins", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_WEB_HOST: "127.0.0.1",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.urls.webBaseUrl).toBe("http://127.0.0.1:3101");
    expect(config.env).toMatchObject({
      DEVICE_SYNC_PUBLIC_BASE_URL: "http://127.0.0.1:3101/api/device-sync",
      HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS:
        "http://localhost:3101,http://127.0.0.1:3101",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://127.0.0.1:3101",
      HOSTED_WEB_BASE_URL: "http://127.0.0.1:3101",
      MURPH_DEV_WEB_HOST: "127.0.0.1",
    });
  });

  it("rejects non-loopback worktree web hosts", () => {
    for (const host of ["0.0.0.0", "example.test", "::1"]) {
      expect(() =>
        buildHostedLocalWorktreeConfig({
          env: {
            MURPH_DEV_WEB_HOST: host,
          },
          ports,
          slug: "feature-a",
        })
      ).toThrow("web host must be localhost or 127.0.0.1");
    }
  });

  it("allows an explicit worktree Stripe listener opt-in", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_SKIP_STRIPE_LISTEN: "0",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env.MURPH_DEV_SKIP_STRIPE_LISTEN).toBe("0");
  });

  it("preserves an explicit Temporal disable for worktree startup", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_TEMPORAL: "disabled",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env.MURPH_DEV_TEMPORAL).toBe("disabled");
    expect(
      resolveHostedLocalWorktreeDevConfig({
        env: {
          MURPH_DEV_TEMPORAL: "disabled",
        },
        slug: "feature-a",
      }).temporal.mode,
    ).toBe("disabled");
  });

  it("drops inherited temp dir overrides from worktree startup env", () => {
    for (const tempDir of [
      ".tmp/hosted-local-worktrees",
      ".tmp/hosted-local-worktrees/feature-a",
    ]) {
      const config = buildHostedLocalWorktreeConfig({
        env: {
          MURPH_DEV_TEMP_DIR: tempDir,
        },
        ports,
        slug: "feature-a",
      });

      expect(config.env.MURPH_DEV_TEMP_DIR).toBeUndefined();
      expect(formatHostedLocalWorktreeEnv(config)).not.toContain("MURPH_DEV_TEMP_DIR");
    }
  });

  it("rejects remote hosted crypto mode for worktree commands", () => {
    for (const value of ["1", "yes"]) {
      expect(() =>
        buildHostedLocalWorktreeConfig({
          env: {
            MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: value,
          },
          ports,
          slug: "feature-a",
        })
      ).toThrow("is not supported by hosted-local worktree commands");
    }
  });

  it("pins inherited E2E isolation off", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED).toBe("0");

    const devConfig = resolveHostedLocalWorktreeDevConfig({
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      slug: "feature-a",
    });
    expect(devConfig.temporal.mode).toBe("managed");
  });

  it("keeps forbidden worktree flags off after profile application", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
      ports,
      slug: "feature-a",
    });

    const profiled = applyHostedLocalProfile({
      env: {
        ...config.env,
        MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "0",
      },
      profileName: config.profileName,
    });

    expect(profiled.env.MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS).toBe("0");
    expect(profiled.env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED).toBe("0");
  });

  it("honors an explicit Linq tunnel disable for worktree startup", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env).toMatchObject({
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
        ".tmp/hosted-local-worktrees/feature-a/cloudflared-linq-webhook.yml",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
    });
  });

  it("allows shared live Linq tunnel opt-in for the active worktree", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "1",
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "dev",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env).toMatchObject({
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "1",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
        ".tmp/hosted-local-worktrees/feature-a/cloudflared-linq-webhook.yml",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "dev",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "0",
    });
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

  it("can start a shared Linq tunnel while skipping registration", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "required",
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "dev",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env).toMatchObject({
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "required",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
        ".tmp/hosted-local-worktrees/feature-a/cloudflared-linq-webhook.yml",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "dev",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
    });
  });

  it("uses auto Linq mode for explicit public URL registration without a tunnel", () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL: "https://feature-a.example.test",
      },
      ports,
      slug: "feature-a",
    });

    expect(config.env).toMatchObject({
      MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL: "https://feature-a.example.test",
      MURPH_DEV_LINQ_WEBHOOK_REGISTRATION_CACHE:
        ".tmp/hosted-local-worktrees/feature-a/linq-webhook-registration.json",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "auto",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG:
        ".tmp/hosted-local-worktrees/feature-a/cloudflared-linq-webhook.yml",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "0",
    });
  });

  it("derives a worktree Linq tunnel config from another git worktree", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "auto",
      },
      ports,
      slug: "feature-a",
    });
    worktreeMocks.spawnSync.mockImplementation((command, args) => {
      if (command === "git" && args?.join(" ") === "worktree list --porcelain -z") {
        return {
          status: 0,
          stderr: "",
          stdout: [
            "worktree /current",
            "HEAD abc",
            "worktree /shared-root",
            "HEAD def",
            "",
          ].join("\0"),
        };
      }
      return {
        status: 0,
        stderr: "",
        stdout: "",
      };
    });
    worktreeMocks.readFile.mockImplementation(async (filePath) => {
      const normalized = String(filePath).replaceAll("\\", "/");
      if (normalized === config.paths.linqWebhookTunnelConfigPath) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      if (normalized === "/shared-root/.tmp/cloudflared-linq-webhook.yml") {
        return [
          "tunnel: dev",
          "ingress:",
          "  - hostname: linq-webhook-dev.example.test",
          "    service: http://localhost:3000",
          "  - service: http_status:404",
          "",
        ].join("\n");
      }
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });

    await prepareHostedLocalWorktreeLinqTunnelConfig(config);

    expect(worktreeMocks.writeFile).toHaveBeenCalledTimes(1);
    const writeCall = worktreeMocks.writeFile.mock.calls[0];
    expect(writeCall?.[0]).toBe(config.paths.linqWebhookTunnelConfigPath);
    expect(writeCall?.[1]).toContain("hostname: linq-webhook-dev.example.test");
    expect(writeCall?.[1]).toContain("service: http://localhost:3101");
    expect(writeCall?.[1]).not.toContain("service: http://localhost:3000");
    expect(writeCall?.[2]).toEqual({
      encoding: "utf8",
      mode: 0o600,
    });
  });

  it("does not overwrite an existing worktree Linq tunnel config", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    worktreeMocks.readFile.mockImplementation(async (filePath) => {
      if (String(filePath) === config.paths.linqWebhookTunnelConfigPath) {
        return "existing";
      }
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });

    await prepareHostedLocalWorktreeLinqTunnelConfig(config);

    expect(worktreeMocks.writeFile).not.toHaveBeenCalled();
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

  it("uses deterministic slug ports for the default config resolution path", async () => {
    const config = await resolveHostedLocalWorktreeConfig({
      env: {},
      slug: "feature-a",
    });
    const repeated = await resolveHostedLocalWorktreeConfig({
      env: {},
      slug: "feature-a",
    });

    expect(config.ports).toEqual(repeated.ports);
    expect(config.ports.web).toBeGreaterThanOrEqual(3100);
    expect(config.ports.web).toBeLessThan(3400);
    expect(config.ports.worker).toBeGreaterThanOrEqual(8800);
    expect(config.ports.worker).toBeLessThan(9100);
    expect(config.ports.temporal).toBeGreaterThanOrEqual(7300);
    expect(config.ports.temporal).toBeLessThan(7600);
    expect(config.ports.minio).toBeGreaterThanOrEqual(9100);
    expect(config.ports.minio).toBeLessThan(9400);
  });

  it("keeps deterministic slug ports when probing is disabled", async () => {
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
    expect(config.urls.webBaseUrl).toBe(`http://localhost:${config.ports.web}`);
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

  it("holds one cross-worktree lock per slug database until released", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });

    const lock = await acquireHostedLocalWorktreeLock(config);
    await lock.release();

    expect(worktreeMocks.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("murph-hosted-local-worktree-locks"),
      expect.objectContaining({ recursive: true }),
    );
    expect(worktreeMocks.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("murph_dev_feature_a.lock"),
      expect.objectContaining({ mode: 0o700 }),
    );
    expect(worktreeMocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("owner.json"),
      expect.stringContaining('"databaseName":"murph_dev_feature_a"'),
      expect.objectContaining({ mode: 0o600 }),
    );
    expect(worktreeMocks.rm).toHaveBeenCalledWith(
      expect.stringContaining("murph_dev_feature_a.lock"),
      { force: true, recursive: true },
    );
  });

  it("refuses duplicate same-slug worktree locks", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    worktreeMocks.mkdir
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("exists"), { code: "EEXIST" }));
    worktreeMocks.readFile.mockResolvedValueOnce(`${JSON.stringify({
      databaseCreated: false,
      databaseName: "murph_dev_feature_a",
      pid: process.pid,
      slug: "feature-a",
    })}\n`);

    await expect(acquireHostedLocalWorktreeLock(config)).rejects.toThrow(
      "another process already owns database murph_dev_feature_a",
    );

    expect(worktreeMocks.writeFile).not.toHaveBeenCalled();
  });

  it("reclaims a dead lock owner and drops its helper-created database when crypto state is missing", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    const deadPid = 9_999_999;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === deadPid) {
        const error = new Error("missing process") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return true;
    });
    worktreeMocks.mkdir
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("exists"), { code: "EEXIST" }))
      .mockResolvedValueOnce(undefined);
    worktreeMocks.readFile.mockResolvedValueOnce(`${JSON.stringify({
      databaseCreated: true,
      databaseName: "murph_dev_feature_a",
      pid: deadPid,
      slug: "feature-a",
    })}\n`);

    try {
      const lock = await acquireHostedLocalWorktreeLock(config);
      await lock.release();
    } finally {
      killSpy.mockRestore();
    }

    expect(worktreeMocks.spawnSync).toHaveBeenCalledWith(
      "dropdb",
      expect.arrayContaining([
        "--if-exists",
        "murph_dev_feature_a",
      ]),
      expect.any(Object),
    );
    expect(worktreeMocks.rm).toHaveBeenCalledWith(
      expect.stringContaining("murph_dev_feature_a.lock"),
      { force: true, recursive: true },
    );
    expect(worktreeMocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("owner.json"),
      expect.stringContaining('"databaseCreated":false'),
      expect.objectContaining({ mode: 0o600 }),
    );
  });

  it("records database creation in the lock owner", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    const lock = await acquireHostedLocalWorktreeLock(config);
    await lock.recordDatabaseCreated();
    await lock.release();

    expect(worktreeMocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("owner.json"),
      expect.stringContaining('"databaseCreated":true'),
      expect.objectContaining({ mode: 0o600 }),
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

  it("runs the created-database hook before returning created database state", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    const onCreated = vi.fn();

    await expect(
      ensureHostedLocalWorktreeDatabase(config, { onCreated }),
    ).resolves.toEqual({
      created: true,
    });

    expect(onCreated).toHaveBeenCalledOnce();
    expect(worktreeMocks.spawnSync).toHaveBeenCalledWith(
      "createdb",
      expect.arrayContaining(["murph_dev_feature_a"]),
      expect.any(Object),
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

  it("drops a newly created slug database when startup fails before crypto state exists", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });

    await expect(
      removeCreatedHostedLocalWorktreeDatabaseIfCryptoStateMissing(config),
    ).resolves.toEqual({
      missingCryptoState: true,
      removed: true,
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

  it("preserves a newly created slug database once crypto state exists", async () => {
    const config = buildHostedLocalWorktreeConfig({
      env: {},
      ports,
      slug: "feature-a",
    });
    worktreeMocks.readFile.mockResolvedValueOnce(
      buildValidHostedLocalWorktreeCryptoStateText(),
    );

    await expect(
      removeCreatedHostedLocalWorktreeDatabaseIfCryptoStateMissing(config),
    ).resolves.toEqual({
      missingCryptoState: false,
      removed: false,
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

  it("resolves the stack config used by worktree commands", () => {
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
