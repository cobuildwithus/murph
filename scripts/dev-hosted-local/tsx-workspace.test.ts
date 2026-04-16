import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureHostedLocalWorkspaceTsconfigPath } from "./tsx-workspace.ts";

describe("ensureHostedLocalWorkspaceTsconfigPath", () => {
  it("sets the repo workspace tsconfig path when the env is unset", () => {
    const env: NodeJS.ProcessEnv = {};
    const scriptsDir = path.resolve("scripts/dev-hosted-local");

    const resolved = ensureHostedLocalWorkspaceTsconfigPath(env, scriptsDir);

    expect(resolved).toBe(path.resolve("tsconfig.base.json"));
    expect(env.TSX_TSCONFIG_PATH).toBe(path.resolve("tsconfig.base.json"));
  });

  it("preserves an explicit tsconfig override", () => {
    const env: NodeJS.ProcessEnv = {
      TSX_TSCONFIG_PATH: "/tmp/custom-tsconfig.json",
    };

    const resolved = ensureHostedLocalWorkspaceTsconfigPath(env, path.resolve("scripts/dev-hosted-local"));

    expect(resolved).toBe("/tmp/custom-tsconfig.json");
    expect(env.TSX_TSCONFIG_PATH).toBe("/tmp/custom-tsconfig.json");
  });
});
