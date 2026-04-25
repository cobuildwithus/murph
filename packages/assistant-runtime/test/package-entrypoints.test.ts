import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

import {
  runHostedAssistantRuntimeJobInProcess,
} from "@murphai/assistant-runtime";
import {
  parseHostedAssistantRuntimeJobInput,
  readHostedRunnerCommitTimeoutMs,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedEmailSendRequest as parseHostedEmailSendRequestDirect,
} from "../src/hosted-email.ts";
import {
  parseHostedEmailSendRequest,
} from "@murphai/assistant-runtime/hosted-email";
import {
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
  HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
} from "@murphai/assistant-runtime/hosted-assistant-env-constants";
import {
  parseHostedAssistantRuntimeJobInput as parseHostedAssistantRuntimeJobInputDirect,
} from "../src/hosted-runtime/parsers.ts";
import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
  HostedAssistantConfigurationError,
  readHostedAssistantApiKeyEnvName,
} from "../src/hosted-assistant-env.ts";
import {
  runHostedAssistantRuntimeJobInProcess as runHostedAssistantRuntimeJobInProcessDirect,
} from "../src/hosted-runtime.ts";
import {
  readHostedRunnerCommitTimeoutMs as readHostedRunnerCommitTimeoutMsDirect,
} from "../src/hosted-runtime/timeouts.ts";

test("package root export re-exports the hosted runtime surface only", () => {
  assert.equal(
    runHostedAssistantRuntimeJobInProcess,
    runHostedAssistantRuntimeJobInProcessDirect,
  );
});

test("hosted-email subpath export stays wired to the hosted email source surface", () => {
  assert.equal(parseHostedEmailSendRequest, parseHostedEmailSendRequestDirect);
});

test("hosted-runtime-contracts subpath stays wired to the worker-safe hosted runtime surface", () => {
  assert.equal(parseHostedAssistantRuntimeJobInput, parseHostedAssistantRuntimeJobInputDirect);
  assert.equal(readHostedRunnerCommitTimeoutMs, readHostedRunnerCommitTimeoutMsDirect);
});

test("package manifest declares the hosted assistant env, hosted runtime contracts, and hosted email subpaths", async () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
  };

  assert.ok(manifest.exports);
  assert.ok("./hosted-assistant-env" in manifest.exports);
  assert.ok("./hosted-assistant-env-constants" in manifest.exports);
  assert.ok("./hosted-runtime-contracts" in manifest.exports);
  assert.ok("./hosted-email" in manifest.exports);
  assert.ok(Array.isArray(HOSTED_ASSISTANT_CONFIG_ENV_NAMES));
  assert.ok(HOSTED_ASSISTANT_CONFIG_ENV_NAMES.length > 0);
  assert.ok(Array.isArray(HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.telegramConfigured));
  assert.ok(HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES.includes("LINQ_WEBHOOK_SECRET"));
  assert.ok(HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES.includes("OPENAI_API_KEY"));
  assert.ok(HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES.includes("TELEGRAM_BOT_TOKEN"));
  assert.equal(typeof readHostedAssistantApiKeyEnvName, "function");
  assert.equal(typeof HostedAssistantConfigurationError, "function");
});
