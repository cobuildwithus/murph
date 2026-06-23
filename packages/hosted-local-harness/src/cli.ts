import process from "node:process";
import os from "node:os";
import { pathToFileURL } from "node:url";

import type { HostedLocalDevConfig } from "./dev-hosted-local/types.ts";
import type { HostedLocalDevStack } from "./dev-hosted-local/stack.ts";
import {
  listHostedLocalE2eScenarios,
  resolveHostedLocalE2eScenarios,
  runHostedLocalE2eSuite,
} from "./e2e.ts";
import { listHostedLocalProfiles, applyHostedLocalProfile } from "./profiles.ts";
import { runDoctorCommand, runForegroundCommand } from "./process.ts";
import {
  applyHostedLocalStateEnv,
  createHostedLocalHarnessState,
  updateHostedLocalHarnessState,
} from "./state.ts";
import { hostedLocalHarnessRepoRoot } from "./repo.ts";

interface HostedLocalCliIo {
  env?: NodeJS.ProcessEnv;
  stderr?: NodeJS.WritableStream;
  stdout?: NodeJS.WritableStream;
}

type ParsedProfileArgs = {
  args: string[];
  profileName: string | null;
};

export async function runHostedLocalCli(
  argv: readonly string[] = process.argv.slice(2),
  io: HostedLocalCliIo = {},
): Promise<void> {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp(io.stdout ?? process.stdout);
    return;
  }

  switch (command) {
    case "profiles":
      printProfiles(io.stdout ?? process.stdout);
      return;
    case "doctor":
      await runDoctor(args, io);
      return;
    case "up":
      await runUp(args, io);
      return;
    case "worktree":
      await runWorktree(args, io);
      return;
    case "run":
      await runCommand(args, io);
      return;
    case "e2e":
      await runE2e(args, io);
      return;
    default:
      throw new Error(`Unknown hosted-local command: ${command}`);
  }
}

async function runWorktree(args: readonly string[], io: HostedLocalCliIo): Promise<void> {
  const [subcommand, slug, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    printWorktreeHelp(io.stdout ?? process.stdout);
    return;
  }
  if (!slug || slug === "--help" || slug === "-h") {
    printWorktreeHelp(io.stdout ?? process.stdout);
    return;
  }

  if (subcommand === "down") {
    throw new Error(
      [
        "hosted-local worktree down is disabled until worktree up records process ownership.",
        "Stop the foreground `hosted-local worktree up` process directly.",
      ].join(" "),
    );
  }

  const {
    ensureHostedLocalWorktreeDatabase,
    formatHostedLocalWorktreeEnv,
    removeCreatedHostedLocalWorktreeDatabaseIfUnpaired,
    resolveHostedLocalWorktreeConfig,
    writeHostedLocalWorktreeManifest,
  } = await import("./dev-hosted-local/worktree.ts");

  switch (subcommand) {
    case "env": {
      const config = await resolveHostedLocalWorktreeConfig({
        env: io.env ?? process.env,
        slug,
      });
      (io.stdout ?? process.stdout).write(formatHostedLocalWorktreeEnv(config));
      return;
    }
    case "doctor": {
      const config = await resolveHostedLocalWorktreeConfig({
        env: io.env ?? process.env,
        slug,
      });
      await writeHostedLocalWorktreeManifest(config);
      await runDoctor(["--profile", "worktree", ...rest], {
        ...io,
        env: config.env,
      });
      return;
    }
    case "up": {
      const config = await resolveHostedLocalWorktreeConfig({
        env: io.env ?? process.env,
        slug,
      });
      await writeHostedLocalWorktreeManifest(config);
      const databaseState = await ensureHostedLocalWorktreeDatabase(config);
      try {
        await runUp(["--profile", "worktree"], {
          ...io,
          env: config.env,
        });
      } finally {
        if (databaseState.created) {
          const cleanup = await removeCreatedHostedLocalWorktreeDatabaseIfUnpaired(
            config,
          );
          if (cleanup.unpaired && !cleanup.removed) {
            (io.stderr ?? process.stderr).write(
              `Warning: newly created worktree database ${config.databaseName} was left in place; drop it manually before retrying if startup failed before crypto state was written.\n`,
            );
          }
        }
      }
      return;
    }
    default:
      throw new Error(`Unknown hosted-local worktree command: ${subcommand}`);
  }
}

async function runUp(args: readonly string[], io: HostedLocalCliIo): Promise<void> {
  const parsed = parseProfileArgs(args, "dev");
  if (parsed.args.some((arg) => arg === "--help" || arg === "-h")) {
    printUpHelp(io.stdout ?? process.stdout);
    return;
  }
  const { startHostedLocalDevStack } = await import("./dev-hosted-local/stack.ts");

  const profiled = applyHostedLocalProfile({
    env: io.env ?? process.env,
    profileName: parsed.profileName,
  });
  let state = await createHostedLocalHarnessState({
    command: ["hosted-local", "up", ...args],
    env: profiled.env,
    profile: profiled.profile,
    status: "starting",
  });
  const runtimeEnv = applyHostedLocalStateEnv({ env: profiled.env, state });

  let stack: HostedLocalDevStack | null = null;
  let startupPromise: Promise<HostedLocalDevStack> | null = null;
  const startupAbort = new AbortController();
  let terminationSignal: NodeJS.Signals | null = null;
  let stopPromise: Promise<void> | null = null;
  let resolveTerminationCleanup: (() => void) | null = null;
  const terminationCleanupComplete = new Promise<void>((resolve) => {
    resolveTerminationCleanup = resolve;
  });
  let terminationCleanupError: unknown = null;
  let stateUpdateTail: Promise<void> = Promise.resolve();

  const updateState = async (
    patch: Parameters<typeof updateHostedLocalHarnessState>[1],
  ): Promise<void> => {
    const update = stateUpdateTail.then(async () => {
      state = await updateHostedLocalHarnessState(state, patch);
    });
    stateUpdateTail = update.then(() => {}, () => {});
    await update;
  };
  await updateState({
    webBaseUrl: state.webBaseUrl,
    workerBaseUrl: state.workerBaseUrl,
    status: "starting",
  });

  const stopStack = (signal: NodeJS.Signals): Promise<void> => {
    stopPromise ??= stack === null
      ? stopStartup(signal)
      : stack.stop(signal);
    return stopPromise;
  };
  const stopStartup = async (signal: NodeJS.Signals): Promise<void> => {
    startupAbort.abort();
    if (startupPromise === null) {
      return;
    }

    try {
      const startedStack = await startupPromise;
      stack = startedStack;
      startedStack.kill(signal);
      await startedStack.stop(signal);
    } catch (error) {
      if (!terminationSignal) {
        throw error;
      }
    }
  };

  const awaitTerminationCleanup = async (): Promise<void> => {
    await terminationCleanupComplete;
    if (terminationCleanupError !== null) {
      throw terminationCleanupError;
    }
  };

  const handleTerminationSignal = async (signal: NodeJS.Signals): Promise<void> => {
    if (terminationSignal) {
      if (stack !== null) {
        stack.kill("SIGKILL");
      }
      return;
    }
    terminationSignal = signal;
    startupAbort.abort();
    if (stack !== null) {
      stack.kill(signal);
    }
    (io.stderr ?? process.stderr).write(`\nStopping hosted-local harness (${signal}).\n`);
    try {
      await stopStack(signal);
      await updateState({ status: "stopped" });
    } catch (error) {
      terminationCleanupError = error;
    } finally {
      resolveTerminationCleanup?.();
    }
  };

  const onSigint = (): void => {
    void handleTerminationSignal("SIGINT");
  };
  const onSigterm = (): void => {
    void handleTerminationSignal("SIGTERM");
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  const onExit = (): void => {
    if (stack === null) {
      startupAbort.abort();
      return;
    }
    stack.kill("SIGKILL");
  };
  process.once("exit", onExit);

  try {
    try {
      if (terminationSignal) {
        await awaitTerminationCleanup();
        return;
      }
      startupPromise = startHostedLocalDevStack({
        abortSignal: startupAbort.signal,
        env: runtimeEnv,
        stderrTarget: io.stderr,
        stdoutTarget: io.stdout,
      });
      stack = await startupPromise;
    } catch (error) {
      if (terminationSignal) {
        await awaitTerminationCleanup();
        return;
      }
      await updateState({ status: "failed" });
      throw error;
    }
    if (terminationSignal) {
      await awaitTerminationCleanup();
      return;
    }

    try {
      await stack.ready;
    } catch (error) {
      if (terminationSignal) {
        await awaitTerminationCleanup();
        return;
      }
      await updateState({ status: "failed" });
      throw error;
    }
    if (terminationSignal) {
      await awaitTerminationCleanup();
      return;
    }

    await updateState({
      status: "ready",
      webBaseUrl: stack.webBaseUrl,
      workerBaseUrl: stack.workerBaseUrl,
    });
    if (terminationSignal) {
      await awaitTerminationCleanup();
      return;
    }
    printReady(stack, state.statePath, io.stdout ?? process.stdout);
    emitReadyToken(runtimeEnv.MURPH_DEV_READY_TOKEN);

    const result = await Promise.race([
      stack.waitForExit().then((exited) => ({ exited, type: "child-exit" as const })),
      awaitTerminationCleanup().then(() => ({ type: "termination-cleanup" as const })),
    ]);

    if (result.type === "termination-cleanup") {
      return;
    }

    const { exited } = result;
    await stopStack("SIGTERM");
    await updateState({
      status: exited.child.exitCode === 0 ? "complete" : "failed",
    });
    if (terminationSignal) {
      await awaitTerminationCleanup();
      return;
    }
    if (exited.child.exitCode === 0) {
      return;
    }
    throw new Error(`${exited.name} exited with code ${exited.child.exitCode ?? "unknown"}.`);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("exit", onExit);
  }
}

async function runE2e(args: readonly string[], io: HostedLocalCliIo): Promise<void> {
  const parsed = parseProfileArgs(args, "e2e:stub");
  let prepareRunnerBundle = true;
  let listOnly = false;
  const positional: string[] = [];
  for (const arg of parsed.args) {
    if (arg === "--no-bundle") {
      prepareRunnerBundle = false;
      continue;
    }
    if (arg === "--list") {
      listOnly = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printE2eHelp(io.stdout ?? process.stdout);
      return;
    }
    positional.push(arg);
  }
  if (listOnly) {
    printE2eScenarios(io.stdout ?? process.stdout);
    return;
  }
  const scenario = positional[0] ?? "all";
  const scenarios = resolveHostedLocalE2eScenarios(scenario);
  const profiled = applyHostedLocalProfile({
    env: io.env ?? process.env,
    profileName: parsed.profileName,
  });
  let state = await createHostedLocalHarnessState({
    command: ["hosted-local", "e2e", ...args],
    env: profiled.env,
    profile: profiled.profile,
    runIdSuffix: scenario,
    status: "running",
  });
  const env = applyHostedLocalStateEnv({ env: profiled.env, state });
  try {
    const result = await runHostedLocalE2eSuite({
      env,
      prepareRunnerBundle,
      scenario,
    });
    if (result.terminationSignal) {
      state = await updateHostedLocalHarnessState(state, { status: "stopped" });
      (io.stdout ?? process.stdout).write(
        `Hosted-local E2E stopped (${result.terminationSignal}): ${state.statePath}\n`,
      );
      return;
    }
    state = await updateHostedLocalHarnessState(state, { status: "complete" });
    (io.stdout ?? process.stdout).write(`Hosted-local E2E complete: ${state.statePath}\n`);
  } catch (error) {
    await updateHostedLocalHarnessState(state, { status: "failed" });
    throw error;
  }

  void scenarios;
}

async function runCommand(args: readonly string[], io: HostedLocalCliIo): Promise<void> {
  const separatorIndex = args.indexOf("--");
  const parentArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const parsed = parseProfileArgs(parentArgs, "dev");
  const commandArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : parsed.args;
  if (commandArgs.length === 0 || parsed.args.some((arg) => arg === "--help" || arg === "-h")) {
    printRunHelp(io.stdout ?? process.stdout);
    return;
  }
  const [command, ...commandRest] = commandArgs;
  const profiled = applyHostedLocalProfile({
    env: io.env ?? process.env,
    profileName: parsed.profileName,
  });
  let state = await createHostedLocalHarnessState({
    command: ["hosted-local", "run", ...args],
    env: profiled.env,
    profile: profiled.profile,
    runIdSuffix: command,
    status: "running",
  });
  const env = applyHostedLocalStateEnv({ env: profiled.env, state });
  try {
    await runForegroundCommand({
      args: commandRest,
      command: command ?? "",
      cwd: hostedLocalHarnessRepoRoot,
      env,
      label: `hosted-local run ${command}`,
    });
    state = await updateHostedLocalHarnessState(state, { status: "complete" });
    (io.stdout ?? process.stdout).write(`Hosted-local command complete: ${state.statePath}\n`);
  } catch (error) {
    await updateHostedLocalHarnessState(state, { status: "failed" });
    throw error;
  }
}

async function runDoctor(args: readonly string[], io: HostedLocalCliIo): Promise<void> {
  const parsed = parseProfileArgs(args, "dev");
  const json = parsed.args.includes("--json");
  if (parsed.args.some((arg) => arg === "--help" || arg === "-h")) {
    printDoctorHelp(io.stdout ?? process.stdout);
    return;
  }
  const { resolveHostedLocalDevConfig } = await import(
    "./dev-hosted-local/config.ts"
  );
  const profiled = applyHostedLocalProfile({
    env: io.env ?? process.env,
    profileName: parsed.profileName,
  });
  const config = resolveHostedLocalDevConfig(profiled.env);
  const commands = [
    runDoctorCommand("node", ["--version"]),
    runDoctorCommand("pnpm", ["--version"]),
    runDoctorCommand("docker", ["info"]),
    runDoctorCommand("createdb", ["--version"]),
  ];
  const result = {
    commands: commands.map(redactHostedLocalDoctorCommandResult),
    config: redactHostedLocalDoctorConfig(config),
    profile: profiled.profile,
  };
  if (json) {
    (io.stdout ?? process.stdout).write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const stdout = io.stdout ?? process.stdout;
  stdout.write(`Hosted-local profile: ${profiled.profile.name}\n`);
  stdout.write(`  ${profiled.profile.description}\n`);
  stdout.write(`Web: ${config.skipWeb ? "disabled" : `http://${config.webHost}:${config.webPort}`}\n`);
  stdout.write(`Worker: ${config.workerProtocol}://${config.workerHost}:${config.workerPort}\n`);
  stdout.write("\nPrerequisites:\n");
  for (const command of commands) {
    stdout.write(`  ${command.ok ? "[ok]" : "[fail]"} ${command.command}\n`);
    if (!command.ok && command.stderr.trim()) {
      stdout.write(`    ${redactHostedLocalDiagnosticText(command.stderr).split(/\r?\n/u)[0]}\n`);
    }
  }
}

function redactHostedLocalDoctorConfig(
  config: HostedLocalDevConfig,
): HostedLocalDevConfig {
  return {
    ...config,
    databaseUrlOverride: config.databaseUrlOverride ? "[redacted]" : null,
    workerPersistDir: config.workerPersistDir.startsWith("/")
      ? "<configured-path>"
      : config.workerPersistDir,
  };
}

function redactHostedLocalDoctorCommandResult(
  command: ReturnType<typeof runDoctorCommand>,
): ReturnType<typeof runDoctorCommand> {
  return {
    ...command,
    stderr: redactHostedLocalDiagnosticText(command.stderr),
    stdout: redactHostedLocalDiagnosticText(command.stdout),
  };
}

function redactHostedLocalDiagnosticText(value: string): string {
  return value
    .split(hostedLocalHarnessRepoRoot).join("<REPO_ROOT>")
    .split(os.homedir()).join("<HOME_DIR>")
    .slice(0, 2_000);
}

function parseProfileArgs(
  args: readonly string[],
  defaultProfileName: string,
): ParsedProfileArgs {
  const rest: string[] = [];
  let profileName: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--profile") {
      profileName = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      profileName = arg.slice("--profile=".length);
      continue;
    }
    rest.push(arg);
  }
  return { args: rest, profileName: profileName ?? defaultProfileName };
}

function printReady(
  stack: HostedLocalDevStack,
  statePath: string,
  stdout: NodeJS.WritableStream,
): void {
  stdout.write(
    [
      "",
      "Hosted-local harness is ready.",
      ...(stack.webBaseUrl ? [`web: ${stack.webBaseUrl}`] : []),
      ...(stack.linqWebhookTargetUrl ? [`linq webhook: ${stack.linqWebhookTargetUrl}`] : []),
      `worker: ${stack.workerBaseUrl}`,
      `state: ${statePath}`,
      "",
    ].join("\n"),
  );
}

function emitReadyToken(token: string | undefined): void {
  const normalized = token?.trim();
  if (!normalized) {
    return;
  }
  process.stdout.write(`__MURPH_HOSTED_LOCAL_READY__ ${normalized}\n`);
}

function printHelp(stdout: NodeJS.WritableStream): void {
  stdout.write(
    [
      "Run the local hosted Murph harness.",
      "",
      "Usage:",
      "  hosted-local up [--profile dev]",
      "  hosted-local worktree up <slug>",
      "  hosted-local worktree doctor <slug> [--json]",
      "  hosted-local worktree env <slug>",
      "  hosted-local e2e [scenario] [--profile e2e:stub] [--list]",
      "  hosted-local run [--profile dev] -- <command> [args...]",
      "  hosted-local doctor [--profile dev] [--json]",
      "  hosted-local profiles",
      "",
      "Compatibility:",
      "  pnpm dev is a shortcut for pnpm hosted-local up.",
      "  scripts/dev-hosted-local.ts remains a compatibility wrapper.",
      "",
    ].join("\n"),
  );
}

function printProfiles(stdout: NodeJS.WritableStream): void {
  for (const profile of listHostedLocalProfiles()) {
    stdout.write(`${profile.name}\n  ${profile.description}\n`);
  }
}

function printUpHelp(stdout: NodeJS.WritableStream): void {
  stdout.write("Usage: hosted-local up [--profile dev|worker-only]\n");
}

function printWorktreeHelp(stdout: NodeJS.WritableStream): void {
  stdout.write(
    [
      "Usage:",
      "  hosted-local worktree up <slug>",
      "  hosted-local worktree doctor <slug> [--json]",
      "  hosted-local worktree env <slug>",
      "",
      "Stop the foreground worktree process directly; out-of-band down is disabled until process ownership is recorded.",
      "",
      "Slugs must use lowercase letters, digits, and hyphens.",
      "",
    ].join("\n"),
  );
}

function printE2eHelp(stdout: NodeJS.WritableStream): void {
  stdout.write(
    [
      "Usage: hosted-local e2e [scenario] [--profile e2e:stub|e2e:live] [--no-bundle] [--list]",
      "",
      "The command prepares one hosted-local runner bundle, runs the selected Vitest files,",
      "and cleans stale Cloudflare runner containers once in a finally block.",
      "",
    ].join("\n"),
  );
}

function printE2eScenarios(stdout: NodeJS.WritableStream): void {
  for (const scenario of listHostedLocalE2eScenarios()) {
    const suffix = scenario.manualOnly ? "\tmanual" : "";
    stdout.write(`${scenario.name}\t${scenario.file}${suffix}\n`);
  }
}

function printRunHelp(stdout: NodeJS.WritableStream): void {
  stdout.write("Usage: hosted-local run [--profile name] -- <command> [args...]\n");
}

function printDoctorHelp(stdout: NodeJS.WritableStream): void {
  stdout.write("Usage: hosted-local doctor [--profile name] [--json]\n");
}

function isDirectCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }
  return import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectCliEntrypoint()) {
  await runHostedLocalCli();
}
