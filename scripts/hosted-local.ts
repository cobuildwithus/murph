import process from "node:process";

import { runHostedLocalCli } from "../packages/hosted-local-harness/src/cli.ts";

await runHostedLocalCli(process.argv.slice(2));
