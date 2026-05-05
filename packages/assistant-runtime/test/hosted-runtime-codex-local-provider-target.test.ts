import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  ensureHostedAssistantOperatorDefaults,
} from "@murphai/operator-config/hosted-assistant-config";

import {
  readHostedAssistantExecutionDefaultTarget,
} from "../src/hosted-runtime/context.ts";
import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "../src/hosted-runtime/launch-spec.ts";

const HOSTED_ASSISTANT_ENV = {
  HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
  HOSTED_ASSISTANT_MODEL: "gpt-5.5",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
  HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
} as const;

test("hosted assistant default target uses the local Codex recorder provider only for test overrides", async () => {
  await withTemporaryHostedAssistantEnv(async () => {
    const productionTarget = await readHostedAssistantExecutionDefaultTarget({
      ...HOSTED_ASSISTANT_ENV,
    });
    assert.equal(productionTarget?.modelProvider, "openai");

    const localTarget = await readHostedAssistantExecutionDefaultTarget({
      ...HOSTED_ASSISTANT_ENV,
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        "http://127.0.0.1:4567/v1",
      NODE_ENV: "test",
    });
    assert.equal(localTarget?.modelProvider, "openai-local-test");
  });
});

async function withTemporaryHostedAssistantEnv(
  run: () => Promise<void>,
): Promise<void> {
  const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-target-"));
  const previousEnv = captureEnv([
    "HOME",
    ...Object.keys(HOSTED_ASSISTANT_ENV),
  ]);

  try {
    process.env.HOME = operatorHomeRoot;
    for (const [key, value] of Object.entries(HOSTED_ASSISTANT_ENV)) {
      process.env[key] = value;
    }
    await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: HOSTED_ASSISTANT_ENV,
      homeDirectory: operatorHomeRoot,
    });

    await run();
  } finally {
    restoreEnv(previousEnv);
    await rm(operatorHomeRoot, {
      force: true,
      recursive: true,
    });
  }
}

function captureEnv(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
