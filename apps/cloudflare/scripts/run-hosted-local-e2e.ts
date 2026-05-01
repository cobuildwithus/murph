import process from "node:process";

import { runCloudflareHostedLocalE2eCompatCli } from "@murphai/hosted-local-harness/compat";

await runCloudflareHostedLocalE2eCompatCli(process.argv.slice(2));
