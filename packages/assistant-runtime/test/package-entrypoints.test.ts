import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

import {
  parseHostedEmailSendRequest,
  reconcileHostedVerifiedEmailSelfTarget,
  runHostedAssistantRuntimeJobInProcess,
} from "@murphai/assistant-runtime";
import {
  parseHostedEmailSendRequest as parseHostedEmailSendRequestDirect,
} from "../src/hosted-email.ts";
import {
  reconcileHostedVerifiedEmailSelfTarget as reconcileHostedVerifiedEmailSelfTargetDirect,
} from "../src/hosted-email-route.ts";
import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HostedAssistantConfigurationError,
  readHostedAssistantApiKeyEnvName,
} from "../src/hosted-assistant-env.ts";
import {
  runHostedAssistantRuntimeJobInProcess as runHostedAssistantRuntimeJobInProcessDirect,
} from "../src/hosted-runtime.ts";

test("package root export re-exports the hosted runtime and hosted email surfaces", () => {
  assert.equal(parseHostedEmailSendRequest, parseHostedEmailSendRequestDirect);
  assert.equal(
    reconcileHostedVerifiedEmailSelfTarget,
    reconcileHostedVerifiedEmailSelfTargetDirect,
  );
  assert.equal(
    runHostedAssistantRuntimeJobInProcess,
    runHostedAssistantRuntimeJobInProcessDirect,
  );
});

test("package manifest declares the hosted assistant env subpath and the source re-export stays wired", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
  };

  assert.ok(manifest.exports);
  assert.ok("./hosted-assistant-env" in manifest.exports);
  assert.ok(Array.isArray(HOSTED_ASSISTANT_CONFIG_ENV_NAMES));
  assert.ok(HOSTED_ASSISTANT_CONFIG_ENV_NAMES.length > 0);
  assert.equal(typeof readHostedAssistantApiKeyEnvName, "function");
  assert.equal(typeof HostedAssistantConfigurationError, "function");
});
