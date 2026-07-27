import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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

    expect(resolveExecutorFailure({
      MURPH_VERIFY_EXECUTOR: "ssh",
      MURPH_VERIFY_REQUIRES_VERCEL_ENV: "1",
    }, true)).toContain("never forwards Vercel development credentials");
  });

  it("rejects coordinator pools and fails closed when an explicit remote stack is unavailable", () => {
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

    expect(resolveExecutorFailure({
      MURPH_VERIFY_EXECUTOR: "ssh",
      MURPH_VERIFY_SSH_HOST: "worker-mac",
    }, false)).toContain("Crabbox CLI is unavailable");
  });

  it("requires a safe SSH-config host alias", () => {
    expect(resolveExecutorFailure({
      MURPH_VERIFY_EXECUTOR: "ssh",
    }, true)).toContain("requires MURPH_VERIFY_SSH_HOST");

    for (const hostAlias of [
      "-worker",
      "worker@example.test",
      "worker.example.test:22",
      "worker example",
    ]) {
      expect(resolveExecutorFailure({
        MURPH_VERIFY_EXECUTOR: "ssh",
        MURPH_VERIFY_SSH_HOST: hostAlias,
      }, true)).toContain("must be a safe SSH host alias");
    }
    expect(resolveExecutorFailure({
      MURPH_VERIFY_EXECUTOR: "ssh",
      MURPH_VERIFY_SSH_HOST: "worker\nexample",
    }, true)).toContain("must not contain control characters");

    expect(resolveExecutor({
      MURPH_VERIFY_EXECUTOR: "ssh",
      MURPH_VERIFY_SSH_HOST: "worker-mac.local",
    }, true)).toMatchObject({ executor: "ssh", reason: "explicit" });
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
    const testRepoDir = path.join(tempRoot, "repo");
    const testScriptsDir = path.join(testRepoDir, "scripts");
    mkdirSync(testScriptsDir, { recursive: true });
    writeFileSync(
      path.join(testScriptsDir, "verification-dispatch.mjs"),
      readFileSync(dispatcherPath, "utf8"),
      "utf8",
    );
    runGit(testRepoDir, ["init", "--quiet"]);
    runGit(testRepoDir, ["add", "scripts"]);
    runGit(testRepoDir, [
      "-c",
      "user.name=Crabbox Test",
      "-c",
      "user.email=crabbox-test@users.noreply.github.com",
      "commit",
      "--quiet",
      "-m",
      "initial",
    ]);
    const dispatcherUnderTest = realpathSync(
      path.join(testScriptsDir, "verification-dispatch.mjs"),
    );
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
    const result = spawnSync(
      process.execPath,
      [dispatcherUnderTest, "test:diff", "packages/assistant-engine"],
      {
        cwd: testRepoDir,
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
          MURPH_WORKSPACE_ARTIFACT_LOCK_HELD: "1",
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
    expect(args).not.toContain("--ttl");
    expect(args).not.toContain("--stop-after");
    expect(args).not.toContain("--keep");
    expect(args).not.toContain("--keep-on-failure");
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
      [dispatcherUnderTest, "verify:acceptance"],
      {
        cwd: testRepoDir,
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

  it("uses one isolated, secret-free static macOS workspace per local worktree", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const capturePath = path.join(tempRoot, "args.txt");
    const environmentPath = path.join(tempRoot, "environment.txt");
    const testRepoDir = path.join(tempRoot, "repo");
    const testScriptsDir = path.join(testRepoDir, "scripts");
    mkdirSync(testScriptsDir, { recursive: true });
    writeFileSync(
      path.join(testScriptsDir, "verification-dispatch.mjs"),
      readFileSync(dispatcherPath, "utf8"),
      "utf8",
    );
    runGit(testRepoDir, ["init", "--quiet"]);
    runGit(testRepoDir, ["add", "scripts"]);
    runGit(testRepoDir, [
      "-c",
      "user.name=Crabbox Test",
      "-c",
      "user.email=crabbox-test@users.noreply.github.com",
      "commit",
      "--quiet",
      "-m",
      "initial",
    ]);
    const dispatcherUnderTest = realpathSync(
      path.join(testScriptsDir, "verification-dispatch.mjs"),
    );
    writeExecutable(
      path.join(binDir, "crabbox"),
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then exit 0; fi',
        `printf "%s\\n" "$@" > ${shellQuote(capturePath)}`,
        `printf "CRABBOX_STATIC_ID=%s\\nMURPH_WORKSPACE_ARTIFACT_LOCK_HELD=%s\\nMURPH_VERIFY_SSH_HOST=%s\\nOPENAI_API_KEY=%s\\nNODE_OPTIONS=%s\\n" "\${CRABBOX_STATIC_ID-unset}" "\${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD-unset}" "\${MURPH_VERIFY_SSH_HOST-unset}" "\${OPENAI_API_KEY-unset}" "\${NODE_OPTIONS-unset}" > ${shellQuote(environmentPath)}`,
      ].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [dispatcherUnderTest, "test:diff", "packages/assistant-engine"],
      {
        cwd: testRepoDir,
        encoding: "utf8",
        env: {
          ...withoutVerificationRoutingEnvironment(process.env),
          MURPH_VERIFY_EXECUTOR: "ssh",
          MURPH_VERIFY_SSH_HOST: "worker-mac.local",
          MURPH_WORKSPACE_ARTIFACT_LOCK_HELD: "1",
          NODE_OPTIONS: "--trace-warnings",
          OPENAI_API_KEY: "must-not-reach-crabbox",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(capturePath, "utf8").trim().split("\n");
    expect(flagValue(args, "--provider")).toBe("ssh");
    expect(flagValue(args, "--target")).toBe("macos");
    expect(flagValue(args, "--static-host")).toBe("worker-mac.local");
    expect(flagValue(args, "--static-work-root")).toMatch(
      /^\/Users\/Shared\/murph-crabbox\/runs\/[a-f0-9]{16}-[a-f0-9]{16}$/u,
    );
    expect(args).toContain("--full-resync");
    expect(args).toContain("--preflight");
    expect(flagValue(args, "--preflight-tools")).toBe(
      "git,rsync,node,corepack,lockf",
    );
    expect(args).not.toContain("--allow-env");
    expect(args).not.toContain("--env-from-profile");
    expect(args).not.toContain("--keep");
    expect(args).not.toContain("--ttl");
    expect(args.slice(-4)).toEqual([
      "/bin/sh",
      "scripts/crabbox/run-ssh-locked-verification.sh",
      "test:diff",
      "packages/assistant-engine",
    ]);
    expect(readFileSync(environmentPath, "utf8")).toMatch(
      /^CRABBOX_STATIC_ID=static_murph_[a-f0-9]{16}\nMURPH_WORKSPACE_ARTIFACT_LOCK_HELD=unset\nMURPH_VERIFY_SSH_HOST=unset\nOPENAI_API_KEY=unset\nNODE_OPTIONS=unset\n$/u,
    );

    const firstIdentity = callDispatcherExport<Record<string, string>>(
      "buildSshWorktreeIdentity",
      "/workspace/one",
    );
    const repeatedIdentity = callDispatcherExport<Record<string, string>>(
      "buildSshWorktreeIdentity",
      "/workspace/one",
    );
    const secondIdentity = callDispatcherExport<Record<string, string>>(
      "buildSshWorktreeIdentity",
      "/workspace/two",
    );
    expect(repeatedIdentity.staticId).toBe(firstIdentity.staticId);
    expect(repeatedIdentity.workRoot).not.toBe(firstIdentity.workRoot);
    expect(secondIdentity.staticId).not.toBe(firstIdentity.staticId);
    expect(secondIdentity.workRoot).not.toBe(firstIdentity.workRoot);
    expect(Object.values(firstIdentity).join(" ")).not.toContain("/workspace/one");

    expect(callDispatcherExport<Record<string, unknown>>(
      "buildLockedRemoteDispatcherInvocation",
      {
        request: {
          commandArgs: [],
          verificationCommand: "verify:acceptance",
        },
        argv: ["verify:acceptance"],
      },
    )).toMatchObject({
      command: "node",
      args: [
        "scripts/run-with-workspace-artifact-lock.mjs",
        "remote verify:acceptance",
        "--",
        "node",
        "scripts/verification-dispatch.mjs",
        "verify:acceptance",
      ],
    });
  });

  it("checks the remote sync candidate only after acquiring the workspace lock", async () => {
    const tempRoot = makeTempRoot();
    const repoDir = path.join(tempRoot, "repo");
    const scriptsDir = path.join(repoDir, "scripts");
    const binDir = path.join(tempRoot, "bin");
    const lockReadyPath = path.join(tempRoot, "lock-ready");
    const lockReleasePath = path.join(tempRoot, "lock-release");
    const providerMarkerPath = path.join(tempRoot, "provider-called");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, "verification-dispatch.mjs"),
      readFileSync(dispatcherPath, "utf8"),
      "utf8",
    );
    writeFileSync(
      path.join(scriptsDir, "run-with-workspace-artifact-lock.mjs"),
      readFileSync(
        path.join(repoRoot, "scripts", "run-with-workspace-artifact-lock.mjs"),
        "utf8",
      ),
      "utf8",
    );
    writeExecutable(
      path.join(scriptsDir, "hold-lock.sh"),
      [
        "#!/bin/sh",
        `: > ${shellQuote(lockReadyPath)}`,
        `while [ ! -f ${shellQuote(lockReleasePath)} ]; do sleep 0.05; done`,
      ].join("\n"),
    );
    writeExecutable(
      path.join(binDir, "crabbox"),
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then exit 0; fi',
        `: > ${shellQuote(providerMarkerPath)}`,
      ].join("\n"),
    );
    runGit(repoDir, ["init", "--quiet"]);
    runGit(repoDir, ["add", "scripts"]);
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

    const baseEnvironment: NodeJS.ProcessEnv = {
      ...withoutVerificationRoutingEnvironment(process.env),
      HOME: path.join(tempRoot, "home"),
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    const lockHolder = spawn(
      process.execPath,
      [
        path.join(scriptsDir, "run-with-workspace-artifact-lock.mjs"),
        "test lock holder",
        "--",
        path.join(scriptsDir, "hold-lock.sh"),
      ],
      {
        cwd: repoDir,
        env: baseEnvironment,
        stdio: "ignore",
      },
    );
    await waitForFile(lockReadyPath);

    const dispatcher = spawn(
      process.execPath,
      [
        realpathSync(path.join(scriptsDir, "verification-dispatch.mjs")),
        "test:diff",
        "scripts/verification-dispatch.mjs",
      ],
      {
        cwd: repoDir,
        env: {
          ...baseEnvironment,
          MURPH_VERIFY_EXECUTOR: "ssh",
          MURPH_VERIFY_SSH_HOST: "worker-mac",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const stderrChunks: Buffer[] = [];
    dispatcher.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    try {
      await waitForCondition(
        () => Buffer.concat(stderrChunks).toString("utf8").includes(
          "state=waiting-for-workspace-lock",
        ) || dispatcher.exitCode !== null,
        "dispatcher to enter or reject the workspace lock",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        Buffer.concat(stderrChunks).toString("utf8"),
        `dispatcher exited with code ${dispatcher.exitCode} before waiting for the workspace lock`,
      ).toContain("state=waiting-for-workspace-lock");
      writeFileSync(path.join(repoDir, "raced.txt"), "changed while waiting\n", "utf8");
      writeFileSync(lockReleasePath, "release\n", "utf8");

      const [lockResult, dispatcherResult] = await Promise.all([
        waitForChild(lockHolder),
        waitForChild(dispatcher),
      ]);
      expect(lockResult).toEqual({ code: 0, signal: null });
      expect(dispatcherResult).toEqual({ code: 1, signal: null });
      expect(Buffer.concat(stderrChunks).toString("utf8")).toContain(
        "unauthorized Git state (untracked=1)",
      );
      expect(existsSync(providerMarkerPath)).toBe(false);
    } finally {
      if (!existsSync(lockReleasePath)) {
        writeFileSync(lockReleasePath, "release\n", "utf8");
      }
      await Promise.allSettled([
        waitForChild(lockHolder),
        waitForChild(dispatcher),
      ]);
    }
  });

  it("freezes one candidate before provider sync and preserves implicit diff scope", async () => {
    const tempRoot = makeTempRoot();
    const repoDir = path.join(tempRoot, "repo");
    const scriptsDir = path.join(repoDir, "scripts");
    const binDir = path.join(tempRoot, "bin");
    const providerReadyPath = path.join(tempRoot, "provider-ready");
    const providerReleasePath = path.join(tempRoot, "provider-release");
    const providerCapturePath = path.join(tempRoot, "provider-capture.txt");
    const providerCwdPath = path.join(tempRoot, "provider-cwd.txt");
    const providerDiffPath = path.join(tempRoot, "provider-diff.txt");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, "verification-dispatch.mjs"),
      readFileSync(dispatcherPath, "utf8"),
      "utf8",
    );
    writeFileSync(path.join(repoDir, "tracked.txt"), "before\n", "utf8");
    writeFileSync(path.join(repoDir, "rename-old.txt"), "rename\n", "utf8");
    writeFileSync(path.join(repoDir, "delete.txt"), "delete\n", "utf8");
    writeExecutable(
      path.join(binDir, "crabbox"),
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then exit 0; fi',
        `pwd > ${shellQuote(providerCwdPath)}`,
        `: > ${shellQuote(providerReadyPath)}`,
        `while [ ! -f ${shellQuote(providerReleasePath)} ]; do sleep 0.05; done`,
        "{",
        '  printf "tracked=%s\\n" "$(cat tracked.txt)"',
        '  printf "staged=%s\\n" "$(cat staged-new.txt)"',
        '  printf "renamed=%s\\n" "$(cat rename-new.txt)"',
        '  if [ -e rename-old.txt ]; then printf "old=present\\n"; else printf "old=absent\\n"; fi',
        '  if [ -e delete.txt ]; then printf "deleted=present\\n"; else printf "deleted=absent\\n"; fi',
        '  if [ -e late.txt ]; then printf "late=present\\n"; else printf "late=absent\\n"; fi',
        `} > ${shellQuote(providerCapturePath)}`,
        `git diff --name-only HEAD -- > ${shellQuote(providerDiffPath)}`,
      ].join("\n"),
    );
    runGit(repoDir, ["init", "--quiet"]);
    runGit(repoDir, ["add", "scripts", "tracked.txt", "rename-old.txt", "delete.txt"]);
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

    writeFileSync(path.join(repoDir, "tracked.txt"), "admitted\n", "utf8");
    writeFileSync(path.join(repoDir, "staged-new.txt"), "staged\n", "utf8");
    runGit(repoDir, ["add", "staged-new.txt"]);
    runGit(repoDir, ["mv", "rename-old.txt", "rename-new.txt"]);
    writeFileSync(path.join(repoDir, "rename-new.txt"), "renamed-and-modified\n", "utf8");
    rmSync(path.join(repoDir, "delete.txt"));

    const dispatcher = spawn(
      process.execPath,
      [
        realpathSync(path.join(scriptsDir, "verification-dispatch.mjs")),
        "test:diff",
      ],
      {
        cwd: repoDir,
        env: {
          ...insideWorkspaceArtifactLockEnvironment(process.env),
          HOME: path.join(tempRoot, "home"),
          MURPH_VERIFY_EXECUTOR: "ssh",
          MURPH_VERIFY_SSH_HOST: "worker-mac",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const stderrChunks: Buffer[] = [];
    dispatcher.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    try {
      await waitForFile(providerReadyPath, 15_000);
      writeFileSync(path.join(repoDir, "tracked.txt"), "after-admission\n", "utf8");
      writeFileSync(path.join(repoDir, "late.txt"), "late\n", "utf8");
      writeFileSync(providerReleasePath, "release\n", "utf8");

      expect(await waitForChild(dispatcher)).toEqual({ code: 0, signal: null });
      expect(readFileSync(providerCapturePath, "utf8")).toBe(
        [
          "tracked=admitted",
          "staged=staged",
          "renamed=renamed-and-modified",
          "old=absent",
          "deleted=absent",
          "late=absent",
          "",
        ].join("\n"),
      );
      expect(Buffer.concat(stderrChunks).toString("utf8")).toMatch(
        /\[verification-dispatch\] candidate-tree=[a-f0-9]{40}\n/u,
      );
      expect(readFileSync(providerDiffPath, "utf8").trim().split("\n"))
        .toEqual(expect.arrayContaining([
          "delete.txt",
          "rename-new.txt",
          "staged-new.txt",
          "tracked.txt",
        ]));
      expect(existsSync(readFileSync(providerCwdPath, "utf8").trim())).toBe(false);
    } finally {
      if (!existsSync(providerReleasePath)) {
        writeFileSync(providerReleasePath, "release\n", "utf8");
      }
      if (dispatcher.exitCode === null && dispatcher.signalCode === null) {
        dispatcher.kill("SIGHUP");
      }
      await Promise.allSettled([waitForChild(dispatcher)]);
    }
  });

  it("rejects a staged addition changed while the frozen candidate is captured", async () => {
    const tempRoot = makeTempRoot();
    const repoDir = path.join(tempRoot, "repo");
    const scriptsDir = path.join(repoDir, "scripts");
    const binDir = path.join(tempRoot, "bin");
    const captureReadyPath = path.join(tempRoot, "capture-ready");
    const captureReleasePath = path.join(tempRoot, "capture-release");
    const providerPath = path.join(tempRoot, "provider-started");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(scriptsDir, "verification-dispatch.mjs"),
      readFileSync(dispatcherPath, "utf8"),
      "utf8",
    );
    runGit(repoDir, ["init", "--quiet"]);
    runGit(repoDir, ["add", "scripts"]);
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
    writeFileSync(path.join(repoDir, "staged-new.txt"), "staged\n", "utf8");
    runGit(repoDir, ["add", "staged-new.txt"]);

    const realGit = spawnSync("/bin/sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).stdout.trim();
    expect(realGit).not.toBe("");
    writeExecutable(
      path.join(binDir, "git"),
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "stash" ] && [ "${2:-}" = "create" ]; then',
        `  : > ${shellQuote(captureReadyPath)}`,
        `  while [ ! -f ${shellQuote(captureReleasePath)} ]; do sleep 0.05; done`,
        "fi",
        `exec ${shellQuote(realGit)} "$@"`,
      ].join("\n"),
    );
    writeExecutable(
      path.join(binDir, "crabbox"),
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then exit 0; fi',
        `: > ${shellQuote(providerPath)}`,
      ].join("\n"),
    );

    const dispatcher = spawn(
      process.execPath,
      [
        realpathSync(path.join(scriptsDir, "verification-dispatch.mjs")),
        "test:diff",
      ],
      {
        cwd: repoDir,
        env: {
          ...insideWorkspaceArtifactLockEnvironment(process.env),
          HOME: path.join(tempRoot, "home"),
          MURPH_VERIFY_EXECUTOR: "ssh",
          MURPH_VERIFY_SSH_HOST: "worker-mac",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const stderrChunks: Buffer[] = [];
    dispatcher.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    try {
      await waitForFile(captureReadyPath);
      writeFileSync(
        path.join(repoDir, "staged-new.txt"),
        "changed-during-capture\n",
        "utf8",
      );
      writeFileSync(captureReleasePath, "release\n", "utf8");

      expect(await waitForChild(dispatcher)).toEqual({ code: 1, signal: null });
      expect(Buffer.concat(stderrChunks).toString("utf8")).toContain(
        "new path whose current contents were not fully staged",
      );
      expect(existsSync(providerPath)).toBe(false);
    } finally {
      if (!existsSync(captureReleasePath)) {
        writeFileSync(captureReleasePath, "release\n", "utf8");
      }
      if (dispatcher.exitCode === null && dispatcher.signalCode === null) {
        dispatcher.kill("SIGHUP");
      }
      await Promise.allSettled([waitForChild(dispatcher)]);
    }
  });

  it.runIf(process.platform === "darwin")(
    "keeps the static worker busy when transport exits before remote completion",
    async () => {
      const tempRoot = makeTempRoot();
      const repoDir = path.join(tempRoot, "repo");
      const scriptsDir = path.join(repoDir, "scripts");
      const binDir = path.join(tempRoot, "bin");
      const remoteReadyPath = path.join(tempRoot, "remote-ready");
      const remoteReleasePath = path.join(tempRoot, "remote-release");
      const remoteDonePath = path.join(tempRoot, "remote-done");
      const remotePidPath = path.join(tempRoot, "remote-pid");
      const providerStartedPath = path.join(tempRoot, "provider-started");
      const providerCwdPath = path.join(tempRoot, "provider-cwd");
      const remoteLockPath = path.join(tempRoot, "worker.lock");
      const blockedPath = path.join(tempRoot, "retry-blocked");
      const overlapPath = path.join(tempRoot, "overlap");
      const retryPath = path.join(tempRoot, "retry-complete");
      const lockedRemoteCommand = shellQuote(
        'exec 9>"$1"; /usr/bin/lockf -t 0 9; exec slow-remote-verifier',
      );
      mkdirSync(scriptsDir, { recursive: true });
      for (const scriptName of [
        "verification-dispatch.mjs",
        "run-with-workspace-artifact-lock.mjs",
      ]) {
        writeFileSync(
          path.join(scriptsDir, scriptName),
          readFileSync(path.join(repoRoot, "scripts", scriptName), "utf8"),
          "utf8",
        );
      }
      writeExecutable(
        path.join(binDir, "slow-remote-verifier"),
        [
          "#!/bin/sh",
          `: > ${shellQuote(remoteReadyPath)}`,
          `while [ ! -f ${shellQuote(remoteReleasePath)} ]; do sleep 0.05; done`,
          `: > ${shellQuote(remoteDonePath)}`,
        ].join("\n"),
      );
      writeExecutable(
        path.join(binDir, "crabbox"),
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "--version" ]; then exit 0; fi',
          `if [ ! -f ${shellQuote(providerStartedPath)} ]; then`,
          `  : > ${shellQuote(providerStartedPath)}`,
          `  pwd > ${shellQuote(providerCwdPath)}`,
          `  nohup /bin/sh -c ${lockedRemoteCommand} sh ${
            shellQuote(remoteLockPath)
          } >/dev/null 2>&1 &`,
          `  printf "%s\\n" "$!" > ${shellQuote(remotePidPath)}`,
          `  while [ ! -f ${shellQuote(remoteReadyPath)} ]; do sleep 0.05; done`,
          "  exit 255",
          "fi",
          `if [ ! -f ${shellQuote(remoteReleasePath)} ]; then`,
          `  if /usr/bin/lockf -k -t 0 ${shellQuote(remoteLockPath)} sh -c ${
            shellQuote(`: > ${overlapPath}`)
          }; then`,
          "    exit 0",
          "  else",
          "    status=$?",
          "  fi",
          `  : > ${shellQuote(blockedPath)}`,
          "  exit \"$status\"",
          "fi",
          `/usr/bin/lockf -k -t 0 ${shellQuote(remoteLockPath)} sh -c ${
            shellQuote(`: > ${retryPath}`)
          }`,
        ].join("\n"),
      );
      runGit(repoDir, ["init", "--quiet"]);
      runGit(repoDir, ["add", "scripts"]);
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

      const baseEnvironment = {
        ...withoutVerificationRoutingEnvironment(process.env),
        HOME: path.join(tempRoot, "home"),
        MURPH_VERIFY_EXECUTOR: "ssh",
        MURPH_VERIFY_SSH_HOST: "worker-mac",
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      };
      const lockWrapperPath = path.join(
        scriptsDir,
        "run-with-workspace-artifact-lock.mjs",
      );
      const dispatcherPathInRepo = realpathSync(
        path.join(scriptsDir, "verification-dispatch.mjs"),
      );
      const runRemoteDiff = () => spawn(
        process.execPath,
        [
          lockWrapperPath,
          "remote test:diff",
          "--",
          process.execPath,
          dispatcherPathInRepo,
          "test:diff",
          "scripts/verification-dispatch.mjs",
        ],
        {
          cwd: repoDir,
          env: baseEnvironment,
          stdio: "ignore",
        },
      );
      const lockPath = path.join(
        repoDir,
        ".git",
        "murph-locks",
        "workspace-artifacts.lock",
      );
      try {
        const firstRun = runRemoteDiff();
        expect(await waitForChild(firstRun)).toEqual({
          code: 255,
          signal: null,
        });
        const remotePid = Number.parseInt(
          readFileSync(remotePidPath, "utf8").trim(),
          10,
        );
        expect(Number.isInteger(remotePid)).toBe(true);
        expect(isProcessRunning(remotePid)).toBe(true);
        expect(existsSync(lockPath)).toBe(false);
        expect(existsSync(readFileSync(providerCwdPath, "utf8").trim())).toBe(
          false,
        );

        expect((await waitForChild(runRemoteDiff())).code).not.toBe(0);
        expect(existsSync(blockedPath)).toBe(true);
        expect(existsSync(overlapPath)).toBe(false);
        expect(existsSync(retryPath)).toBe(false);
        expect(existsSync(lockPath)).toBe(false);

        writeFileSync(remoteReleasePath, "release\n", "utf8");
        await waitForFile(remoteDonePath);
        await waitForCondition(
          () => !isProcessRunning(remotePid),
          "the remotely locked verifier to exit",
        );

        expect(await waitForChild(runRemoteDiff())).toEqual({
          code: 0,
          signal: null,
        });
        expect(existsSync(retryPath)).toBe(true);
        expect(existsSync(lockPath)).toBe(false);
      } finally {
        if (!existsSync(remoteReleasePath)) {
          writeFileSync(remoteReleasePath, "release\n", "utf8");
        }
        if (existsSync(remotePidPath)) {
          const remotePid = Number.parseInt(
            readFileSync(remotePidPath, "utf8").trim(),
            10,
          );
          await waitForCondition(
            () => !isProcessRunning(remotePid),
            "the test-owned remote verifier to exit",
          );
        }
      }
    },
  );

  it("identifies sensitive files before remote Git-managed sync", () => {
    expect(callDispatcherExport<string[]>(
      "findSensitiveRemoteSyncPaths",
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
      "findUnsafeRemoteWorktreeStates",
      [
        { indexStatus: "C", worktreeStatus: " " },
        { indexStatus: "R", worktreeStatus: "M" },
        { indexStatus: "R", worktreeStatus: "D" },
      ],
    )).toEqual([]);
    expect(callDispatcherExport(
      "findUnsafeRemoteWorktreeStates",
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
            ...insideWorkspaceArtifactLockEnvironment(process.env),
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
          ...insideWorkspaceArtifactLockEnvironment(process.env),
          MURPH_VERIFY_EXECUTOR: "crabbox",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    expect(malformedRenameResult.status).toBe(1);
    expect(malformedRenameResult.stderr).toContain(
      "Unable to parse the remote verification Git status boundary",
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
          ...insideWorkspaceArtifactLockEnvironment(process.env),
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
      expect(callDispatcherExportFailure("assertSafeRemoteSync", repoDir))
        .toContain("unauthorized Git state (untracked=1)");
      rmSync(path.join(repoDir, fileName));
    }

    writeFileSync(path.join(repoDir, "ignored-private.txt"), "private\n", "utf8");
    writeFileSync(path.join(repoDir, "tracked.ts"), "export const value = 2;\n", "utf8");
    writeFileSync(path.join(repoDir, "staged.ts"), "export const staged = true;\n", "utf8");
    runGit(repoDir, ["add", "staged.ts"]);
    expect(callDispatcherVoidExport("assertSafeRemoteSync", repoDir)).toBe("ok");

    writeFileSync(path.join(repoDir, "staged.ts"), "export const staged = 'changed';\n", "utf8");
    expect(callDispatcherExportFailure("assertSafeRemoteSync", repoDir))
      .toContain("staged-addition-changed=1");
    runGit(repoDir, ["add", "staged.ts"]);

    writeFileSync(
      path.join(repoDir, "staged-then-deleted.ts"),
      "export const removed = true;\n",
      "utf8",
    );
    runGit(repoDir, ["add", "staged-then-deleted.ts"]);
    rmSync(path.join(repoDir, "staged-then-deleted.ts"));
    expect(callDispatcherExportFailure("assertSafeRemoteSync", repoDir))
      .toContain("staged-addition-changed=1");
    runGit(repoDir, ["reset", "--quiet", "--", "staged-then-deleted.ts"]);

    writeFileSync(path.join(repoDir, "intent.ts"), "export const intent = true;\n", "utf8");
    runGit(repoDir, ["add", "--intent-to-add", "intent.ts"]);
    expect(callDispatcherExportFailure("assertSafeRemoteSync", repoDir))
      .toContain("intent-to-add=1");
    runGit(repoDir, ["add", "intent.ts"]);

    runGit(repoDir, ["mv", "rename-me.ts", "renamed.ts"]);
    writeFileSync(path.join(repoDir, "renamed.ts"), "export const renamed = 2;\n", "utf8");
    rmSync(path.join(repoDir, "delete-me.ts"));
    runGit(repoDir, ["rm", "--quiet", "staged-delete.ts"]);
    expect(callDispatcherVoidExport("assertSafeRemoteSync", repoDir)).toBe("ok");

    writeFileSync(path.join(repoDir, ".env.production"), "synthetic-test-value\n", "utf8");
    runGit(repoDir, ["add", "--force", ".env.production"]);
    expect(callDispatcherExportFailure("assertSafeRemoteSync", repoDir))
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
    expect(callDispatcherVoidExport("assertSafeRemoteSync", repoDir)).toBe("ok");

    writeFileSync(path.join(repoDir, "copied.ts"), "export const value = 3;\n", "utf8");
    expect(readGitStatus(repoDir)).toContain("CM copied.ts\0source.ts\0");
    expect(callDispatcherExportFailure("assertSafeRemoteSync", repoDir))
      .toContain("staged-addition-changed=1");

    rmSync(path.join(repoDir, "copied.ts"));
    expect(readGitStatus(repoDir)).toContain("CD copied.ts\0source.ts\0");
    expect(callDispatcherExportFailure("assertSafeRemoteSync", repoDir))
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
        isExecutorAvailable: () => process.env.MURPH_TEST_CRABBOX_AVAILABLE === "1",
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
  delete sanitized.MURPH_VERIFY_SSH_HOST;
  delete sanitized.MURPH_WORKSPACE_ARTIFACT_LOCK_HELD;
  return sanitized;
}

function insideWorkspaceArtifactLockEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...withoutVerificationRoutingEnvironment(environment),
    MURPH_WORKSPACE_ARTIFACT_LOCK_HELD: "1",
  };
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
      module.assertSafeRemoteSync(
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

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<void> {
  await waitForCondition(
    () => existsSync(filePath),
    `file ${path.basename(filePath)}`,
    timeoutMs,
  );
}

async function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function waitForChild(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
