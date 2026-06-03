import process from "node:process";

import { runHostedLocalCli } from "@murphai/hosted-local-harness/cli";

await runHostedLocalCli(process.argv.slice(2));
