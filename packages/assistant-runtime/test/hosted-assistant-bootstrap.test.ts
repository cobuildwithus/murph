import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveHostedAssistantConfig,
  resolveOperatorConfigPath,
} from "@murphai/operator-config/operator-config";
import {
  ensureHostedAssistantOperatorDefaults,
  parseHostedAssistantConfig,
  tryParseHostedAssistantConfig,
} from "@murphai/operator-config/hosted-assistant-config";

const temporaryPaths: string[] = [];

const CODEX_VERCEL_GATEWAY_TARGET = {
  adapter: "codex-cli",
  approvalPolicy: "never",
  codexCommand: null,
  model: "gpt-5.6-terra",
  modelProvider: "openai",
  oss: false,
  profile: null,
  reasoningEffort: "medium",
  sandbox: "danger-full-access",
} as const;

const CODEX_VERCEL_GATEWAY_ENV = {
  HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
  HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
  HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
} as const;

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map(async (target) => {
      await rm(target, { force: true, recursive: true });
    }),
  );
});

describe("ensureHostedAssistantOperatorDefaults", () => {
  it("accepts only hosted Codex App Server profiles with OpenAI as the model provider", () => {
    const hostedConfig = {
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          label: "OpenAI",
          managedBy: "platform",
          target: CODEX_VERCEL_GATEWAY_TARGET,
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
      updatedAt: "2026-04-28T00:00:00.000Z",
    };

    expect(parseHostedAssistantConfig(hostedConfig)).toEqual(hostedConfig);
  });

  it("rejects unsupported hosted profiles", () => {
    const legacyTargetConfig = {
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          label: "Legacy",
          managedBy: "platform",
          target: {
            adapter: "unsupported-provider",
            apiKeyEnv: "PROVIDER_API_KEY",
            endpoint: "https://api.example.test/v1",
            headers: null,
            model: "gpt-5.4",
            presetId: "legacy",
            providerName: "legacy",
            reasoningEffort: "medium",
            webSearch: null,
          },
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
      updatedAt: "2026-04-05T00:00:00.000Z",
    };
    const legacyProviderConfig = {
      activeProfileId: "platform-default",
      profiles: [
        {
          apiKeyEnv: "PROVIDER_API_KEY",
          approvalPolicy: null,
          baseUrl: "https://api.example.test/v1",
          codexCommand: null,
          id: "platform-default",
          label: "Legacy",
          managedBy: "platform",
          model: "gpt-5.4",
          oss: false,
          profile: null,
          provider: "unsupported-provider",
          providerName: "legacy",
          reasoningEffort: "medium",
          sandbox: null,
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
      updatedAt: "2026-04-05T00:00:00.000Z",
    };

    for (const legacyConfig of [legacyTargetConfig, legacyProviderConfig]) {
      expect(() => parseHostedAssistantConfig(legacyConfig)).toThrow(
        "Hosted assistant config is required.",
      );
      expect(tryParseHostedAssistantConfig(legacyConfig)).toBeNull();
    }
  });

  it("seeds Codex App Server defaults from hosted OpenAI env", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    const result = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: CODEX_VERCEL_GATEWAY_ENV,
      homeDirectory,
    });

    expect(result).toMatchObject({
      configured: true,
      provider: "codex-cli",
      seeded: true,
      source: "hosted-env",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toMatchObject({
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          label: "OpenAI",
          managedBy: "platform",
          target: CODEX_VERCEL_GATEWAY_TARGET,
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
    });
  });

  it("allows activation bootstrap to stay missing when no hosted assistant seed exists", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: true,
        env: {},
        homeDirectory,
      }),
    ).resolves.toMatchObject({
      configured: false,
      provider: null,
      seeded: false,
      source: "missing",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toBeNull();
  });

  it("fails closed for unsupported hosted provider env", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    for (const provider of ["legacy", "openrouter", "venice", "custom", "unsupported-provider"]) {
      await expect(
        ensureHostedAssistantOperatorDefaults({
          allowMissing: false,
          env: {
            HOSTED_ASSISTANT_MODEL: "gpt-5.4",
            HOSTED_ASSISTANT_PROVIDER: provider,
          },
          homeDirectory,
        }),
      ).rejects.toMatchObject({
        code: "HOSTED_ASSISTANT_CONFIG_INVALID",
        name: "HostedAssistantConfigurationError",
      });
    }
  });

  it("fails closed when hosted runtime selectors are mixed into old provider env", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
          HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
          HOSTED_ASSISTANT_PROVIDER: "legacy",
          HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
          HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
        },
        homeDirectory,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_CONFIG_INVALID",
      name: "HostedAssistantConfigurationError",
    });
  });

  it("updates the platform-managed hosted Codex profile when the worker env changes", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: CODEX_VERCEL_GATEWAY_ENV,
      homeDirectory,
    });

    const secondResult = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        ...CODEX_VERCEL_GATEWAY_ENV,
        HOSTED_ASSISTANT_MODEL: "gpt-5.6",
      },
      homeDirectory,
    });

    expect(secondResult).toMatchObject({
      configured: true,
      provider: "codex-cli",
      seeded: true,
      source: "hosted-env",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toMatchObject({
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          managedBy: "platform",
          target: {
            ...CODEX_VERCEL_GATEWAY_TARGET,
            model: "gpt-5.6",
          },
        },
      ],
    });
  });

  it("replaces invalid durable hosted config from hosted Codex env without reviving legacy defaults", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();
    const operatorConfigPath = resolveOperatorConfigPath(homeDirectory);

    await mkdir(path.dirname(operatorConfigPath), { recursive: true });
    await writeFile(
      operatorConfigPath,
      `${JSON.stringify({
        assistant: {
          defaults: {
            apiKeyEnv: "PROVIDER_API_KEY",
            baseUrl: "https://api.example.test/v1",
            model: "gpt-4.1-mini",
            provider: "unsupported-provider",
            providerName: "legacy",
          },
        },
        defaultVault: null,
        hostedAssistant: {
          activeProfileId: "broken",
          profiles: "invalid",
          schema: "murph.hosted-assistant-config.v1",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
        schema: "murph.operator-config.v1",
        updatedAt: "2026-04-05T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: true,
        env: CODEX_VERCEL_GATEWAY_ENV,
        homeDirectory,
      }),
    ).resolves.toMatchObject({
      configured: true,
      provider: "codex-cli",
      seeded: true,
      source: "hosted-env",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toMatchObject({
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          managedBy: "platform",
          target: CODEX_VERCEL_GATEWAY_TARGET,
        },
      ],
    });
  });
});

async function createTemporaryHomeDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-assistant-bootstrap-"));
  temporaryPaths.push(target);
  return target;
}
