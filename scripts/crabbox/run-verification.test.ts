import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
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

const repoRoot = path.resolve(import.meta.dirname, "../..");
const runnerPath = path.join(repoRoot, "scripts", "crabbox", "run-verification.mjs");
const sshRunnerPath = path.join(
  repoRoot,
  "scripts",
  "crabbox",
  "run-ssh-verification.mjs",
);
const dispatcherPath = path.join(
  repoRoot,
  "scripts",
  "verification-dispatch.mjs",
);
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
        MURPH_APP_VITEST_MAX_WORKERS: "99",
        MURPH_CRABBOX_NO_FORWARD: "must-not-reach-verification",
        MURPH_PACKAGE_COVERAGE_CONCURRENCY: "99",
        MURPH_VERIFY_PROFILE: "attacker-controlled",
        MURPH_VERIFY_STEP_PARALLEL: "1",
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
      MURPH_VERIFY_PROFILE: "default",
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
    expect(environment).not.toHaveProperty("MURPH_APP_VITEST_MAX_WORKERS");
    expect(environment).not.toHaveProperty("MURPH_CRABBOX_NO_FORWARD");
    expect(environment).not.toHaveProperty(
      "MURPH_PACKAGE_COVERAGE_CONCURRENCY",
    );
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
        `printf "CI=%s\\nMURPH_CRABBOX_REMOTE=%s\\nMURPH_VERIFY_EXECUTOR=%s\\nMURPH_VERIFY_PROFILE=%s\\nCUSTOM_PROVIDER_TOKEN=%s\\n" "\${CI-unset}" "\${MURPH_CRABBOX_REMOTE-unset}" "\${MURPH_VERIFY_EXECUTOR-unset}" "\${MURPH_VERIFY_PROFILE-unset}" "\${CUSTOM_PROVIDER_TOKEN-unset}" > ${shellQuote(verifierEnvironmentPath)}`,
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
      "CI=unset\nMURPH_CRABBOX_REMOTE=1\nMURPH_VERIFY_EXECUTOR=local\nMURPH_VERIFY_PROFILE=default\nCUSTOM_PROVIDER_TOKEN=unset\n",
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

  it("proves the static archive contract before entering the sanitized verification core", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const environmentPath = path.join(tempRoot, "environment.txt");
    const eventLogPath = path.join(tempRoot, "events.txt");

    writeStaticArchiveCapabilityTools(binDir, { eventLogPath });
    writeExecutable(
      path.join(binDir, "corepack"),
      [
        "#!/bin/sh",
        `printf 'install\\n' >> ${shellQuote(eventLogPath)}`,
      ].join("\n"),
    );
    writeExecutable(
      path.join(binDir, "bash"),
      [
        "#!/bin/sh",
        `printf 'verify\\n' >> ${shellQuote(eventLogPath)}`,
        `printf "CI=%s\\nMURPH_CRABBOX_REMOTE=%s\\nMURPH_VERIFY_EXECUTOR=%s\\nMURPH_VERIFY_PROFILE=%s\\nMURPH_PACKAGE_COVERAGE_CONCURRENCY=%s\\nOPENAI_API_KEY=%s\\n" "\${CI-unset}" "\${MURPH_CRABBOX_REMOTE-unset}" "\${MURPH_VERIFY_EXECUTOR-unset}" "\${MURPH_VERIFY_PROFILE-unset}" "\${MURPH_PACKAGE_COVERAGE_CONCURRENCY-unset}" "\${OPENAI_API_KEY-unset}" > ${shellQuote(environmentPath)}`,
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [sshRunnerPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          HOME: path.join(tempRoot, "home"),
          MURPH_PACKAGE_COVERAGE_CONCURRENCY: "99",
          MURPH_VERIFY_PROFILE: "default",
          OPENAI_API_KEY: "must-not-reach-verification",
          PATH: binDir,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      "readiness=tar-zstd-round-trip profile=static-ssh",
    );
    expect(readFileSync(eventLogPath, "utf8")).toBe(
      "tar:--format=pax --no-recursion --null -T /dev/null -cvvf -\n" +
        "zstd:-3 --no-progress -T2\n" +
        "zstd:-d --stdout\n" +
        "tar:-tf -\n" +
        "install\n" +
        "verify\n",
    );
    expect(readFileSync(environmentPath, "utf8")).toBe(
      "CI=unset\nMURPH_CRABBOX_REMOTE=1\nMURPH_VERIFY_EXECUTOR=local\nMURPH_VERIFY_PROFILE=static-ssh\nMURPH_PACKAGE_COVERAGE_CONCURRENCY=unset\nOPENAI_API_KEY=unset\n",
    );
  });

  it("fails closed on an absent static tar before installation", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const childMarkerPath = path.join(tempRoot, "candidate-command-started");
    const eventLogPath = path.join(tempRoot, "events.txt");

    writeStaticArchiveCapabilityTools(binDir, {
      eventLogPath,
      tarMode: "absent",
    });
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
      [sshRunnerPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          HOME: path.join(tempRoot, "home"),
          PATH: binDir,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "tar is unavailable on the non-interactive PATH",
    );
    expect(existsSync(eventLogPath)).toBe(false);
    expect(existsSync(childMarkerPath)).toBe(false);
  });

  it("fails closed on an absent static zstd before Git inspection or installation", () => {
    const tempRoot = makeTempRoot();
    const { runDirectory, workspaceRoot } =
      createStaticRunnerWorkspace(tempRoot);
    const binDir = path.join(tempRoot, "bin");
    const childMarkerPath = path.join(tempRoot, "candidate-command-started");
    const eventLogPath = path.join(tempRoot, "events.txt");

    writeStaticArchiveCapabilityTools(binDir, {
      eventLogPath,
      zstdMode: "absent",
    });
    for (const command of ["corepack", "bash", "git"]) {
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
      [
        path.join(
          workspaceRoot,
          "scripts",
          "crabbox",
          "run-ssh-verification.mjs",
        ),
        "--cleanup-static-workspace",
        "verify:acceptance",
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: {
          HOME: path.join(tempRoot, "home"),
          PATH: binDir,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "zstd is unavailable on the non-interactive PATH",
    );
    expect(result.stderr).not.toContain("Git snapshot");
    expect(readFileSync(eventLogPath, "utf8")).toBe(
      "tar:--format=pax --no-recursion --null -T /dev/null -cvvf -\n",
    );
    expect(existsSync(childMarkerPath)).toBe(false);
    expect(existsSync(runDirectory)).toBe(false);
  });

  it("fails closed when static zstd does not emit a zstd frame", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const childMarkerPath = path.join(tempRoot, "candidate-command-started");
    const eventLogPath = path.join(tempRoot, "events.txt");

    writeStaticArchiveCapabilityTools(binDir, {
      eventLogPath,
      zstdMode: "passthrough",
    });
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
      [sshRunnerPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          HOME: path.join(tempRoot, "home"),
          PATH: binDir,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "zstd compression did not produce a standard zstd frame",
    );
    expect(readFileSync(eventLogPath, "utf8")).toBe(
      "tar:--format=pax --no-recursion --null -T /dev/null -cvvf -\n" +
        "zstd:-3 --no-progress -T2\n",
    );
    expect(existsSync(childMarkerPath)).toBe(false);
  });

  it("fails closed on incompatible static zstd arguments before installation", () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const childMarkerPath = path.join(tempRoot, "candidate-command-started");
    const eventLogPath = path.join(tempRoot, "events.txt");

    writeStaticArchiveCapabilityTools(binDir, {
      eventLogPath,
      zstdMode: "incompatible",
    });
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
      [sshRunnerPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          HOME: path.join(tempRoot, "home"),
          PATH: binDir,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "zstd could not compress stdin with Murph's snapshot arguments (-3 --no-progress -T2) (exit 17)",
    );
    expect(result.stderr).not.toContain("worker-local-detail");
    expect(readFileSync(eventLogPath, "utf8")).toBe(
      "tar:--format=pax --no-recursion --null -T /dev/null -cvvf -\n" +
        "zstd:-3 --no-progress -T2\n",
    );
    expect(existsSync(childMarkerPath)).toBe(false);
  });

  it("cleans only an exact opaque static SSH run workspace", () => {
    const tempRoot = makeTempRoot();
    const workerRoot = path.join(tempRoot, "murph-crabbox");
    const runRoot = path.join(workerRoot, "runs");
    const runDirectory = path.join(
      runRoot,
      "0123456789abcdef-fedcba9876543210",
    );
    const workspaceRoot = path.join(
      runDirectory,
      "static_murph_0123456789abcdef",
      "murph",
    );
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(path.join(workspaceRoot, "candidate.txt"), "candidate\n");

    expect(callSshModule(
      "parseSshVerificationRequest",
      ["--cleanup-static-workspace", "test:diff", "scripts"],
    )).toEqual({
      cleanupOnly: false,
      cleanupWorkspace: true,
      verificationArgs: ["test:diff", "scripts"],
    });
    expect(callSshModule(
      "parseSshVerificationRequest",
      ["--cleanup-static-workspace-only"],
    )).toEqual({
      cleanupOnly: true,
      cleanupWorkspace: true,
      verificationArgs: [],
    });
    expect(callSshModule(
      "cleanupStaticWorkspace",
      { runRoot, workspaceRoot },
    )).toBeNull();
    expect(existsSync(runDirectory)).toBe(false);
    expect(existsSync(workspaceRoot)).toBe(false);

    expect(callSshModuleFailure(
      "assertSafeStaticWorkspace",
      { runRoot, workspaceRoot: runRoot },
    )).toContain("exact opaque nested run directory");
  });

  it("reconstructs the exact detached base and staged candidate after Crabbox excludes .git", () => {
    const tempRoot = makeTempRoot();
    const sourceRoot = path.join(tempRoot, "source");
    const remoteRoot = path.join(tempRoot, "remote");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(path.join(sourceRoot, ".gitignore"), "ignored.txt\n");
    writeFileSync(path.join(sourceRoot, "changed.txt"), "base\n");
    writeFileSync(path.join(sourceRoot, "deleted.txt"), "delete\n");
    writeFileSync(path.join(sourceRoot, "ignored.txt"), "tracked ignored\n");
    runGit(sourceRoot, ["init", "--quiet"]);
    runGit(sourceRoot, [
      "add",
      "--force",
      ".gitignore",
      "changed.txt",
      "deleted.txt",
      "ignored.txt",
    ]);
    runGit(sourceRoot, [
      "-c",
      "user.name=Crabbox Test",
      "-c",
      "user.email=crabbox-test@users.noreply.github.com",
      "commit",
      "--quiet",
      "-m",
      "base",
    ]);
    const baseTree = readGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]);

    writeFileSync(path.join(sourceRoot, "changed.txt"), "candidate\n");
    rmSync(path.join(sourceRoot, "deleted.txt"));
    writeFileSync(path.join(sourceRoot, "added.txt"), "added\n");
    runGit(sourceRoot, ["add", "--all", "--force"]);
    const candidateTree = readGit(sourceRoot, ["write-tree"]);

    expect(callModule(
      "writeStaticGitSnapshotMetadata",
      { baseTree, candidateTree, snapshotRoot: sourceRoot },
      dispatcherPath,
    )).toBeNull();
    cpSync(sourceRoot, remoteRoot, {
      filter: (source) => path.basename(source) !== ".git",
      recursive: true,
    });

    expect(callSshModule(
      "restoreStaticGitSnapshot",
      { workspaceRoot: remoteRoot },
    )).toBeNull();
    expect(readGit(remoteRoot, ["rev-parse", "HEAD^{tree}"])).toBe(baseTree);
    expect(readGit(remoteRoot, ["write-tree"])).toBe(candidateTree);
    expect(readGit(remoteRoot, ["diff", "--cached", "--name-only"]).split("\n"))
      .toEqual(["added.txt", "changed.txt", "deleted.txt"]);
    expect(readGit(remoteRoot, ["status", "--porcelain"]).split("\n"))
      .toEqual([
        "A  added.txt",
        "M  changed.txt",
        "D  deleted.txt",
      ]);
    expect(existsSync(path.join(
      remoteRoot,
      ".git",
      "murph-static-snapshot",
    ))).toBe(false);
  });

  it.runIf(process.platform === "darwin")(
    "preserves verifier failure through the production lock wrapper and exact cleanup",
    () => {
      const tempRoot = makeTempRoot();
      const workerRoot = path.join(tempRoot, "murph-crabbox");
      const runDirectory = path.join(
        workerRoot,
        "runs",
        "0123456789abcdef-fedcba9876543210",
      );
      const workspaceRoot = path.join(
        runDirectory,
        "static_murph_0123456789abcdef",
        "murph",
      );
      const workspaceScriptDir = path.join(
        workspaceRoot,
        "scripts",
        "crabbox",
      );
      const binDir = path.join(tempRoot, "bin");
      writeStaticArchiveCapabilityTools(binDir);
      mkdirSync(workspaceScriptDir, { recursive: true });
      for (const scriptName of [
        "run-ssh-locked-verification.sh",
        "run-ssh-verification.mjs",
        "run-verification.mjs",
      ]) {
        writeFileSync(
          path.join(workspaceScriptDir, scriptName),
          readFileSync(
            path.join(repoRoot, "scripts", "crabbox", scriptName),
            "utf8",
          ),
          "utf8",
        );
      }
      runGit(workspaceRoot, ["init", "--quiet"]);
      runGit(workspaceRoot, ["add", "--all", "--force"]);
      runGit(workspaceRoot, [
        "-c",
        "user.name=Crabbox Test",
        "-c",
        "user.email=crabbox-test@users.noreply.github.com",
        "commit",
        "--quiet",
        "-m",
        "base",
      ]);
      const baseTree = readGit(workspaceRoot, ["rev-parse", "HEAD^{tree}"]);
      expect(callModule(
        "writeStaticGitSnapshotMetadata",
        {
          baseTree,
          candidateTree: baseTree,
          snapshotRoot: workspaceRoot,
        },
        dispatcherPath,
      )).toBeNull();
      rmSync(path.join(workspaceRoot, ".git"), {
        force: true,
        recursive: true,
      });
      writeExecutable(path.join(binDir, "corepack"), "#!/bin/sh\nexit 37");

      const result = spawnSync(
        "/bin/sh",
        [
          "scripts/crabbox/run-ssh-locked-verification.sh",
          "test:diff",
        ],
        {
          cwd: workspaceRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: path.join(tempRoot, "home"),
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(result.status, result.stderr).toBe(37);
      expect(existsSync(runDirectory)).toBe(false);
      expect(existsSync(workspaceRoot)).toBe(false);
      const releasedLock = spawnSync(
        "/usr/bin/lockf",
        [
          "-t",
          "0",
          path.join(workerRoot, "verification.lock"),
          "/usr/bin/true",
        ],
      );
      expect(releasedLock.status).toBe(0);
    },
  );

  it("retains SSH entrypoint ownership until its verifier group exits on SIGHUP", async () => {
    const tempRoot = makeTempRoot();
    const binDir = path.join(tempRoot, "bin");
    const childReadyPath = path.join(tempRoot, "child-ready");
    const childHupPath = path.join(tempRoot, "child-hup");
    const childPidPath = path.join(tempRoot, "child-pid");
    const descendantHupPath = path.join(tempRoot, "descendant-hup");
    const descendantPidPath = path.join(tempRoot, "descendant-pid");
    writeStaticArchiveCapabilityTools(binDir);
    writeExecutable(
      path.join(binDir, "slow-verifier-child"),
      [
        "#!/bin/sh",
        `printf "%s\\n" "$$" > ${shellQuote(descendantPidPath)}`,
        `trap ': > ${shellQuote(descendantHupPath)}; sleep 0.25; exit 129' HUP`,
        `: > ${shellQuote(childReadyPath)}`,
        "while :; do sleep 0.05; done",
      ].join("\n"),
    );
    writeExecutable(
      path.join(binDir, "corepack"),
      [
        "#!/bin/sh",
        `printf "%s\\n" "$$" > ${shellQuote(childPidPath)}`,
        `trap ': > ${shellQuote(childHupPath)}; exit 129' HUP`,
        "slow-verifier-child &",
        "wait",
      ].join("\n"),
    );
    writeExecutable(path.join(binDir, "bash"), "#!/bin/sh\nexit 0");

    const runner = spawn(
      process.execPath,
      [sshRunnerPath, "verify:acceptance"],
      {
        cwd: repoRoot,
        env: {
          HOME: path.join(tempRoot, "home"),
          PATH: `${binDir}${path.delimiter}/usr/bin:/bin`,
        },
        stdio: "ignore",
      },
    );
    try {
      await waitForFile(childReadyPath);
      const childPid = Number.parseInt(
        readFileSync(childPidPath, "utf8").trim(),
        10,
      );
      const descendantPid = Number.parseInt(
        readFileSync(descendantPidPath, "utf8").trim(),
        10,
      );
      expect(Number.isInteger(childPid)).toBe(true);
      expect(Number.isInteger(descendantPid)).toBe(true);
      runner.kill("SIGHUP");

      await waitForFile(childHupPath);
      expect(runner.exitCode).toBeNull();
      expect(await waitForChild(runner)).toEqual({ code: 129, signal: null });
      await waitForCondition(
        () => !isProcessRunning(childPid),
        "the SSH verifier child to exit",
      );
      await waitForCondition(
        () => !isProcessRunning(descendantPid),
        "the SSH verifier descendant to exit",
      );
      expect(existsSync(childHupPath)).toBe(true);
      expect(existsSync(descendantHupPath)).toBe(true);
    } finally {
      if (runner.exitCode === null && runner.signalCode === null) {
        runner.kill("SIGHUP");
      }
      await Promise.allSettled([waitForChild(runner)]);
    }
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

function createStaticRunnerWorkspace(tempRoot: string): {
  runDirectory: string;
  workspaceRoot: string;
} {
  const runDirectory = path.join(
    tempRoot,
    "murph-crabbox",
    "runs",
    "0123456789abcdef-fedcba9876543210",
  );
  const workspaceRoot = path.join(
    runDirectory,
    "static_murph_0123456789abcdef",
    "murph",
  );
  const workspaceScriptDir = path.join(
    workspaceRoot,
    "scripts",
    "crabbox",
  );
  mkdirSync(workspaceScriptDir, { recursive: true });
  for (const scriptName of [
    "run-ssh-verification.mjs",
    "run-verification.mjs",
  ]) {
    cpSync(
      path.join(repoRoot, "scripts", "crabbox", scriptName),
      path.join(workspaceScriptDir, scriptName),
    );
  }
  return { runDirectory, workspaceRoot: realpathSync(workspaceRoot) };
}

function writeStaticArchiveCapabilityTools(
  binDir: string,
  options: {
    eventLogPath?: string;
    tarMode?: "absent" | "success";
    zstdMode?: "absent" | "incompatible" | "passthrough" | "success";
  } = {},
): void {
  const eventLogPath = options.eventLogPath;
  const logTar = eventLogPath
    ? `printf 'tar:%s\\n' "$*" >> ${shellQuote(eventLogPath)}`
    : ":";
  const logZstd = eventLogPath
    ? `printf 'zstd:%s\\n' "$*" >> ${shellQuote(eventLogPath)}`
    : ":";

  if (options.tarMode !== "absent") {
    writeExecutable(
      path.join(binDir, "tar"),
      [
        "#!/bin/sh",
        logTar,
        "case \"$*\" in",
        "  \"--format=pax --no-recursion --null -T /dev/null -cvvf -\") printf 'murph-static-tar-probe' ;;",
        '  "-tf -") /bin/cat >/dev/null ;;',
        "  *) exit 91 ;;",
        "esac",
      ].join("\n"),
    );
  }
  if (options.zstdMode === "absent") {
    return;
  }

  const zstdBehavior = options.zstdMode === "passthrough"
    ? [
        "case \"$*\" in",
        '  "-3 --no-progress -T2") /bin/cat ;;',
        "  *) exit 92 ;;",
        "esac",
      ]
    : [
        "case \"$*\" in",
        "  \"-3 --no-progress -T2\") printf '\\050\\265\\057\\375'; /bin/cat ;;",
        '  "-d --stdout") /usr/bin/tail -c +5 ;;',
        "  *) exit 92 ;;",
        "esac",
      ];
  writeExecutable(
    path.join(binDir, "zstd"),
    [
      "#!/bin/sh",
      logZstd,
      ...(options.zstdMode === "incompatible"
        ? ["printf 'worker-local-detail\n' >&2", "exit 17"]
        : []),
      ...zstdBehavior,
    ].join("\n"),
  );
}

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

function runGit(repoDir: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

function readGit(repoDir: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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

function callModule<T>(
  exportName: string,
  argument: unknown,
  modulePath = runnerPath,
): T {
  const result = runModuleCall(exportName, argument, modulePath);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}

function callModuleFailure(exportName: string, argument: unknown): string {
  const result = runModuleCall(exportName, argument);
  expect(result.status).toBe(2);
  return result.stderr;
}

function callSshModule<T>(exportName: string, argument: unknown): T {
  const result = runModuleCall(exportName, argument, sshRunnerPath);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}

function callSshModuleFailure(exportName: string, argument: unknown): string {
  const result = runModuleCall(exportName, argument, sshRunnerPath);
  expect(result.status).toBe(2);
  return result.stderr;
}

function runModuleCall(
  exportName: string,
  argument: unknown,
  modulePath = runnerPath,
): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  const moduleUrl = pathToFileURL(modulePath).href;
  const source = `
    const module = await import(${JSON.stringify(moduleUrl)});
    try {
      const result = module[process.env.MURPH_TEST_EXPORT](
        JSON.parse(process.env.MURPH_TEST_ARGUMENT_JSON),
      );
      process.stdout.write(JSON.stringify(result ?? null));
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
