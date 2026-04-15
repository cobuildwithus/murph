import { describe, expect, it } from "vitest";

import {
  parsePort,
  parseWorkerProtocol,
  resolveHostedLocalDevConfig,
} from "./config.ts";

describe("resolveHostedLocalDevConfig", () => {
  it("returns the documented defaults", () => {
    expect(resolveHostedLocalDevConfig({})).toEqual({
      skipPrismaMigrate: false,
      skipVercelPull: false,
      webHost: "127.0.0.1",
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
        MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
        MURPH_DEV_SKIP_VERCEL_PULL: "1",
        MURPH_DEV_WEB_HOST: "0.0.0.0",
        MURPH_DEV_WEB_PORT: "3015",
        MURPH_DEV_WORKER_HOST: "localhost",
        MURPH_DEV_WORKER_PORT: "8795",
        MURPH_DEV_WORKER_PROTOCOL: "https",
        MURPH_DEV_CF_PERSIST_DIR: ".wrangler/state/custom-dev",
      }),
    ).toEqual({
      skipPrismaMigrate: true,
      skipVercelPull: true,
      webHost: "0.0.0.0",
      webPort: 3015,
      workerHost: "localhost",
      workerPersistDir: ".wrangler/state/custom-dev",
      workerPort: 8795,
      workerProtocol: "https",
    });
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
