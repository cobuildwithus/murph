import path from "node:path";
import { fileURLToPath } from "node:url";

import { runForegroundCommand } from "@murphai/hosted-local-harness/process";

import { createHostedWebSmokeEnvironment } from "../next-artifacts";

// Compile before the live E2E stack starts, using the same isolated output
// directory that its existing production-start selector consumes.
void runForegroundCommand({
  args: ["--dir", "apps/web", "build"],
  command: "pnpm",
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  env: createHostedWebSmokeEnvironment({ ...process.env, NODE_ENV: "production" }),
  label: "Hosted local production Web build",
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Hosted local production Web build failed.");
  process.exitCode = 1;
});
