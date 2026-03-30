import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  resolveAssistantSelfDeliveryTarget,
  saveAssistantSelfDeliveryTarget,
} from "@murph/assistant-services/operator-config";
import {
  readAssistantAutomationState as readHostedAssistantAutomationState,
  saveAssistantAutomationState as saveHostedAssistantAutomationState,
} from "@murph/assistant-services/store";
import {
  readOperatorConfig,
  resolveAssistantSelfDeliveryTarget as resolveCliAssistantSelfDeliveryTarget,
  saveAssistantOperatorDefaultsPatch,
  saveDefaultVaultConfig,
} from "murph/operator-config";
import { assistantAutomationStateSchema } from "murph/assistant-core";
import {
  readAssistantAutomationState as readCliAssistantAutomationState,
  saveAssistantAutomationState as saveCliAssistantAutomationState,
} from "murph/assistant/store";

test("assistant-services publishes the hosted boundary entrypoints needed by assistant-runtime", async () => {
  const assistantServicesManifest = JSON.parse(
    await readFile(
      new URL("../../assistant-services/package.json", import.meta.url),
      "utf8",
    ),
  ) as {
    dependencies?: Record<string, string>;
    exports: Record<string, { default?: string; import?: string; types?: string }>;
  };
  const cliManifest = JSON.parse(
    await readFile(
      new URL("../../cli/package.json", import.meta.url),
      "utf8",
    ),
  ) as {
    exports: Record<string, { default?: string; import?: string; types?: string }>;
  };

  assert.deepEqual(assistantServicesManifest.exports["."], {
    default: "./dist/index.js",
    import: "./dist/index.js",
    types: "./dist/index.d.ts",
  });
  assert.deepEqual(assistantServicesManifest.exports["./operator-config"], {
    default: "./dist/operator-config.js",
    import: "./dist/operator-config.js",
    types: "./dist/operator-config.d.ts",
  });
  assert.deepEqual(assistantServicesManifest.exports["./runtime"], {
    default: "./dist/runtime.js",
    import: "./dist/runtime.js",
    types: "./dist/runtime.d.ts",
  });
  assert.deepEqual(cliManifest.exports["./assistant-core"], {
    default: "./dist/assistant-core.js",
    types: "./dist/assistant-core.d.ts",
  });
  assert.equal(
    "@murph/runtime-state" in (assistantServicesManifest.dependencies ?? {}),
    false,
    "assistant-services should stay a compatibility boundary over murph/assistant-core instead of owning runtime-state writes.",
  );
});

test("assistant-services operator-config writes targets back in a CLI-readable shape", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-services-boundary-"));

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

test("assistant-services operator-config tolerates malformed existing config", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-services-boundary-"));

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

test("assistant-services operator-config rewrites schema-invalid assistant defaults into a CLI-readable config", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "assistant-services-boundary-"));

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

test("assistant-services automation state stays CLI-readable in both directions", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "assistant-services-boundary-vault-"));

  try {
    const initial = await readHostedAssistantAutomationState(vaultRoot);
    assert.equal(initial.autoReplyPrimed, true);
    assert.deepEqual(initial.autoReplyChannels, []);

    const hostedSaved = await saveHostedAssistantAutomationState(
      vaultRoot,
      assistantAutomationStateSchema.parse({
        ...initial,
        autoReplyChannels: ["email"],
        autoReplyBacklogChannels: ["email"],
        autoReplyPrimed: false,
        updatedAt: "2026-03-28T11:00:00.000Z",
      }),
    );

    assert.deepEqual(await readCliAssistantAutomationState(vaultRoot), hostedSaved);

    const cliSaved = await saveCliAssistantAutomationState(
      vaultRoot,
      assistantAutomationStateSchema.parse({
        ...hostedSaved,
        preferredChannels: ["telegram"],
        updatedAt: "2026-03-28T12:00:00.000Z",
      }),
    );

    assert.deepEqual(await readHostedAssistantAutomationState(vaultRoot), cliSaved);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});
