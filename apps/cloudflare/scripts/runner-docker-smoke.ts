import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeHostedBundleBase64,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";

import {
  parseHostedRunnerSmokeResult,
} from "../src/hosted-runner-smoke-contract.js";
import {
  removeHostedRunnerFinalImageBestEffort,
} from "./local-runner-docker-cleanup.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");

const FIXTURE_VAULT_ROOT = path.join(repoRoot, "fixtures", "demo-web-vault");
const EXPECTED_VAULT_ID = "vault_01JNV40W8VFYQ2H7CMJY5A9R4K";
const WAV_RELATIVE_PATH = "raw/smoke/hosted-runner.wav";
const EXPECTED_TRANSCRIPT_SNIPPET = "hello";
const IMAGE_TAG = "murph-cloudflare-runner";
const SMOKE_BUNDLE_DIR = path.join(appDir, ".deploy", "runner-smoke-bundle");

async function main(): Promise<void> {
  try {
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
      "--platform",
      "linux/amd64",
      "--interactive",
      "--network",
      "none",
      "--entrypoint",
      "node",
      IMAGE_TAG,
      "dist/hosted-runner-smoke.js",
    ], JSON.stringify({
      bundle,
      expectedTranscriptSnippet: EXPECTED_TRANSCRIPT_SNIPPET,
      expectedVaultId: EXPECTED_VAULT_ID,
      wavRelativePath: WAV_RELATIVE_PATH,
    }));

    const result = parseHostedRunnerSmokeResult(parseJsonValue(
      output,
      "Docker runner smoke stdout",
    ));

    console.log(`Hosted runner smoke passed.`);
    console.log(`childCwdIsIsolated=${result.childCwdIsIsolated}`);
    console.log(`murphCommandDiscovered=${result.murphCommandDiscovered}`);
    console.log(`vaultCliCommandDiscovered=${result.vaultCliCommandDiscovered}`);
    console.log(`codexCommandDiscovered=${result.codexCommandDiscovered}`);
    console.log(`codexVersion=${result.codexVersion}`);
    console.log(`codexAppServerHelpBytes=${result.codexAppServerHelpBytes}`);
    console.log(`codexHostedShellVaultCliLlmsBytes=${result.codexHostedShellVaultCliLlmsBytes}`);
    console.log(`codexHostedShellMurphPathBytes=${result.codexHostedShellMurphPathBytes}`);
    console.log(`codexHostedShellPythonVersion=${result.codexHostedShellPythonVersion}`);
    console.log(`codexHostedCliSchemaVaultOptionHidden=${result.codexHostedCliSchemaVaultOptionHidden}`);
    console.log(`codexHostedCliVaultCommandProofCount=${result.codexHostedCliVaultCommandProofCount}`);
    console.log(`codexHostedCliVaultWriteProofCount=${result.codexHostedCliVaultWriteProofCount}`);
    console.log(`operatorHomeRebound=${result.operatorHomeRebound}`);
    console.log(`vaultRootRebound=${result.vaultRootRebound}`);
    console.log(`reportedVaultIdMatchesExpected=${result.reportedVaultIdMatchesExpected}`);
    console.log(`vaultShowBytes=${result.vaultShowBytes}`);
    console.log(`healthCommonsCatalogHash=${result.healthCommonsCatalogHash}`);
    console.log(`healthCommonsFinnishDrySaunaTitle=${result.healthCommonsFinnishDrySaunaTitle}`);
    console.log(`healthCommonsCliProtocolListBytes=${result.healthCommonsCliProtocolListBytes}`);
    console.log(`healthCommonsRuntimeSearchHitKeys=${result.healthCommonsRuntimeSearchHitKeys.join(",")}`);
    console.log(`healthCommonsRuntimeProtocolHitKeys=${result.healthCommonsRuntimeProtocolHitKeys.join(",")}`);
    console.log(`wavTranscriptProviderId=${result.wavTranscriptProviderId}`);
    console.log(`wavTranscriptSha256=${result.wavTranscriptSha256}`);
    console.log(`wavTranscriptMatchesExpectedSnippet=${result.wavTranscriptMatchesExpectedSnippet}`);
    console.log(`normalizedTranscriptProviderId=${result.normalizedTranscriptProviderId}`);
    console.log(`normalizedTranscriptSha256=${result.normalizedTranscriptSha256}`);
    console.log(`normalizedTranscriptMatchesExpectedSnippet=${result.normalizedTranscriptMatchesExpectedSnippet}`);
    console.log(`pythonVersion=${result.pythonVersion}`);
    console.log(`ripgrepCommandDiscovered=${result.ripgrepCommandDiscovered}`);
    console.log(`ripgrepVersion=${result.ripgrepVersion}`);
  } finally {
    await rm(SMOKE_BUNDLE_DIR, { force: true, recursive: true });
    await removeHostedRunnerFinalImageBestEffort();
  }
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
            `docker runner smoke exited with code ${code ?? "unknown"}. stdoutBytes=${Buffer.byteLength(stdout, "utf8")} stderrBytes=${Buffer.byteLength(stderr, "utf8")}`,
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

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new SyntaxError(
      `${label} was not valid JSON. bytes=${Buffer.byteLength(value, "utf8")}`,
    );
  }
}
