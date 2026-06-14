import { describe, expect, it } from "vitest";

import {
  parseLinqWebhookTunnelMode,
  parsePort,
  parseTemporalMode,
  parseWorkerProtocol,
  printHelp,
  resolveHostedLocalDevConfig,
} from "../../src/dev-hosted-local/config.ts";

describe("resolveHostedLocalDevConfig", () => {
  it("returns the documented defaults", () => {
    expect(resolveHostedLocalDevConfig({})).toEqual({
      databaseUrlOverride: null,
      forceResetLocalDatabase: false,
      forceResetLocalTemporal: false,
      linqWebhookPublicUrl: null,
      linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
      linqWebhookTunnelMode: "auto",
      linqWebhookTunnelName: "dev",
      skipHealthCommonsWatch: false,
      skipLinqWebhookRegister: false,
      skipPrismaMigrate: false,
      skipRunnerSmoke: false,
      skipStripeListen: false,
      skipWeb: false,
      skipVercelPull: false,
      temporal: {
        host: "127.0.0.1",
        mode: "auto",
        namespace: "default",
        port: 7233,
        taskQueue: "murph-hosted-runtime",
      },
      useVercelDatabaseUrl: false,
      webHost: "localhost",
      webPort: 3000,
      workerHost: "127.0.0.1",
      workerPersistDir: ".wrangler/state/dev-root",
      workerPort: 8787,
      workerProtocol: "http",
    });
  });

  it("parses explicit local overrides", () => {
    expect(
      resolveHostedLocalDevConfig({
        MURPH_DEV_FORCE_RESET_LOCAL_DB: "1",
        MURPH_DEV_FORCE_RESET_TEMPORAL: "1",
        MURPH_DEV_DATABASE_URL: "postgresql://127.0.0.1:5432/custom",
        MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL: "https://linq-webhook.example.test",
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "1",
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG: ".tmp/custom-linq-cloudflared.yml",
        MURPH_DEV_LINQ_WEBHOOK_TUNNEL_NAME: "linq-dev",
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
        MURPH_DEV_SKIP_RUNNER_SMOKE: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_TEMPORAL: "external",
        MURPH_DEV_TEMPORAL_HOST: "localhost",
        MURPH_DEV_TEMPORAL_PORT: "7243",
        MURPH_DEV_SKIP_WEB: "1",
        MURPH_DEV_SKIP_VERCEL_PULL: "1",
        MURPH_DEV_USE_VERCEL_DATABASE_URL: "1",
        TEMPORAL_NAMESPACE: "hosted-test",
        TEMPORAL_TASK_QUEUE: "hosted-test-queue",
        MURPH_DEV_WEB_HOST: "0.0.0.0",
        MURPH_DEV_WEB_PORT: "3015",
        MURPH_DEV_WORKER_HOST: "localhost",
        MURPH_DEV_WORKER_PORT: "8795",
        MURPH_DEV_WORKER_PROTOCOL: "https",
        MURPH_DEV_CF_PERSIST_DIR: ".wrangler/state/custom-dev",
      }),
    ).toEqual({
      databaseUrlOverride: "postgresql://127.0.0.1:5432/custom",
      forceResetLocalDatabase: true,
      forceResetLocalTemporal: true,
      linqWebhookPublicUrl: "https://linq-webhook.example.test",
      linqWebhookTunnelConfigPath: ".tmp/custom-linq-cloudflared.yml",
      linqWebhookTunnelMode: "required",
      linqWebhookTunnelName: "linq-dev",
      skipHealthCommonsWatch: true,
      skipLinqWebhookRegister: true,
      skipPrismaMigrate: true,
      skipRunnerSmoke: true,
      skipStripeListen: true,
      skipWeb: true,
      skipVercelPull: true,
      temporal: {
        host: "localhost",
        mode: "external",
        namespace: "hosted-test",
        port: 7243,
        taskQueue: "hosted-test-queue",
      },
      useVercelDatabaseUrl: true,
      webHost: "0.0.0.0",
      webPort: 3015,
      workerHost: "localhost",
      workerPersistDir: ".wrangler/state/custom-dev",
      workerPort: 8795,
      workerProtocol: "https",
    });
  });

  it.each([
    "MURPH_DEV_CODEX_BRIDGE",
    "MURPH_DEV_CODEX_COMMAND",
    "MURPH_DEV_CODEX_BRIDGE_HOST",
    "MURPH_DEV_CODEX_BRIDGE_PORT",
    "MURPH_DEV_CODEX_APP_SERVER_PROXY_URL",
    "MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN",
  ])("rejects deprecated hosted-local Codex bridge env %s", (name) => {
    expect(() =>
      resolveHostedLocalDevConfig({
        [name]: "",
      })
    ).toThrow(
      `Deprecated hosted-local Codex bridge env is no longer supported: ${name}.`,
    );
  });

  it("disables Temporal by default when web is intentionally skipped", () => {
    expect(
      resolveHostedLocalDevConfig({
        MURPH_DEV_SKIP_WEB: "1",
      }).temporal.mode,
    ).toBe("disabled");

    expect(
      resolveHostedLocalDevConfig({
        MURPH_HOSTED_LOCAL_PROFILE: "worker-only",
      }).temporal.mode,
    ).toBe("disabled");
  });

  it("uses an explicit external Temporal address instead of starting managed Temporal", () => {
    expect(
      resolveHostedLocalDevConfig({
        HOSTED_TEMPORAL_ADDRESS: "temporal.example.test:7233",
      }).temporal.mode,
    ).toBe("external");
  });
});

describe("printHelp", () => {
  it("documents the stripe listener skip flag", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      printHelp();
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = writes.join("");
    expect(output).toContain("MURPH_DEV_DATABASE_URL=...");
    expect(output).toContain("MURPH_DEV_FORCE_RESET_LOCAL_DB=1");
    expect(output).toContain("MURPH_DEV_FORCE_RESET_TEMPORAL=1");
    expect(output).toContain("HOSTED_ASSISTANT_PROVIDER=openai");
    expect(output).toContain("OPENAI_API_KEY=...");
    expect(output).not.toContain("MURPH_DEV_CODEX_BRIDGE");
    expect(output).not.toContain("MURPH_DEV_CODEX_COMMAND");
    expect(output).toContain("MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH=1");
    expect(output).toContain("MURPH_DEV_SKIP_RUNNER_SMOKE=1");
    expect(output).toContain("MURPH_DEV_SKIP_STRIPE_LISTEN=1");
    expect(output).toContain("MURPH_DEV_SKIP_WORKERS_AI=1");
    expect(output).toContain("MURPH_DEV_STRIPE_ENV_FILE=.tmp/.env.hosted-local-stripe");
    expect(output).toContain("MURPH_DEV_LINQ_WEBHOOK_TUNNEL=auto");
    expect(output).toContain("MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG=.tmp/cloudflared-linq-webhook.yml");
    expect(output).toContain("MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL=...");
    expect(output).toContain("HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS=...");
    expect(output).toContain("MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1");
    expect(output).toContain("MURPH_DEV_TEMPORAL=auto");
    expect(output).toContain("MURPH_DEV_TEMPORAL_PORT=7233");
    expect(output).toContain("TEMPORAL_TASK_QUEUE=murph-hosted-runtime");
    expect(output).toContain("MURPH_DEV_WEB_HOST=localhost");
    expect(output).toContain("stripe listen");
  });
});

describe("parseLinqWebhookTunnelMode", () => {
  it("defaults to auto", () => {
    expect(parseLinqWebhookTunnelMode(undefined)).toBe("auto");
  });

  it("normalizes disabled and required values", () => {
    expect(parseLinqWebhookTunnelMode("off")).toBe("disabled");
    expect(parseLinqWebhookTunnelMode("true")).toBe("required");
  });

  it("rejects invalid values", () => {
    expect(() => parseLinqWebhookTunnelMode("maybe")).toThrow(
      "MURPH_DEV_LINQ_WEBHOOK_TUNNEL must be auto, required, 1, or 0.",
    );
  });
});

describe("parseTemporalMode", () => {
  it("uses the fallback when the override is missing", () => {
    expect(parseTemporalMode(undefined, "managed")).toBe("managed");
  });

  it("normalizes auto, managed, external, and disabled values", () => {
    expect(parseTemporalMode("auto")).toBe("auto");
    expect(parseTemporalMode("on")).toBe("managed");
    expect(parseTemporalMode("external")).toBe("external");
    expect(parseTemporalMode("off")).toBe("disabled");
  });

  it("rejects invalid values", () => {
    expect(() => parseTemporalMode("maybe")).toThrow(
      "MURPH_DEV_TEMPORAL must be auto, managed, external, disabled, 1, or 0.",
    );
  });
});

describe("parsePort", () => {
  it("uses the fallback when the override is missing", () => {
    expect(parsePort(undefined, 3000, "PORT")).toBe(3000);
  });

  it("rejects invalid TCP ports", () => {
    expect(() => parsePort("0", 3000, "PORT")).toThrow("PORT must be a valid TCP port.");
    expect(() => parsePort("70000", 3000, "PORT")).toThrow("PORT must be a valid TCP port.");
    expect(() => parsePort("abc", 3000, "PORT")).toThrow("PORT must be a valid TCP port.");
  });
});

describe("parseWorkerProtocol", () => {
  it("defaults to http", () => {
    expect(parseWorkerProtocol(undefined)).toBe("http");
  });

  it("normalizes valid values", () => {
    expect(parseWorkerProtocol("HTTPS")).toBe("https");
  });

  it("rejects invalid values", () => {
    expect(() => parseWorkerProtocol("tcp")).toThrow(
      "MURPH_DEV_WORKER_PROTOCOL must be either http or https.",
    );
  });
});
