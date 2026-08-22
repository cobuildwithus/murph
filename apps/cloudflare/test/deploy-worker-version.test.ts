import { describe, expect, it, vi } from "vitest";

import {
  listHostedDeployEnvironmentInvariantErrors,
  listHostedDeployEnvironmentInvariantErrorsAsync,
} from "../scripts/deploy-preflight.js";
import {
  runHostedWorkerDeployment,
  type DeploymentStatusPayload,
  type HostedWorkerDeploymentDependencies,
} from "../scripts/deploy-worker-version.shared.js";

describe("runHostedWorkerDeployment", () => {
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
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.validateDeployEnvironment).toHaveBeenCalledWith({
      deployWorker: true,
      source: expect.objectContaining({
        CF_WORKER_NAME: "hosted-worker",
      }),
    });
    expect(dependencies.validatePreparedArtifacts).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      includeSecrets: true,
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      source: expect.objectContaining({
        CF_WORKER_NAME: "hosted-worker",
      }),
    });
    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      containerRolloutMode: "gradual",
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: "manual direct deploy",
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
    });
    expect(result).toMatchObject({
      finalDeploymentVersions: [
        {
          percentage: 100,
          versionId: "version-direct",
        },
      ],
      smokeVersionId: "version-direct",
    });
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      "/tmp/github-output.txt",
      [
        "final_version_traffic=[{\"percentage\":100,\"versionId\":\"version-direct\"}]",
        "smoke_version_id=version-direct",
        "",
      ].join("\n"),
      {
        encoding: "utf8",
        flag: "a",
      },
    );
  });

  it("defaults to a direct deploy", async () => {
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
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      containerRolloutMode: "gradual",
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("direct deploy"),
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
    });
    expect(result.smokeVersionId).toBe("version-direct");
  });

  it("defaults production deploys to immediate container rollout for hard runner floors", async () => {
    const finalDeployment: DeploymentStatusPayload = {
      created_on: "2026-03-27T00:10:00.000Z",
      versions: [
        {
          percentage: 100,
          version_id: "version-direct",
        },
      ],
    };
    const dependencies = createDependencies({
      readCurrentDeployment: vi
        .fn<HostedWorkerDeploymentDependencies["readCurrentDeployment"]>()
        .mockResolvedValue(finalDeployment),
    });

    await runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_DEPLOY_CONTEXT: "production",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      containerRolloutMode: "immediate",
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("production direct deploy"),
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
    });
  });

  it("fails direct deploys that do not report a 100% Worker version for smoke", async () => {
    const finalDeployment: DeploymentStatusPayload = {
      created_on: "2026-03-27T00:10:00.000Z",
      versions: [
        {
          percentage: 50,
          version_id: "version-split",
        },
      ],
    };
    const dependencies = createDependencies({
      readCurrentDeployment: vi
        .fn<HostedWorkerDeploymentDependencies["readCurrentDeployment"]>()
        .mockResolvedValue(finalDeployment),
    });

    await expect(runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    })).rejects.toThrow("Direct deploy did not report a 100% Worker version for smoke.");

    expect(dependencies.deployDirect).toHaveBeenCalledTimes(1);
    expect(dependencies.writeFile).not.toHaveBeenCalledWith(
      "/tmp/deployment-result.json",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("accepts yes and no for deploy boolean env values", async () => {
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

    await runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_INCLUDE_SECRETS: "no",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.validatePreparedArtifacts).toHaveBeenCalledWith({
      configPath: "/tmp/wrangler.generated.jsonc",
      includeSecrets: false,
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      source: expect.objectContaining({
        HOSTED_EXECUTION_INCLUDE_SECRETS: "no",
      }),
    });
    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      containerRolloutMode: "gradual",
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("direct deploy"),
      includeSecrets: false,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
    });

    const yesDependencies = createDependencies({
      readCurrentDeployment: vi
        .fn<HostedWorkerDeploymentDependencies["readCurrentDeployment"]>()
        .mockResolvedValue(finalDeployment),
    });

    await runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies: yesDependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_INCLUDE_SECRETS: "yes",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(yesDependencies.deployDirect).toHaveBeenCalledWith({
      containerRolloutMode: "gradual",
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("direct deploy"),
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
    });
  });

  it("supports explicit immediate container rollout for hotfix deploys", async () => {
    const finalDeployment: DeploymentStatusPayload = {
      created_on: "2026-03-27T00:10:00.000Z",
      versions: [
        {
          percentage: 100,
          version_id: "version-direct",
        },
      ],
    };
    const dependencies = createDependencies({
      readCurrentDeployment: vi
        .fn<HostedWorkerDeploymentDependencies["readCurrentDeployment"]>()
        .mockResolvedValue(finalDeployment),
    });

    await runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_CONTAINER_ROLLOUT: "immediate",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    });

    expect(dependencies.deployDirect).toHaveBeenCalledWith({
      containerRolloutMode: "immediate",
      configPath: "/tmp/wrangler.generated.jsonc",
      deploymentMessage: expect.stringContaining("direct deploy"),
      includeSecrets: true,
      secretsFilePath: "/tmp/worker-secrets.json",
      versionTag: expect.any(String),
      workerName: "hosted-worker",
    });
  });

  it("rejects unknown container rollout modes before running Wrangler", async () => {
    const dependencies = createDependencies();

    await expect(runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_CONTAINER_ROLLOUT: "fast",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    })).rejects.toThrow("HOSTED_EXECUTION_CONTAINER_ROLLOUT must be 'gradual' or 'immediate'.");

    expect(dependencies.deployDirect).not.toHaveBeenCalled();
    expect(dependencies.validateDeployEnvironment).not.toHaveBeenCalled();
    expect(dependencies.validatePreparedArtifacts).not.toHaveBeenCalled();
  });

  it("rejects invalid deploy environment before validating prepared artifacts or running Wrangler", async () => {
    const dependencies = createDependencies({
      validateDeployEnvironment: async () => {
        throw new Error("Invalid GitHub environment variables for deploy workflow.");
      },
    });

    await expect(runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_DEPLOY_CONTEXT: "production",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    })).rejects.toThrow("Invalid GitHub environment variables for deploy workflow.");

    expect(dependencies.validateDeployEnvironment).toHaveBeenCalledWith({
      deployWorker: true,
      source: expect.objectContaining({
        HOSTED_EXECUTION_DEPLOY_CONTEXT: "production",
      }),
    });
    expect(dependencies.validatePreparedArtifacts).not.toHaveBeenCalled();
    expect(dependencies.deployDirect).not.toHaveBeenCalled();
  });

  it.each([
    [
      "malformed authority JSON",
      { HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: '{"standby"' },
    ],
    [
      "an invalid authority status",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "authority-v2": {
            publicKeyPem: "standby-public-key",
            status: "verify-only",
          },
        }),
      },
    ],
    [
      "an additional active authority",
      {
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "authority-v2": {
            publicKeyPem: "standby-public-key",
            status: "active",
          },
        }),
      },
    ],
    [
      "a private JWK without d",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                crv: "P-256",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "cloudflare-automation-secret",
              status: "decrypt_only",
            },
          }),
      },
    ],
    [
      "a non-Cloudflare private recipient",
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                crv: "P-256",
                d: "standby-private-coordinate",
                kty: "EC",
                x: "standby-public-x",
                y: "standby-public-y",
              },
              recipient: "recovery-offline",
              status: "decrypt_only",
            },
          }),
      },
    ],
  ] as const)("rejects %s before prepared artifacts or Wrangler", async (
    _name,
    overrides,
  ) => {
    const dependencies = createDependencies({
      validateDeployEnvironment: async ({ source }) => {
        const errors = listHostedDeployEnvironmentInvariantErrors(
          source,
          { deployWorker: true },
        );
        if (errors.length > 0) {
          throw new Error(
            `Invalid GitHub environment variables for deploy workflow: ${errors.join(" ")}`,
          );
        }
      },
    });

    await expect(runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: createPreviewDeploymentEnv({
        HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "authority-v1",
        HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          "-----BEGIN PUBLIC KEY-----\\nactive\\n-----END PUBLIC KEY-----",
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
          "cloudflare-automation:v1",
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify({
          crv: "P-256",
          d: "active-private-coordinate",
          kty: "EC",
          x: "active-public-x",
          y: "active-public-y",
        }),
        ...overrides,
      }),
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-runner-staging",
    })).rejects.toThrow(/HOSTED_CRYPTO_/u);

    expect(dependencies.validatePreparedArtifacts).not.toHaveBeenCalled();
    expect(dependencies.deployDirect).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a self-routed Worker/Web origin",
      {
        HOSTED_WEB_BASE_URL: "https://hosted-runner-staging.example.test",
      },
      "preview deploys must keep CF_PUBLIC_BASE_URL distinct from HOSTED_WEB_BASE_URL.",
      undefined,
    ],
    [
      "a split-host device callback origin",
      {
        DEVICE_SYNC_PUBLIC_BASE_URL:
          "https://device-sync-staging.example.test/api/device-sync",
      },
      "DEVICE_SYNC_PUBLIC_BASE_URL must use the HOSTED_WEB_BASE_URL hostname in preview deploys.",
      undefined,
    ],
    [
      "a private device callback DNS result",
      {
        DEVICE_SYNC_PUBLIC_BASE_URL:
          "https://web-staging.example.test/api/device-sync",
      },
      "DEVICE_SYNC_PUBLIC_BASE_URL must not resolve to private-network addresses in preview deploys.",
      "web-staging.example.test",
    ],
  ] as const)(
    "rejects preview %s before artifact validation, lifecycle changes, or Wrangler",
    async (_name, overrides, expectedError, privateHostname) => {
      const dependencies = createDependencies({
        validateDeployEnvironment: async ({ source }) => {
          const errors = await listHostedDeployEnvironmentInvariantErrorsAsync(
            source,
            { deployWorker: true },
            {
              readR2BucketInfo: async (bucketName) => ({
                defaultStorageClass: "Standard",
                location: bucketName.includes("enam") ? "ENAM" : "OC",
                name: bucketName,
              }),
              resolveHostnameAddresses: async (hostname) =>
                hostname === privateHostname ? ["10.1.2.3"] : ["8.8.8.8"],
            },
          );
          if (errors.length > 0) {
            throw new Error(
              `Invalid GitHub environment variables for deploy workflow: ${errors.join(" ")}`,
            );
          }
        },
      });

      await expect(runHostedWorkerDeployment({
        configPath: "/tmp/wrangler.generated.jsonc",
        dependencies,
        env: createPreviewDeploymentEnv(overrides),
        resultPath: "/tmp/deployment-result.json",
        runnerBundleDir: "/tmp/runner-bundle",
        secretsFilePath: "/tmp/worker-secrets.json",
        workerName: "hosted-runner-staging",
      })).rejects.toThrow(expectedError);

      expect(dependencies.validatePreparedArtifacts).not.toHaveBeenCalled();
      expect(dependencies.deployDirect).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid prepared artifacts before running Wrangler", async () => {
    const dependencies = createDependencies({
      validatePreparedArtifacts: async () => {
        throw new Error("Prepared runner bundle changed after assembly.");
      },
    });

    await expect(runHostedWorkerDeployment({
      configPath: "/tmp/wrangler.generated.jsonc",
      dependencies,
      env: {
        CF_WORKER_NAME: "hosted-worker",
      },
      resultPath: "/tmp/deployment-result.json",
      runnerBundleDir: "/tmp/runner-bundle",
      secretsFilePath: "/tmp/worker-secrets.json",
      workerName: "hosted-worker",
    })).rejects.toThrow("Prepared runner bundle changed after assembly.");

    expect(dependencies.mkdir).not.toHaveBeenCalled();
    expect(dependencies.deployDirect).not.toHaveBeenCalled();
  });
});

function createPreviewDeploymentEnv(
  overrides: Record<string, string | undefined> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    CF_BUNDLES_BUCKET: "hosted-bundles-staging",
    CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-staging",
    CF_PUBLIC_BASE_URL: "https://hosted-runner-staging.example.test",
    CF_WORKER_NAME: "hosted-runner-staging",
    HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
    HOSTED_ASSISTANT_PROVIDER: "openai",
    HOSTED_CRYPTO_ENV: "preview",
    HOSTED_EXECUTION_DEPLOY_CONTEXT: "preview",
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "preview",
    HOSTED_WEB_BASE_URL: "https://web-staging.example.test",
    HOSTED_WEB_PRODUCTION_BASE_URL: "https://app.example.test",
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<HostedWorkerDeploymentDependencies> = {},
): HostedWorkerDeploymentDependencies & {
  deployDirect: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  readCurrentDeployment: ReturnType<typeof vi.fn>;
  validateDeployEnvironment: ReturnType<typeof vi.fn>;
  validatePreparedArtifacts: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
} {
  const deployDirect = vi.fn(
    overrides.deployDirect ?? (async () => {}),
  );
  const mkdir = vi.fn(
    overrides.mkdir ?? (async () => {}),
  );
  const readCurrentDeployment = vi.fn(
    overrides.readCurrentDeployment ?? (async () => null),
  );
  const validateDeployEnvironment = vi.fn(
    overrides.validateDeployEnvironment ?? (async () => {}),
  );
  const validatePreparedArtifacts = vi.fn(
    overrides.validatePreparedArtifacts ?? (async () => {}),
  );
  const writeFile = vi.fn(
    overrides.writeFile ?? (async () => {}),
  );

  return {
    deployDirect,
    mkdir,
    readCurrentDeployment,
    validateDeployEnvironment,
    validatePreparedArtifacts,
    writeFile,
  };
}
