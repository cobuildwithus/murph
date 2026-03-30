import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  assistantAutomationStateSchema,
  createIntegratedInboxServices,
  createIntegratedVaultServices,
  readAssistantAutomationState,
  resolveAssistantSelfDeliveryTarget,
  saveAssistantAutomationState,
  saveAssistantSelfDeliveryTarget,
} from "murph/assistant-core";
import {
  readOperatorConfig,
  resolveAssistantSelfDeliveryTarget as resolveCliAssistantSelfDeliveryTarget,
  saveAssistantOperatorDefaultsPatch,
  saveAssistantSelfDeliveryTarget as saveCliAssistantSelfDeliveryTarget,
  saveDefaultVaultConfig,
} from "murph/operator-config";
import {
  readAssistantAutomationState as readCliAssistantAutomationState,
  saveAssistantAutomationState as saveCliAssistantAutomationState,
} from "murph/assistant/store";

test("assistant-runtime uses murph/assistant-core as its only assistant boundary", async () => {
  const runtimeManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    dependencies?: Record<string, string | undefined>;
  };
  const cliManifest = JSON.parse(
    await readFile(new URL("../../cli/package.json", import.meta.url), "utf8"),
  ) as {
    exports: Record<string, { default?: string; types?: string }>;
  };
  const sourceFiles = await listFilesRecursive(new URL("../src/", import.meta.url));
  const cloudflareNodeRunnerSource = await readFile(
    new URL("../../../apps/cloudflare/test/node-runner.test.ts", import.meta.url),
    "utf8",
  );
  const assistantCoreModule = await import("murph/assistant-core");
  const inboxServicesModule = await import("murph/inbox-services");
  const vaultServicesModule = await import("murph/vault-services");
  const vaultCliServicesModule = await import("murph/vault-cli-services");
  let sawAssistantCoreImport = false;

  assert.equal(runtimeManifest.dependencies?.murph, "workspace:*");
  assert.equal(existsSync(new URL("../../assistant-services/package.json", import.meta.url)), false);
  assert.equal(runtimeManifest.dependencies?.["@murph/assistant-services"], undefined);
  assert.deepEqual(cliManifest.exports["./assistant-core"], {
    default: "./dist/assistant-core.js",
    types: "./dist/assistant-core.d.ts",
  });
  assert.deepEqual(cliManifest.exports["./vault-services"], {
    default: "./dist/vault-services.js",
    types: "./dist/vault-services.d.ts",
  });
  assert.deepEqual(cliManifest.exports["./vault-cli-services"], {
    default: "./dist/vault-cli-services.js",
    types: "./dist/vault-cli-services.d.ts",
  });
  assert.match(cloudflareNodeRunnerSource, /from ["']murph\/assistant-core["']/u);
  assert.doesNotMatch(cloudflareNodeRunnerSource, /from ["']murph["']/u);

  for (const fileUrl of sourceFiles) {
    const source = await readFile(fileUrl, "utf8");
    assert.doesNotMatch(source, /@murph\/assistant-services/u);
    if (/from ["']murph\/assistant-core["']/u.test(source)) {
      sawAssistantCoreImport = true;
    }
  }

  assert.equal(sawAssistantCoreImport, true);
  assert.equal(assistantCoreModule.createIntegratedInboxServices, createIntegratedInboxServices);
  assert.equal(assistantCoreModule.createIntegratedVaultServices, createIntegratedVaultServices);
  assert.equal(
    Object.hasOwn(assistantCoreModule, "createIntegratedInboxCliServices"),
    false,
  );
  assert.equal(
    Object.hasOwn(assistantCoreModule, "createIntegratedVaultCliServices"),
    false,
  );
  assert.equal(
    inboxServicesModule.createIntegratedInboxCliServices,
    inboxServicesModule.createIntegratedInboxServices,
  );
  assert.equal(
    Object.hasOwn(vaultServicesModule, "createIntegratedVaultCliServices"),
    false,
  );
  assert.equal(
    Object.hasOwn(vaultServicesModule, "createUnwiredVaultCliServices"),
    false,
  );
  assert.equal(
    vaultCliServicesModule.createIntegratedVaultCliServices,
    vaultServicesModule.createIntegratedVaultServices,
  );
  assert.equal(
    vaultCliServicesModule.createUnwiredVaultCliServices,
    vaultServicesModule.createUnwiredVaultServices,
  );
  assert.equal(resolveAssistantSelfDeliveryTarget, resolveCliAssistantSelfDeliveryTarget);
  assert.equal(saveAssistantSelfDeliveryTarget, saveCliAssistantSelfDeliveryTarget);
  assert.equal(readAssistantAutomationState, readCliAssistantAutomationState);
  assert.equal(saveAssistantAutomationState, saveCliAssistantAutomationState);
});

test("assistant-core operator-config writes targets back in a CLI-readable shape", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-core-boundary-"));

  try {
    const homeRoot = path.join(workspaceRoot, "home");
    await saveDefaultVaultConfig("/tmp/existing-vault", homeRoot);
    await saveAssistantOperatorDefaultsPatch(
      {
        defaultsByProvider: {
          "openai-compatible": {
            approvalPolicy: null,
            codexCommand: null,
            model: "gpt-5.4",
            oss: null,
            profile: null,
            reasoningEffort: null,
            sandbox: null,
          },
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
    assert.equal(
      config.assistant?.defaultsByProvider?.["openai-compatible"]?.model,
      "gpt-5.4",
    );
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.telegram, {
      channel: "telegram",
      deliveryTarget: null,
      identityId: null,
      participantId: "chat-123",
      sourceThreadId: "chat-123",
    });
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.email, saved);
    assert.match(config.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);

    assert.deepEqual(
      await resolveAssistantSelfDeliveryTarget(" EMAIL ", homeRoot),
      saved,
    );
    assert.deepEqual(
      await resolveCliAssistantSelfDeliveryTarget("email", homeRoot),
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
    assert.equal(config.assistant?.defaultsByProvider ?? null, null);
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.email, saved);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assistant-core operator-config rewrites schema-invalid assistant defaults into a CLI-readable config", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-core-boundary-"));

  try {
    const homeRoot = path.join(workspaceRoot, "home");
    const configPath = path.join(homeRoot, ".murph", "config.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({
        assistant: {
          defaultsByProvider: {
            openai: {
              model: "gpt-5.4",
            },
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
    assert.equal(config.assistant?.defaultsByProvider ?? null, null);
    assert.deepEqual(config.assistant?.selfDeliveryTargets?.email, saved);
    assert.deepEqual(
      await resolveCliAssistantSelfDeliveryTarget("email", homeRoot),
      saved,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assistant-core automation state stays CLI-readable in both directions", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "assistant-core-boundary-vault-"));

  try {
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

    assert.deepEqual(await readCliAssistantAutomationState(vaultRoot), coreSaved);

    const cliSaved = await saveCliAssistantAutomationState(
      vaultRoot,
      assistantAutomationStateSchema.parse({
        ...coreSaved,
        preferredChannels: ["telegram"],
        updatedAt: "2026-03-28T12:00:00.000Z",
      }),
    );

    assert.deepEqual(await readAssistantAutomationState(vaultRoot), cliSaved);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
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
