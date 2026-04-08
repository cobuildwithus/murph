import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeHostedBundleBase64,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";

import {
  parseHostedRunnerSmokeResult,
} from "../src/hosted-runner-smoke-contract.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");

const FIXTURE_VAULT_ROOT = path.join(repoRoot, "fixtures", "demo-web-vault");
const EXPECTED_VAULT_ID = "vault_01JNV40W8VFYQ2H7CMJY5A9R4K";
const PDF_RELATIVE_PATH = "raw/smoke/hosted-runner.pdf";
const WAV_RELATIVE_PATH = "raw/smoke/hosted-runner.wav";
const EXPECTED_PDF_TEXT = "Murph hosted PDF smoke fixture";
const EXPECTED_TRANSCRIPT_SNIPPET = "hello";
const IMAGE_TAG = "murph-cloudflare-runner";

async function main(): Promise<void> {
  const snapshot = await snapshotHostedExecutionContext({
    vaultRoot: FIXTURE_VAULT_ROOT,
  });
  const bundle = encodeHostedBundleBase64(snapshot.bundle);

  if (!bundle) {
    throw new Error("Could not encode the hosted runner smoke fixture bundle.");
  }

  const output = await runDockerCommand([
    "run",
    "--rm",
    "--interactive",
    "--network",
    "none",
    "--entrypoint",
    "node",
    IMAGE_TAG,
    "dist/hosted-runner-smoke.js",
  ], JSON.stringify({
    bundle,
    expectedPdfText: EXPECTED_PDF_TEXT,
    expectedTranscriptSnippet: EXPECTED_TRANSCRIPT_SNIPPET,
    expectedVaultId: EXPECTED_VAULT_ID,
    pdfRelativePath: PDF_RELATIVE_PATH,
    wavRelativePath: WAV_RELATIVE_PATH,
  }));

  const result = parseHostedRunnerSmokeResult(JSON.parse(output));

  console.log(`Hosted runner smoke passed.`);
  console.log(`childCwd=${result.childCwd}`);
  console.log(`murphBin=${result.murphBin}`);
  console.log(`vaultCliBin=${result.vaultCliBin}`);
  console.log(`reportedVaultId=${result.reportedVaultId}`);
  console.log(`pdfText=${JSON.stringify(result.pdfText)}`);
  console.log(`wavTranscript=${JSON.stringify(result.wavTranscript)}`);
  console.log(`normalizedTranscript=${JSON.stringify(result.normalizedTranscript)}`);
}

async function runDockerCommand(args: string[], stdinText: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: appDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
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
    child.stdin.end(stdinText);
  });
}

await main();
