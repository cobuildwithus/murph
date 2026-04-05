import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";

import { afterEach, test } from "vitest";

import { createHostedAssistantProfile } from "../src/assistant/hosted-config.ts";
import {
  normalizeAssistantPersistedHeaders,
  serializeAssistantProviderOperatorDefaults,
} from "../src/assistant/provider-config.js";
import {
  buildAssistantProviderDefaultsPatch,
  resolveAssistantBackendTarget,
  resolveOperatorConfigPath,
  saveDefaultVaultConfig,
} from "../src/operator-config.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createTempHomeDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "murph-operator-config-"));
  tempDirectories.push(directory);
  return directory;
}

test("normalizeAssistantPersistedHeaders strips secret headers and keeps public ones", () => {
  assert.deepEqual(
    normalizeAssistantPersistedHeaders({
      Authorization: "Bearer secret-token",
      "X-Visible": "public-header",
      "x-trace-id": "trace-123",
    }),
    {
      "X-Visible": "public-header",
      "X-Trace-Id": "trace-123",
    },
  );
});

test("serializeAssistantProviderOperatorDefaults omits secret openai-compatible headers", () => {
  assert.deepEqual(
    serializeAssistantProviderOperatorDefaults({
      provider: "openai-compatible",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.example.test/v1",
      headers: {
        Authorization: "Bearer secret-token",
        "X-Visible": "public-header",
      },
      model: "gpt-4.1-mini",
      providerName: "example",
    }),
    {
      approvalPolicy: null,
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.example.test/v1",
      codexCommand: null,
      headers: {
        "X-Visible": "public-header",
      },
      model: "gpt-4.1-mini",
      oss: false,
      profile: null,
      providerName: "example",
      reasoningEffort: null,
      sandbox: null,
    },
  );
});

test("createHostedAssistantProfile strips secret headers from persisted targets", () => {
  const profile = createHostedAssistantProfile({
    id: "platform-default",
    providerConfig: {
      provider: "openai-compatible",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.example.test/v1",
      headers: {
        Authorization: "Bearer secret-token",
        "X-Visible": "public-header",
      },
      model: "gpt-4.1-mini",
      providerName: "example",
    },
  });

  assert.deepEqual(profile.target.headers, {
    "X-Visible": "public-header",
  });
});

test("assistant backend defaults are sanitized before persistence flows reuse them", () => {
  const backend = resolveAssistantBackendTarget({
    backend: {
      adapter: "openai-compatible",
      apiKeyEnv: "OPENAI_API_KEY",
      endpoint: "https://api.example.test/v1",
      headers: {
        Authorization: "Bearer secret-token",
        "X-Visible": "public-header",
      },
      model: "gpt-4.1-mini",
      providerName: "example",
      reasoningEffort: null,
    },
    identityId: null,
    failoverRoutes: null,
    selfDeliveryTargets: null,
  });

  assert.deepEqual(backend?.headers, {
    "X-Visible": "public-header",
  });

  const patch = buildAssistantProviderDefaultsPatch({
    defaults: {
      backend,
      identityId: null,
      failoverRoutes: null,
      selfDeliveryTargets: null,
    },
    provider: "openai-compatible",
    providerConfig: {
      headers: {
        Authorization: "Bearer another-secret",
        "X-Visible": "next-public-header",
      },
    },
  });

  assert.deepEqual(patch.backend?.headers, {
    "X-Visible": "next-public-header",
  });
});

test("saveDefaultVaultConfig writes restrictive operator config permissions", async () => {
  const homeDirectory = await createTempHomeDirectory();
  const vaultDirectory = path.join(homeDirectory, "vault");

  await saveDefaultVaultConfig(vaultDirectory, homeDirectory);

  const configPath = resolveOperatorConfigPath(homeDirectory);
  const configDirectory = path.dirname(configPath);
  const configContents = await readFile(configPath, "utf8");

  assert.match(configContents, /"defaultVault": "~\/vault"/);

  if (process.platform === "win32") {
    return;
  }

  const fileStats = await stat(configPath);
  const directoryStats = await stat(configDirectory);

  assert.equal(fileStats.mode & 0o777, 0o600);
  assert.equal(directoryStats.mode & 0o777, 0o700);
});
