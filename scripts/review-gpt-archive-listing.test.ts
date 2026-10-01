import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageModule = pathToFileURL(path.resolve("node_modules/@cobuild/review-gpt/dist/review-gpt-lib.mjs")).href;
let fixtureRoot: string;
let fixtureEnv: NodeJS.ProcessEnv;

function run(command: string, args: string[], input?: string) {
  const result = spawnSync(command, args, {
    cwd: fixtureRoot,
    env: fixtureEnv,
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`${command} fixture failed: ${result.error ?? result.stderr}`);
  return result.stdout;
}

async function prepareReview(archive: string, repomix: "xml" | "none") {
  await writeFile(path.join(fixtureRoot, "review.config.sh"), [
    'package_script="package-fixture.sh"',
    'browser_profile="fixture"',
    'managed_browser_user_data_dir="browser-fixture"',
    'managed_browser_profile="fixture"',
    `repomix_attachment_format="${repomix}"`,
  ].join("\n") + "\n");
  await writeFile(path.join(fixtureRoot, "package-fixture.sh"),
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf 'ZIP: %s (fixture)\\n' "$(dirname "$0")/${archive}"\n`);
  const output = run(process.execPath, ["--input-type=module", "-e", `
    const { runReviewGpt } = await import(${JSON.stringify(packageModule)});
    try {
      const result = await runReviewGpt({ dryRun: true, artifacts: true,
        browserPath: process.execPath, config: "review.config.sh", prompt: ["Synthetic archive check"] },
        { cwd: process.cwd() });
      console.log("RESULT:" + JSON.stringify({ ok: true, dryRun: result.dryRun }));
    } catch (error) {
      console.log("RESULT:" + JSON.stringify({ ok: false, error: String(error).slice(0, 500) }));
    }
  `]);
  const line = output.split("\n").find((value) => value.startsWith("RESULT:"));
  if (!line) throw new Error("Review fixture did not return its dry-run outcome.");
  return JSON.parse(line.slice("RESULT:".length)) as { ok: boolean; dryRun?: boolean; error?: string };
}

describe.sequential("installed ReviewGPT archive listings", () => {
  beforeAll(async () => {
    const tempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    if (!tempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
    fixtureRoot = await mkdtemp(path.join(tempRoot, "review-archive-"));
    fixtureEnv = {
      PATH: process.env.PATH,
      HOME: fixtureRoot,
      TMPDIR: fixtureRoot,
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      SYSTEMROOT: process.env.SYSTEMROOT,
    };
    run("git", ["init", "--quiet"]);
    await mkdir(path.join(fixtureRoot, "padding"));
    await mkdir(path.join(fixtureRoot, "src"));
    const names = Array.from({ length: 8_000 }, (_, index) =>
      `padding/${String(index).padStart(5, "0")}-${"a".repeat(160)}.txt`);
    for (const name of names) await writeFile(path.join(fixtureRoot, name), "");
    names.push("src/late.ts");
    await writeFile(path.join(fixtureRoot, "src/late.ts"), "export const archiveTailProbe = true;\n");
    run("zip", ["--quiet", "safe.zip", "-@"], names.join("\n") + "\n");
    expect(Buffer.byteLength(run("unzip", ["-Z1", "safe.zip"]))).toBeGreaterThan(1024 * 1024);
    // Keep one real source beyond the old listing limit for the repomix path.
    await rm(path.join(fixtureRoot, "padding"), { recursive: true });
    await copyFile(path.join(fixtureRoot, "safe.zip"), path.join(fixtureRoot, "sensitive.zip"));
    await writeFile(path.join(fixtureRoot, ".env"), "SYNTHETIC_FIXTURE=true\n");
    run("zip", ["--quiet", "sensitive.zip", ".env"]);
  });

  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("prepares oversized safe listings through both privacy and repomix manifest owners", async () => {
    const result = await prepareReview("safe.zip", "xml");
    expect(result).toEqual({ ok: true, dryRun: true });
    const repomix = await readFile(path.join(fixtureRoot, "repo.repomix.xml"), "utf8");
    expect(repomix).toContain("src/late.ts");
    expect(repomix).toContain("archiveTailProbe");
  });

  it("still rejects a sensitive entry after the old buffer limit", async () => {
    const result = await prepareReview("sensitive.zip", "none");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(".env");
    expect(result.error).toContain("credential-shaped file(s)");
  });
});
