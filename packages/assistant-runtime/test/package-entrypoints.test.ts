import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

import {
  parseHostedRuntimeLatencyTraceResponse as parseHostedRuntimeLatencyTraceResponseRootPublic,
  runHostedWorkspaceRuntimeJobInProcess as runHostedWorkspaceRuntimeJobInProcessPublic,
} from "@murphai/assistant-runtime";
import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES as HOSTED_ASSISTANT_CONFIG_ENV_NAMES_PUBLIC,
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS as HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_PUBLIC,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES as HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_PUBLIC,
  HostedAssistantConfigurationError as HostedAssistantConfigurationErrorPublic,
  readHostedAssistantApiKeyEnvName as readHostedAssistantApiKeyEnvNamePublic,
} from "@murphai/assistant-runtime/hosted-assistant-env";
import {
  HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES as HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES_PUBLIC,
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES as HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES_PUBLIC,
  HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES as HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_PUBLIC,
} from "@murphai/assistant-runtime/hosted-assistant-env-constants";
import {
  parseHostedEmailSendRequest as parseHostedEmailSendRequestPublic,
} from "@murphai/assistant-runtime/hosted-email";
import {
  sendHostedProviderTelegramMessage as sendHostedProviderTelegramMessagePublic,
} from "@murphai/assistant-runtime/hosted-provider-effects";
import {
  buildHostedRuntimeForwardedEnv as buildHostedRuntimeForwardedEnvPublic,
  buildHostedRuntimeLaunchSpec as buildHostedRuntimeLaunchSpecPublic,
  parseHostedAssistantWorkspaceRuntimeJobInput as parseHostedAssistantWorkspaceRuntimeJobInputPublic,
  parseHostedRuntimeLatencyTraceResponse as parseHostedRuntimeLatencyTraceResponsePublic,
  projectHostedRuntimeProcessEnv as projectHostedRuntimeProcessEnvPublic,
  readHostedRunnerCommitTimeoutMs as readHostedRunnerCommitTimeoutMsPublic,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedAssistantRuntimeConfig as parseHostedAssistantRuntimeConfigWorkerPublic,
  parseHostedRuntimeLatencyTraceResponse as parseHostedRuntimeLatencyTraceResponseWorkerPublic,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES as HOSTED_ASSISTANT_CONFIG_ENV_NAMES_DIRECT,
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS as HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_DIRECT,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES as HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_DIRECT,
  HostedAssistantConfigurationError as HostedAssistantConfigurationErrorDirect,
  readHostedAssistantApiKeyEnvName as readHostedAssistantApiKeyEnvNameDirect,
} from "../src/hosted-assistant-env.ts";
import {
  HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES as HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES_DIRECT,
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES as HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES_DIRECT,
  HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES as HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_DIRECT,
} from "../src/hosted-assistant-env-constants.ts";
import {
  parseHostedEmailSendRequest as parseHostedEmailSendRequestDirect,
} from "../src/hosted-email.ts";
import {
  sendHostedProviderTelegramMessage as sendHostedProviderTelegramMessageDirect,
} from "../src/hosted-provider-effects.ts";
import {
  parseHostedRuntimeLatencyTraceResponse as parseHostedRuntimeLatencyTraceResponseRootDirect,
  runHostedWorkspaceRuntimeJobInProcess as runHostedWorkspaceRuntimeJobInProcessDirect,
} from "../src/hosted-runtime.ts";
import {
  buildHostedRuntimeForwardedEnv as buildHostedRuntimeForwardedEnvDirect,
  buildHostedRuntimeLaunchSpec as buildHostedRuntimeLaunchSpecDirect,
  parseHostedAssistantWorkspaceRuntimeJobInput as parseHostedAssistantWorkspaceRuntimeJobInputDirect,
  parseHostedRuntimeLatencyTraceResponse as parseHostedRuntimeLatencyTraceResponseDirect,
  projectHostedRuntimeProcessEnv as projectHostedRuntimeProcessEnvDirect,
  readHostedRunnerCommitTimeoutMs as readHostedRunnerCommitTimeoutMsDirect,
} from "../src/hosted-runtime-contracts.ts";
import {
  parseHostedAssistantRuntimeConfig as parseHostedAssistantRuntimeConfigWorkerDirect,
  parseHostedRuntimeLatencyTraceResponse as parseHostedRuntimeLatencyTraceResponseWorkerDirect,
} from "../src/hosted-runtime-worker-contracts.ts";

const expectedAssistantRuntimePublicExportKeys = [
  ".",
  "./hosted-assistant-env",
  "./hosted-assistant-env-constants",
  "./hosted-email",
  "./hosted-provider-effects",
  "./hosted-runtime-contracts",
  "./hosted-runtime-worker-contracts",
] as const;

type AssistantRuntimePackageManifest = {
  exports?: Record<string, unknown>;
};

function readPackageManifest(): AssistantRuntimePackageManifest {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  if (!isObjectRecord(manifest)) {
    return {};
  }

  return {
    exports: isObjectRecord(manifest.exports) ? manifest.exports : undefined,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

test("package root export re-exports the hosted runtime surface only", () => {
  assert.equal(
    runHostedWorkspaceRuntimeJobInProcessPublic,
    runHostedWorkspaceRuntimeJobInProcessDirect,
  );
  assert.equal(
    parseHostedRuntimeLatencyTraceResponseRootPublic,
    parseHostedRuntimeLatencyTraceResponseRootDirect,
  );
});

test("package root export omits legacy run-drain job helpers", async () => {
  const root = await import("@murphai/assistant-runtime");

  assert.equal("runHostedAssistantRuntimeJobInProcess" in root, false);
  assert.equal("runHostedAssistantRuntimeJobInProcessDetailed" in root, false);
  assert.equal("parseHostedAssistantRuntimeJobInput" in root, false);
  assert.equal("parseHostedAssistantRuntimeJobRequest" in root, false);
});

test("hosted-runtime-contracts omits assistant-engine Codex lifecycle hooks", async () => {
  const contracts = await import("@murphai/assistant-runtime/hosted-runtime-contracts");

  assert.equal("snapshotExpectedHostedCodexRootProcess" in contracts, false);
  assert.equal("stopHostedWarmCodexAppServer" in contracts, false);
});

test("hosted-assistant-env subpath stays wired to the hosted env source surface", () => {
  assert.equal(HOSTED_ASSISTANT_CONFIG_ENV_NAMES_PUBLIC, HOSTED_ASSISTANT_CONFIG_ENV_NAMES_DIRECT);
  assert.equal(
    HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_PUBLIC,
    HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_DIRECT,
  );
  assert.equal(
    HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_PUBLIC,
    HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_DIRECT,
  );
  assert.equal(
    HostedAssistantConfigurationErrorPublic,
    HostedAssistantConfigurationErrorDirect,
  );
  assert.equal(readHostedAssistantApiKeyEnvNamePublic, readHostedAssistantApiKeyEnvNameDirect);
  assert.ok(Array.isArray(HOSTED_ASSISTANT_CONFIG_ENV_NAMES_PUBLIC));
  assert.ok(HOSTED_ASSISTANT_CONFIG_ENV_NAMES_PUBLIC.length > 0);
  assert.equal(typeof readHostedAssistantApiKeyEnvNamePublic, "function");
  assert.equal(typeof HostedAssistantConfigurationErrorPublic, "function");
});

test("hosted-assistant-env-constants subpath stays wired to the hosted env constants source surface", () => {
  assert.equal(
    HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES_PUBLIC,
    HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES_DIRECT,
  );
  assert.equal(
    HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES_PUBLIC,
    HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES_DIRECT,
  );
  assert.equal(
    HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_PUBLIC,
    HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_DIRECT,
  );
  assert.ok(Array.isArray(HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_PUBLIC.telegramConfigured));
  assert.ok(HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES_PUBLIC.includes("LINQ_WEBHOOK_SECRET"));
  assert.ok(HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_PUBLIC.includes("OPENAI_API_KEY"));
  assert.ok(HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES_PUBLIC.includes("JUNCTION_API_KEY"));
  assert.ok(
    (HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_PUBLIC as readonly string[]).includes(
      "HOSTED_WEB_BASE_URL",
    ),
  );
  assert.ok(
    (HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_PUBLIC as readonly string[]).includes(
      "TELEGRAM_BOT_TOKEN",
    ),
  );
  assert.ok(
    (HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_PUBLIC as readonly string[]).includes(
      "HOSTED_LOG_FINGERPRINT_SECRET",
    ),
  );
});

test("hosted-email subpath export stays wired to the hosted email source surface", () => {
  assert.equal(parseHostedEmailSendRequestPublic, parseHostedEmailSendRequestDirect);
});

test("hosted-provider-effects subpath stays wired to the hosted provider effects source surface", () => {
  assert.equal(sendHostedProviderTelegramMessagePublic, sendHostedProviderTelegramMessageDirect);
});

test("hosted-runtime-contracts subpath stays wired to the worker-safe hosted runtime surface", async () => {
  const contracts = await import("@murphai/assistant-runtime/hosted-runtime-contracts");

  assert.equal(
    contracts.parseHostedAssistantWorkspaceRuntimeJobInput,
    parseHostedAssistantWorkspaceRuntimeJobInputDirect,
  );
  assert.equal(
    parseHostedAssistantWorkspaceRuntimeJobInputPublic,
    parseHostedAssistantWorkspaceRuntimeJobInputDirect,
  );
  assert.equal(readHostedRunnerCommitTimeoutMsPublic, readHostedRunnerCommitTimeoutMsDirect);
  assert.equal(buildHostedRuntimeForwardedEnvPublic, buildHostedRuntimeForwardedEnvDirect);
  assert.equal(buildHostedRuntimeLaunchSpecPublic, buildHostedRuntimeLaunchSpecDirect);
  assert.equal(projectHostedRuntimeProcessEnvPublic, projectHostedRuntimeProcessEnvDirect);
  assert.equal(
    parseHostedRuntimeLatencyTraceResponsePublic,
    parseHostedRuntimeLatencyTraceResponseDirect,
  );
});

test("hosted-runtime-worker-contracts subpath stays wired to the worker contracts source surface", () => {
  assert.equal(
    parseHostedAssistantRuntimeConfigWorkerPublic,
    parseHostedAssistantRuntimeConfigWorkerDirect,
  );
  assert.equal(
    parseHostedRuntimeLatencyTraceResponseWorkerPublic,
    parseHostedRuntimeLatencyTraceResponseWorkerDirect,
  );
});

test("package manifest public exports stay covered by entrypoint wiring tests", () => {
  const manifest = readPackageManifest();

  assert.ok(manifest.exports);
  assert.deepEqual(
    Object.keys(manifest.exports).sort(),
    [...expectedAssistantRuntimePublicExportKeys].sort(),
  );
});
