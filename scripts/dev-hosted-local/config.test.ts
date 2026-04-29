import { describe, expect, it } from "vitest";

import {
  parsePort,
  parseWorkerProtocol,
  printHelp,
  resolveHostedLocalDevConfig,
} from "./config.ts";

describe("resolveHostedLocalDevConfig", () => {
  it("returns the documented defaults", () => {
    expect(resolveHostedLocalDevConfig({})).toEqual({
      databaseUrlOverride: null,
      forceResetLocalDatabase: false,
      skipPrismaMigrate: false,
      skipRunnerSmoke: false,
      skipStripeListen: false,
      skipWeb: false,
      skipVercelPull: false,
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
        MURPH_DEV_DATABASE_URL: "postgresql://127.0.0.1:5432/custom",
        MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
        MURPH_DEV_SKIP_RUNNER_SMOKE: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_SKIP_WEB: "1",
        MURPH_DEV_SKIP_VERCEL_PULL: "1",
        MURPH_DEV_USE_VERCEL_DATABASE_URL: "1",
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
      skipPrismaMigrate: true,
      skipRunnerSmoke: true,
      skipStripeListen: true,
      skipWeb: true,
      skipVercelPull: true,
      useVercelDatabaseUrl: true,
      webHost: "0.0.0.0",
      webPort: 3015,
      workerHost: "localhost",
      workerPersistDir: ".wrangler/state/custom-dev",
      workerPort: 8795,
      workerProtocol: "https",
    });
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
    expect(output).toContain("MURPH_DEV_SKIP_RUNNER_SMOKE=1");
    expect(output).toContain("MURPH_DEV_SKIP_STRIPE_LISTEN=1");
    expect(output).toContain("MURPH_DEV_STRIPE_ENV_FILE=.tmp/.env.hosted-local-stripe");
    expect(output).toContain("MURPH_DEV_WEB_HOST=localhost");
    expect(output).toContain("stripe listen");
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
