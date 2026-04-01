import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDeployWorkerCliPaths } from "../scripts/deploy-worker-version-paths.js";

describe("resolveDeployWorkerCliPaths", () => {
  it("uses the app deploy directory by default when launched from the repo root", () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");

    const result = resolveDeployWorkerCliPaths([], {
      deployRoot,
    });

    expect(result.configPath).toBe(path.join(deployRoot, ".deploy", "wrangler.generated.jsonc"));
    expect(result.resultPath).toBe(path.join(deployRoot, ".deploy", "deployment-result.json"));
    expect(result.secretsFilePath).toBe(path.join(deployRoot, ".deploy", "worker-secrets.json"));
  });

  it("resolves explicit relative artifact paths against the app deploy root", () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");

    const result = resolveDeployWorkerCliPaths(
      [
        "--config",
        "./.deploy/wrangler.generated.jsonc",
        "--result",
        "./.deploy/custom-result.json",
        "--secrets-file",
        "./.deploy/custom-secrets.json",
      ],
      { deployRoot },
    );

    expect(result.configPath).toBe(path.join(deployRoot, ".deploy", "wrangler.generated.jsonc"));
    expect(result.resultPath).toBe(path.join(deployRoot, ".deploy", "custom-result.json"));
    expect(result.secretsFilePath).toBe(path.join(deployRoot, ".deploy", "custom-secrets.json"));
  });
});
