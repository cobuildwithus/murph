import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from "@murphai/hosted-execution/env";
import {
  normalizeAssistantBackendTarget,
} from "@murphai/operator-config/assistant-backend";
import {
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
} from "@murphai/operator-config/assistant/target-runtime";
import {
  ensureHostedAssistantOperatorDefaults,
} from "@murphai/operator-config/hosted-assistant-config";

import {
  hydrateHostedExecutionDefaultTarget,
  readHostedAssistantExecutionDefaultTarget,
} from "../src/hosted-runtime/context.ts";
import {
  HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
} from "../src/hosted-runtime/codex-runtime-env.ts";

const HOSTED_ASSISTANT_ENV = {
  HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
  HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
  HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
} as const;
const HOSTED_ASSISTANT_RUNTIME_ENV = {
  ...HOSTED_ASSISTANT_ENV,
  [HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV]: "hosted-openai",
} as const;

test("hosted assistant default target follows the effective Codex provider id", async () => {
  await withTemporaryHostedAssistantEnv(async () => {
    const productionTarget = await readHostedAssistantExecutionDefaultTarget();
    assert.equal(productionTarget?.modelProvider, "openai");

    process.env[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV] =
      "hosted-openai";
    const hostedOpenAiTarget = await readHostedAssistantExecutionDefaultTarget();
    assert.equal(hostedOpenAiTarget?.modelProvider, "hosted-openai");

    process.env[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV] =
      "openai-local-test";
    const localTarget = await readHostedAssistantExecutionDefaultTarget();
    assert.equal(localTarget?.modelProvider, "openai-local-test");

    process.env[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV] =
      HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID;
    const chatGptTarget = await readHostedAssistantExecutionDefaultTarget();
    assert.equal(
      normalizeAssistantBackendTarget(chatGptTarget)?.modelProvider,
      HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
    );
  });
});

test("hosted assistant injected env overrides a stale saved platform profile", async () => {
  await withTemporaryHostedAssistantEnv(async () => {
    await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        ...HOSTED_ASSISTANT_ENV,
        HOSTED_ASSISTANT_MODEL: "openai/gpt-5.6-terra",
      },
    });

    const staleSavedTarget = await readHostedAssistantExecutionDefaultTarget();
    assert.equal(staleSavedTarget?.model, "openai/gpt-5.6-terra");

    const envTarget = await readHostedAssistantExecutionDefaultTarget({
      runtimeEnv: HOSTED_ASSISTANT_RUNTIME_ENV,
    });

    assert.equal(envTarget?.model, "gpt-5.6-terra");
    assert.equal(envTarget?.modelProvider, "hosted-openai");

    const restoredTarget = await readHostedAssistantExecutionDefaultTarget();
    assert.equal(restoredTarget?.model, "gpt-5.6-terra");
    assert.equal(restoredTarget?.modelProvider, "openai");
  });
});

test("hosted assistant target follows a provider switch in the same operator home", async () => {
  await withTemporaryHostedAssistantEnv(async () => {
    const openAiTarget = await readHostedAssistantExecutionDefaultTarget({
      runtimeEnv: {
        ...HOSTED_ASSISTANT_RUNTIME_ENV,
        [HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV]: "hosted-openai",
      },
    });
    assert.equal(openAiTarget?.modelProvider, "hosted-openai");

    const veniceTarget = await readHostedAssistantExecutionDefaultTarget({
      runtimeEnv: {
        ...HOSTED_ASSISTANT_RUNTIME_ENV,
        HOSTED_ASSISTANT_PROVIDER: "venice",
        [HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV]: "venice-local-test",
      },
    });
    assert.equal(veniceTarget?.modelProvider, "venice-local-test");
  });
});

test("hosted assistant target uses the prepared test Codex command override", async () => {
  await withTemporaryHostedAssistantEnv(async () => {
    const defaultTarget = await readHostedAssistantExecutionDefaultTarget({
      runtimeEnv: {
        ...HOSTED_ASSISTANT_RUNTIME_ENV,
        [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: "/tmp/hosted-local-codex",
        NODE_ENV: "test",
      },
    });

    assert.equal(defaultTarget?.codexCommand, "/tmp/hosted-local-codex");
    assert.equal(defaultTarget?.modelProvider, "hosted-openai");
  });
});

test("hosted assistant hydration applies runtime env over stale saved platform profile", async () => {
  await withTemporaryHostedAssistantEnv(async () => {
    await ensureHostedAssistantOperatorDefaults({
      allowMissing: false,
      env: {
        ...HOSTED_ASSISTANT_ENV,
        HOSTED_ASSISTANT_MODEL: "openai/gpt-5.6-terra",
      },
    });

    const hydrated = await hydrateHostedExecutionDefaultTarget(
      {
        hosted: {
          memberId: "member-hosted-target-regression",
          userEnvKeys: [],
        },
      },
      {
        runtimeEnv: HOSTED_ASSISTANT_RUNTIME_ENV,
      },
    );

    assert.equal(hydrated.hosted?.defaultTarget?.model, "gpt-5.6-terra");
    assert.equal(hydrated.hosted?.defaultTarget?.modelProvider, "hosted-openai");
  });
});

async function withTemporaryHostedAssistantEnv(
  run: () => Promise<void>,
): Promise<void> {
  const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "hosted-codex-target-"));
  const previousEnv = captureEnv([
    "HOME",
    HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
    HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
    ...Object.keys(HOSTED_ASSISTANT_ENV),
  ]);

  try {
    process.env.HOME = operatorHomeRoot;
    delete process.env[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV];
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
