import process from "node:process";

import { runDevHostedLocalCompatCli } from "../packages/hosted-local-harness/src/compat.ts";

await runDevHostedLocalCompatCli(process.argv.slice(2));
