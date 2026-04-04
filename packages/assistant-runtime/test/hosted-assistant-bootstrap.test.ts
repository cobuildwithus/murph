import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildAssistantProviderDefaultsPatch,
  ensureHostedAssistantOperatorDefaults,
  parseHostedAssistantConfig,
  resolveAssistantBackendTarget,
  resolveAssistantOperatorDefaults,
  resolveHostedAssistantConfig,
  resolveOperatorConfigPath,
  saveAssistantOperatorDefaultsPatch,
  saveHostedAssistantConfig,
  tryParseHostedAssistantConfig,
} from "@murphai/assistant-core";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map(async (target) => {
      await rm(target, { force: true, recursive: true });
    }),
  );
});

describe("ensureHostedAssistantOperatorDefaults", () => {
  it("accepts only the canonical target-based hosted profile shape", () => {
    expect(parseHostedAssistantConfig({
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          label: "OpenAI",
          managedBy: "platform",
          target: {
            adapter: "openai-compatible",
            apiKeyEnv: "OPENAI_API_KEY",
            endpoint: "https://api.openai.com/v1",
            headers: null,
            model: "gpt-5.4",
            providerName: "openai",
            reasoningEffort: "medium",
          },
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
      updatedAt: "2026-04-05T00:00:00.000Z",
    })).toEqual({
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          label: "OpenAI",
          managedBy: "platform",
          target: {
            adapter: "openai-compatible",
            apiKeyEnv: "OPENAI_API_KEY",
            endpoint: "https://api.openai.com/v1",
            headers: null,
            model: "gpt-5.4",
            providerName: "openai",
            reasoningEffort: "medium",
          },
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
      updatedAt: "2026-04-05T00:00:00.000Z",
    });
  });

  it("rejects the removed legacy provider-shaped hosted profile", () => {
    const legacyConfig = {
      activeProfileId: "platform-default",
      profiles: [
        {
          apiKeyEnv: "OPENAI_API_KEY",
          approvalPolicy: null,
          baseUrl: "https://api.openai.com/v1",
          codexCommand: null,
          id: "platform-default",
          label: "OpenAI",
          managedBy: "platform",
          model: "gpt-5.4",
          oss: false,
          profile: null,
          provider: "openai-compatible",
          providerName: "openai",
          reasoningEffort: "medium",
          sandbox: null,
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
      updatedAt: "2026-04-05T00:00:00.000Z",
    };

    expect(() => parseHostedAssistantConfig(legacyConfig)).toThrow(
      "Hosted assistant config is required.",
    );
    expect(tryParseHostedAssistantConfig(legacyConfig)).toBeNull();
  });

  it("seeds explicit OpenAI-compatible defaults from a named hosted provider", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    const result = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
        HOSTED_ASSISTANT_PROVIDER: "openai",
      },
      homeDirectory,
    });

    expect(result).toMatchObject({
      configured: true,
      provider: "openai-compatible",
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
            adapter: "openai-compatible",
            apiKeyEnv: "OPENAI_API_KEY",
            endpoint: "https://api.openai.com/v1",
            model: "gpt-4.1-mini",
            providerName: "openai",
          },
        },
      ],
      schema: "murph.hosted-assistant-config.v1",
    });

    await expect(resolveAssistantOperatorDefaults(homeDirectory)).resolves.toBeNull();
  });

  it("preserves hosted reasoning effort for named OpenAI profiles", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    const result = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: "gpt-5.4",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      },
      homeDirectory,
    });

    expect(result).toMatchObject({
      configured: true,
      provider: "openai-compatible",
      seeded: true,
      source: "hosted-env",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toMatchObject({
      activeProfileId: "platform-default",
      profiles: [
        {
          id: "platform-default",
          target: {
            adapter: "openai-compatible",
            model: "gpt-5.4",
            providerName: "openai",
            reasoningEffort: "medium",
          },
        },
      ],
    });

    await expect(resolveAssistantOperatorDefaults(homeDirectory)).resolves.toBeNull();
  });

  it("preserves hosted reasoning effort for named Venice profiles", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    const result = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: "openai-gpt-54",
        HOSTED_ASSISTANT_PROVIDER: "venice",
        HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      },
      homeDirectory,
    });

    expect(result).toMatchObject({
      configured: true,
      provider: "openai-compatible",
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
            adapter: "openai-compatible",
            apiKeyEnv: "VENICE_API_KEY",
            endpoint: "https://api.venice.ai/api/v1",
            model: "openai-gpt-54",
            providerName: "venice",
            reasoningEffort: "medium",
          },
        },
      ],
    });
  });

  it("preserves hosted reasoning effort for custom OpenAI-compatible endpoints", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    const result = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_BASE_URL: "https://router.example.test/v1",
        HOSTED_ASSISTANT_MODEL: "gpt-5-compatible",
        HOSTED_ASSISTANT_PROVIDER: "custom",
        HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      },
      homeDirectory,
    });

    expect(result).toMatchObject({
      configured: true,
      provider: "openai-compatible",
      seeded: true,
      source: "hosted-env",
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
    await expect(resolveAssistantOperatorDefaults(homeDirectory)).resolves.toBeNull();
  });

  it("rejects incomplete custom OpenAI-compatible configuration", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_MODEL: "my-model",
          HOSTED_ASSISTANT_PROVIDER: "custom",
        },
        homeDirectory,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_CONFIG_INVALID",
      name: "HostedAssistantConfigurationError",
    });
  });

  it("rejects hosted codex bootstrap configuration", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: "codex-cli",
          HOSTED_ASSISTANT_MODEL: "gpt-5-codex",
        },
        homeDirectory,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_CONFIG_INVALID",
      name: "HostedAssistantConfigurationError",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toBeNull();
  });

  it("updates platform-managed hosted config when the worker env changes", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: "openrouter/meta-llama-3.1-8b-instruct",
        HOSTED_ASSISTANT_PROVIDER: "openrouter",
      },
      homeDirectory,
    });

    const secondResult = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
        HOSTED_ASSISTANT_PROVIDER: "openai",
      },
      homeDirectory,
    });

    expect(secondResult).toMatchObject({
      configured: true,
      provider: "openai-compatible",
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
            adapter: "openai-compatible",
            apiKeyEnv: "OPENAI_API_KEY",
            endpoint: "https://api.openai.com/v1",
            model: "gpt-4.1-mini",
            providerName: "openai",
          },
        },
      ],
    });

    await expect(resolveAssistantOperatorDefaults(homeDirectory)).resolves.toBeNull();
  });

  it("preserves member-managed hosted config instead of overwriting it from worker env", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await saveHostedAssistantConfig(
      {
        activeProfileId: "saved-default",
        profiles: [
          {
            id: "saved-default",
            label: "OpenAI",
            managedBy: "member",
            target: {
              adapter: "openai-compatible",
              apiKeyEnv: "OPENAI_API_KEY",
              endpoint: "https://api.openai.com/v1",
              model: "gpt-4.1-mini",
              providerName: "openai",
              reasoningEffort: null,
            },
          },
        ],
        schema: "murph.hosted-assistant-config.v1",
        updatedAt: "2026-03-28T00:00:00.000Z",
      },
      homeDirectory,
    );

    const firstResult = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {},
      homeDirectory,
    });

    expect(firstResult).toMatchObject({
      configured: true,
      provider: "openai-compatible",
      seeded: false,
      source: "saved",
    });

    const secondResult = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: "openrouter/meta-llama-3.1-8b-instruct",
        HOSTED_ASSISTANT_PROVIDER: "openrouter",
      },
      homeDirectory,
    });

    expect(secondResult).toMatchObject({
      configured: true,
      provider: "openai-compatible",
      seeded: false,
      source: "saved",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toMatchObject({
      activeProfileId: "saved-default",
      profiles: [
        {
          id: "saved-default",
          managedBy: "member",
          target: {
            adapter: "openai-compatible",
            apiKeyEnv: "OPENAI_API_KEY",
            endpoint: "https://api.openai.com/v1",
            model: "gpt-4.1-mini",
            providerName: "openai",
          },
        },
      ],
    });

    await expect(resolveAssistantOperatorDefaults(homeDirectory)).resolves.toBeNull();
  });

  it("fails closed when durable hosted config is invalid even if assistant defaults exist", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();
    const operatorConfigPath = resolveOperatorConfigPath(homeDirectory);

    await saveAssistantOperatorDefaultsPatch(
      buildAssistantProviderDefaultsPatch({
        defaults: null,
        provider: "openai-compatible",
        providerConfig: {
          provider: "openai-compatible",
          apiKeyEnv: "OPENAI_API_KEY",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4.1-mini",
          providerName: "openai",
        },
      }),
      homeDirectory,
    );

    const existingConfig = JSON.parse(await readFile(operatorConfigPath, "utf8")) as Record<string, unknown>;

    await mkdir(path.dirname(operatorConfigPath), { recursive: true });
    await writeFile(
      operatorConfigPath,
      `${JSON.stringify({
        ...existingConfig,
        hostedAssistant: {
          schema: "murph.hosted-assistant-config.v1",
          activeProfileId: "broken",
          profiles: "invalid",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

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
      source: "invalid",
    });

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {},
        homeDirectory,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_CONFIG_INVALID",
      name: "HostedAssistantConfigurationError",
    });

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toBeNull();
    const defaults = await resolveAssistantOperatorDefaults(homeDirectory);
    expect(resolveAssistantBackendTarget(defaults)).toMatchObject({
      adapter: "openai-compatible",
      apiKeyEnv: "OPENAI_API_KEY",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      providerName: "openai",
    });
  });

  it("fails closed when durable hosted config still uses the removed provider-shaped profile", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();
    const operatorConfigPath = resolveOperatorConfigPath(homeDirectory);

    await mkdir(path.dirname(operatorConfigPath), { recursive: true });
    await writeFile(
      operatorConfigPath,
      `${JSON.stringify({
        schema: "murph.operator-config.v1",
        defaultVault: null,
        assistant: null,
        hostedAssistant: {
          activeProfileId: "platform-default",
          profiles: [
            {
              apiKeyEnv: "OPENAI_API_KEY",
              approvalPolicy: null,
              baseUrl: "https://api.openai.com/v1",
              codexCommand: null,
              id: "platform-default",
              label: "OpenAI",
              managedBy: "platform",
              model: "gpt-5.4",
              oss: false,
              profile: null,
              provider: "openai-compatible",
              providerName: "openai",
              reasoningEffort: "medium",
              sandbox: null,
            },
          ],
          schema: "murph.hosted-assistant-config.v1",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
        updatedAt: "2026-04-05T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(resolveHostedAssistantConfig(homeDirectory)).resolves.toBeNull();

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
      source: "invalid",
    });

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {},
        homeDirectory,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_CONFIG_INVALID",
      name: "HostedAssistantConfigurationError",
    });
  });
});

async function createTemporaryHomeDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-assistant-bootstrap-"));
  temporaryPaths.push(target);
  return target;
}
