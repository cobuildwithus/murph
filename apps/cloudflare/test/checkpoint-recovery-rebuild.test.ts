import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { initializeVault, validateVault, walkVaultFiles } from "@murphai/core";
import { readAssistantOnboardingState } from "@murphai/assistant-engine/assistant-state";
import { createSyntheticBrowserVaultReplica } from "./fixtures/browser-vault-replica.ts";
import { rebuildPartialRecoveryVault } from "../scripts/checkpoint-recovery-rebuild.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "synthetic-partial-recovery-"));
  directories.push(vaultRoot);
  const replica = createSyntheticBrowserVaultReplica(4);
  return { vaultRoot, replica, sourceBytes: Buffer.from(JSON.stringify(replica)), timezone: "UTC",
    recoveredAt: "2026-02-01T00:00:00.000Z", completedOnboarding: true, signal: new AbortController().signal };
}

it("creates a valid foundation, preserves the full source, and keeps completed onboarding closed", async () => {
  const input = await fixture();
  const mailboxPath = path.join(input.vaultRoot, ".runtime/operations/mailbox/synthetic.json");
  await mkdir(path.dirname(mailboxPath), { recursive: true });
  await writeFile(mailboxPath, "synthetic-existing-cursor");
  expect((await rebuildPartialRecoveryVault(input)).summary).toMatchObject({ validVault: true,
    recoveredSourceBytes: input.sourceBytes.byteLength, onboardingCompleted: true,
    originalFilesRestored: false, restorationPerformed: false });
  expect((await validateVault({ vaultRoot: input.vaultRoot })).valid).toBe(true);
  expect(await readAssistantOnboardingState(input.vaultRoot)).toMatchObject({ status: "completed", completedReason: "manual" });
  expect(await readFile(mailboxPath, "utf8")).toBe("synthetic-existing-cursor");
  const files = await walkVaultFiles(input.vaultRoot, "raw");
  const source = files.find((file) => file.endsWith("recovered-browser-vault.json"));
  expect(source).toBeDefined();
  expect(await readFile(path.join(input.vaultRoot, source!))).toEqual(input.sourceBytes);
});

it("never overwrites an existing initialized vault or a surviving core document", async () => {
  const input = await fixture();
  await initializeVault({ vaultRoot: input.vaultRoot, title: "Synthetic existing vault", timezone: "UTC" });
  const metadata = await readFile(path.join(input.vaultRoot, "vault.json"));
  await expect(rebuildPartialRecoveryVault(input)).rejects.toThrow("existing_canonical_foundation");
  expect(await readFile(path.join(input.vaultRoot, "vault.json"))).toEqual(metadata);
  const other = await fixture();
  await writeFile(path.join(other.vaultRoot, "CORE.md"), "synthetic surviving core");
  await expect(rebuildPartialRecoveryVault(other)).rejects.toThrow("existing_canonical_foundation");
  expect(await readFile(path.join(other.vaultRoot, "CORE.md"), "utf8")).toBe("synthetic surviving core");
});

it("does not assert completed onboarding without the recovery instruction", async () => {
  const input = await fixture();
  const result = await rebuildPartialRecoveryVault({ ...input, completedOnboarding: false });
  expect(result.summary.onboardingCompleted).toBe(false);
  expect((await readAssistantOnboardingState(input.vaultRoot)).status).toBe("open");
});

it("does no initialization after cancellation", async () => {
  const input = await fixture();
  const controller = new AbortController(); controller.abort();
  await expect(rebuildPartialRecoveryVault({ ...input, signal: controller.signal })).rejects.toThrow();
  await expect(readFile(path.join(input.vaultRoot, "vault.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
