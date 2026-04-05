import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import bundle, { MURPH_OPENCLAW_SKILL_PATH } from "../src/index.ts";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = path.join(packageDir, MURPH_OPENCLAW_SKILL_PATH);

describe("@murphai/openclaw", () => {
  test("exports vault-first bundle metadata", () => {
    expect(bundle.packageName).toBe("@murphai/openclaw");
    expect(bundle.bundleFormat).toBe("claude");
    expect(bundle.requiresBins).toEqual(["vault-cli"]);
    expect(bundle.vaultFirst).toBe(true);
    expect(bundle.managesSeparateMurphAssistant).toBe(false);
  });

  test("ships a Murph skill with the expected OpenClaw guidance", async () => {
    const skill = await readFile(skillPath, "utf8");

    expect(skill).toContain("name: murph");
    expect(skill).toContain('metadata: {"openclaw":{"requires":{"bins":["vault-cli"]}}}');
    expect(skill).toContain("Use OpenClaw's built-in `exec` tool to run `vault-cli` commands.");
    expect(skill).toContain("Do not create or manage a second Murph assistant runtime inside OpenClaw.");
    expect(skill).toContain("`vault-cli <command path> --schema --format json`");
    expect(skill).toContain('`vault-cli search query --text "<query>"`');
  });
});
