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
    writeExecutable(path.join(binDir, "git"), "#!/bin/sh\nexit 0");

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

  it("parses porcelain -z rename records without treating the original path as another state", () => {
    expect(callDispatcherExport(
      "parseGitStatusPorcelainV1Z",
      "R  renamed file.ts\0original file.ts\0 M tracked file.ts\0",
    )).toEqual([
      { indexStatus: "R", worktreeStatus: " " },
      { indexStatus: " ", worktreeStatus: "M" },
    ]);
  });

  it("refuses every unauthorized Git state before Crabbox delegation", () => {
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
      [
        "#!/bin/sh",
        "case \"${1:-}\" in",
        "  status) printf '%b' \"$MURPH_TEST_GIT_STATUS\" ;;",
        "  ls-files) printf '%b' 'scripts/verification-dispatch.mjs\\000' ;;",
        "esac",
      ].join("\n"),
    );

    for (const [status, reason] of [
      ["?? notes.txt\\000", "untracked"],
      [" A intent.txt\\000", "intent-to-add"],
      ["AM staged.txt\\000", "staged-addition-changed"],
      ["AD staged-then-deleted.txt\\000", "staged-addition-changed"],
      ["DD conflict.txt\\000", "unmerged"],
      ["AU conflict.txt\\000", "unmerged"],
      ["UD conflict.txt\\000", "unmerged"],
      ["UA conflict.txt\\000", "unmerged"],
      ["DU conflict.txt\\000", "unmerged"],
      ["AA conflict.txt\\000", "unmerged"],
      ["UU conflict.txt\\000", "unmerged"],
      [" Z unsupported.txt\\000", "unsupported"],
    ] as const) {
      rmSync(delegationMarkerPath, { force: true });
      const result = spawnSync(
        process.execPath,
        [dispatcherPath, "verify:acceptance"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...withoutVerificationRoutingEnvironment(process.env),
            MURPH_TEST_GIT_STATUS: status,
            MURPH_VERIFY_EXECUTOR: "crabbox",
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`unauthorized Git state (${reason}=1)`);
      expect(result.stderr).not.toContain(status.slice(3, -4));
      expect(existsSync(delegationMarkerPath)).toBe(false);
    }

    rmSync(delegationMarkerPath, { force: true });
    const malformedRenameResult = spawnSync(
      process.execPath,
      [dispatcherPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...withoutVerificationRoutingEnvironment(process.env),
          MURPH_TEST_GIT_STATUS: "R  renamed-without-original.ts\\000",
          MURPH_VERIFY_EXECUTOR: "crabbox",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    expect(malformedRenameResult.status).toBe(1);
    expect(malformedRenameResult.stderr).toContain(
      "Unable to parse the Blacksmith Testbox Git status boundary",
    );
    expect(existsSync(delegationMarkerPath)).toBe(false);
  });

  it("refuses a sensitive cached path before Crabbox delegation", () => {
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
      [
        "#!/bin/sh",
        "case \"${1:-}\" in",
        "  status) exit 0 ;;",
        "  ls-files) printf '%b' '.env.production\\000scripts/verification-dispatch.mjs\\000' ;;",
        "esac",
      ].join("\n"),
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

  it("enforces the complete Git-state authorization boundary in a real repository", () => {
    const tempRoot = makeTempRoot();
    const repoDir = path.join(tempRoot, "repo");
    mkdirSync(repoDir, { recursive: true });
    runGit(repoDir, ["init", "--quiet"]);
    writeFileSync(path.join(repoDir, ".gitignore"), "ignored-private.txt\n", "utf8");
    writeFileSync(path.join(repoDir, "tracked.ts"), "export const value = 1;\n", "utf8");
    writeFileSync(path.join(repoDir, "rename-me.ts"), "export const renamed = 1;\n", "utf8");
    writeFileSync(path.join(repoDir, "delete-me.ts"), "export const deleted = 1;\n", "utf8");
    writeFileSync(path.join(repoDir, "staged-delete.ts"), "export const stagedDelete = 1;\n", "utf8");
    runGit(repoDir, [
      "add",
      ".gitignore",
      "tracked.ts",
      "rename-me.ts",
      "delete-me.ts",
      "staged-delete.ts",
    ]);
    runGit(repoDir, [
      "-c",
      "user.name=Crabbox Test",
      "-c",
      "user.email=crabbox-test@users.noreply.github.com",
      "commit",
      "--quiet",
      "-m",
      "initial",
    ]);

    for (const fileName of ["notes.txt", "credentials.json", ".netrc", "private.key"]) {
      writeFileSync(path.join(repoDir, fileName), "private\n", "utf8");
      expect(callDispatcherExportFailure("assertSafeBlacksmithSync", repoDir))
        .toContain("unauthorized Git state (untracked=1)");
      rmSync(path.join(repoDir, fileName));
    }

    writeFileSync(path.join(repoDir, "ignored-private.txt"), "private\n", "utf8");
    writeFileSync(path.join(repoDir, "tracked.ts"), "export const value = 2;\n", "utf8");
    writeFileSync(path.join(repoDir, "staged.ts"), "export const staged = true;\n", "utf8");
    runGit(repoDir, ["add", "staged.ts"]);
    expect(callDispatcherVoidExport("assertSafeBlacksmithSync", repoDir)).toBe("ok");

    writeFileSync(path.join(repoDir, "staged.ts"), "export const staged = 'changed';\n", "utf8");
    expect(callDispatcherExportFailure("assertSafeBlacksmithSync", repoDir))
      .toContain("staged-addition-changed=1");
    runGit(repoDir, ["add", "staged.ts"]);

    writeFileSync(
      path.join(repoDir, "staged-then-deleted.ts"),
      "export const removed = true;\n",
      "utf8",
    );
    runGit(repoDir, ["add", "staged-then-deleted.ts"]);
    rmSync(path.join(repoDir, "staged-then-deleted.ts"));
    expect(callDispatcherExportFailure("assertSafeBlacksmithSync", repoDir))
      .toContain("staged-addition-changed=1");
    runGit(repoDir, ["reset", "--quiet", "--", "staged-then-deleted.ts"]);

    writeFileSync(path.join(repoDir, "intent.ts"), "export const intent = true;\n", "utf8");
    runGit(repoDir, ["add", "--intent-to-add", "intent.ts"]);
    expect(callDispatcherExportFailure("assertSafeBlacksmithSync", repoDir))
      .toContain("intent-to-add=1");
    runGit(repoDir, ["add", "intent.ts"]);

    runGit(repoDir, ["mv", "rename-me.ts", "renamed.ts"]);
    writeFileSync(path.join(repoDir, "renamed.ts"), "export const renamed = 2;\n", "utf8");
    rmSync(path.join(repoDir, "delete-me.ts"));
    runGit(repoDir, ["rm", "--quiet", "staged-delete.ts"]);
    expect(callDispatcherVoidExport("assertSafeBlacksmithSync", repoDir)).toBe("ok");

    writeFileSync(path.join(repoDir, ".env.production"), "synthetic-test-value\n", "utf8");
    runGit(repoDir, ["add", "--force", ".env.production"]);
    expect(callDispatcherExportFailure("assertSafeBlacksmithSync", repoDir))
      .toContain("sync refused sensitive managed paths");
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

function callDispatcherVoidExport(exportName: string, argument: unknown): string {
  const result = runDispatcherVoidExport(exportName, argument);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

function callDispatcherExportFailure(exportName: string, argument: unknown): string {
  const result = runDispatcherVoidExport(exportName, argument);
  expect(result.status).toBe(2);
  return result.stderr;
}

function runDispatcherVoidExport(
  exportName: string,
  argument: unknown,
): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  const moduleUrl = pathToFileURL(dispatcherPath).href;
  const source = `
    const module = await import(${JSON.stringify(moduleUrl)});
    try {
      module[process.env.MURPH_TEST_EXPORT](
        JSON.parse(process.env.MURPH_TEST_ARGUMENT_JSON),
      );
      process.stdout.write("ok");
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

function runGit(repoDir: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}
