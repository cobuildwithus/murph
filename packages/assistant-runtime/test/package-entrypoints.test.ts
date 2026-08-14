import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { expectTypeOf, test } from "vitest";

import {
  parseHostedRuntimeLatencyTraceResponse as parseHostedRuntimeLatencyTraceResponseRootPublic,
  runHostedWorkspaceRuntimeJobInProcess as runHostedWorkspaceRuntimeJobInProcessPublic,
} from "@murphai/assistant-runtime";
import type {
  HostedRuntimeDeviceSyncPort as HostedRuntimeDeviceSyncPortPublic,
} from "@murphai/assistant-runtime";
import {
  parseHostedEmailSendRequest as parseHostedEmailSendRequestPublic,
} from "@murphai/assistant-runtime/hosted-email";
import {
  checkpointHostedRuntimeBridgeWebWorkspace as checkpointHostedRuntimeBridgeWebWorkspacePublic,
} from "@murphai/assistant-runtime/hosted-checkpoint-bridge";
import {
  buildHostedDeviceSyncStatusPrompt as buildHostedDeviceSyncStatusPromptPublic,
  fetchCompleteHostedDeviceSyncRuntimeSnapshot as fetchCompleteHostedDeviceSyncRuntimeSnapshotPublic,
} from "@murphai/assistant-runtime/hosted-device-sync-status";
import {
  createHostedRuntimeDeviceSyncService as createHostedRuntimeDeviceSyncServiceTestkitPublic,
  resolveHostedDeviceSyncWakeRecovery as resolveHostedDeviceSyncWakeRecoveryTestkitPublic,
} from "@murphai/assistant-runtime/hosted-device-sync-testkit";
import type {
  HostedRuntimeDeviceSyncPort as HostedRuntimeDeviceSyncPortTestkitPublic,
} from "@murphai/assistant-runtime/hosted-device-sync-testkit";
import {
  createHostedWorkspaceInvocationLease as createHostedWorkspaceInvocationLeasePublic,
  runHostedWorkspaceInvocation as runHostedWorkspaceInvocationPublic,
} from "@murphai/assistant-runtime/hosted-invocation";
import {
  checkpointHostedRuntimeBridgeWorkspace as checkpointHostedRuntimeBridgeWorkspaceTestkitPublic,
  createHostedWorkspaceRuntimeBridgeJobOptions as createHostedWorkspaceRuntimeBridgeJobOptionsPublic,
} from "@murphai/assistant-runtime/hosted-invocation-testkit";
import {
  sendHostedProviderTelegramMessage as sendHostedProviderTelegramMessagePublic,
} from "@murphai/assistant-runtime/hosted-provider-effects";
import {
  buildHostedRuntimeForwardedEnv as buildHostedRuntimeForwardedEnvPublic,
  buildHostedRuntimeLaunchSpec as buildHostedRuntimeLaunchSpecPublic,
  HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES as HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES_PUBLIC,
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS as HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_PUBLIC,
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES as HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES_PUBLIC,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES as HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_PUBLIC,
  HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES as HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_PUBLIC,
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
  parseHostedEmailSendRequest as parseHostedEmailSendRequestDirect,
} from "../src/hosted-email.ts";
import {
  checkpointHostedRuntimeBridgeWebWorkspace as checkpointHostedRuntimeBridgeWebWorkspaceDirect,
} from "../src/hosted-checkpoint-bridge.ts";
import {
  buildHostedDeviceSyncStatusPrompt as buildHostedDeviceSyncStatusPromptDirect,
  fetchCompleteHostedDeviceSyncRuntimeSnapshot as fetchCompleteHostedDeviceSyncRuntimeSnapshotDirect,
} from "../src/hosted-device-sync-status.ts";
import {
  createHostedRuntimeDeviceSyncService as createHostedRuntimeDeviceSyncServiceTestkitDirect,
  resolveHostedDeviceSyncWakeRecovery as resolveHostedDeviceSyncWakeRecoveryTestkitDirect,
} from "../src/hosted-device-sync-testkit.ts";
import type {
  HostedRuntimeDeviceSyncPort as HostedRuntimeDeviceSyncPortLeaf,
} from "../src/hosted-runtime/device-sync-port.ts";
import type {
  HostedRuntimeDeviceSyncPort as HostedRuntimeDeviceSyncPortPlatform,
} from "../src/hosted-runtime/platform.ts";
import {
  checkpointHostedRuntimeBridgeWebWorkspace as checkpointHostedRuntimeBridgeWebWorkspaceSource,
} from "../src/hosted-runtime/checkpoint-bridge.ts";
import {
  createHostedWorkspaceInvocationLease as createHostedWorkspaceInvocationLeaseDirect,
  runHostedWorkspaceInvocation as runHostedWorkspaceInvocationDirect,
} from "../src/hosted-invocation.ts";
import {
  checkpointHostedRuntimeBridgeWorkspace as checkpointHostedRuntimeBridgeWorkspaceTestkitDirect,
  createHostedWorkspaceRuntimeBridgeJobOptions as createHostedWorkspaceRuntimeBridgeJobOptionsDirect,
} from "../src/hosted-invocation-testkit.ts";
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
  HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES as HOSTED_SHARED_DEVICE_SYNC_PLATFORM_ENV_NAMES_DIRECT,
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS as HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_DIRECT,
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES as HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES_DIRECT,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES as HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_DIRECT,
  HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES as HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_DIRECT,
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
  "./hosted-assistant-bootstrap",
  "./hosted-checkpoint-bridge",
  "./hosted-device-sync-status",
  "./hosted-device-sync-testkit",
  "./hosted-email",
  "./hosted-invocation",
  "./hosted-invocation-testkit",
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

test("hosted runtime entrypoints omit legacy child process env alias", async () => {
  const root = await import("@murphai/assistant-runtime");
  const contracts = await import("@murphai/assistant-runtime/hosted-runtime-contracts");
  const workerContracts = await import("@murphai/assistant-runtime/hosted-runtime-worker-contracts");

  assert.equal("projectHostedRuntimeToChildEnv" in root, false);
  assert.equal("projectHostedRuntimeToChildEnv" in contracts, false);
  assert.equal("projectHostedRuntimeToChildEnv" in workerContracts, false);
});

test("hosted-runtime-contracts omits assistant-engine Codex lifecycle hooks", async () => {
  const contracts = await import("@murphai/assistant-runtime/hosted-runtime-contracts");

  assert.equal("stopWarmCodexAppServer" in contracts, false);
});

test("hosted assistant bootstrap exposes the CLI surface reader", async () => {
  const bootstrap = await import("@murphai/assistant-runtime/hosted-assistant-bootstrap");

  assert.equal(typeof bootstrap.readHostedAssistantCliSurfaceBootstrapContext, "function");
});

test("hosted runtime contracts expose hosted env categories from the runtime owner", () => {
  assert.equal(
    HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_PUBLIC,
    HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS_DIRECT,
  );
  assert.equal(
    HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_PUBLIC,
    HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES_DIRECT,
  );
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
      "TELEGRAM_BOT_TOKEN",
    ),
  );
  assert.ok(
    (HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES_PUBLIC as readonly string[]).includes(
      "HOSTED_LOG_FINGERPRINT_SECRET",
    ),
  );
});

test("assistant-runtime omits hosted assistant env shim subpaths", async () => {
  const manifest = readPackageManifest();

  assert.equal(manifest.exports?.["./hosted-assistant-env"], undefined);
  assert.equal(manifest.exports?.["./hosted-assistant-env-constants"], undefined);
});

test("hosted-email subpath export stays wired to the hosted email source surface", () => {
  assert.equal(parseHostedEmailSendRequestPublic, parseHostedEmailSendRequestDirect);
});

test("hosted-checkpoint-bridge subpath export stays wired to the checkpoint source surface", () => {
  assert.equal(
    checkpointHostedRuntimeBridgeWebWorkspacePublic,
    checkpointHostedRuntimeBridgeWebWorkspaceDirect,
  );
  assert.equal(
    checkpointHostedRuntimeBridgeWebWorkspaceDirect,
    checkpointHostedRuntimeBridgeWebWorkspaceSource,
  );
});

test("hosted-checkpoint-bridge subpath omits bundle bridge helpers", async () => {
  const checkpointBridge = await import("@murphai/assistant-runtime/hosted-checkpoint-bridge");

  assert.equal("checkpointHostedRuntimeBridgeWorkspace" in checkpointBridge, false);
  assert.equal("snapshotHostedRuntimeBridgeWorkspaceBundle" in checkpointBridge, false);
});

test("hosted-invocation subpath export stays wired to the package invocation source surface", () => {
  assert.equal(createHostedWorkspaceInvocationLeasePublic, createHostedWorkspaceInvocationLeaseDirect);
  assert.equal(runHostedWorkspaceInvocationPublic, runHostedWorkspaceInvocationDirect);
});

test("hosted-invocation subpath omits checkpoint bridge helpers", async () => {
  const hostedInvocation = await import("@murphai/assistant-runtime/hosted-invocation");

  assert.equal("checkpointHostedRuntimeBridgeWebWorkspace" in hostedInvocation, false);
  assert.equal("checkpointHostedRuntimeBridgeWorkspace" in hostedInvocation, false);
  assert.equal("createHostedWorkspaceRuntimeBridgeJobOptions" in hostedInvocation, false);
});

test("hosted-device-sync-status subpath stays wired to the existing status owners", () => {
  assert.equal(
    buildHostedDeviceSyncStatusPromptPublic,
    buildHostedDeviceSyncStatusPromptDirect,
  );
  assert.equal(
    fetchCompleteHostedDeviceSyncRuntimeSnapshotPublic,
    fetchCompleteHostedDeviceSyncRuntimeSnapshotDirect,
  );
});

test("hosted-device-sync-testkit subpath stays wired to the existing device-sync owners", () => {
  assert.equal(
    createHostedRuntimeDeviceSyncServiceTestkitPublic,
    createHostedRuntimeDeviceSyncServiceTestkitDirect,
  );
  assert.equal(
    resolveHostedDeviceSyncWakeRecoveryTestkitPublic,
    resolveHostedDeviceSyncWakeRecoveryTestkitDirect,
  );
});

test("hosted device-sync port type stays identical across production and testkit entrypoints", () => {
  expectTypeOf<HostedRuntimeDeviceSyncPortTestkitPublic>()
    .toEqualTypeOf<HostedRuntimeDeviceSyncPortPublic>();
  expectTypeOf<HostedRuntimeDeviceSyncPortPublic>()
    .toEqualTypeOf<HostedRuntimeDeviceSyncPortPlatform>();
  expectTypeOf<HostedRuntimeDeviceSyncPortPlatform>()
    .toEqualTypeOf<HostedRuntimeDeviceSyncPortLeaf>();
});

test("assistant-runtime testkits stay partitioned by owner", async () => {
  const deviceSyncTestkit = await import(
    "@murphai/assistant-runtime/hosted-device-sync-testkit"
  );
  const invocationTestkit = await import(
    "@murphai/assistant-runtime/hosted-invocation-testkit"
  );

  assert.equal("createHostedWorkspaceRuntimeBridgeJobOptions" in deviceSyncTestkit, false);
  assert.equal("createHostedRuntimeDeviceSyncService" in invocationTestkit, false);
});

test("hosted-invocation-testkit subpath export stays wired to bridge option construction", () => {
  assert.equal(
    createHostedWorkspaceRuntimeBridgeJobOptionsPublic,
    createHostedWorkspaceRuntimeBridgeJobOptionsDirect,
  );
  assert.equal(
    checkpointHostedRuntimeBridgeWorkspaceTestkitPublic,
    checkpointHostedRuntimeBridgeWorkspaceTestkitDirect,
  );
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

test("package manifest public exports map to source and built entrypoint targets", () => {
  const manifest = readPackageManifest();
  assert.ok(manifest.exports);

  for (const exportKey of expectedAssistantRuntimePublicExportKeys) {
    const target: unknown = manifest.exports[exportKey];
    assert.ok(isObjectRecord(target));
    const sourceStem = exportKey === "." ? "index" : exportKey.slice(2);
    const importTarget = `./dist/${sourceStem}.js`;
    const typesTarget = `./dist/${sourceStem}.d.ts`;

    assert.equal(target.import, importTarget);
    assert.equal(target.default, importTarget);
    assert.equal(target.types, typesTarget);
    assert.equal(existsSync(new URL(`../src/${sourceStem}.ts`, import.meta.url)), true);
  }
});
