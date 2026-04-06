import path from "node:path";
import { writeFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

const wranglerMocks = vi.hoisted(() => ({
  runWranglerJson: vi.fn(),
  runWranglerLogged: vi.fn(),
}));

vi.mock("../scripts/wrangler-runner.js", () => ({
  runWranglerJson: wranglerMocks.runWranglerJson,
  runWranglerLogged: wranglerMocks.runWranglerLogged,
}));

import { runDeployWorkerVersionCli } from "../scripts/deploy-worker-version.cli.js";

describe("runDeployWorkerVersionCli", () => {
  beforeEach(() => {
    wranglerMocks.runWranglerJson.mockReset();
    wranglerMocks.runWranglerLogged.mockReset();
  });

  it("passes app-root deploy artifact paths to the rollout entrypoint", async () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");
    const runHostedWorkerDeployment = vi.fn(async () => ({
      candidateVersionId: null,
      currentDeploymentVersions: null,
      finalDeploymentVersions: [],
      mode: "direct" as const,
      rolloutPercentage: null,
      smokeVersionId: null,
      uploadedVersionId: null,
      workerName: "hosted-worker",
    }));

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot,
        env: {
          CF_WORKER_NAME: "hosted-worker",
          HOSTED_EXECUTION_DEPLOYMENT_MODE: "direct",
        },
        log: false,
        runHostedWorkerDeployment,
      },
    );

    expect(runHostedWorkerDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: path.join(deployRoot, ".deploy", "wrangler.generated.jsonc"),
        env: expect.objectContaining({
          CF_WORKER_NAME: "hosted-worker",
        }),
        resultPath: path.join(deployRoot, ".deploy", "deployment-result.json"),
        secretsFilePath: path.join(deployRoot, ".deploy", "worker-secrets.json"),
        workerName: "hosted-worker",
      }),
    );
  });

  it("treats wrangler no-deployments errors as an empty current deployment", async () => {
    wranglerMocks.runWranglerJson.mockRejectedValueOnce(new Error("Worker hosted-worker has no deployments"));

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env: {
          CF_WORKER_NAME: "hosted-worker",
          HOSTED_EXECUTION_DEPLOYMENT_MODE: "direct",
        },
        log: false,
        runHostedWorkerDeployment: async ({ dependencies }) => {
          expect(await dependencies.readCurrentDeployment("hosted-worker", "/tmp/config.jsonc")).toBeNull();

          return {
            candidateVersionId: null,
            currentDeploymentVersions: null,
            finalDeploymentVersions: [],
            mode: "direct",
            rolloutPercentage: null,
            smokeVersionId: null,
            uploadedVersionId: null,
            workerName: "hosted-worker",
          };
        },
      },
    );

    expect(wranglerMocks.runWranglerJson).toHaveBeenCalledWith([
      "deployments",
      "status",
      "--config",
      "/tmp/config.jsonc",
      "--json",
      "--name",
      "hosted-worker",
    ]);
  });

  it("fails deployment-status reads with worker-scoped JSON context", async () => {
    wranglerMocks.runWranglerJson.mockResolvedValueOnce("{not json");

    await expect(
      runDeployWorkerVersionCli(
        ["--config", "./.deploy/wrangler.generated.jsonc"],
        {
          deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
          env: {
            CF_WORKER_NAME: "hosted-worker",
            HOSTED_EXECUTION_DEPLOYMENT_MODE: "direct",
          },
          log: false,
          runHostedWorkerDeployment: async ({ dependencies }) => {
            await dependencies.readCurrentDeployment("hosted-worker", "/tmp/config.jsonc");
            throw new Error("Expected readCurrentDeployment to fail.");
          },
        },
      ),
    ).rejects.toThrow(
      "Wrangler deployment status for worker hosted-worker must be valid JSON:",
    );
  });

  it("reads the most recent matching wrangler JSONL entry without parsing the whole file up front", async () => {
    wranglerMocks.runWranglerLogged.mockImplementationOnce(async (_args: string[], options?: { envOverrides?: Record<string, string> }) => {
      const outputFilePath = options?.envOverrides?.WRANGLER_OUTPUT_FILE_PATH;

      if (!outputFilePath) {
        throw new Error("Expected WRANGLER_OUTPUT_FILE_PATH.");
      }

      await writeFile(
        outputFilePath,
        [
          JSON.stringify({ type: "other", version_id: "ignore-me" }),
          "",
          JSON.stringify({ type: "version-upload", version_id: "version-old" }),
          JSON.stringify({ type: "version-upload", version_id: "version-new" }),
        ].join("\n"),
        "utf8",
      );
    });

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env: {
          CF_WORKER_NAME: "hosted-worker",
          HOSTED_EXECUTION_DEPLOYMENT_MODE: "direct",
        },
        log: false,
        runHostedWorkerDeployment: async ({ dependencies, secretsFilePath }) => {
          const versionId = await dependencies.uploadVersion({
            configPath: "/tmp/config.jsonc",
            includeSecrets: false,
            message: "upload message",
            secretsFilePath,
            tag: "deploy-tag",
            workerName: "hosted-worker",
          });

          expect(versionId).toBe("version-new");

          return {
            candidateVersionId: versionId,
            currentDeploymentVersions: null,
            finalDeploymentVersions: [],
            mode: "direct",
            rolloutPercentage: null,
            smokeVersionId: null,
            uploadedVersionId: versionId,
            workerName: "hosted-worker",
          };
        },
      },
    );

    expect(wranglerMocks.runWranglerLogged).toHaveBeenCalledWith(
      expect.arrayContaining(["versions", "upload", "--config", "/tmp/config.jsonc"]),
      expect.objectContaining({
        envOverrides: expect.objectContaining({
          WRANGLER_OUTPUT_FILE_PATH: expect.any(String),
        }),
      }),
    );
  });

  it("fails malformed Wrangler output lines with file and line context", async () => {
    wranglerMocks.runWranglerLogged.mockImplementationOnce(async (_args: string[], options?: { envOverrides?: Record<string, string> }) => {
      const outputFilePath = options?.envOverrides?.WRANGLER_OUTPUT_FILE_PATH;

      if (!outputFilePath) {
        throw new Error("Expected WRANGLER_OUTPUT_FILE_PATH.");
      }

      await writeFile(
        outputFilePath,
        [
          JSON.stringify({ type: "other", version_id: "ignore-me" }),
          "{not json",
        ].join("\n"),
        "utf8",
      );
    });

    await expect(
      runDeployWorkerVersionCli(
        ["--config", "./.deploy/wrangler.generated.jsonc"],
        {
          deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
          env: {
            CF_WORKER_NAME: "hosted-worker",
            HOSTED_EXECUTION_DEPLOYMENT_MODE: "direct",
          },
          log: false,
          runHostedWorkerDeployment: async ({ dependencies, secretsFilePath }) => {
            await dependencies.uploadVersion({
              configPath: "/tmp/config.jsonc",
              includeSecrets: false,
              message: "upload message",
              secretsFilePath,
              tag: "deploy-tag",
              workerName: "hosted-worker",
            });
            throw new Error("Expected uploadVersion to fail.");
          },
        },
      ),
    ).rejects.toThrow(/Wrangler output entry in .* at line 2 must be valid JSON:/);
  });
});
