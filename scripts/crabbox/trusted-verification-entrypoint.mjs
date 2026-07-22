#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SUPPORTED_VERIFICATION_COMMANDS = new Set([
  "test:diff",
  "verify:acceptance",
]);

const TRUSTED_ENTRYPOINT_ENV = "MURPH_CRABBOX_TRUSTED_ENTRYPOINT";
const TRUSTED_PATH = "/usr/local/bin:/usr/bin:/bin";

export function parseTrustedVerificationRequest(argv) {
  const [verificationCommand, ...commandArgs] = argv;
  if (!verificationCommand || !SUPPORTED_VERIFICATION_COMMANDS.has(verificationCommand)) {
    throw new Error(
      `Trusted Crabbox entrypoint supports only: ${[...SUPPORTED_VERIFICATION_COMMANDS].join(", ")}.`,
    );
  }
  return { commandArgs, verificationCommand };
}

export function buildTrustedVerificationEnvironment(source = process.env) {
  const home = requireEnvironmentValue(source, "HOME");
  const user = source.USER?.trim() || "crabbox";

  return {
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LOGNAME: source.LOGNAME?.trim() || user,
    PATH: TRUSTED_PATH,
    SHELL: "/bin/bash",
    TERM: source.TERM?.trim() || "dumb",
    TMPDIR: "/tmp",
    [TRUSTED_ENTRYPOINT_ENV]: "1",
    USER: user,
  };
}

export async function runTrustedVerification(argv, sourceEnvironment = process.env) {
  const request = parseTrustedVerificationRequest(argv);
  const environment = buildTrustedVerificationEnvironment(sourceEnvironment);
  replaceProcessEnvironment(environment);

  const repoRoot = path.resolve(process.cwd());
  const candidateEntrypoint = path.join(
    repoRoot,
    "scripts",
    "crabbox",
    "run-verification.mjs",
  );
  if (!existsSync(candidateEntrypoint) || !statSync(candidateEntrypoint).isFile()) {
    throw new Error("Trusted Crabbox entrypoint could not resolve the candidate verifier.");
  }

  return await runChild(
    process.execPath,
    [
      candidateEntrypoint,
      request.verificationCommand,
      ...request.commandArgs,
    ],
    { cwd: repoRoot, env: environment },
  );
}

function replaceProcessEnvironment(environment) {
  for (const name of Object.keys(process.env)) {
    delete process.env[name];
  }
  Object.assign(process.env, environment);
}

function requireEnvironmentValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value || /[\0\r\n]/u.test(value)) {
    throw new Error(`Trusted Crabbox entrypoint requires a safe ${name}.`);
  }
  return value;
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const useDetachedProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      ...options,
      detached: useDetachedProcessGroup,
      stdio: "inherit",
    });

    const onSigint = () => signalChild(child, useDetachedProcessGroup, "SIGINT");
    const onSigterm = () => signalChild(child, useDetachedProcessGroup, "SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal === "SIGINT") {
        resolve(130);
        return;
      }
      if (signal) {
        resolve(143);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function signalChild(child, useDetachedProcessGroup, signal) {
  try {
    if (useDetachedProcessGroup && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ESRCH") {
      throw error;
    }
  }
}

function isDirectEntrypoint() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectEntrypoint()) {
  try {
    process.exitCode = await runTrustedVerification(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[crabbox-trusted-entrypoint] ${message}\n`);
    process.exitCode = 1;
  }
}
