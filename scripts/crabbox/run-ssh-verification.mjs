#!/usr/bin/env node

import { rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runSanitizedVerification } from "./run-verification.mjs";

const CLEANUP_FLAG = "--cleanup-static-workspace";
const CLEANUP_ONLY_FLAG = "--cleanup-static-workspace-only";
const SSH_RUN_ROOT = "/Users/Shared/murph-crabbox/runs";

export function parseSshVerificationRequest(argv) {
  if (argv[0] === CLEANUP_ONLY_FLAG && argv.length === 1) {
    return {
      cleanupOnly: true,
      cleanupWorkspace: true,
      verificationArgs: [],
    };
  }
  if (argv[0] !== CLEANUP_FLAG) {
    return {
      cleanupOnly: false,
      cleanupWorkspace: false,
      verificationArgs: argv,
    };
  }
  return {
    cleanupOnly: false,
    cleanupWorkspace: true,
    verificationArgs: argv.slice(1),
  };
}

export function assertSafeStaticWorkspace(
  { workspaceRoot, runRoot = SSH_RUN_ROOT },
) {
  const resolvedRunRoot = path.resolve(runRoot);
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const relativeWorkspace = path.relative(resolvedRunRoot, resolvedWorkspace);
  if (
    relativeWorkspace.includes(path.sep) ||
    !/^[a-f0-9]{16}-[a-f0-9]{16}$/u.test(relativeWorkspace)
  ) {
    throw new Error(
      "Static SSH workspace cleanup requires one opaque run directory below the configured run root.",
    );
  }
  return resolvedWorkspace;
}

export function cleanupStaticWorkspace(
  { workspaceRoot, runRoot = SSH_RUN_ROOT },
) {
  rmSync(assertSafeStaticWorkspace({ workspaceRoot, runRoot }), {
    force: true,
    recursive: true,
  });
}

function isDirectEntrypoint() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href;
}

if (isDirectEntrypoint()) {
  try {
    const request = parseSshVerificationRequest(process.argv.slice(2));
    const workspaceRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    try {
      if (!request.cleanupOnly) {
        process.exitCode = await runSanitizedVerification(
          request.verificationArgs,
        );
      }
    } finally {
      if (request.cleanupWorkspace) {
        cleanupStaticWorkspace({ workspaceRoot });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ssh-verification] ${message}\n`);
    process.exitCode = 1;
  }
}
