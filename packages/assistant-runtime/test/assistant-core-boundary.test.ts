import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { test } from "vitest";

import {
  assistantAutomationStateSchema,
  createIntegratedInboxServices,
  createIntegratedVaultServices,
  readAssistantAutomationState,
  readOperatorConfig,
  resolveAssistantSelfDeliveryTarget,
  saveAssistantAutomationState,
  saveAssistantOperatorDefaultsPatch,
  saveAssistantSelfDeliveryTarget,
  saveDefaultVaultConfig,
} from "@murphai/assistant-core";

interface PackageManifest {
  dependencies?: Record<string, string | undefined>;
  exports?: Record<string, { default?: string; types?: string }>;
}

interface TsConfigShape {
  references?: Array<{ path?: string }>;
}

test("assistant-runtime uses the dedicated @murphai/assistant-core boundary instead of importing the CLI package", async () => {
  const runtimeManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageManifest;
  const cloudflareManifest = JSON.parse(
    await readFile(new URL("../../../apps/cloudflare/package.json", import.meta.url), "utf8"),
  ) as PackageManifest;
  const assistantCoreManifest = JSON.parse(
    await readFile(new URL("../../assistant-core/package.json", import.meta.url), "utf8"),
  ) as PackageManifest;
  const assistantCoreTsconfig = JSON.parse(
    await readFile(new URL("../../assistant-core/tsconfig.json", import.meta.url), "utf8"),
  ) as TsConfigShape;
  const cliManifest = JSON.parse(
    await readFile(new URL("../../cli/package.json", import.meta.url), "utf8"),
  ) as PackageManifest;
  const assistantCoreIndexSource = await readFile(
    new URL("../../assistant-core/src/index.ts", import.meta.url),
    "utf8",
  );
  const assistantCoreInboxServicesSource = await readFile(
    new URL("../../assistant-core/src/inbox-services.ts", import.meta.url),
    "utf8",
  );
  const assistantCoreIntegratedServicesSource = await readFile(
    new URL("../../assistant-core/src/usecases/integrated-services.ts", import.meta.url),
    "utf8",
  );
  const assistantCoreTypesSource = await readFile(
    new URL("../../assistant-core/src/usecases/types.ts", import.meta.url),
    "utf8",
  );
  const runtimeIndexSource = await readFile(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  const runtimeSourceFiles = await listFilesRecursive(new URL("../src/", import.meta.url));
  const assistantCoreSourceFiles = await listFilesRecursive(
    new URL("../../assistant-core/src/", import.meta.url),
  );
  const cloudflareNodeRunnerSource = await readFile(
    new URL("../../../apps/cloudflare/test/node-runner.test.ts", import.meta.url),
    "utf8",
  );
  const assistantCoreModule = await import("@murphai/assistant-core");
  const assistantRuntimeModule = await import("@murphai/assistant-runtime");
  let sawAssistantCoreImport = false;

  assert.equal(runtimeManifest.dependencies?.["@murphai/assistant-core"], "workspace:*");
  assert.equal(runtimeManifest.dependencies?.murph, undefined);
  assert.equal(cloudflareManifest.dependencies?.["@murphai/assistant-core"], "workspace:*");
  assert.equal(cloudflareManifest.dependencies?.murph, undefined);
  assert.equal(assistantCoreManifest.dependencies?.murph, undefined);
  assert.equal(assistantCoreManifest.exports?.["./*"], undefined);
  assert.equal(
    assistantCoreManifest.exports?.["./assistant-runtime"]?.default,
    "./dist/assistant-runtime.js",
  );
  assert.equal(
    assistantCoreManifest.exports?.["./assistant-provider"]?.default,
    "./dist/assistant-provider.js",
  );
  assert.equal(
    assistantCoreManifest.exports?.["./assistant-state"]?.default,
    "./dist/assistant-state.js",
  );
  assert.equal(existsSync(new URL("../../assistant-services/package.json", import.meta.url)), false);
  assert.equal(cliManifest.exports?.["./assistant-core"], undefined);
  assert.ok(
    assistantCoreTsconfig.references?.every((reference) => reference.path !== "../cli"),
    "packages/assistant-core/tsconfig.json must not reference ../cli",
  );
  assert.doesNotMatch(assistantCoreIndexSource, /\bfrom ["']murph\//u);
  assert.doesNotMatch(assistantCoreInboxServicesSource, /\bcreateIntegratedInboxCliServices\b/u);
  assert.doesNotMatch(assistantCoreInboxServicesSource, /\bInboxCliServices\b/u);
  assert.doesNotMatch(
    assistantCoreIntegratedServicesSource,
    /\bcreateIntegratedVaultCliServices\b/u,
  );
  assert.doesNotMatch(
    assistantCoreIntegratedServicesSource,
    /\bcreateUnwiredVaultCliServices\b/u,
  );
  assert.doesNotMatch(assistantCoreTypesSource, /\bVaultCliServices\b/u);
  assert.doesNotMatch(runtimeIndexSource, /contracts\.ts/u);
  assert.match(cloudflareNodeRunnerSource, /from ["']@murphai\/assistant-core["']/u);
  assert.doesNotMatch(cloudflareNodeRunnerSource, /from ["']murph(\/|["'])/u);

  for (const fileUrl of runtimeSourceFiles) {
    const source = await readFile(fileUrl, "utf8");
    assert.doesNotMatch(source, /@murphai\/assistant-services/u);
    assert.doesNotMatch(source, /\bfrom ["']murph(\/|["'])/u);
    if (/from ["']@murphai\/assistant-core["']/u.test(source)) {
      sawAssistantCoreImport = true;
    }
  }

  for (const fileUrl of assistantCoreSourceFiles) {
    const source = await readFile(fileUrl, "utf8");
    assert.doesNotMatch(source, /assistant-daemon-client/u);
    assert.doesNotMatch(source, /\bfrom ["']murph(\/|["'])/u);
  }

  assert.equal(sawAssistantCoreImport, true);
  assert.equal(assistantCoreModule.createIntegratedInboxServices, createIntegratedInboxServices);
  assert.equal(assistantCoreModule.createIntegratedVaultServices, createIntegratedVaultServices);
  assert.equal(Object.hasOwn(assistantCoreModule, "createIntegratedInboxCliServices"), false);
  assert.equal(Object.hasOwn(assistantCoreModule, "createIntegratedVaultCliServices"), false);
  assert.equal(Object.hasOwn(assistantCoreModule, "createUnwiredVaultCliServices"), false);
  assert.equal(Object.hasOwn(assistantCoreModule, "saveDefaultVaultConfig"), true);
  assert.equal(Object.hasOwn(assistantCoreModule, "saveAssistantOperatorDefaultsPatch"), true);
  assert.equal(Object.hasOwn(assistantRuntimeModule, "parseHostedExecutionSideEffects"), false);
  assert.equal(Object.hasOwn(assistantRuntimeModule, "parseHostedExecutionSideEffectRecord"), false);
  assert.equal(Object.hasOwn(assistantRuntimeModule, "HostedExecutionSideEffect"), false);
  assert.equal(Object.hasOwn(assistantRuntimeModule, "runHostedAssistantRuntimeJobInProcess"), true);
  assert.equal(Object.hasOwn(assistantRuntimeModule, "readHostedRunnerCommitTimeoutMs"), true);
});

test("assistant-core operator-config writes the canonical local config shape", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-core-boundary-"));

  try {
    const homeRoot = path.join(workspaceRoot, "home");
    const configPath = path.join(homeRoot, ".murph", "config.json");
    await saveDefaultVaultConfig("/tmp/existing-vault", homeRoot);
    await saveAssistantOperatorDefaultsPatch(
      {
        backend: {
          adapter: "openai-compatible",
          apiKeyEnv: null,
          endpoint: null,
          headers: null,
          model: "gpt-5.4",
          options: null,
          providerName: null,
        },
        selfDeliveryTargets: {
          telegram: {
            channel: "telegram",
            deliveryTarget: null,
            identityId: null,
            participantId: "chat-123",
            sourceThreadId: "chat-123",
          },
        },
      },
      homeRoot,
    );

    const saved = await saveAssistantSelfDeliveryTarget(
      {
        channel: " Email ",
        deliveryTarget: " user@example.com ",
        identityId: " assistant@mail.example.test ",
        participantId: " user@example.com ",
        sourceThreadId: "   ",
      },
      homeRoot,
    );

    assert.deepEqual(saved, {
      channel: "email",
      deliveryTarget: "user@example.com",
      identityId: "assistant@mail.example.test",
      participantId: "user@example.com",
      sourceThreadId: null,
    });

    const config = await readOperatorConfig(homeRoot);
    assert.ok(config);
    assert.equal(config.schema, "murph.operator-config.v1");
    assert.equal(config.defaultVault, "/tmp/existing-vault");
    assert.equal(config.assistant?.backend?.adapter, "openai-compatible");
    assert.equal(config.assistant?.backend?.model, "gpt-5.4");
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.telegram, {
      channel: "telegram",
      deliveryTarget: null,
      identityId: null,
      participantId: "chat-123",
      sourceThreadId: "chat-123",
    });
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.email, saved);
    assert.match(config.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);

    const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      assistant?: {
        backend?: {
          adapter?: string | null;
          model?: string | null;
        } | null;
        selfDeliveryTargets?: Record<string, unknown>;
      };
      defaultVault?: string | null;
      schema?: string;
    };
    assert.equal(rawConfig.schema, "murph.operator-config.v1");
    assert.equal(rawConfig.defaultVault, "/tmp/existing-vault");
    assert.equal(rawConfig.assistant?.backend?.adapter, "openai-compatible");
    assert.equal(rawConfig.assistant?.backend?.model, "gpt-5.4");
    assert.deepEqual(rawConfig.assistant?.selfDeliveryTargets?.email, saved);

    assert.deepEqual(
      await resolveAssistantSelfDeliveryTarget(" EMAIL ", homeRoot),
      saved,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assistant-core operator-config tolerates malformed existing config", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-core-boundary-"));

  try {
    const homeRoot = path.join(workspaceRoot, "home");
    const configPath = path.join(homeRoot, ".murph", "config.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, "{not valid json\n", "utf8");

    const saved = await saveAssistantSelfDeliveryTarget(
      {
        channel: "email",
        deliveryTarget: "user@example.com",
        identityId: null,
        participantId: "user@example.com",
        sourceThreadId: null,
      },
      homeRoot,
    );

    const config = await readOperatorConfig(homeRoot);
    assert.ok(config);
    assert.equal(config.defaultVault, null);
    assert.equal(config.assistant?.backend ?? null, null);
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.email, saved);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assistant-core operator-config rewrites schema-invalid assistant config into a readable config", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-core-boundary-"));

  try {
    const homeRoot = path.join(workspaceRoot, "home");
    const configPath = path.join(homeRoot, ".murph", "config.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({
        assistant: {
          backend: {
            adapter: "not-a-provider",
            model: "gpt-5.4",
          },
        },
        defaultVault: "/tmp/invalid-preserved-value",
        schema: "murph.operator-config.v1",
        updatedAt: "2026-03-28T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const saved = await saveAssistantSelfDeliveryTarget(
      {
        channel: "email",
        deliveryTarget: "user@example.com",
        identityId: null,
        participantId: "user@example.com",
        sourceThreadId: null,
      },
      homeRoot,
    );

    const config = await readOperatorConfig(homeRoot);
    assert.ok(config);
    assert.equal(config.defaultVault, null);
    assert.equal(config.assistant?.backend ?? null, null);
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.email, saved);
    assert.deepEqual(
      await resolveAssistantSelfDeliveryTarget("email", homeRoot),
      saved,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assistant-core automation state round-trips through canonical local storage", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "assistant-core-boundary-vault-"));
  const rewrittenVaultRoot = await mkdtemp(
    path.join(tmpdir(), "assistant-core-boundary-vault-rewritten-"),
  );

  try {
    const automationPath = resolveAssistantStatePaths(vaultRoot).automationPath;
    const initial = await readAssistantAutomationState(vaultRoot);
    assert.equal(initial.autoReplyPrimed, true);
    assert.deepEqual(initial.autoReplyChannels, []);

    const coreSaved = await saveAssistantAutomationState(
      vaultRoot,
      assistantAutomationStateSchema.parse({
        ...initial,
        autoReplyChannels: ["email"],
        autoReplyBacklogChannels: ["email"],
        autoReplyPrimed: false,
        updatedAt: "2026-03-28T11:00:00.000Z",
      }),
    );

    assert.deepEqual(
      JSON.parse(await readFile(automationPath, "utf8")) as unknown,
      coreSaved,
    );

    const rewritten = assistantAutomationStateSchema.parse({
      ...coreSaved,
      preferredChannels: ["telegram"],
      updatedAt: "2026-03-28T12:00:00.000Z",
    });
    const rewrittenAutomationPath = resolveAssistantStatePaths(rewrittenVaultRoot).automationPath;
    await mkdir(path.dirname(rewrittenAutomationPath), { recursive: true });
    await writeFile(
      rewrittenAutomationPath,
      `${JSON.stringify(rewritten, null, 2)}\n`,
      "utf8",
    );

    assert.deepEqual(await readAssistantAutomationState(rewrittenVaultRoot), rewritten);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
    await rm(rewrittenVaultRoot, { force: true, recursive: true });
  }
});

async function listFilesRecursive(directoryUrl: URL): Promise<URL[]> {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files: URL[] = [];

  for (const entry of entries) {
    const nextUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(new URL(`${entry.name}/`, directoryUrl))));
      continue;
    }
    if (entry.isFile()) {
      files.push(nextUrl);
    }
  }

  return files;
}
