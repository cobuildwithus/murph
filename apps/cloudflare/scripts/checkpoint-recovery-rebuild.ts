import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { importDocument, initializeVault, statAndHashVaultFile, validateVault, VAULT_LAYOUT } from "@murphai/core";
import { completeAssistantOnboarding, readAssistantOnboardingState } from "@murphai/assistant-engine/assistant-state";
import type { BrowserVaultReplica } from "@murphai/query/browser";
import { summarizeRecoveryReplica } from "./checkpoint-recovery-replica.ts";

async function requireMissing(file: string): Promise<void> {
  try { await access(file); }
  catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("recovery_rebuild_existing_canonical_foundation");
}

// Operates only in protected temporary scratch restored from the current
// checkpoint. The caller owns publication fencing and scratch disposal.
// Preserve the complete authenticated projection as source evidence instead
// of inventing the canonical fields or full document bodies it omits.
export async function rebuildPartialRecoveryVault(input: {
  vaultRoot: string;
  replica: BrowserVaultReplica;
  sourceBytes: Uint8Array;
  timezone: string;
  recoveredAt: string;
  completedOnboarding: boolean;
  signal: AbortSignal;
}) {
  input.signal.throwIfAborted();
  await requireMissing(path.join(input.vaultRoot, VAULT_LAYOUT.metadata));
  await requireMissing(path.join(input.vaultRoot, VAULT_LAYOUT.coreDocument));
  const scratch = await mkdtemp(path.join(tmpdir(), "murph-recovery-source-"));
  try {
    const sourcePath = path.join(scratch, "recovered-browser-vault.json");
    await writeFile(sourcePath, input.sourceBytes, { mode: 0o600 });
    input.signal.throwIfAborted();
    await initializeVault({ vaultRoot: input.vaultRoot, timezone: input.timezone, createdAt: input.recoveredAt });
    const imported = await importDocument({
      vaultRoot: input.vaultRoot, sourcePath, source: "checkpoint_recovery", occurredAt: input.recoveredAt,
      title: "Recovered Browser Vault data",
      note: "Partial recovery from the last surviving Browser Vault copy. The attached JSON preserves that copy's data, including historical metrics and available profile, goal, and document summaries. It is a derived projection, not the original vault: bodies may be truncated and fields or files may be absent. Consult this recovered source before asking the member to repeat information. Connected providers must resync authoritative device records.",
    });
    const preserved = await statAndHashVaultFile(input.vaultRoot, imported.raw.relativePath);
    if (preserved?.byteSize !== input.sourceBytes.byteLength
      || preserved.sha256 !== createHash("sha256").update(input.sourceBytes).digest("hex")) {
      throw new Error("recovery_source_preservation_failed");
    }
    input.signal.throwIfAborted();
    if (input.completedOnboarding) await completeAssistantOnboarding({
      vault: input.vaultRoot, reason: "manual", completedAt: input.recoveredAt,
    });
    const validation = await validateVault({ vaultRoot: input.vaultRoot });
    const onboarding = await readAssistantOnboardingState(input.vaultRoot);
    if (!validation.valid || input.completedOnboarding && onboarding.status !== "completed") {
      throw new Error("recovery_rebuild_validation_failed");
    }
    return { validVault: true, recoveredSourceBytes: preserved.byteSize,
      onboardingCompleted: onboarding.status === "completed", coverage: summarizeRecoveryReplica(input.replica),
      originalFilesRestored: false, restorationPerformed: false };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
