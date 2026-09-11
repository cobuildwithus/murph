import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runForegroundCommand } from "./process.ts";

/** Ask Vitest itself to apply each filter, including dynamic titles and skips. */
export async function assertHostedLocalVitestSelection(input: {
  config: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  files: readonly string[];
  patterns: readonly string[];
}): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-e2e-selection-"));
  const output = path.join(directory, "tests.json");
  const collect = async (pattern?: string): Promise<Set<string>> => {
    await runForegroundCommand({
      command: "pnpm",
      args: ["exec", "vitest", "list", "--config", input.config, ...input.files,
        ...(pattern === undefined ? [] : ["--testNamePattern", pattern]), "--json", output],
      cwd: input.cwd,
      env: input.env,
      label: "Validate hosted E2E test selection",
    });
    const rows: unknown = JSON.parse(await readFile(output, "utf8"));
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Hosted E2E selection matched zero runnable tests.");
    }
    const names = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row.name !== "string" || typeof row.file !== "string") {
        throw new Error("Invalid Vitest collection result.");
      }
      const identity = JSON.stringify([row.file, row.name]);
      if (names.has(identity)) throw new Error("Hosted E2E collection has duplicate test identities.");
      names.add(identity);
    }
    return names;
  };
  try {
    // One pattern can intentionally select a focused live journey. Multiple
    // patterns partition a file and must cover every runnable test exactly once.
    const complete = input.patterns.length > 1 ? await collect() : null;
    const selected = new Set<string>();
    for (const pattern of input.patterns) {
      for (const identity of await collect(pattern)) {
        if (selected.has(identity)) throw new Error("Hosted E2E process filters overlap.");
        selected.add(identity);
      }
    }
    if (complete && (complete.size !== selected.size || [...complete].some((identity) => !selected.has(identity)))) {
      throw new Error("Hosted E2E process filters omit runnable tests.");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
