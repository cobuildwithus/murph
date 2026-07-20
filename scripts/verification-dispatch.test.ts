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

const repoRoot = path.resolve(import.meta.dirname, "..");
const dispatcherPath = path.join(repoRoot, "scripts", "verification-dispatch.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe("verification dispatcher", () => {
  it("routes configured Codex verification through Crabbox to Blacksmith", () => {
    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_CRABBOX_BLACKSMITH: "1",
    }, true)).toMatchObject({
      executor: "crabbox",
      reason: "codex-auto",
      target: null,
    });
  });

  it("keeps CI and already-remote verification local", () => {
    expect(resolveExecutor({
      CI: "1",
      MURPH_CRABBOX_BLACKSMITH: "1",
    }, true)).toMatchObject({ executor: "local", reason: "ci" });

    expect(resolveExecutor({
      MURPH_CRABBOX_BLACKSMITH: "1",
      MURPH_CRABBOX_REMOTE: "1",
    }, true)).toMatchObject({ executor: "local", reason: "already-remote" });
  });

  it("falls back locally when automatic Blacksmith execution is unavailable", () => {
    expect(resolveExecutor({ MURPH_CRABBOX_BLACKSMITH: "1" }, true))
      .toMatchObject({ executor: "local", reason: "non-codex" });

    expect(resolveExecutor({ CODEX_THREAD_ID: "thread-1" }, true))
      .toMatchObject({ executor: "local", reason: "no-blacksmith-config" });

    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_CRABBOX_BLACKSMITH: "1",
    }, false)).toMatchObject({ executor: "local", reason: "crabbox-unavailable" });

    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_CRABBOX_BLACKSMITH: "1",
      MURPH_VERIFY_EXECUTOR: "local",
    }, true)).toMatchObject({ executor: "local", reason: "explicit" });
  });

  it("forces Vercel-development-environment work to stay local", () => {
    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_CRABBOX_BLACKSMITH: "1",
      MURPH_VERIFY_REQUIRES_VERCEL_ENV: "1",
    }, true)).toMatchObject({ executor: "local", reason: "vercel-development-env" });

    const result = resolveExecutorFailure({
      MURPH_CRABBOX_BLACKSMITH: "1",
      MURPH_VERIFY_EXECUTOR: "crabbox",
      MURPH_VERIFY_REQUIRES_VERCEL_ENV: "1",
    }, true);
    expect(result).toContain("never forwards Vercel development credentials");
  });

  it("rejects coordinator pools and fails closed when the direct CLI stack is unavailable", () => {
    expect(resolveExecutorFailure({
      MURPH_CRABBOX_POOL: "pool",
      MURPH_VERIFY_EXECUTOR: "crabbox",
    }, true)).toContain("does not use Crabbox pools");

    expect(resolveExecutor({
      MURPH_VERIFY_EXECUTOR: "crabbox",
    }, true)).toMatchObject({
      executor: "crabbox",
      reason: "explicit",
      target: null,
    });

    expect(resolveExecutorFailure({
      MURPH_VERIFY_EXECUTOR: "crabbox",
    }, false)).toContain("Crabbox and Blacksmith CLIs are unavailable");
  });

  it("uses the direct Blacksmith provider without environment forwarding", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const capturePath = path.join(tempRoot, "args.txt");
    const envCapturePath = path.join(tempRoot, "env-allow.txt");
    const sentinelCapturePath = path.join(tempRoot, "sentinel.txt");
    const fakeCrabboxPath = path.join(binDir, "crabbox");
    const fakeBlacksmithPath = path.join(binDir, "blacksmith");
    writeExecutable(
      fakeCrabboxPath,
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then exit 0; fi',
        'printf "%s\\n" "$@" > "$MURPH_TEST_CRABBOX_CAPTURE"',
        'printf "%s" "${CRABBOX_ENV_ALLOW-unset}" > "$MURPH_TEST_CRABBOX_ENV_CAPTURE"',
        'printf "%s" "${MURPH_CRABBOX_NO_FORWARD-unset}" > "$MURPH_TEST_CRABBOX_SENTINEL_CAPTURE"',
      ].join("\n"),
    );
    writeExecutable(fakeBlacksmithPath, "#!/bin/sh\nexit 0");

    const result = spawnSync(
      process.execPath,
      [dispatcherPath, "test:diff", "packages/assistant-engine"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...withoutVerificationRoutingEnvironment(process.env),
          CODEX_THREAD_ID: "thread-1",
          CRABBOX_ENV_ALLOW: "OPENAI_API_KEY,VERCEL_OIDC_TOKEN",
          MURPH_CRABBOX_BLACKSMITH: "1",
          MURPH_CRABBOX_NO_FORWARD: "must-not-reach-crabbox",
          MURPH_TEST_CRABBOX_CAPTURE: capturePath,
          MURPH_TEST_CRABBOX_ENV_CAPTURE: envCapturePath,
          MURPH_TEST_CRABBOX_SENTINEL_CAPTURE: sentinelCapturePath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(capturePath, "utf8").trim().split("\n");
    expect(readFileSync(envCapturePath, "utf8")).toBe("unset");
    expect(readFileSync(sentinelCapturePath, "utf8")).toBe("unset");
    const providerIndex = args.indexOf("--provider");
    expect(providerIndex).toBeGreaterThan(-1);
    expect(args[providerIndex + 1]).toBe("blacksmith-testbox");
    expect(args).not.toContain("--id");
    expect(args).not.toContain("--pool");
    expect(args).not.toContain("--pool-return");
    expect(args).not.toContain("--allow-env");
    expect(args).not.toContain("--env-from-profile");
    expect(args.slice(-4)).toEqual([
      "node",
      "scripts/crabbox/run-verification.mjs",
      "test:diff",
      "packages/assistant-engine",
    ]);

    const leaseResult = spawnSync(
      process.execPath,
      [dispatcherPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...withoutVerificationRoutingEnvironment(process.env),
          CODEX_THREAD_ID: "thread-1",
          CRABBOX_ENV_ALLOW: "OPENAI_API_KEY,VERCEL_OIDC_TOKEN",
          MURPH_CRABBOX_LEASE_ID: "lease-1",
          MURPH_CRABBOX_NO_FORWARD: "must-not-reach-crabbox",
          MURPH_TEST_CRABBOX_CAPTURE: capturePath,
          MURPH_TEST_CRABBOX_ENV_CAPTURE: envCapturePath,
          MURPH_TEST_CRABBOX_SENTINEL_CAPTURE: sentinelCapturePath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(leaseResult.status, leaseResult.stderr).toBe(0);
    const leaseArgs = readFileSync(capturePath, "utf8").trim().split("\n");
    const leaseIdIndex = leaseArgs.indexOf("--id");
    expect(leaseIdIndex).toBeGreaterThan(-1);
    expect(leaseArgs[leaseIdIndex + 1]).toBe("lease-1");
    expect(leaseArgs).not.toContain("--pool");
    expect(leaseArgs.slice(-3)).toEqual([
      "node",
      "scripts/crabbox/run-verification.mjs",
      "verify:acceptance",
    ]);
    expect(readFileSync(envCapturePath, "utf8")).toBe("unset");
    expect(readFileSync(sentinelCapturePath, "utf8")).toBe("unset");
  });

  it("identifies sensitive files before Blacksmith delegates its Git-managed sync", () => {
    expect(callDispatcherExport<string[]>(
      "findSensitiveBlacksmithSyncPaths",
      [
        ".env.example",
        ".env.local",
        "apps/cloudflare/.dev.vars.production",
        "notes.local.md",
        "scripts/verification-dispatch.mjs",
        "vault/private.json",
        ".crabbox/runs/failure.log",
      ],
    )).toEqual([
      ".env.local",
      "apps/cloudflare/.dev.vars.production",
      "notes.local.md",
      "vault/private.json",
      ".crabbox/runs/failure.log",
    ]);
  });

  it("refuses a sensitive Git-managed sync set before Crabbox delegation", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const delegationMarkerPath = path.join(tempRoot, "delegated");

    writeExecutable(
      path.join(binDir, "crabbox"),
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then exit 0; fi',
        `: > ${shellQuote(delegationMarkerPath)}`,
      ].join("\n"),
    );
    writeExecutable(path.join(binDir, "blacksmith"), "#!/bin/sh\nexit 0");
    writeExecutable(
      path.join(binDir, "git"),
      "#!/bin/sh\nprintf '%b' '.env.production\\000scripts/verification-dispatch.mjs\\000'",
    );

    const result = spawnSync(
      process.execPath,
      [dispatcherPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...withoutVerificationRoutingEnvironment(process.env),
          MURPH_VERIFY_EXECUTOR: "crabbox",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sync refused sensitive managed paths");
    expect(result.stderr).toContain(".env.production");
    expect(existsSync(delegationMarkerPath)).toBe(false);
  });
});

function callDispatcherExport<T>(exportName: string, argument: unknown): T {
  const moduleUrl = pathToFileURL(dispatcherPath).href;
  const source = `
    const module = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(JSON.stringify(module[process.env.MURPH_TEST_EXPORT](
      JSON.parse(process.env.MURPH_TEST_ARGUMENT_JSON),
    )));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_TEST_ARGUMENT_JSON: JSON.stringify(argument),
      MURPH_TEST_EXPORT: exportName,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}

function resolveExecutor(
  environment: NodeJS.ProcessEnv,
  crabboxAvailable: boolean,
): Record<string, unknown> {
  const result = runResolver(environment, crabboxAvailable);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function resolveExecutorFailure(
  environment: NodeJS.ProcessEnv,
  crabboxAvailable: boolean,
): string {
  const result = runResolver(environment, crabboxAvailable);
  expect(result.status).toBe(2);
  return result.stderr;
}

function runResolver(
  environment: NodeJS.ProcessEnv,
  crabboxAvailable: boolean,
): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  const moduleUrl = pathToFileURL(dispatcherPath).href;
  const source = `
    const module = await import(${JSON.stringify(moduleUrl)});
    try {
      const result = module.resolveVerificationExecutor({
        env: JSON.parse(process.env.MURPH_TEST_ENV_JSON),
        isCrabboxAvailable: () => process.env.MURPH_TEST_CRABBOX_AVAILABLE === "1",
      });
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
      MURPH_TEST_CRABBOX_AVAILABLE: crabboxAvailable ? "1" : "0",
      MURPH_TEST_ENV_JSON: JSON.stringify(environment),
    },
  }) as ReturnType<typeof spawnSync> & { stderr: string; stdout: string };
}

function makeTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-crabbox-dispatch-test-"));
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

function withoutVerificationRoutingEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  delete sanitized.CI;
  delete sanitized.CODEX_THREAD_ID;
  delete sanitized.MURPH_CRABBOX_BLACKSMITH;
  delete sanitized.MURPH_CRABBOX_LEASE_ID;
  delete sanitized.MURPH_CRABBOX_POOL;
  delete sanitized.MURPH_CRABBOX_REMOTE;
  delete sanitized.MURPH_VERIFY_EXECUTOR;
  delete sanitized.MURPH_VERIFY_REQUIRES_VERCEL_ENV;
  return sanitized;
}
