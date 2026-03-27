import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const lifecycleConfigPath = path.join(appDir, "r2-bundles-lifecycle.json");

const configuredBuckets = dedupe([
  normalizeString(process.env.CF_BUNDLES_BUCKET),
  normalizeString(process.env.CF_BUNDLES_PREVIEW_BUCKET),
]);

if (configuredBuckets.length === 0) {
  throw new Error("CF_BUNDLES_BUCKET or CF_BUNDLES_PREVIEW_BUCKET must be configured.");
}

for (const bucketName of configuredBuckets) {
  console.log(`Applying transient lifecycle rules to R2 bucket ${bucketName}...`);
  await runWranglerCommand([
    "exec",
    "wrangler",
    "r2",
    "bucket",
    "lifecycle",
    "set",
    bucketName,
    "--file",
    lifecycleConfigPath,
  ]);
}

console.log(
  `Applied transient lifecycle rules from ${path.relative(process.cwd(), lifecycleConfigPath) || path.basename(lifecycleConfigPath)}.`,
);

function normalizeString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function dedupe(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function runWranglerCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePnpmCommand(), args, {
      cwd: appDir,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `wrangler exited from signal ${signal}.`
            : `wrangler exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

function resolvePnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}
