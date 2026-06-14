import * as fsPromises from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(async () => {}),
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import {
  isWranglerDevPnpmCommand,
  normalizePnpmScriptArgs,
  resolveWorkerDevPnpmCommands,
  resolveWorkerDevPnpmEnv,
  shouldSkipRunnerBundle,
  shouldSkipRunnerDockerBase,
  STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV,
} from "../scripts/dev-worker.ts";
import { hostedLocalRunnerBaseImageTag } from "../scripts/runner-base-image-contract.ts";

describe("cloudflare dev-worker script", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("normalizes pnpm passthrough args", () => {
    expect(normalizePnpmScriptArgs(["--", "--ip", "127.0.0.1"])).toEqual(["--ip", "127.0.0.1"]);
    expect(normalizePnpmScriptArgs(["--ip", "127.0.0.1"])).toEqual(["--ip", "127.0.0.1"]);
  });

  it("prepares the runner bundle and base image before wrangler dev by default", () => {
    expect(resolveWorkerDevPnpmCommands(["--", "--port", "8787"], {})).toEqual([
      ["runner:bundle"],
      ["runner:docker:base"],
      ["exec", "wrangler", "dev", "--port", "8787"],
    ]);
  });

  it("identifies the final wrangler dev command", () => {
    expect(isWranglerDevPnpmCommand(["exec", "wrangler", "dev", "--port", "8787"])).toBe(true);
    expect(isWranglerDevPnpmCommand(["runner:bundle"])).toBe(false);
    expect(isWranglerDevPnpmCommand(["exec", "wrangler", "deploy"])).toBe(false);
  });

  it("strips CLOUDFLARE_API_TOKEN only from the final wrangler dev command", () => {
    const env = {
      CLOUDFLARE_API_TOKEN: "account-scoped-token",
      HOSTED_WEB_BASE_URL: "http://localhost:3000",
      [STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV]: "1",
    } satisfies NodeJS.ProcessEnv;

    expect(resolveWorkerDevPnpmEnv(["runner:bundle"], env)).toBe(env);

    const wranglerEnv = resolveWorkerDevPnpmEnv(
      ["exec", "wrangler", "dev", "--port", "8787"],
      env,
    );
    expect(wranglerEnv).toEqual({
      HOSTED_WEB_BASE_URL: "http://localhost:3000",
    });
    expect(env.CLOUDFLARE_API_TOKEN).toBe("account-scoped-token");
    expect(env[STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV]).toBe("1");
  });

  it("skips the bundle step when the caller prebuilt it", () => {
    const env = { MURPH_DEV_SKIP_RUNNER_BUNDLE: "1" } satisfies NodeJS.ProcessEnv;

    expect(shouldSkipRunnerBundle(env)).toBe(true);
    expect(resolveWorkerDevPnpmCommands(["--", "--port", "8787"], env)).toEqual([
      ["runner:docker:base"],
      ["exec", "wrangler", "dev", "--port", "8787"],
    ]);
  });

  it("skips the base image step when the caller prebuilt it", () => {
    const env = { MURPH_DEV_SKIP_RUNNER_DOCKER_BASE: "1" } satisfies NodeJS.ProcessEnv;

    expect(shouldSkipRunnerDockerBase(env)).toBe(true);
    expect(resolveWorkerDevPnpmCommands(["--", "--port", "8787"], env)).toEqual([
      ["runner:bundle"],
      ["exec", "wrangler", "dev", "--port", "8787"],
    ]);
  });

  it("can skip both runner preparation steps for hosted-local e2e", () => {
    const env = {
      MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
      MURPH_DEV_SKIP_RUNNER_DOCKER_BASE: "1",
    } satisfies NodeJS.ProcessEnv;

    expect(resolveWorkerDevPnpmCommands(["--", "--port", "8787"], env)).toEqual([
      ["exec", "wrangler", "dev", "--port", "8787"],
    ]);
  });

  it("fails closed before wrangler dev when skip mode is set but the prepared bundle is missing", async () => {
    const accessMock = vi.mocked(fsPromises.access).mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    const { main } = await import("../scripts/dev-worker.ts");

    vi.stubEnv("MURPH_DEV_SKIP_RUNNER_BUNDLE", "1");

    await expect(main([])).rejects.toThrow(
      "MURPH_DEV_SKIP_RUNNER_BUNDLE=1 requires a prepared Cloudflare runner bundle.",
    );
    expect(accessMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed before wrangler dev when base image skip mode is set but the image is missing", async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
    } as ReturnType<typeof spawnSync>);
    const { main } = await import("../scripts/dev-worker.ts");

    vi.stubEnv("MURPH_DEV_SKIP_RUNNER_DOCKER_BASE", "1");

    await expect(main([])).rejects.toThrow(
      "MURPH_DEV_SKIP_RUNNER_DOCKER_BASE=1 requires a prepared Cloudflare runner base image.",
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      [
        "image",
        "inspect",
        hostedLocalRunnerBaseImageTag,
      ],
      expect.any(Object),
    );
  });
});
