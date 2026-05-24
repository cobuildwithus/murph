import { spawn } from "node:child_process";

export const hostedRunnerFinalImageTag = "murph-cloudflare-runner";
const dockerCleanupTimeoutMs = 10_000;

export async function removeHostedRunnerFinalImageBestEffort(): Promise<void> {
  await runDockerCommandBestEffort([
    "image",
    "rm",
    "-f",
    hostedRunnerFinalImageTag,
  ]);
}

async function runDockerCommandBestEffort(args: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("docker", args, {
      env: process.env,
      stdio: "ignore",
    });
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish();
    }, dockerCleanupTimeoutMs);
    timeout.unref();

    child.on("error", finish);
    child.on("close", finish);
  });
}
