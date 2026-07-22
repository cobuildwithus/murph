import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const runnerPath = path.join(repoRoot, "scripts", "crabbox", "run-verification.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe("Crabbox verification environment", () => {
  it("rebuilds the process environment from safe paths and synthetic test values", () => {
    const environment = callModule<Record<string, string>>(
      "buildSanitizedVerificationEnvironment",
      {
        HOME: "/home/crabbox",
        PATH: "/usr/local/bin:/usr/bin:/bin",
        TERM: "xterm-256color",
        USER: "crabbox",
        CI: "1",
        CRABBOX_ENV_ALLOW: "CI,NODE_OPTIONS",
        CUSTOM_PROVIDER_TOKEN: "secret-custom-token",
        DATABASE_URL: "postgresql://real-secret",
        MURPH_CRABBOX_NO_FORWARD: "must-not-reach-verification",
        NODE_OPTIONS: "--trace-warnings",
        OPENAI_API_KEY: "secret-openai-key",
        STRIPE_SECRET_KEY: "secret-stripe-key",
        VERCEL_OIDC_TOKEN: "secret-vercel-token",
      },
    );

    expect(environment).toMatchObject({
      HOME: "/home/crabbox",
      MURPH_CRABBOX_REMOTE: "1",
      MURPH_VERIFY_EXECUTOR: "local",
      MURPH_VERIFY_SHARED_HOST: "0",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_crabbox_verify_placeholder1",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
      USER: "crabbox",
    });
    expect(environment.DATABASE_URL).toContain("127.0.0.1:1/murph_test");
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("STRIPE_SECRET_KEY");
    expect(environment).not.toHaveProperty("VERCEL_OIDC_TOKEN");
    expect(environment).not.toHaveProperty("CI");
    expect(environment).not.toHaveProperty("CRABBOX_ENV_ALLOW");
    expect(environment).not.toHaveProperty("CUSTOM_PROVIDER_TOKEN");
    expect(environment).not.toHaveProperty("MURPH_CRABBOX_NO_FORWARD");
    expect(environment).not.toHaveProperty("MURPH_VERIFY_STEP_PARALLEL");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");

    expect(callModuleFailure(
      "buildSanitizedVerificationEnvironment",
      { PATH: "/usr/bin:/bin" },
    )).toContain("requires HOME");
    expect(callModuleFailure(
      "buildSanitizedVerificationEnvironment",
      { HOME: "/home/crabbox" },
    )).toContain("requires PATH");
  });

  it("runs the frozen install before the exact workspace verifier under the synthetic environment", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const installArgsPath = path.join(tempRoot, "install-args.txt");
    const installEnvironmentPath = path.join(tempRoot, "install-env.txt");
    const installMarkerPath = path.join(tempRoot, "install-complete");
    const verifierArgsPath = path.join(tempRoot, "verifier-args.txt");
    const verifierEnvironmentPath = path.join(tempRoot, "verifier-env.txt");

    writeExecutable(
      path.join(binDir, "corepack"),
      [
        "#!/bin/sh",
        `printf "%s\\n" "$@" > ${shellQuote(installArgsPath)}`,
        `printf "CI=%s\\nCUSTOM_PROVIDER_TOKEN=%s\\n" "\${CI-unset}" "\${CUSTOM_PROVIDER_TOKEN-unset}" > ${shellQuote(installEnvironmentPath)}`,
        `: > ${shellQuote(installMarkerPath)}`,
      ].join("\n"),
    );
    writeExecutable(
      path.join(binDir, "bash"),
      [
        "#!/bin/sh",
        `[ -f ${shellQuote(installMarkerPath)} ] || exit 41`,
        `printf "%s\\n" "$@" > ${shellQuote(verifierArgsPath)}`,
        `printf "CI=%s\\nMURPH_CRABBOX_REMOTE=%s\\nMURPH_VERIFY_EXECUTOR=%s\\nCUSTOM_PROVIDER_TOKEN=%s\\n" "\${CI-unset}" "\${MURPH_CRABBOX_REMOTE-unset}" "\${MURPH_VERIFY_EXECUTOR-unset}" "\${CUSTOM_PROVIDER_TOKEN-unset}" > ${shellQuote(verifierEnvironmentPath)}`,
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [
        runnerPath,
        "test:diff",
        "scripts/verification-dispatch.mjs",
        ".crabbox.yaml",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          CI: "source-ci-must-not-reach-verifier",
          CUSTOM_PROVIDER_TOKEN: "secret-custom-token",
          HOME: path.join(tempRoot, "home"),
          MURPH_CRABBOX_TRUSTED_ENTRYPOINT: "1",
          MURPH_CRABBOX_NO_FORWARD: "must-not-reach-verifier",
          PATH: `${binDir}${path.delimiter}/usr/bin:/bin`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(installArgsPath, "utf8").trim().split("\n")).toEqual([
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
    ]);
    expect(readFileSync(installEnvironmentPath, "utf8")).toBe(
      "CI=1\nCUSTOM_PROVIDER_TOKEN=unset\n",
    );
    expect(readFileSync(verifierArgsPath, "utf8").trim().split("\n")).toEqual([
      "scripts/workspace-verify.sh",
      "test:diff",
      "scripts/verification-dispatch.mjs",
      ".crabbox.yaml",
    ]);
    expect(readFileSync(verifierEnvironmentPath, "utf8")).toBe(
      "CI=unset\nMURPH_CRABBOX_REMOTE=1\nMURPH_VERIFY_EXECUTOR=local\nCUSTOM_PROVIDER_TOKEN=unset\n",
    );
  });

  it("rejects unsupported remote command surfaces", () => {
    expect(callModule(
      "parseRemoteVerificationRequest",
      ["verify:acceptance"],
    )).toEqual({ commandArgs: [], verificationCommand: "verify:acceptance" });

    expect(callModuleFailure(
      "parseRemoteVerificationRequest",
      ["release:patch"],
    )).toContain("supports only");
  });

  it("rejects direct candidate execution outside the trusted Testbox entrypoint", () => {
    expect(callModuleFailure(
      "assertTrustedEntrypoint",
      {
        ACTIONS_RUNTIME_TOKEN: "ambient-actions-token",
        HOME: "/home/crabbox",
        PATH: "/usr/bin:/bin",
      },
    )).toContain("trusted Testbox entrypoint");
  });

  it("fails closed before starting candidate-controlled child commands", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const childMarkerPath = path.join(tempRoot, "child-started");
    for (const command of ["corepack", "bash"]) {
      writeExecutable(
        path.join(binDir, command),
        [
          "#!/bin/sh",
          `: > ${shellQuote(childMarkerPath)}`,
          "exit 0",
        ].join("\n"),
      );
    }

    const result = spawnSync(
      process.execPath,
      [runnerPath, "test:diff", "scripts/verification-dispatch.mjs"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ACTIONS_RUNTIME_TOKEN: "ambient-actions-token",
          HOME: path.join(tempRoot, "home"),
          PATH: `${binDir}${path.delimiter}/usr/bin:/bin`,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("trusted Testbox entrypoint");
    expect(existsSync(childMarkerPath)).toBe(false);
  });
});

function makeTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-crabbox-runner-test-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeExecutable(filePath: string, content: string): void {
  const parentDir = path.dirname(filePath);
  mkdirSync(parentDir, { mode: 0o700, recursive: true });
  writeFileSync(filePath, `${content}\n`, { encoding: "utf8", mode: 0o700, flag: "w" });
  chmodSync(parentDir, 0o700);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function callModule<T>(exportName: string, argument: unknown): T {
  const result = runModuleCall(exportName, argument);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}

function callModuleFailure(exportName: string, argument: unknown): string {
  const result = runModuleCall(exportName, argument);
  expect(result.status).toBe(2);
  return result.stderr;
}

function runModuleCall(
  exportName: string,
  argument: unknown,
): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  const moduleUrl = pathToFileURL(runnerPath).href;
  const source = `
    const module = await import(${JSON.stringify(moduleUrl)});
    try {
      const result = module[process.env.MURPH_TEST_EXPORT](
        JSON.parse(process.env.MURPH_TEST_ARGUMENT_JSON),
      );
      process.stdout.write(JSON.stringify(result));
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    }
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_TEST_ARGUMENT_JSON: JSON.stringify(argument),
      MURPH_TEST_EXPORT: exportName,
    },
  }) as ReturnType<typeof spawnSync> & { stderr: string; stdout: string };
}
