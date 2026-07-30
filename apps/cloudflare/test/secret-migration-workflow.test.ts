import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const workflowUrl = new URL(
  "../../../.github/workflows/migrate-cloudflare-secrets-private.yml",
  import.meta.url,
);

const expectedSecretNames = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_IMAGES_SIGNING_KEY",
  "DEVICE_SYNC_SECRET",
  "ELEVENLABS_API_KEY",
  "EXA_API_KEY",
  "HOSTED_AI_USAGE_REPORTING_SECRET",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_DATABASE_ALERT_LINQ_CHAT_ID",
  "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID",
  "HOSTED_EMAIL_SIGNING_SECRET",
  "HOSTED_LOG_FINGERPRINT_SECRET",
  "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
  "HOSTED_R2_PRESIGN_ACCESS_KEY_ID",
  "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_WEBHOOK_SECRET",
  "LINQ_API_TOKEN",
  "LINQ_WEBHOOK_SECRET",
  "MAPBOX_ACCESS_TOKEN",
  "MURPH_DATA_API_KEY",
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "VENICE_API_KEY",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "XAI_API_KEY",
] as const;

const pinnedTargetKeyId = "3380204578043523366";
const pinnedTargetPublicKey = "8TBLIjl/ZGOcaCkPgxUSzzZgMcUluIVDKu8BiunQAAs=";

interface CiphertextManifest {
  key_id: string;
  source_repository: string;
  source_sha: string;
  target_environment: string;
  target_repository: string;
  secrets: Array<{
    name: string;
    encrypted_value: string;
  }>;
}

interface ExecFileFailure extends Error {
  stderr?: string;
}

async function readWorkflow(): Promise<string> {
  return readFile(workflowUrl, "utf8");
}

function mappedSecretNames(workflow: string): string[] {
  return [
    ...workflow.matchAll(
      /^\s{10}([A-Z0-9_]+):\s+\$\{\{\s*secrets\.\1\s*\}\}$/gmu,
    ),
  ].map((match) => match[1] ?? "");
}

function encryptedSecretNames(workflow: string): string[] {
  return [
    ...workflow.matchAll(/^\s{14}"([A-Z0-9_]+)",$/gmu),
  ].map((match) => match[1] ?? "");
}

function extractEncryptionPhp(workflow: string): string {
  const match = workflow.match(
    /^\s{10}php <<'PHP'\n([\s\S]*?)^\s{10}PHP$/mu,
  );
  if (!match?.[1]) {
    throw new Error("Could not locate the workflow's PHP encryption program.");
  }

  return `${match[1]
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n")}\n`;
}

async function generateSodiumKeyPair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const { stdout } = await execFileAsync("php", [
    "-r",
    [
      "$keyPair = sodium_crypto_box_keypair();",
      "echo json_encode([",
      '    "privateKey" => base64_encode(sodium_crypto_box_secretkey($keyPair)),',
      '    "publicKey" => base64_encode(sodium_crypto_box_publickey($keyPair)),',
      "], JSON_THROW_ON_ERROR);",
    ].join("\n"),
  ], { encoding: "utf8" });

  return JSON.parse(stdout) as {
    privateKey: string;
    publicKey: string;
  };
}

function buildSecretValues(): Record<string, string> {
  return Object.fromEntries(
    expectedSecretNames.map((name) => [
      name,
      `plaintext:${name}:must-not-enter-the-artifact`,
    ]),
  );
}

function vitestTempRoot(): string {
  const root = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!root) {
    throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  }
  return root;
}

async function runEncryptionProgram(input: {
  publicKey: string;
  secretValues?: Record<string, string>;
}): Promise<{
  directory: string;
  manifestPath: string;
  run: Promise<{ stdout: string; stderr: string }>;
}> {
  const workflow = await readWorkflow();
  const directory = await mkdtemp(
    path.join(vitestTempRoot(), "murph-secret-migration-"),
  );
  const scriptPath = path.join(directory, "encrypt.php");
  const manifestPath = path.join(directory, "cloudflare-secret-ciphertext.json");
  await writeFile(scriptPath, extractEncryptionPhp(workflow), "utf8");

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of expectedSecretNames) {
    delete env[name];
  }
  Object.assign(env, {
    GITHUB_REPOSITORY: "cobuildwithus/murph",
    GITHUB_SHA: "fixture-source-sha",
    TARGET_ENVIRONMENT: "production",
    TARGET_KEY_ID: "fixture-key-id",
    TARGET_PUBLIC_KEY: input.publicKey,
    TARGET_REPOSITORY: "cobuildwithus/murph-cloud",
    ...(input.secretValues ?? buildSecretValues()),
  });

  return {
    directory,
    manifestPath,
    run: execFileAsync("php", [scriptPath], {
      cwd: directory,
      encoding: "utf8",
      env,
    }),
  };
}

async function decryptManifest(
  manifestPath: string,
  keyPair: { privateKey: string; publicKey: string },
): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync("php", [
    "-r",
    [
      '$manifest = json_decode(file_get_contents($argv[1]), true, flags: JSON_THROW_ON_ERROR);',
      '$privateKey = sodium_base642bin(getenv("PRIVATE_KEY"), SODIUM_BASE64_VARIANT_ORIGINAL);',
      '$publicKey = sodium_base642bin(getenv("PUBLIC_KEY"), SODIUM_BASE64_VARIANT_ORIGINAL);',
      "$keyPair = sodium_crypto_box_keypair_from_secretkey_and_publickey($privateKey, $publicKey);",
      "$plaintext = [];",
      'foreach ($manifest["secrets"] as $secret) {',
      '    $ciphertext = sodium_base642bin($secret["encrypted_value"], SODIUM_BASE64_VARIANT_ORIGINAL);',
      "    $value = sodium_crypto_box_seal_open($ciphertext, $keyPair);",
      "    if ($value === false) {",
      '        fwrite(STDERR, "Could not decrypt fixture ciphertext.\\n");',
      "        exit(1);",
      "    }",
      '    $plaintext[$secret["name"]] = $value;',
      "}",
      "echo json_encode($plaintext, JSON_THROW_ON_ERROR);",
    ].join("\n"),
    manifestPath,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PRIVATE_KEY: keyPair.privateKey,
      PUBLIC_KEY: keyPair.publicKey,
    },
  });

  return JSON.parse(stdout) as Record<string, string>;
}

async function expectRunFailure(
  run: Promise<{ stdout: string; stderr: string }>,
  expectedError: string,
): Promise<void> {
  try {
    await run;
    throw new Error("Expected the encryption program to fail.");
  } catch (error) {
    const failure = error as ExecFileFailure;
    expect(failure.stderr).toContain(expectedError);
  }
}

describe("private Cloudflare secret migration workflow", () => {
  it("encrypts the exact mapped secret set without exposing plaintext", async () => {
    const workflow = await readWorkflow();
    const mappedNames = mappedSecretNames(workflow);
    const encryptedNames = encryptedSecretNames(workflow);

    expect(mappedNames).toEqual(expectedSecretNames);
    expect(new Set(mappedNames).size).toBe(mappedNames.length);
    expect(encryptedNames).toEqual(mappedNames);
    expect(workflow).toContain("sodium_crypto_box_seal($value, $publicKey)");
    expect(workflow).toContain("sodium_memzero($value)");
    expect(workflow).not.toMatch(/run:[\s\S]*\$\{\{\s*secrets\./u);
  });

  it("produces only decryptable sealed-box ciphertext in the manifest", async () => {
    const keyPair = await generateSodiumKeyPair();
    const secretValues = buildSecretValues();
    const execution = await runEncryptionProgram({
      publicKey: keyPair.publicKey,
      secretValues,
    });

    try {
      const result = await execution.run;
      expect(result.stdout).toBe(
        `Encrypted ${expectedSecretNames.length} deploy secrets.\n`,
      );
      expect(result.stderr).toBe("");
      const manifestText = await readFile(execution.manifestPath, "utf8");
      const manifest = JSON.parse(manifestText) as CiphertextManifest;

      expect(manifest).toMatchObject({
        key_id: "fixture-key-id",
        source_repository: "cobuildwithus/murph",
        source_sha: "fixture-source-sha",
        target_environment: "production",
        target_repository: "cobuildwithus/murph-cloud",
      });
      expect(manifest.secrets.map((secret) => secret.name)).toEqual(
        expectedSecretNames,
      );
      for (const value of Object.values(secretValues)) {
        expect(`${result.stdout}${result.stderr}`).not.toContain(value);
        expect(manifestText).not.toContain(value);
      }
      expect(await decryptManifest(execution.manifestPath, keyPair)).toEqual(
        secretValues,
      );
    } finally {
      await rm(execution.directory, { recursive: true, force: true });
    }
  });

  it("fails before writing a manifest when a configured source secret is missing", async () => {
    const keyPair = await generateSodiumKeyPair();
    const secretValues = buildSecretValues();
    delete secretValues.OPENAI_API_KEY;
    const execution = await runEncryptionProgram({
      publicKey: keyPair.publicKey,
      secretValues,
    });

    try {
      await expectRunFailure(
        execution.run,
        "Configured public production secret is unavailable: OPENAI_API_KEY",
      );
      await expect(readFile(execution.manifestPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(execution.directory, { recursive: true, force: true });
    }
  });

  it("fails before writing a manifest when the target public key is malformed", async () => {
    const execution = await runEncryptionProgram({
      publicKey: "not-a-valid-libsodium-public-key",
    });

    try {
      await expectRunFailure(
        execution.run,
        "Target GitHub environment public key is invalid.",
      );
      await expect(readFile(execution.manifestPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(execution.directory, { recursive: true, force: true });
    }
  });

  it("is protected-main-only and retains ciphertext briefly", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).not.toContain("inputs:");
    expect(workflow).not.toContain("${{ inputs.");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(/^\s{2}push:/mu);
    expect(workflow).toContain(
      "if: ${{ github.ref == 'refs/heads/main' && github.ref_protected }}",
    );
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain("TARGET_ENVIRONMENT: production");
    expect(workflow).toContain("TARGET_REPOSITORY: cobuildwithus/murph-cloud");
    expect(workflow).toContain(`TARGET_KEY_ID: "${pinnedTargetKeyId}"`);
    expect(workflow).toContain(
      `TARGET_PUBLIC_KEY: "${pinnedTargetPublicKey}"`,
    );
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).toContain(
      "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
    );
  });
});
