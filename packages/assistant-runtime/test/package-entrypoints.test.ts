import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "@murphai/assistant-runtime";
import {
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
  parseHostedAssistantWorkspaceRuntimeJobInput as parseHostedAssistantWorkspaceRuntimeJobInputDirect,
} from "../src/hosted-runtime/parsers.ts";
import {
  buildHostedRuntimeForwardedEnv,
  buildHostedRuntimeLaunchSpec,
  projectHostedRuntimeToChildEnv,
} from "../src/hosted-runtime-contracts.ts";
import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
  HostedAssistantConfigurationError,
  readHostedAssistantApiKeyEnvName,
} from "../src/hosted-assistant-env.ts";
import {
  runHostedWorkspaceRuntimeJobInProcess as runHostedWorkspaceRuntimeJobInProcessDirect,
} from "../src/hosted-runtime.ts";
import {
  readHostedRunnerCommitTimeoutMs as readHostedRunnerCommitTimeoutMsDirect,
} from "../src/hosted-runtime/timeouts.ts";
import {
  buildHostedRuntimeForwardedEnv as buildHostedRuntimeForwardedEnvDirect,
  buildHostedRuntimeLaunchSpec as buildHostedRuntimeLaunchSpecDirect,
} from "../src/hosted-runtime/launch-spec.ts";
import {
  projectHostedRuntimeToChildEnv as projectHostedRuntimeToChildEnvDirect,
} from "../src/hosted-runtime/environment.ts";

test("package root export re-exports the hosted runtime surface only", () => {
  assert.equal(
    runHostedWorkspaceRuntimeJobInProcess,
    runHostedWorkspaceRuntimeJobInProcessDirect,
  );
});

test("package root export omits legacy run-drain job helpers", async () => {
  const root = await import("@murphai/assistant-runtime");

  assert.equal("runHostedAssistantRuntimeJobInProcess" in root, false);
  assert.equal("runHostedAssistantRuntimeJobInProcessDetailed" in root, false);
  assert.equal("parseHostedAssistantRuntimeJobInput" in root, false);
  assert.equal("parseHostedAssistantRuntimeJobRequest" in root, false);
});

test("hosted-email subpath export stays wired to the hosted email source surface", () => {
  assert.equal(parseHostedEmailSendRequest, parseHostedEmailSendRequestDirect);
});

test("hosted-runtime-contracts subpath stays wired to the worker-safe hosted runtime surface", async () => {
  const contracts = await import("@murphai/assistant-runtime/hosted-runtime-contracts");

  assert.equal(
    contracts["parseHostedAssistantWorkspaceRuntimeJobInput" as keyof typeof contracts],
    parseHostedAssistantWorkspaceRuntimeJobInputDirect,
  );
  assert.equal(readHostedRunnerCommitTimeoutMs, readHostedRunnerCommitTimeoutMsDirect);
  assert.equal(
    contracts["buildHostedRuntimeForwardedEnv" as keyof typeof contracts],
    buildHostedRuntimeForwardedEnvDirect,
  );
  assert.equal(
    contracts["buildHostedRuntimeLaunchSpec" as keyof typeof contracts],
    buildHostedRuntimeLaunchSpecDirect,
  );
  assert.equal(
    contracts["projectHostedRuntimeToChildEnv" as keyof typeof contracts],
    projectHostedRuntimeToChildEnvDirect,
  );
  assert.equal(buildHostedRuntimeForwardedEnv, buildHostedRuntimeForwardedEnvDirect);
  assert.equal(buildHostedRuntimeLaunchSpec, buildHostedRuntimeLaunchSpecDirect);
  assert.equal(projectHostedRuntimeToChildEnv, projectHostedRuntimeToChildEnvDirect);
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
  assert.ok(HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES.includes("VERCEL_AI_API_KEY"));
  assert.ok(HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES.includes("HOSTED_WAKE_ENCRYPTION_KEY"));
  assert.ok(HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES.includes("TELEGRAM_BOT_TOKEN"));
  assert.equal(typeof readHostedAssistantApiKeyEnvName, "function");
  assert.equal(typeof HostedAssistantConfigurationError, "function");
});
