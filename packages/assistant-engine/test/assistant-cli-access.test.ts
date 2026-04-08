import path from "node:path";

import { describe, expect, it } from "vitest";

import { prepareAssistantDirectCliEnv } from "../src/assistant-cli-access.js";

describe("prepareAssistantDirectCliEnv", () => {
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
});
