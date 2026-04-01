import { runDeployWorkerVersionCli } from "./deploy-worker-version.cli.js";

await runDeployWorkerVersionCli(process.argv.slice(2));
