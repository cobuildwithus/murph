import process from "node:process";

import { ensureHostedLocalWorkspaceTsconfigPath } from "./dev-hosted-local/tsx-workspace.ts";

ensureHostedLocalWorkspaceTsconfigPath();

const argv = new Set(process.argv.slice(2));

if (argv.has("--help") || argv.has("-h")) {
  const { printHelp } = await import("./dev-hosted-local/config.ts");
  printHelp();
  process.exit(0);
}

const { main } = await import("./dev-hosted-local/main.ts");
await main();
