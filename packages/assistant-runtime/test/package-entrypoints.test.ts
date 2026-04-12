import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

import {
  runHostedAssistantRuntimeJobInProcess,
} from "@murphai/assistant-runtime";
import {
  parseHostedEmailSendRequest as parseHostedEmailSendRequestDirect,
} from "../src/hosted-email.ts";
import {
  parseHostedEmailSendRequest,
} from "@murphai/assistant-runtime/hosted-email";
import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HostedAssistantConfigurationError,
  readHostedAssistantApiKeyEnvName,
} from "../src/hosted-assistant-env.ts";
import {
  runHostedAssistantRuntimeJobInProcess as runHostedAssistantRuntimeJobInProcessDirect,
} from "../src/hosted-runtime.ts";

test("package root export re-exports the hosted runtime surface only", () => {
  assert.equal(
    runHostedAssistantRuntimeJobInProcess,
    runHostedAssistantRuntimeJobInProcessDirect,
  );
});

test("hosted-email subpath export stays wired to the hosted email source surface", () => {
  assert.equal(parseHostedEmailSendRequest, parseHostedEmailSendRequestDirect);
});

test("package manifest declares the hosted assistant env and hosted email subpaths", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
  };

  assert.ok(manifest.exports);
  assert.ok("./hosted-assistant-env" in manifest.exports);
  assert.ok("./hosted-email" in manifest.exports);
  assert.ok(Array.isArray(HOSTED_ASSISTANT_CONFIG_ENV_NAMES));
  assert.ok(HOSTED_ASSISTANT_CONFIG_ENV_NAMES.length > 0);
  assert.equal(typeof readHostedAssistantApiKeyEnvName, "function");
  assert.equal(typeof HostedAssistantConfigurationError, "function");
});
