import * as fsPromises from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(async () => {}),
}));

import {
  normalizePnpmScriptArgs,
  resolveWorkerDevPnpmCommands,
  shouldSkipRunnerBundle,
} from "../scripts/dev-worker.ts";

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

  it("skips the bundle step when the caller prebuilt it", () => {
    const env = { MURPH_DEV_SKIP_RUNNER_BUNDLE: "1" } satisfies NodeJS.ProcessEnv;

    expect(shouldSkipRunnerBundle(env)).toBe(true);
    expect(resolveWorkerDevPnpmCommands(["--", "--port", "8787"], env)).toEqual([
      ["runner:docker:base"],
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
});
