import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildTrustedVerificationEnvironment,
  parseTrustedVerificationRequest,
} from "./trusted-verification-entrypoint.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const trustedEntrypointPath = path.join(
  repoRoot,
  "scripts",
  "crabbox",
  "trusted-verification-entrypoint.mjs",
);
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe("trusted Crabbox verification entrypoint", () => {
  it("replaces Testbox ambient state with a minimal synthetic boundary", () => {
    expect(buildTrustedVerificationEnvironment({
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "ambient-oidc-token",
      ACTIONS_RUNTIME_TOKEN: "ambient-actions-token",
      BLACKSMITH_ADMIN_KEY: "ambient-blacksmith-key",
      CUSTOM_PROVIDER_TOKEN: "ambient-provider-token",
      GITHUB_TOKEN: "ambient-github-token",
      HOME: "/home/runner",
      LOGNAME: "runner",
      OPENAI_API_KEY: "ambient-model-key",
      PATH: "/ambient/untrusted/bin",
      STRIPE_SECRET_KEY: "ambient-billing-key",
      TERM: "xterm-256color",
      USER: "runner",
      VERCEL_TOKEN: "ambient-vercel-token",
    })).toEqual({
      HOME: "/home/runner",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      LOGNAME: "runner",
      MURPH_CRABBOX_TRUSTED_ENTRYPOINT: "1",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      SHELL: "/bin/bash",
      TERM: "xterm-256color",
      TMPDIR: "/tmp",
      USER: "runner",
    });
  });

  it("accepts only the two canonical verification commands", () => {
    expect(parseTrustedVerificationRequest([
      "test:diff",
      "scripts/verification-dispatch.mjs",
    ])).toEqual({
      commandArgs: ["scripts/verification-dispatch.mjs"],
      verificationCommand: "test:diff",
    });
    expect(() => parseTrustedVerificationRequest(["release:patch"]))
      .toThrow(/supports only/u);
  });

  it("erases ambient state before candidate code starts", () => {
    const tempRoot = makeTempRoot();
    const candidateEntrypoint = path.join(
      tempRoot,
      "scripts",
      "crabbox",
      "run-verification.mjs",
    );
    const capturePath = path.join(tempRoot, "candidate-capture.json");
    mkdirSync(path.dirname(candidateEntrypoint), { recursive: true });
    writeFileSync(
      candidateEntrypoint,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
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
        "  },",
        "}));",
      ].join("\n"),
      "utf8",
    );

    const home = path.join(tempRoot, "home");
    const result = spawnSync(
      process.execPath,
      [
        trustedEntrypointPath,
        "test:diff",
        "scripts/verification-dispatch.mjs",
      ],
      {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ACTIONS_RUNTIME_TOKEN: "ambient-actions-token",
          BLACKSMITH_ADMIN_KEY: "ambient-blacksmith-key",
          CI: "1",
          CUSTOM_PROVIDER_TOKEN: "ambient-provider-token",
          GITHUB_TOKEN: "ambient-github-token",
          HOME: home,
          NODE_OPTIONS: "--trace-warnings",
          OPENAI_API_KEY: "ambient-model-key",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          TERM: "xterm-256color",
          USER: "runner",
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const capture = JSON.parse(readFileSync(capturePath, "utf8")) as {
      argv: string[];
      environment: Record<string, string>;
    };
    expect(capture).toEqual({
      argv: ["test:diff", "scripts/verification-dispatch.mjs"],
      environment: {
        ACTIONS_RUNTIME_TOKEN: "unset",
        BLACKSMITH_ADMIN_KEY: "unset",
        CI: "unset",
        CUSTOM_PROVIDER_TOKEN: "unset",
        GITHUB_TOKEN: "unset",
        HOME: home,
        MURPH_CRABBOX_TRUSTED_ENTRYPOINT: "1",
        NODE_OPTIONS: "unset",
        OPENAI_API_KEY: "unset",
        PATH: "/usr/local/bin:/usr/bin:/bin",
      },
    });
  });

  it("locks the hydration workflow to a secret-free, trusted-main entry boundary", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "crabbox.yml"),
      "utf8",
    );
    const config = readFileSync(path.join(repoRoot, ".crabbox.yaml"), "utf8");

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toContain("${{ secrets.");
    expect(workflow).not.toMatch(/^\s*environment:/mu);
    expect(workflow).not.toMatch(/^\s*id-token:/mu);
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/mu);
    expect(workflow).not.toMatch(/^\s*(pull_request_target|repository_dispatch):/mu);
    expect(workflow).toContain(
      "          sudo install -d -o root -g root -m 0755 /usr/local/libexec",
    );
    expect(workflow).toContain(
      [
        "          sudo install -o root -g root -m 0555 \\",
        "            scripts/crabbox/trusted-verification-entrypoint.mjs \\",
        "            /usr/local/libexec/murph-crabbox-trusted-entrypoint.mjs",
      ].join("\n"),
    );
    expect(workflow).toContain(
      "/usr/local/libexec/murph-crabbox-trusted-entrypoint.mjs",
    );
    expect(workflow).toContain(
      [
        "          sudo install -o root -g root -m 0555 \\",
        '            "$entrypoint" /usr/local/bin/murph-crabbox-verify',
      ].join("\n"),
    );
    expect(workflow).toContain("exec /usr/bin/env -i");
    expect(workflow.indexOf("exec /usr/bin/env -i"))
      .toBeLessThan(workflow.indexOf("/usr/local/bin/node"));
    expect(workflow.indexOf("Install the secret-free delegated verification entrypoint"))
      .toBeLessThan(workflow.indexOf("useblacksmith/run-testbox@"));
    expect(config).toContain("provider: blacksmith-testbox");
    expect(config).toContain("ref: main");
    const actionRefs = [...workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gmu)];
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const actionRef of actionRefs) {
      expect(actionRef[1]).toMatch(/^[a-f0-9]{40}$/u);
    }
  });

  it("puts the remaining production deploy hook behind the production environment", () => {
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
