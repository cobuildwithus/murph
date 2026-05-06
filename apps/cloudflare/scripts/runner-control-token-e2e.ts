import { spawn } from "node:child_process";

const IMAGE_TAG = "murph-cloudflare-runner";
const OLD_RUNNER_CONTROL_TOKEN = "old-runner-control-token";
const NEXT_RUNNER_CONTROL_TOKEN = "next-runner-control-token";

async function main(): Promise<void> {
  const oldContainerId = await startRunnerContainer(OLD_RUNNER_CONTROL_TOKEN);
  try {
    await waitForRunnerHealth(oldContainerId);
    await assertRunnerControlTokenBoundary({
      acceptedToken: OLD_RUNNER_CONTROL_TOKEN,
      containerId: oldContainerId,
      rejectedToken: NEXT_RUNNER_CONTROL_TOKEN,
      scenario: "surviving-old-shell",
    });
  } finally {
    await removeContainer(oldContainerId);
  }

  const nextContainerId = await startRunnerContainer(NEXT_RUNNER_CONTROL_TOKEN);
  try {
    await waitForRunnerHealth(nextContainerId);
    await assertRunnerControlTokenBoundary({
      acceptedToken: NEXT_RUNNER_CONTROL_TOKEN,
      containerId: nextContainerId,
      rejectedToken: OLD_RUNNER_CONTROL_TOKEN,
      scenario: "fresh-shell-after-destroy",
    });
  } finally {
    await removeContainer(nextContainerId);
  }

  console.log("Hosted runner final-image control-token recovery smoke passed.");
}

async function startRunnerContainer(controlToken: string): Promise<string> {
  return (await runDockerCommand([
    "run",
    "--detach",
    "--platform",
    "linux/amd64",
    "--network",
    "none",
    "--env",
    `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN=${controlToken}`,
    IMAGE_TAG,
  ])).trim();
}

async function waitForRunnerHealth(containerId: string): Promise<void> {
  await runDockerCommand([
    "exec",
    containerId,
    "node",
    "--input-type=module",
    "-e",
    buildEntrypointHealthProbeScript(),
  ]);
}

async function assertRunnerControlTokenBoundary(input: {
  acceptedToken: string;
  containerId: string;
  rejectedToken: string;
  scenario: string;
}): Promise<void> {
  await runDockerCommand([
    "exec",
    input.containerId,
    "node",
    "--input-type=module",
    "-e",
    buildControlTokenProbeScript(input),
  ]);
}

function buildEntrypointHealthProbeScript(): string {
  return `
const port = process.env.PORT || "8080";
const deadline = Date.now() + 10_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(\`http://127.0.0.1:\${port}/health\`);
    if (response.ok) {
      const body = await response.json();
      if (body?.ok === true && body?.service === "cloudflare-hosted-runner-node") {
        process.exit(0);
      }
    }
  } catch {
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
console.error("Hosted runner final-image health check failed.");
process.exit(1);
`.trim();
}

function buildControlTokenProbeScript(input: {
  acceptedToken: string;
  rejectedToken: string;
  scenario: string;
}): string {
  return `
const port = process.env.PORT || "8080";
const endpoint = \`http://127.0.0.1:\${port}/internal/workspace-invocation\`;

async function postWithToken(token) {
  const response = await fetch(endpoint, {
    body: "{}",
    headers: {
      authorization: \`Bearer \${token}\`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
  }
  return { body, status: response.status };
}

const rejected = await postWithToken(${JSON.stringify(input.rejectedToken)});
if (rejected.status !== 401) {
  console.error(${JSON.stringify(input.scenario)} + ": stale control token was not rejected", rejected);
  process.exit(1);
}

const accepted = await postWithToken(${JSON.stringify(input.acceptedToken)});
if (accepted.status === 401) {
  console.error(${JSON.stringify(input.scenario)} + ": current control token was rejected", accepted);
  process.exit(1);
}
if (accepted.status !== 400) {
  console.error(${JSON.stringify(input.scenario)} + ": current control token did not reach request validation", accepted);
  process.exit(1);
}
`.trim();
}

async function removeContainer(containerId: string): Promise<void> {
  try {
    await runDockerCommand([
      "rm",
      "--force",
      containerId,
    ]);
  } catch {
  }
}

async function runDockerCommand(args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() || `docker ${args.join(" ")} exited with code ${code ?? "unknown"}.`,
          ),
        );
        return;
      }

      resolve(stdout.trim());
    });
  });
}

await main();
