import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const cloudflareConsumerDir = path.join(repoRoot, "apps", "cloudflare");

describe("@murphai/hosted-local-harness package boundary", () => {
  it("imports advertised root and subpath exports through package resolution", () => {
    const script = `
      const expected = new Map([
        ["@murphai/hosted-local-harness", ["startHostedLocalHarness", "resolveHostedLocalE2eScenarios"]],
        ["@murphai/hosted-local-harness/cli", ["runHostedLocalCli"]],
        ["@murphai/hosted-local-harness/compat", ["normalizeLegacyCloudflareHostedLocalE2eArgs"]],
        ["@murphai/hosted-local-harness/codex-app-server-stub", ["maybeInstallHostedLocalCodexAppServerStub"]],
        ["@murphai/hosted-local-harness/dev-hosted-local/environment", ["loadHostedLocalBaseEnvironment"]],
        ["@murphai/hosted-local-harness/dev-hosted-local/stack", ["startHostedLocalDevStack"]],
        ["@murphai/hosted-local-harness/harness", ["startHostedLocalHarness"]],
        ["@murphai/hosted-local-harness/e2e", ["runHostedLocalE2eSuite", "resolveHostedLocalE2eScenarios"]],
      ]);
      for (const [specifier, names] of expected) {
        const imported = await import(specifier);
        for (const name of names) {
          if (typeof imported[name] !== "function") {
            throw new Error(\`\${specifier} did not expose function \${name}.\`);
          }
        }
      }
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        cwd: cloudflareConsumerDir,
        encoding: "utf8",
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
        },
        timeout: 10_000,
      },
    );

    expect(result.status, sanitizeProcessOutput(result.stderr || result.stdout)).toBe(0);
    expect(result.signal).toBeNull();
  });
});

function sanitizeProcessOutput(value: string): string {
  return value
    .split(repoRoot).join("<REPO_ROOT>")
    .split(os.homedir()).join("<HOME_DIR>");
}
