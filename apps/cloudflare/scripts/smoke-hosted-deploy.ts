import { appendFile } from "node:fs/promises";

import {
  resolveSmokeExpectedStandbyMode,
  runSmokeHostedDeploy,
} from "./smoke-hosted-deploy.shared.js";

await runSmokeHostedDeploy();

const githubOutputPath = process.env.GITHUB_OUTPUT?.trim();
if (resolveSmokeExpectedStandbyMode() !== null && githubOutputPath) {
  await appendFile(githubOutputPath, "standby_mode_verified=true\n", "utf8");
}
