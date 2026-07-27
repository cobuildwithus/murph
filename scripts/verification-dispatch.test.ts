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
  it("keeps automatic verification local when the removed opt-in flag remains set", () => {
    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_CRABBOX_BLACKSMITH: "1",
    }, true)).toMatchObject({
      executor: "local",
      reason: "auto",
    });
  });

  it("keeps CI and already-remote verification local", () => {
    expect(resolveExecutor({
      CI: "1",
    }, true)).toMatchObject({ executor: "local", reason: "ci" });

    expect(resolveExecutor({
      MURPH_CRABBOX_REMOTE: "1",
    }, true)).toMatchObject({ executor: "local", reason: "already-remote" });
  });

  it("does not probe Blacksmith availability in automatic mode", () => {
    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_CRABBOX_BLACKSMITH: "1",
    }, false)).toMatchObject({ executor: "local", reason: "auto" });

    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_VERIFY_EXECUTOR: "local",
    }, true)).toMatchObject({ executor: "local", reason: "explicit" });
  });

  it("forces Vercel-development-environment work to stay local", () => {
    expect(resolveExecutor({
      CODEX_THREAD_ID: "thread-1",
      MURPH_VERIFY_REQUIRES_VERCEL_ENV: "1",
    }, true)).toMatchObject({ executor: "local", reason: "vercel-development-env" });

    const result = resolveExecutorFailure({
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
    });

    expect(resolveExecutorFailure({
      MURPH_VERIFY_EXECUTOR: "crabbox",
    }, false)).toContain("Crabbox and Blacksmith CLIs are unavailable");
  });

  it("rebuilds the local Crabbox CLI environment from non-secret host paths", () => {
    expect(callDispatcherExport(
      "buildCrabboxCliEnvironment",
      {
        ACTIONS_RUNTIME_TOKEN: "actions-secret",
        CI: "1",
        CRABBOX_ENV_ALLOW: "OPENAI_API_KEY",
        CUSTOM_PROVIDER_TOKEN: "provider-secret",
        GITHUB_TOKEN: "github-secret",
        HOME: "/safe/home",
        NODE_OPTIONS: "--require=malicious-bootstrap",
        OPENAI_API_KEY: "model-secret",
        PATH: "/safe/bin:/usr/bin:/bin",
        STRIPE_SECRET_KEY: "billing-secret",
        TERM: "xterm-256color",
        USER: "crabbox-user",
        XDG_CONFIG_HOME: "/safe/config",
      },
    )).toEqual({
      HOME: "/safe/home",
      PATH: "/safe/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
      USER: "crabbox-user",
      XDG_CONFIG_HOME: "/safe/config",
    });
  });

  it("uses the direct Blacksmith provider without environment forwarding", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const capturePath = path.join(tempRoot, "args.txt");
    const crabboxProbeCapturePath = path.join(tempRoot, "crabbox-probe-env.txt");
    const blacksmithProbeCapturePath = path.join(tempRoot, "blacksmith-probe-env.txt");
    const envCapturePath = path.join(tempRoot, "env-allow.txt");
    const secretCapturePath = path.join(tempRoot, "secret-env.txt");
    const sentinelCapturePath = path.join(tempRoot, "sentinel.txt");
    const expectedSanitizedProbeEnvironment = "unset\n".repeat(10);
    const fakeCrabboxPath = path.join(binDir, "crabbox");
    const fakeBlacksmithPath = path.join(binDir, "blacksmith");
    writeExecutable(
      fakeCrabboxPath,
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then',
        `  printf "%s\\n" "\${OPENAI_API_KEY-unset}" "\${STRIPE_SECRET_KEY-unset}" "\${GITHUB_TOKEN-unset}" "\${CUSTOM_PROVIDER_TOKEN-unset}" "\${CI-unset}" "\${NODE_OPTIONS-unset}" "\${CRABBOX_ENV_ALLOW-unset}" "\${CRABBOX_CONFIG-unset}" "\${MURPH_CRABBOX_PROFILE-unset}" "\${MURPH_CRABBOX_NO_FORWARD-unset}" > ${shellQuote(crabboxProbeCapturePath)}`,
        "  exit 0",
        "fi",
        `printf "%s\\n" "$@" > ${shellQuote(capturePath)}`,
        `printf "%s" "\${CRABBOX_ENV_ALLOW-unset}" > ${shellQuote(envCapturePath)}`,
        `printf "%s\\n" "\${OPENAI_API_KEY-unset}" "\${STRIPE_SECRET_KEY-unset}" "\${GITHUB_TOKEN-unset}" "\${CUSTOM_PROVIDER_TOKEN-unset}" "\${CI-unset}" "\${NODE_OPTIONS-unset}" > ${shellQuote(secretCapturePath)}`,
        `printf "%s" "\${MURPH_CRABBOX_NO_FORWARD-unset}" > ${shellQuote(sentinelCapturePath)}`,
      ].join("\n"),
    );
    writeExecutable(
      fakeBlacksmithPath,
      [
        "#!/bin/sh",
        `printf "%s\\n" "\${OPENAI_API_KEY-unset}" "\${STRIPE_SECRET_KEY-unset}" "\${GITHUB_TOKEN-unset}" "\${CUSTOM_PROVIDER_TOKEN-unset}" "\${CI-unset}" "\${NODE_OPTIONS-unset}" "\${CRABBOX_ENV_ALLOW-unset}" "\${CRABBOX_CONFIG-unset}" "\${MURPH_CRABBOX_PROFILE-unset}" "\${MURPH_CRABBOX_NO_FORWARD-unset}" > ${shellQuote(blacksmithProbeCapturePath)}`,
        "exit 0",
      ].join("\n"),
    );
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
          CI: "",
          CRABBOX_ENV_ALLOW: "OPENAI_API_KEY,VERCEL_OIDC_TOKEN",
          CRABBOX_CONFIG: "/tmp/attacker-controlled-crabbox.yaml",
          CUSTOM_PROVIDER_TOKEN: "must-not-reach-crabbox",
          GITHUB_TOKEN: "must-not-reach-crabbox",
          MURPH_CRABBOX_NO_FORWARD: "must-not-reach-crabbox",
          MURPH_CRABBOX_PROFILE: "attacker-controlled-profile",
          MURPH_VERIFY_EXECUTOR: "crabbox",
          NODE_OPTIONS: "--trace-warnings",
          OPENAI_API_KEY: "must-not-reach-crabbox",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          STRIPE_SECRET_KEY: "must-not-reach-crabbox",
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(capturePath, "utf8").trim().split("\n");
    expect(readFileSync(crabboxProbeCapturePath, "utf8")).toBe(
      expectedSanitizedProbeEnvironment,
    );
    expect(readFileSync(blacksmithProbeCapturePath, "utf8")).toBe(
      expectedSanitizedProbeEnvironment,
    );
    expect(readFileSync(envCapturePath, "utf8")).toBe("unset");
    expect(readFileSync(secretCapturePath, "utf8")).toBe(
      "unset\nunset\nunset\nunset\nunset\nunset\n",
    );
    expect(readFileSync(sentinelCapturePath, "utf8")).toBe("unset");
    const providerIndex = args.indexOf("--provider");
    expect(providerIndex).toBeGreaterThan(-1);
    expect(args[providerIndex + 1]).toBe("blacksmith-testbox");
    expect(flagValue(args, "--profile")).toBe("murph-verification");
    expect(flagValue(args, "--blacksmith-org")).toBe("cobuildwithus");
    expect(flagValue(args, "--blacksmith-ref")).toBe("main");
    expect(flagValue(args, "--blacksmith-workflow")).toBe(
      ".github/workflows/crabbox-bounded.yml",
    );
    expect(flagValue(args, "--blacksmith-job")).toBe("hydrate");
    expect(flagValue(args, "--idle-timeout")).toBe("10m");
    expect(flagValue(args, "--ttl")).toBe("45m");
    expect(flagValue(args, "--stop-after")).toBe("always");
    expect(args).not.toContain("--id");
    expect(args).not.toContain("--pool");
    expect(args).not.toContain("--pool-return");
    expect(args).not.toContain("--allow-env");
    expect(args).not.toContain("--env-from-profile");
    expect(args.slice(-3)).toEqual([
      "/usr/local/bin/murph-crabbox-verify",
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
          CUSTOM_PROVIDER_TOKEN: "must-not-reach-crabbox",
          GITHUB_TOKEN: "must-not-reach-crabbox",
          MURPH_CRABBOX_LEASE_ID: "lease-1",
          MURPH_CRABBOX_NO_FORWARD: "must-not-reach-crabbox",
          MURPH_VERIFY_EXECUTOR: "crabbox",
          NODE_OPTIONS: "--trace-warnings",
          OPENAI_API_KEY: "must-not-reach-crabbox",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          STRIPE_SECRET_KEY: "must-not-reach-crabbox",
        },
      },
    );

    expect(leaseResult.status).toBe(1);
    expect(leaseResult.stderr).toContain(
      "an arbitrary existing lease cannot prove the organization",
    );
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

  it("parses porcelain -z copy and rename records without shifting later states", () => {
    expect(callDispatcherExport(
      "parseGitStatusPorcelainV1Z",
      [
        "C  copied file.ts\0source file.ts\0",
        "RM renamed file.ts\0original file.ts\0",
        "RD deleted rename.ts\0original delete.ts\0",
        " M tracked file.ts\0",
      ].join(""),
    )).toEqual([
      { indexStatus: "C", worktreeStatus: " " },
      { indexStatus: "R", worktreeStatus: "M" },
      { indexStatus: "R", worktreeStatus: "D" },
      { indexStatus: " ", worktreeStatus: "M" },
    ]);
  });

  it("treats copied additions like additions while preserving tracked renames", () => {
    expect(callDispatcherExport(
      "findUnsafeBlacksmithWorktreeStates",
      [
        { indexStatus: "C", worktreeStatus: " " },
        { indexStatus: "R", worktreeStatus: "M" },
        { indexStatus: "R", worktreeStatus: "D" },
      ],
    )).toEqual([]);
    expect(callDispatcherExport(
      "findUnsafeBlacksmithWorktreeStates",
      [
        { indexStatus: "C", worktreeStatus: "M" },
        { indexStatus: "C", worktreeStatus: "D" },
        { indexStatus: "C", worktreeStatus: "T" },
      ],
    )).toEqual([
      "staged-addition-changed",
      "staged-addition-changed",
      "staged-addition-changed",
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
    const fakeGitPath = path.join(binDir, "git");

    for (const [status, reason] of [
      ["?? notes.txt\\000", "untracked"],
      [" A intent.txt\\000", "intent-to-add"],
      ["AM staged.txt\\000", "staged-addition-changed"],
      ["AD staged-then-deleted.txt\\000", "staged-addition-changed"],
      ["CM copied.ts\\000source.ts\\000", "staged-addition-changed"],
      ["CD copied.ts\\000source.ts\\000", "staged-addition-changed"],
      ["CT copied.ts\\000source.ts\\000", "staged-addition-changed"],
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
      writeExecutable(
        fakeGitPath,
        [
          "#!/bin/sh",
          "case \"${1:-}\" in",
          `  status) printf '%b' ${shellQuote(status)} ;;`,
          "  ls-files) printf '%b' 'scripts/verification-dispatch.mjs\\000' ;;",
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
      expect(result.stderr).toContain(`unauthorized Git state (${reason}=1)`);
      expect(result.stderr).not.toContain(status.slice(3, -4));
      expect(existsSync(delegationMarkerPath)).toBe(false);
    }

    rmSync(delegationMarkerPath, { force: true });
    writeExecutable(
      fakeGitPath,
      [
        "#!/bin/sh",
        "case \"${1:-}\" in",
        "  status) printf '%b' 'R  renamed-without-original.ts\\000' ;;",
        "  ls-files) printf '%b' 'scripts/verification-dispatch.mjs\\000' ;;",
        "esac",
      ].join("\n"),
    );
    const malformedRenameResult = spawnSync(
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

  it("inspects the same default Git index that the scrubbed Crabbox child will sync", () => {
    const tempRoot = makeTempRoot();
    const repoDir = path.join(tempRoot, "repo");
    const alternateIndex = path.join(tempRoot, "alternate-index");
    mkdirSync(repoDir, { recursive: true });
    runGit(repoDir, ["init", "--quiet"]);
    writeFileSync(path.join(repoDir, "tracked.ts"), "export const value = 1;\n", "utf8");
    runGit(repoDir, ["add", "tracked.ts"]);
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
    runGit(repoDir, ["read-tree", "HEAD"], { GIT_INDEX_FILE: alternateIndex });

    writeFileSync(path.join(repoDir, ".env.production"), "synthetic-test-value\n", "utf8");
    runGit(repoDir, ["add", "--force", ".env.production"]);
    expect(runSyncGuardWithParentEnvironment(repoDir, {
      ...process.env,
      GIT_INDEX_FILE: alternateIndex,
    })).toContain("sync refused sensitive managed paths");

    runGit(repoDir, ["reset", "--quiet", "--", ".env.production"]);
    rmSync(path.join(repoDir, ".env.production"));
    writeFileSync(path.join(repoDir, "staged.ts"), "export const staged = 1;\n", "utf8");
    runGit(repoDir, ["add", "staged.ts"]);
    writeFileSync(path.join(repoDir, "staged.ts"), "export const staged = 2;\n", "utf8");
    expect(runSyncGuardWithParentEnvironment(repoDir, {
      ...process.env,
      GIT_INDEX_FILE: alternateIndex,
    })).toContain("unauthorized Git state (staged-addition-changed=1)");
  });

  it("refuses copy-detected additions changed or deleted after staging", () => {
    const tempRoot = makeTempRoot();
    const repoDir = path.join(tempRoot, "repo");
    mkdirSync(repoDir, { recursive: true });
    runGit(repoDir, ["init", "--quiet"]);
    runGit(repoDir, ["config", "status.renames", "copies"]);
    writeFileSync(path.join(repoDir, "source.ts"), "export const value = 1;\n", "utf8");
    runGit(repoDir, ["add", "source.ts"]);
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

    writeFileSync(path.join(repoDir, "copied.ts"), "export const value = 1;\n", "utf8");
    writeFileSync(path.join(repoDir, "source.ts"), "export const value = 2;\n", "utf8");
    runGit(repoDir, ["add", "source.ts", "copied.ts"]);
    expect(readGitStatus(repoDir)).toContain("C  copied.ts\0source.ts\0");
    expect(callDispatcherVoidExport("assertSafeBlacksmithSync", repoDir)).toBe("ok");

    writeFileSync(path.join(repoDir, "copied.ts"), "export const value = 3;\n", "utf8");
    expect(readGitStatus(repoDir)).toContain("CM copied.ts\0source.ts\0");
    expect(callDispatcherExportFailure("assertSafeBlacksmithSync", repoDir))
      .toContain("staged-addition-changed=1");

    rmSync(path.join(repoDir, "copied.ts"));
    expect(readGitStatus(repoDir)).toContain("CD copied.ts\0source.ts\0");
    expect(callDispatcherExportFailure("assertSafeBlacksmithSync", repoDir))
      .toContain("staged-addition-changed=1");
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

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
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

function runGit(
  repoDir: string,
  args: string[],
  environmentOverrides: NodeJS.ProcessEnv = {},
): void {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    env: { ...process.env, ...environmentOverrides },
  });
  expect(result.status, result.stderr).toBe(0);
}

function runSyncGuardWithParentEnvironment(
  repoDir: string,
  parentEnvironment: NodeJS.ProcessEnv,
): string {
  const moduleUrl = pathToFileURL(dispatcherPath).href;
  const source = `
    const module = await import(${JSON.stringify(moduleUrl)});
    try {
      const parentEnvironment = JSON.parse(process.env.MURPH_TEST_PARENT_ENV_JSON);
      const childEnvironment = module.buildCrabboxCliEnvironment(parentEnvironment);
      module.assertSafeBlacksmithSync(
        process.env.MURPH_TEST_REPO_DIR,
        childEnvironment,
      );
      process.stdout.write("ok");
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_TEST_PARENT_ENV_JSON: JSON.stringify(parentEnvironment),
      MURPH_TEST_REPO_DIR: repoDir,
    },
  });
  expect(result.status).toBe(2);
  return result.stderr;
}

function readGitStatus(repoDir: string): string {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: repoDir, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}
