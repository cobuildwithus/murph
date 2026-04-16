import process from "node:process";

import { printHelp } from "./dev-hosted-local/config.ts";
import { main } from "./dev-hosted-local/main.ts";

const argv = new Set(process.argv.slice(2));

if (argv.has("--help") || argv.has("-h")) {
  printHelp();
  process.exit(0);
}

await main();
