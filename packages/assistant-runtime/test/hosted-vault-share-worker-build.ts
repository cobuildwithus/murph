import assert from "node:assert/strict";
import { existsSync } from "node:fs";

export function assertHostedVaultShareWorkerBuilt(
  workerUrl = new URL(import.meta.resolve("@murphai/assistant-runtime/hosted-vault-share-capture-worker")),
): void {
  assert.ok(
    existsSync(workerUrl),
    "Vault-share entrypoint tests require the compiled capture worker. "
      + "Run pnpm --dir packages/assistant-runtime build from the repository root before direct Vitest runs.",
  );
}
