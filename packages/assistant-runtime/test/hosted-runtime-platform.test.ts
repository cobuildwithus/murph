import assert from "node:assert/strict";

import { test } from "vitest";

import {
  resolveAssistantUsageCredentialSource,
} from "@murphai/hosted-execution/assistant-usage";

import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import type { HostedRuntimePlatform } from "../src/hosted-runtime/platform.ts";

test("hosted runtime config fails closed when the platform is not injected", () => {
  assert.throws(
    () => normalizeHostedAssistantRuntimeConfig(undefined, null),
    /platform must be injected/u,
  );
});

test("hosted runtime treats blank configured user API key overrides as platform-funded execution", () => {
  const platform = {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
  } satisfies HostedRuntimePlatform;
  const normalized = normalizeHostedAssistantRuntimeConfig(
    {
      forwardedEnv: {
        HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      },
      userEnv: {
        OPENAI_API_KEY: "   ",
      },
    },
    platform,
  );

  assert.deepEqual(normalized.userEnv, {});
  assert.equal(
    resolveAssistantUsageCredentialSource({
      apiKeyEnv: "OPENAI_API_KEY",
      provider: "codex-cli",
      userEnvKeys: Object.keys(normalized.userEnv),
    }),
    "platform",
  );
});
