import { describe, expect, it, vi } from "vitest";

import {
  runHostedWorkerDeployment,
  type DeploymentStatusPayload,
  type HostedWorkerDeploymentDependencies,
} from "../scripts/deploy-worker-version.shared.js";

describe("runHostedWorkerDeployment", () => {
  it("rejects gradual mode before running Wrangler when the rendered config introduces a new migration tag", async () => {
    const dependencies = createDependencies({
      readRenderedDeployConfig: vi.fn(async () => ({
        migrations: [
          { tag: "v1" },
          { tag: "v2" },
          { tag: "v3" },
        ],
      })),
    });

    await expect(runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hb-worker",
        HOSTED_EXECUTION_DEPLOYMENT_MODE: "gradual",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hb-worker",
    })).rejects.toThrow(
      "Rendered Wrangler config includes unsupported Durable Object migration tag(s) `v3` for gradual versions/deployments. Use HOSTED_EXECUTION_DEPLOYMENT_MODE=direct for the migration rollout first.",
    );

    expect(dependencies.deployDirect).not.toHaveBeenCalled();
    expect(dependencies.deployVersions).not.toHaveBeenCalled();
    expect(dependencies.uploadVersion).not.toHaveBeenCalled();
  });

  it("skips upload and writes candidate outputs when an existing version id is promoted gradually", async () => {
    const currentDeployment: DeploymentStatusPayload = {
      created_on: "2026-03-27T00:00:00.000Z",
      versions: [
        {
          percentage: 100,
          version_id: "version-a",
        },
      ],
    };
    const finalDeployment: DeploymentStatusPayload = {
      created_on: "2026-03-27T00:05:00.000Z",
      versions: [
        {
          percentage: 90,
          version_id: "version-a",
        },
        {
          percentage: 10,
          version_id: "version-b",
        },
      ],
    };
    const readCurrentDeployment = vi
      .fn<HostedWorkerDeploymentDependencies["readCurrentDeployment"]>()
      .mockResolvedValueOnce(currentDeployment)
      .mockResolvedValueOnce(finalDeployment);
    const dependencies = createDependencies({
      readCurrentDeployment,
    });

    const result = await runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hb-worker",
        GITHUB_OUTPUT: "/tmp/github-output.txt",
        HOSTED_EXECUTION_DEPLOYMENT_MODE: "gradual",
        HOSTED_EXECUTION_DEPLOY_VERSION_ID: "version-b",
        HOSTED_EXECUTION_GRADUAL_ROLLOUT_PERCENTAGE: "10",
        HOSTED_EXECUTION_INCLUDE_SECRETS: "true",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hb-worker",
    });

    expect(dependencies.uploadVersion).not.toHaveBeenCalled();
    expect(dependencies.deployVersions).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("rollout 10%"),
      versionSpecs: ["version-a@90", "version-b@10"],
      workerName: "hb-worker",
    });
    expect(result).toMatchObject({
      candidateVersionId: "version-b",
      smokeVersionId: "version-b",
      uploadedVersionId: null,
    });
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      "/tmp/github-output.txt",
      expect.stringContaining("candidate_version_id=version-b"),
      {
        encoding: "utf8",
        flag: "a",
      },
    );
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      "/tmp/github-output.txt",
      expect.stringContaining("smoke_version_id=version-b"),
      {
        encoding: "utf8",
        flag: "a",
      },
    );
  });

  it("runs a direct deploy and records the final deployment traffic", async () => {
    const finalDeployment: DeploymentStatusPayload = {
      created_on: "2026-03-27T00:10:00.000Z",
      versions: [
        {
          percentage: 100,
          version_id: "version-direct",
        },
      ],
    };
    const readCurrentDeployment = vi
      .fn<HostedWorkerDeploymentDependencies["readCurrentDeployment"]>()
      .mockResolvedValue(finalDeployment);
    const dependencies = createDependencies({
      readCurrentDeployment,
    });

    const result = await runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hb-worker",
        GITHUB_OUTPUT: "/tmp/github-output.txt",
        HOSTED_EXECUTION_DEPLOYMENT_MODE: "direct",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hb-worker",
    });

    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("direct deploy"),
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hb-worker",
    });
    expect(dependencies.deployVersions).not.toHaveBeenCalled();
    expect(dependencies.uploadVersion).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidateVersionId: "version-direct",
      finalDeploymentVersions: [
        {
          percentage: 100,
          versionId: "version-direct",
        },
      ],
      smokeVersionId: null,
      uploadedVersionId: null,
    });
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      "/tmp/github-output.txt",
      expect.stringContaining("final_version_traffic=[{\"percentage\":100,\"versionId\":\"version-direct\"}]"),
      {
        encoding: "utf8",
        flag: "a",
      },
    );
  });
});

function createDependencies(
  overrides: Partial<HostedWorkerDeploymentDependencies> = {},
): HostedWorkerDeploymentDependencies & {
  deployDirect: ReturnType<typeof vi.fn>;
  deployVersions: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  readCurrentDeployment: ReturnType<typeof vi.fn>;
  readRenderedDeployConfig: ReturnType<typeof vi.fn>;
  uploadVersion: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
} {
  return {
    deployDirect: overrides.deployDirect ?? vi.fn(async () => {}),
    deployVersions: overrides.deployVersions ?? vi.fn(async () => {}),
    mkdir: overrides.mkdir ?? vi.fn(async () => {}),
    readCurrentDeployment: overrides.readCurrentDeployment
      ?? vi.fn(async () => null),
    readRenderedDeployConfig: overrides.readRenderedDeployConfig
      ?? vi.fn(async () => ({
        migrations: [{ tag: "v1" }, { tag: "v2" }],
      })),
    uploadVersion: overrides.uploadVersion ?? vi.fn(async () => "uploaded-version"),
    writeFile: overrides.writeFile ?? vi.fn(async () => {}),
  };
}
