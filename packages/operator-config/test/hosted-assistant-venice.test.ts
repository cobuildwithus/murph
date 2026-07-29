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

test("hosted assistant configuration accepts the registered Venice Codex provider", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "murph-venice-provider-"));
  try {
    const result = await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "venice",
      },
      homeDirectory,
    });
    assert.deepEqual(result, {
      configured: true,
      provider: "codex-cli",
      seeded: true,
      source: "hosted-env",
    });

    const operatorConfig = await readOperatorConfig(homeDirectory);
    const providerConfig = resolveHostedAssistantProviderConfig(
      operatorConfig?.hostedAssistant,
    );
    assert.equal(providerConfig?.model, "gpt-5.6-terra");
    assert.equal(providerConfig?.modelProvider, "venice");
  } finally {
    await rm(homeDirectory, { force: true, recursive: true });
  }
});
