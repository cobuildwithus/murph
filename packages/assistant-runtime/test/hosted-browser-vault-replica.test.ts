import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import {
  createHostedBrowserVaultReplicaRefreshFromWorkspace,
} from "../src/hosted-runtime/browser-vault-replica.ts";

describe("hosted browser-vault replica refresh preparation", () => {
  it("summarizes restored canonical source separately from default metric selection rows", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    try {
      await writeVaultFile(vaultRoot, path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md"), [
        "---",
        "experimentId: exp_trial",
        "slug: trial",
        "title: Private Trial",
        "status: active",
        "startedOn: 2026-05-01",
        "---",
        "# Private Trial",
        "",
        "Private browser-vault content.",
        "",
      ].join("\n"));

      const prepared = await createHostedBrowserVaultReplicaRefreshFromWorkspace({
        generatedAt: "2026-05-10T00:00:00.000Z",
        platform: createPlatform(),
        sourceStateHash: "a".repeat(64),
        vaultRoot,
        workspace: null,
      });

      expect(prepared.source.fileCount).toBe(1);
      expect(prepared.source.totalBytes).toBeGreaterThan(0);
      expect(prepared.content.entities).toBe(1);
      expect(prepared.content.searchRows).toBe(1);
      expect(prepared.content.metricSelectionRows).toBeGreaterThan(0);
      expect(prepared.content.hasPrivateContent).toBe(true);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(`${vaultRoot}-operator-home`, { force: true, recursive: true });
    }
  });
});

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const filePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function createPlatform() {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
    workspacePort: {
      async checkpoint() {
        throw new Error("Browser-vault refresh preparation must not checkpoint.");
      },
    },
  };
}
