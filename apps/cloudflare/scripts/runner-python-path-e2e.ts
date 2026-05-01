import { spawn } from "node:child_process";

const IMAGE_TAG = "murph-cloudflare-runner";

async function main(): Promise<void> {
  const containerId = (await runDockerCommand([
    "run",
    "--detach",
    "--platform",
    "linux/amd64",
    "--network",
    "none",
    IMAGE_TAG,
  ])).trim();

  try {
    await runDockerCommand([
      "exec",
      containerId,
      "node",
      "--input-type=module",
      "-e",
      buildEntrypointHealthProbeScript(),
    ]);
    await runDockerCommand([
      "exec",
      containerId,
      "/bin/sh",
      "-lc",
      buildPythonPathProbeScript(),
    ]);
  } finally {
    await removeContainer(containerId);
  }

  console.log("Hosted runner final-image Python PATH smoke passed.");
}

function buildPythonPathProbeScript(): string {
  return [
    "set -eu",
    'test "$(pwd)" = "/app"',
    'test "$(id -un)" = "runner"',
    'test "$HOME" = "/home/runner"',
    'test "$NODE_ENV" = "production"',
    'test "$PORT" = "8080"',
    'test "$HOSTED_HOME" = "/home/runner/.murph"',
    'test "$HOSTED_MODELS_ROOT" = "/home/runner/.murph/models"',
    'case "$PATH" in /app/node_modules/.bin:*) ;; *) exit 1;; esac',
    "test ! -w /app",
    "command -v python >/dev/null",
    "command -v python3 >/dev/null",
    'python -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)"',
    'python3 -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)"',
  ].join("; ");
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
