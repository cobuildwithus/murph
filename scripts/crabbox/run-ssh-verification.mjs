#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runSanitizedVerification } from "./run-verification.mjs";

function isDirectEntrypoint() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href;
}

if (isDirectEntrypoint()) {
  try {
    process.exitCode = await runSanitizedVerification(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ssh-verification] ${message}\n`);
    process.exitCode = 1;
  }
}
