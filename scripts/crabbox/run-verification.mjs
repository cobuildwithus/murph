#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SUPPORTED_VERIFICATION_COMMANDS = new Set([
  "test:diff",
  "verify:acceptance",
]);

const SENSITIVE_ENVIRONMENT_NAMES = [
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ANTHROPIC_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "BLACKSMITH_ADMIN_KEY",
  "BLACKSMITH_STICKYDISK_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CRABBOX_COORDINATOR_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "HCLOUD_TOKEN",
  "HETZNER_TOKEN",
  "LINQ_API_TOKEN",
  "LINQ_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "PRIVY_APP_SECRET",
  "PRIVY_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TOKEN",
];

const SAFE_TEST_ENVIRONMENT = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/murph_test",
  HOSTED_APP_SESSION_HMAC_KEY: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
  HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
  HOSTED_CONTACT_PRIVACY_KEYS:
    "v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  HOSTED_DEVICE_ROUTING_INDEX_KEY:
    "0101010101010101010101010101010101010101010101010101010101010101",
  HOSTED_MAILBOX_FINGERPRINT_KEY:
    "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE: "1",
  MURPH_APP_VERIFY_PARALLEL: "1",
  MURPH_CRABBOX_REMOTE: "1",
  MURPH_TEST_LANES_PARALLEL: "1",
  MURPH_VERIFY_EXECUTOR: "local",
  MURPH_VERIFY_SHARED_HOST: "0",
  MURPH_VERIFY_STEP_PARALLEL: "1",
  NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_crabbox_verify_placeholder1",
  NEXT_TELEMETRY_DISABLED: "1",
  PRIVY_VERIFICATION_KEY: "crabbox-hosted-web-verification-key",
};

export function parseRemoteVerificationRequest(argv) {
  const [verificationCommand, ...commandArgs] = argv;
  if (!verificationCommand || !SUPPORTED_VERIFICATION_COMMANDS.has(verificationCommand)) {
    throw new Error(
      `Remote verification supports only: ${[...SUPPORTED_VERIFICATION_COMMANDS].join(", ")}.`,
    );
  }
  return { commandArgs, verificationCommand };
}

export function buildSanitizedVerificationEnvironment(source = process.env) {
  const home = requireEnvironmentValue(source, "HOME");
  const executablePath = requireEnvironmentValue(source, "PATH");
  const user = source.USER?.trim() || "crabbox";

  const environment = {
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LOGNAME: source.LOGNAME?.trim() || user,
    PATH: executablePath,
    SHELL: source.SHELL?.trim() || "/bin/bash",
    TERM: source.TERM?.trim() || "dumb",
    TMPDIR: source.TMPDIR?.trim() || "/tmp",
    USER: user,
    ...SAFE_TEST_ENVIRONMENT,
  };

  assertNoSensitiveEnvironment(environment);
  return environment;
}

export function assertNoSensitiveEnvironment(environment) {
  const leakedNames = SENSITIVE_ENVIRONMENT_NAMES.filter((name) =>
    Object.prototype.hasOwnProperty.call(environment, name)
  );
  if (leakedNames.length > 0) {
    throw new Error(
      `Sensitive environment names reached the Crabbox verification process: ${leakedNames.join(", ")}.`,
    );
  }
}

export async function runRemoteVerification(argv, sourceEnvironment = process.env) {
  const request = parseRemoteVerificationRequest(argv);
  const environment = buildSanitizedVerificationEnvironment(sourceEnvironment);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  process.stderr.write(
    `[crabbox-verification] command=${request.verificationCommand} env=synthetic-no-vercel-development-env\n`,
  );

  const installExitCode = await runChild(
    "corepack",
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
    {
      cwd: repoRoot,
      env: { ...environment, CI: "1" },
    },
  );
  if (installExitCode !== 0) {
    return installExitCode;
  }

  return await runChild(
    "bash",
    [
      "scripts/workspace-verify.sh",
      request.verificationCommand,
      ...request.commandArgs,
    ],
    { cwd: repoRoot, env: environment },
  );
}

function requireEnvironmentValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Crabbox verification requires ${name}.`);
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

    const onSigint = () => {
      signalChild(child, useDetachedProcessGroup, "SIGINT");
    };
    const onSigterm = () => {
      signalChild(child, useDetachedProcessGroup, "SIGTERM");
    };
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
    process.exitCode = await runRemoteVerification(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[crabbox-verification] ${message}\n`);
    process.exitCode = 1;
  }
}
