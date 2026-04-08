import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAssistantCliGuidanceText,
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

  it("builds operator guidance that points callers back to the CLI surface", () => {
    const guidance = buildAssistantCliGuidanceText({
      rawCommand: "vault-cli",
      setupCommand: "murph",
    });

    expect(guidance).toContain("`vault-cli` is the canonical Murph CLI");
    expect(guidance).toContain("`murph` is the setup entrypoint");
    expect(guidance).toContain("Do not edit canonical vault files directly");
  });
});
