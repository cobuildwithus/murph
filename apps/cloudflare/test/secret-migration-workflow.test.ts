import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowUrl = new URL(
  "../../../.github/workflows/migrate-cloudflare-secrets-private.yml",
  import.meta.url,
);

async function readWorkflow(): Promise<string> {
  return readFile(workflowUrl, "utf8");
}

describe("private Cloudflare secret migration workflow", () => {
  it("encrypts the exact mapped secret set without exposing plaintext", async () => {
    const workflow = await readWorkflow();
    const mappedNames = [
      ...workflow.matchAll(
        /^\s{10}([A-Z0-9_]+):\s+\$\{\{\s*secrets\.\1\s*\}\}$/gmu,
      ),
    ].map((match) => match[1] ?? "");
    const encryptedNames = [
      ...workflow.matchAll(/^\s{14}"([A-Z0-9_]+)",$/gmu),
    ].map((match) => match[1] ?? "");

    expect(mappedNames).toHaveLength(31);
    expect(new Set(mappedNames).size).toBe(mappedNames.length);
    expect(encryptedNames).toEqual(mappedNames);
    expect(workflow).toContain("sodium_crypto_box_seal($value, $publicKey)");
    expect(workflow).toContain("sodium_memzero($value)");
    expect(workflow).not.toMatch(/run:[\s\S]*\$\{\{\s*secrets\./u);
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
    expect(workflow).toMatch(/TARGET_KEY_ID: "[0-9]+"/u);
    expect(workflow).toMatch(
      /TARGET_PUBLIC_KEY: "[A-Za-z0-9+/]{43}="/u,
    );
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).toContain(
      "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
    );
  });
});
