import path from "node:path";

import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/env";
import { describe, expect, it } from "vitest";

import {
  buildAssistantCliGuidanceText,
  HOSTED_RUNTIME_PROCESS_ENV_MARKER,
  prepareAssistantDirectCliEnv,
  resolveAssistantCliAccessContext,
} from "../src/assistant-cli-access.js";
import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from "../src/assistant-skill-assets.js";

describe("prepareAssistantDirectCliEnv", () => {
  it("aliases the hosted runtime marker from the hosted environment owner", () => {
    expect(HOSTED_RUNTIME_PROCESS_ENV_MARKER).toBe(HOSTED_RUNTIME_PROCESS_ENV);
  });

  it("returns the canonical raw and setup command names", () => {
    expect(
      resolveAssistantCliAccessContext({
        HOME: "/tmp/murph-home",
      }),
    ).toEqual({
      env: {
        HOME: "/tmp/murph-home",
      },
      rawCommand: "vault-cli",
      setupCommand: "murph",
    });
  });

  it("prepends the operator bin directory and discovered package bin directories", () => {
    const env = prepareAssistantDirectCliEnv({
      HOME: "/tmp/murph-home",
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: path.join("/tmp", "stale-skills"),
      PATH: "/usr/bin",
    });

    const pathEntries = (env.PATH ?? "").split(path.delimiter);

    expect(pathEntries[0]).toBe(path.join("/tmp/murph-home", ".local", "bin"));
    expect(pathEntries).toContain("/usr/bin");
    expect(env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toBeTruthy();
    expect(env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toMatch(
      /assistant-engine[/\\]skills$/,
    );
    expect(
      pathEntries.some((entry) => entry.endsWith(`${path.sep}node_modules${path.sep}.bin`)),
    ).toBe(true);
  });

  it("dedupes prepended path entries and handles missing PATH values", () => {
    const env = prepareAssistantDirectCliEnv({
      HOME: "/tmp/murph-home",
      PATH: "",
    });

    const pathEntries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);

    expect(pathEntries[0]).toBe(path.join("/tmp/murph-home", ".local", "bin"));
    expect(new Set(pathEntries).size).toBe(pathEntries.length);
  });

  it("projects hosted Codex child env to the needed CLI surface without unrelated credentials", () => {
    const env = prepareAssistantDirectCliEnv({
      [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: "1",
      AMBIENT_SECRET: "ambient-secret",
      ASSISTANT_MEMORY_BOUND_SESSION_ID: "stale-session",
      ASSISTANT_MEMORY_BOUND_SOURCE_PROMPT: "stale prompt",
      ASSISTANT_MEMORY_BOUND_TURN_ID: "stale-turn",
      ASSISTANT_MEMORY_BOUND_VAULT: "/tmp/stale-vault",
      ALL_PROXY: "http://platform-all-proxy.example.test:8080",
      CODEX_CA_CERTIFICATE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      CODEX_HOME: "/tmp/murph-home/.codex-hosted",
      CURL_CA_BUNDLE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      HOME: "/tmp/murph-home",
      HTTP_PROXY: "http://platform-proxy.example.test:8080",
      HTTPS_PROXY: "http://platform-proxy.example.test:8080",
      HOSTED_ASSISTANT_PROVIDER: "venice",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-secret",
      [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: "/tmp/murph-home/.codex-hosted/bin/codex",
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: path.join("/tmp", "stale-skills"),
      MURPH_HEALTH_COMMONS_PACKAGE_ROOT: "/app/node_modules/@murphai/health-commons",
      MURPH_ASSISTANT_ACTIVE_SESSION_ID: "session_hosted_active",
      MURPH_ASSISTANT_ACTIVE_TURN_ID: "turn_hosted_active",
      MURPH_PRODUCT_BASE_URL: "https://app.example.test",
      NEXT_PUBLIC_MURPH_PRODUCT_BASE_URL: "https://public-app.example.test",
      MURPH_HOSTED_CODEX_BOUND_USER_ID: "member_123",
      MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID: "attempt_123",
      MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION: "7",
      MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION: "42",
      DEVICE_SYNC_BASE_URL: "http://127.0.0.1:8788",
      DEVICE_SYNC_CONTROL_TOKEN: "device-token",
      ELEVENLABS_API_KEY: "elevenlabs-sentinel",
      EXA_API_KEY: "exa-sentinel",
      LINQ_API_TOKEN: "linq-secret",
      MAPBOX_ACCESS_TOKEN: "mapbox-sentinel",
      MURPH_ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      MURPH_ELEVENLABS_VOICE_ID: "voice_murph",
      NO_PROXY: "localhost,127.0.0.1,host.docker.internal",
      NODE_ENV: "production",
      NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      NODE_OPTIONS: "--require /tmp/injected.js",
      PATH: `${path.join("/tmp/murph-home", ".codex-hosted", "bin")}${path.delimiter}/usr/bin`,
      REQUESTS_CA_BUNDLE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      VAULT: "/tmp/murph-vault",
      OPENAI_API_KEY: "openai-secret",
      VENICE_API_KEY: "venice-secret",
    });

    const pathEntries = (env.PATH ?? "").split(path.delimiter);

    expect(env[HOSTED_RUNTIME_PROCESS_ENV_MARKER]).toBe("1");
    expect(env.CODEX_HOME).toBe("/tmp/murph-home/.codex-hosted");
    expect(env.HOME).toBe("/tmp/murph-home");
    expect(env.HOSTED_ASSISTANT_PROVIDER).toBe("venice");
    expect(env.VAULT).toBe("/tmp/murph-vault");
    expect(env.MURPH_ASSISTANT_ACTIVE_SESSION_ID).toBeUndefined();
    expect(env.MURPH_ASSISTANT_ACTIVE_TURN_ID).toBeUndefined();
    expect(env.MURPH_PRODUCT_BASE_URL).toBeUndefined();
    expect(env.NEXT_PUBLIC_MURPH_PRODUCT_BASE_URL).toBeUndefined();
    expect(env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toMatch(
      /assistant-engine[/\\]skills$/,
    );
    expect(env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]).toBe(
      "/tmp/murph-home/.codex-hosted/bin/codex",
    );
    expect(env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT).toBe(
      "/app/node_modules/@murphai/health-commons",
    );
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.VENICE_API_KEY).toBe("venice-secret");
    expect(env.ALL_PROXY).toBe("http://platform-all-proxy.example.test:8080");
    expect(env.CODEX_CA_CERTIFICATE).toBe("/etc/cloudflare/certs/cloudflare-containers-ca.crt");
    expect(env.CURL_CA_BUNDLE).toBe("/etc/cloudflare/certs/cloudflare-containers-ca.crt");
    expect(env.HTTP_PROXY).toBe("http://platform-proxy.example.test:8080");
    expect(env.HTTPS_PROXY).toBe("http://platform-proxy.example.test:8080");
    expect(env.EXA_API_KEY).toBe("exa-sentinel");
    expect(env.MAPBOX_ACCESS_TOKEN).toBe("mapbox-sentinel");
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,host.docker.internal");
    expect(env.NODE_EXTRA_CA_CERTS).toBe("/etc/cloudflare/certs/cloudflare-containers-ca.crt");
    expect(env.REQUESTS_CA_BUNDLE).toBe("/etc/cloudflare/certs/cloudflare-containers-ca.crt");
    expect(env.MURPH_HOSTED_CODEX_BOUND_USER_ID).toBeUndefined();
    expect(env.MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID).toBeUndefined();
    expect(env.MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION).toBeUndefined();
    expect(env.MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION).toBeUndefined();
    expect(env.ASSISTANT_MEMORY_BOUND_SESSION_ID).toBeUndefined();
    expect(env.ASSISTANT_MEMORY_BOUND_SOURCE_PROMPT).toBeUndefined();
    expect(env.ASSISTANT_MEMORY_BOUND_TURN_ID).toBeUndefined();
    expect(env.ASSISTANT_MEMORY_BOUND_VAULT).toBeUndefined();
    expect(pathEntries[0]).toBe(path.join("/tmp/murph-home", ".codex-hosted", "bin"));
    expect(pathEntries[1]).toBe(path.join("/tmp/murph-home", ".local", "bin"));
    expect(pathEntries).toContain("/usr/bin");
    expect(
      pathEntries.some((entry) => entry.endsWith(`${path.sep}node_modules${path.sep}.bin`)),
    ).toBe(true);
    expect(env.AMBIENT_SECRET).toBeUndefined();
    expect(env.DEVICE_SYNC_BASE_URL).toBeUndefined();
    expect(env.DEVICE_SYNC_CONTROL_TOKEN).toBeUndefined();
    expect(env.ELEVENLABS_API_KEY).toBeUndefined();
    expect(env.HOSTED_EXECUTION_CONTROL_TOKEN).toBeUndefined();
    expect(env.LINQ_API_TOKEN).toBeUndefined();
    expect(env.MURPH_ELEVENLABS_MODEL_ID).toBeUndefined();
    expect(env.MURPH_ELEVENLABS_VOICE_ID).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("forwards only the selected hosted model provider credential", () => {
    const env = prepareAssistantDirectCliEnv({
      [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: "1",
      HOME: "/tmp/murph-home",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-credential",
      PATH: "/usr/bin",
      VENICE_API_KEY: "venice-credential",
    });

    expect(env.OPENAI_API_KEY).toBe("openai-credential");
    expect(env.VENICE_API_KEY).toBeUndefined();
  });

  it("builds operator guidance that points callers back to the CLI surface", () => {
    const guidance = buildAssistantCliGuidanceText({
      rawCommand: "vault-cli",
      setupCommand: "murph",
    });

    expect(guidance).toContain("`vault-cli` is the canonical Murph CLI");
    expect(guidance).toContain("`murph` is the setup entrypoint");
    expect(guidance).toContain("Use the matching local CLI command directly");
    expect(guidance).toContain("prefer `--format json`");
    expect(guidance).toContain("do not run recursive assistant or delivery commands");
    expect(guidance).toContain("`assistant deliver`");
  });
});
