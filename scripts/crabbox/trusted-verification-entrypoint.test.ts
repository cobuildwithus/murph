import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const trustedEntrypointPath = path.join(
  repoRoot,
  "scripts",
  "crabbox",
  "trusted-verification-entrypoint.sh",
);
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe("trusted Crabbox verification entrypoint", () => {
  it("erases ambient state before candidate code starts", () => {
    const tempRoot = makeTempRoot();
    const candidateEntrypoint = writeCandidate(
      tempRoot,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(path.join(tempRoot, "candidate-capture.json"))}, JSON.stringify({`,
        "  argv: process.argv.slice(2),",
        "  environment: {",
        '    ACTIONS_RUNTIME_TOKEN: process.env.ACTIONS_RUNTIME_TOKEN ?? "unset",',
        '    BLACKSMITH_ADMIN_KEY: process.env.BLACKSMITH_ADMIN_KEY ?? "unset",',
        '    CI: process.env.CI ?? "unset",',
        '    CUSTOM_PROVIDER_TOKEN: process.env.CUSTOM_PROVIDER_TOKEN ?? "unset",',
        '    GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "unset",',
        '    HOME: process.env.HOME ?? "unset",',
        '    MURPH_CRABBOX_TRUSTED_ENTRYPOINT: process.env.MURPH_CRABBOX_TRUSTED_ENTRYPOINT ?? "unset",',
        '    NODE_OPTIONS: process.env.NODE_OPTIONS ?? "unset",',
        '    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "unset",',
        '    PATH: process.env.PATH ?? "unset",',
        '    USER: process.env.USER ?? "unset",',
        "  },",
        "}));",
      ],
    );
    expect(existsSync(candidateEntrypoint)).toBe(true);
    const wrapperPath = writeLocalWrapper(tempRoot);

    const result = spawnSync(
      "/bin/sh",
      [wrapperPath, "test:diff", "scripts/verification-dispatch.mjs"],
      {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ACTIONS_RUNTIME_TOKEN: "ambient-actions-token",
          BLACKSMITH_ADMIN_KEY: "ambient-blacksmith-key",
          CI: "1",
          CUSTOM_PROVIDER_TOKEN: "ambient-provider-token",
          GITHUB_TOKEN: "ambient-github-token",
          HOME: "/ambient/home",
          NODE_OPTIONS: "--trace-warnings",
          OPENAI_API_KEY: "ambient-model-key",
          PATH: "/ambient/untrusted/bin",
          TERM: "xterm-256color",
          USER: "runner",
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const capture = JSON.parse(
      readFileSync(path.join(tempRoot, "candidate-capture.json"), "utf8"),
    ) as {
      argv: string[];
      environment: Record<string, string>;
    };
    expect(capture.argv).toEqual([
      "test:diff",
      "scripts/verification-dispatch.mjs",
    ]);
    expect(capture.environment).toMatchObject({
      ACTIONS_RUNTIME_TOKEN: "unset",
      BLACKSMITH_ADMIN_KEY: "unset",
      CI: "unset",
      CUSTOM_PROVIDER_TOKEN: "unset",
      GITHUB_TOKEN: "unset",
      MURPH_CRABBOX_TRUSTED_ENTRYPOINT: "1",
      NODE_OPTIONS: "unset",
      OPENAI_API_KEY: "unset",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      USER: "crabbox",
    });
    expect(capture.environment.HOME).toMatch(
      /^\/tmp\/murph-crabbox-home\.[A-Za-z0-9]+$/u,
    );
    expect(capture.environment.HOME).not.toBe("/ambient/home");
    rmSync(capture.environment.HOME, { force: true, recursive: true });
  });

  it("rejects unsupported commands before candidate Node starts", () => {
    const tempRoot = makeTempRoot();
    const markerPath = path.join(tempRoot, "candidate-started");
    writeCandidate(
      tempRoot,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(markerPath)}, "started");`,
      ],
    );

    const result = spawnSync(
      "/bin/sh",
      [writeLocalWrapper(tempRoot), "release:patch"],
      { cwd: tempRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(64);
    expect(result.stderr).toContain(
      "supports only test:diff and verify:acceptance",
    );
    expect(existsSync(markerPath)).toBe(false);
  });

  it("fails closed when the candidate verifier is not a regular file", () => {
    const tempRoot = makeTempRoot();
    const result = spawnSync(
      "/bin/sh",
      [writeLocalWrapper(tempRoot), "verify:acceptance"],
      { cwd: tempRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(66);
    expect(result.stderr).toContain(
      "could not resolve the candidate verifier",
    );
  });

  it("execs the candidate verifier so SIGINT returns status 130", async () => {
    const tempRoot = makeTempRoot();
    const homePath = path.join(tempRoot, "home-path");
    const readyPath = path.join(tempRoot, "ready");
    writeCandidate(
      tempRoot,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(homePath)}, process.env.HOME ?? "");`,
        `writeFileSync(${JSON.stringify(readyPath)}, "ready");`,
        'process.once("SIGINT", () => process.exit(130));',
        "setInterval(() => {}, 1_000);",
      ],
    );

    const child = spawn(
      "/bin/sh",
      [writeLocalWrapper(tempRoot), "verify:acceptance"],
      { cwd: tempRoot, stdio: "ignore" },
    );
    await waitForFile(readyPath);
    const exitResult = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    child.kill("SIGINT");
    const result = await exitResult;

    expect(result).toEqual({ code: 130, signal: null });
    rmSync(readFileSync(homePath, "utf8"), { force: true, recursive: true });
  });

  it("locks hydration to the root-owned shell boundary and pinned actions", () => {
    const workflowPath = path.join(
      repoRoot,
      ".github",
      "workflows",
      "crabbox-bounded.yml",
    );
    const legacyWorkflowPath = path.join(
      repoRoot,
      ".github",
      "workflows",
      "crabbox.yml",
    );
    const workflow = readFileSync(workflowPath, "utf8");
    const config = readFileSync(path.join(repoRoot, ".crabbox.yaml"), "utf8");
    const entrypoint = readFileSync(trustedEntrypointPath, "utf8");

    expect(existsSync(legacyWorkflowPath)).toBe(false);
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toContain("${{ secrets.");
    expect(workflow).not.toMatch(/^\s*environment:/mu);
    expect(workflow).not.toMatch(/^\s*id-token:/mu);
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/mu);
    expect(workflow).not.toMatch(/^\s*(pull_request_target|repository_dispatch):/mu);
    expect(workflow).toContain("timeout-minutes: 50");
    expect(workflow).toContain(
      [
        "          sudo install -o root -g root -m 0555 \\",
        "            scripts/crabbox/trusted-verification-entrypoint.sh \\",
        "            /usr/local/bin/murph-crabbox-verify",
      ].join("\n"),
    );
    expect(workflow).not.toContain("/usr/local/libexec");
    expect(entrypoint).toContain("exec /usr/bin/env -i");
    expect(entrypoint).toContain("MURPH_CRABBOX_TRUSTED_ENTRYPOINT=1");
    expect(entrypoint).toContain("test:diff|verify:acceptance");
    expect(entrypoint).toContain('repo_root="$(/bin/pwd -P)"');
    expect(workflow.indexOf("Install the secret-free delegated verification entrypoint"))
      .toBeLessThan(workflow.indexOf("useblacksmith/run-testbox@"));
    expect(config).toContain("provider: blacksmith-testbox");
    expect(config).toContain(
      "workflow: .github/workflows/crabbox-bounded.yml",
    );
    expect(config).toContain("ref: main");
    expect(config).toContain("idleTimeout: 10m");
    const actionRefs = [...workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gmu)];
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const actionRef of actionRefs) {
      expect(actionRef[1]).toMatch(/^[a-f0-9]{40}$/u);
    }
  });

  it("puts the production deploy hook behind the production environment", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "deploy-render-temporal-worker.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/^  deploy:\n(?:.|\n)*?^    environment: production$/mu);
  });
});

function makeTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-crabbox-trusted-test-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeCandidate(tempRoot: string, lines: string[]): string {
  const candidateEntrypoint = path.join(
    tempRoot,
    "scripts",
    "crabbox",
    "run-verification.mjs",
  );
  mkdirSync(path.dirname(candidateEntrypoint), { recursive: true });
  writeFileSync(candidateEntrypoint, `${lines.join("\n")}\n`, "utf8");
  return candidateEntrypoint;
}

function writeLocalWrapper(tempRoot: string): string {
  const wrapperPath = path.join(tempRoot, "murph-crabbox-verify");
  const source = readFileSync(trustedEntrypointPath, "utf8");
  const localSource = source.replace(
    "/usr/local/bin/node",
    shellQuote(process.execPath),
  );
  expect(localSource).not.toBe(source);
  writeFileSync(wrapperPath, localSource, "utf8");
  return wrapperPath;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for candidate verifier to start.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
