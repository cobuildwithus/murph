import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  ensureHostedAssistantOperatorDefaults,
  resolveHostedAssistantProviderConfig,
} from "../src/hosted-assistant-config.ts";
import { readOperatorConfig } from "../src/operator-config.ts";

test.each([
  { model: "gpt-5.6-terra", provider: "venice" },
  { model: "murph-custom-r3", provider: "hosted-custom-inference" },
])("hosted assistant configuration accepts registered provider $provider", async ({ model, provider }) => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "murph-venice-provider-"));
  try {
    const result = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: model,
        HOSTED_ASSISTANT_PROVIDER: provider,
      },
      homeDirectory,
    });
    const operatorConfig = await readOperatorConfig(homeDirectory);
    assert.deepEqual(result, {
      config: operatorConfig?.hostedAssistant,
      configured: true,
      provider: "codex-cli",
      seeded: true,
      source: "hosted-env",
    });

    const providerConfig = resolveHostedAssistantProviderConfig(
      operatorConfig?.hostedAssistant,
    );
    assert.equal(providerConfig?.model, model);
    assert.equal(providerConfig?.modelProvider, provider);
  } finally {
    await rm(homeDirectory, { force: true, recursive: true });
  }
});
