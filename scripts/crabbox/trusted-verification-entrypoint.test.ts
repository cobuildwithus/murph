import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildTrustedVerificationEnvironment,
  parseTrustedVerificationRequest,
} from "./trusted-verification-entrypoint.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

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
      "scripts/crabbox/trusted-verification-entrypoint.mjs",
    );
    expect(workflow).toContain(
      "/usr/local/libexec/murph-crabbox-trusted-entrypoint.mjs",
    );
    expect(workflow).toContain("/usr/local/bin/murph-crabbox-verify");
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
