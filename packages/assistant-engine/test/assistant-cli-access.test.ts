import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAssistantCliGuidanceText,
  HOSTED_RUNTIME_PROCESS_ENV_MARKER,
  prepareAssistantDirectCliEnv,
  resolveAssistantCliAccessContext,
} from "../src/assistant-cli-access.js";

describe("prepareAssistantDirectCliEnv", () => {
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
      PATH: "/usr/bin",
    });

    const pathEntries = (env.PATH ?? "").split(path.delimiter);

    expect(pathEntries[0]).toBe(path.join("/tmp/murph-home", ".local", "bin"));
    expect(pathEntries).toContain("/usr/bin");
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

  it("projects hosted Codex child env to the needed CLI surface without provider credentials", () => {
    const env = prepareAssistantDirectCliEnv({
      [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: "1",
      AGENTMAIL_API_KEY: "agentmail-secret",
      AMBIENT_SECRET: "ambient-secret",
      ASSISTANT_MEMORY_BOUND_PRIVATE_CONTEXT: "1",
      ASSISTANT_MEMORY_BOUND_SESSION_ID: "asst_123",
      ASSISTANT_MEMORY_BOUND_SOURCE_PROMPT: "hello",
      ASSISTANT_MEMORY_BOUND_TURN_ID: "turn_123",
      ASSISTANT_MEMORY_BOUND_VAULT: "/tmp/murph-vault",
      BRAVE_API_KEY: "brave-secret",
      CODEX_HOME: "/tmp/murph-home/.codex-hosted",
      HOME: "/tmp/murph-home",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-secret",
      LINQ_API_TOKEN: "linq-secret",
      NODE_ENV: "production",
      NODE_OPTIONS: "--require /tmp/injected.js",
      PATH: `${path.join("/tmp/murph-home", ".codex-hosted", "bin")}${path.delimiter}/usr/bin`,
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      VAULT: "/tmp/murph-vault",
      VERCEL_AI_API_KEY: "vercel-secret",
    });

    const pathEntries = (env.PATH ?? "").split(path.delimiter);

    expect(env[HOSTED_RUNTIME_PROCESS_ENV_MARKER]).toBe("1");
    expect(env.CODEX_HOME).toBe("/tmp/murph-home/.codex-hosted");
    expect(env.HOME).toBe("/tmp/murph-home");
    expect(env.VAULT).toBe("/tmp/murph-vault");
    expect(env.VERCEL_AI_API_KEY).toBeUndefined();
    expect(env.ASSISTANT_MEMORY_BOUND_SESSION_ID).toBe("asst_123");
    expect(env.ASSISTANT_MEMORY_BOUND_SOURCE_PROMPT).toBe("hello");
    expect(pathEntries[0]).toBe(path.join("/tmp/murph-home", ".codex-hosted", "bin"));
    expect(pathEntries[1]).toBe(path.join("/tmp/murph-home", ".local", "bin"));
    expect(pathEntries).toContain("/usr/bin");
    expect(
      pathEntries.some((entry) => entry.endsWith(`${path.sep}node_modules${path.sep}.bin`)),
    ).toBe(true);
    expect(env.AGENTMAIL_API_KEY).toBeUndefined();
    expect(env.AMBIENT_SECRET).toBeUndefined();
    expect(env.BRAVE_API_KEY).toBeUndefined();
    expect(env.HOSTED_EXECUTION_CONTROL_TOKEN).toBeUndefined();
    expect(env.LINQ_API_TOKEN).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
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
