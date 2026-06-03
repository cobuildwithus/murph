import process from "node:process";

import { runDevHostedLocalCompatCli } from "@murphai/hosted-local-harness/compat";

await runDevHostedLocalCompatCli(process.argv.slice(2));
