import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildAssistantProviderDefaultsPatch,
  ensureHostedAssistantOperatorDefaults,
  resolveAssistantBackendTarget,
  resolveAssistantOperatorDefaults,
  resolveHostedAssistantConfig,
  resolveOperatorConfigPath,
  saveAssistantOperatorDefaultsPatch,
  saveHostedAssistantConfig,
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
          apiKeyEnv: "OPENAI_API_KEY",
          baseUrl: "https://api.openai.com/v1",
          id: "platform-default",
          managedBy: "platform",
          model: "gpt-4.1-mini",
          provider: "openai-compatible",
          providerName: "openai",
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
          model: "gpt-5.4",
          provider: "openai-compatible",
          providerName: "openai",
          reasoningEffort: "medium",
        },
      ],
    });

    await expect(resolveAssistantOperatorDefaults(homeDirectory)).resolves.toBeNull();
  });

  it("rejects hosted reasoning effort for non-OpenAI-compatible endpoints", async () => {
    const homeDirectory = await createTemporaryHomeDirectory();

    await expect(
      ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_MODEL: "openrouter/openai/gpt-5.4",
          HOSTED_ASSISTANT_PROVIDER: "openrouter",
          HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
        },
        homeDirectory,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_ASSISTANT_CONFIG_INVALID",
      name: "HostedAssistantConfigurationError",
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
          apiKeyEnv: "OPENAI_API_KEY",
          baseUrl: "https://api.openai.com/v1",
          id: "platform-default",
          managedBy: "platform",
          model: "gpt-4.1-mini",
          provider: "openai-compatible",
          providerName: "openai",
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
            provider: "openai-compatible",
            apiKeyEnv: "OPENAI_API_KEY",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4.1-mini",
            providerName: "openai",
            approvalPolicy: null,
            codexCommand: null,
            oss: false,
            profile: null,
            reasoningEffort: null,
            sandbox: null,
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
          apiKeyEnv: "OPENAI_API_KEY",
          baseUrl: "https://api.openai.com/v1",
          id: "saved-default",
          managedBy: "member",
          model: "gpt-4.1-mini",
          provider: "openai-compatible",
          providerName: "openai",
        },
      ],
    });

    await expect(resolveAssistantOperatorDefaults(homeDirectory)).resolves.toBeNull();
  });

  it("fails closed instead of migrating legacy defaults when durable hosted config is invalid", async () => {
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
});

async function createTemporaryHomeDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "hosted-assistant-bootstrap-"));
  temporaryPaths.push(target);
  return target;
}
