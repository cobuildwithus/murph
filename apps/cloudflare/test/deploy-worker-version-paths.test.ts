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
    expect(result.runnerBundleDir).toBe(path.join(deployRoot, ".deploy", "runner-bundle"));
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
    expect(result.runnerBundleDir).toBe(path.join(deployRoot, ".deploy", "runner-bundle"));
    expect(result.secretsFilePath).toBe(path.join(deployRoot, ".deploy", "custom-secrets.json"));
  });

  it("resolves explicit artifact paths passed with equals-form flags", () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");

    const result = resolveDeployWorkerCliPaths(
      [
        "--config=./.deploy/wrangler.generated.jsonc",
        "--result=./.deploy/custom-result.json",
        "--secrets-file=./.deploy/custom-secrets.json",
      ],
      { deployRoot },
    );

    expect(result.configPath).toBe(path.join(deployRoot, ".deploy", "wrangler.generated.jsonc"));
    expect(result.resultPath).toBe(path.join(deployRoot, ".deploy", "custom-result.json"));
    expect(result.runnerBundleDir).toBe(path.join(deployRoot, ".deploy", "runner-bundle"));
    expect(result.secretsFilePath).toBe(path.join(deployRoot, ".deploy", "custom-secrets.json"));
  });

  it("rejects unsupported deploy args instead of silently dropping them", () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");

    expect(() => resolveDeployWorkerCliPaths(["--dry-run"], { deployRoot })).toThrow(
      "Unsupported deploy worker argument: --dry-run",
    );
  });

  it("redacts unsupported equals-form deploy arg values from errors", () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");

    const thrown = (() => {
      try {
        resolveDeployWorkerCliPaths(["--api-token=secret-token"], { deployRoot });
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain("Unsupported deploy worker argument: --api-token.");
    expect(String(thrown)).not.toContain("secret-token");
  });

  it("rejects known deploy args when their value is missing", () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");

    expect(() => resolveDeployWorkerCliPaths(["--config", "--result", "./result.json"], { deployRoot })).toThrow(
      "Missing value for --config",
    );
  });
});
