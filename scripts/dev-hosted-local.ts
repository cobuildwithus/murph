import process from "node:process";

import { printHelp } from "./dev-hosted-local/config.ts";
import { runHostedLocalCli } from "../packages/hosted-local-harness/src/cli.ts";

// Compatibility entrypoint for the existing root `pnpm dev` script.
// Keep the historical help text stable, but route actual startup through the
// hosted-local harness package so profile/state/diagnostic behavior has one
// source of truth.
const rawArgs = process.argv.slice(2);
const argv = new Set(rawArgs);

if (argv.has("--help") || argv.has("-h")) {
  printHelp();
  process.exit(0);
}

const firstArg = rawArgs[0];
const delegatedArgs = firstArg && !firstArg.startsWith("-") ? rawArgs : ["up", ...rawArgs];
await runHostedLocalCli(delegatedArgs, {
  env: process.env,
});
