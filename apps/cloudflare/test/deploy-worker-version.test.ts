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
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_DEPLOYMENT_MODE: "gradual",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
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
        CF_WORKER_NAME: "hosted-worker",
        GITHUB_OUTPUT: "/tmp/github-output.txt",
        HOSTED_EXECUTION_DEPLOYMENT_MODE: "gradual",
        HOSTED_EXECUTION_DEPLOY_VERSION_ID: "version-b",
        HOSTED_EXECUTION_GRADUAL_ROLLOUT_PERCENTAGE: "10",
        HOSTED_EXECUTION_INCLUDE_SECRETS: "true",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.uploadVersion).not.toHaveBeenCalled();
    expect(dependencies.deployVersions).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("rollout 10%"),
      versionSpecs: ["version-a@90", "version-b@10"],
      workerName: "hosted-worker",
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
        CF_WORKER_NAME: "hosted-worker",
        GITHUB_OUTPUT: "/tmp/github-output.txt",
        HOSTED_EXECUTION_DEPLOYMENT_MESSAGE: "manual direct deploy",
        HOSTED_EXECUTION_DEPLOYMENT_MODE: "direct",
        HOSTED_EXECUTION_VERSION_MESSAGE: "unused direct version message",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: "manual direct deploy",
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
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

  it("defaults to a direct deploy when no deployment mode is provided", async () => {
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
        CF_WORKER_NAME: "hosted-worker",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("direct deploy"),
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
    });
    expect(dependencies.deployVersions).not.toHaveBeenCalled();
    expect(dependencies.uploadVersion).not.toHaveBeenCalled();
    expect(result.mode).toBe("direct");
  });

  it("keeps deployment and version message overrides scoped to the gradual upload flow", async () => {
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
          percentage: 75,
          version_id: "version-a",
        },
        {
          percentage: 25,
          version_id: "uploaded-version",
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

    await runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_DEPLOYMENT_MESSAGE: "manual rollout deploy",
        HOSTED_EXECUTION_DEPLOYMENT_MODE: "gradual",
        HOSTED_EXECUTION_GRADUAL_ROLLOUT_PERCENTAGE: "25",
        HOSTED_EXECUTION_VERSION_MESSAGE: "manual candidate version",
      },
      resultPath: "/tmp/deployment-result.json",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.uploadVersion).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      includeSecrets: true,
      message: "manual candidate version",
      secretsFilePath: "/tmp/worker-secrets.json",
      tag: expect.any(String),
      workerName: "hosted-worker",
    });
    expect(dependencies.deployVersions).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: "manual rollout deploy",
      versionSpecs: ["version-a@75", "uploaded-version@25"],
      workerName: "hosted-worker",
    });
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
  const deployDirect = vi.fn(
    overrides.deployDirect ?? (async () => {}),
  );
  const deployVersions = vi.fn(
    overrides.deployVersions ?? (async () => {}),
  );
  const mkdir = vi.fn(
    overrides.mkdir ?? (async () => {}),
  );
  const readCurrentDeployment = vi.fn(
    overrides.readCurrentDeployment ?? (async () => null),
  );
  const readRenderedDeployConfig = vi.fn(
    overrides.readRenderedDeployConfig
    ?? (async () => ({
      migrations: [{ tag: "v1" }, { tag: "v2" }],
    })),
  );
  const uploadVersion = vi.fn(
    overrides.uploadVersion ?? (async () => "uploaded-version"),
  );
  const writeFile = vi.fn(
    overrides.writeFile ?? (async () => {}),
  );

  return {
    deployDirect,
    deployVersions,
    mkdir,
    readCurrentDeployment,
    readRenderedDeployConfig,
    uploadVersion,
    writeFile,
  };
}
