import { resolveRuntimePaths } from "@murphai/runtime-state/node";

import type {
  InboxAppEnvironment,
  InboxServices,
} from "./types.js";

export function createInboxStorageRepairOps(
  env: InboxAppEnvironment,
): Pick<InboxServices, "compactParserAttempts" | "repairEnvelopes"> {
  return {
    async repairEnvelopes(input) {
      const paths = resolveRuntimePaths(input.vault);
      const inboxd = await env.loadInbox();
      await inboxd.ensureInboxVault(paths.absoluteVaultRoot);
      const result = await inboxd.runInboxEnvelopeMigration({
        ...(input.apply ? { apply: true } : {}),
        ...(input.maxFiles === undefined ? {} : { maxFiles: input.maxFiles }),
        vaultRoot: paths.absoluteVaultRoot,
      });
      return {
        vault: paths.absoluteVaultRoot,
        ...result,
      };
    },
    async compactParserAttempts(input) {
      const paths = resolveRuntimePaths(input.vault);
      const inboxd = await env.loadInbox();
      await inboxd.ensureInboxVault(paths.absoluteVaultRoot);
      const parsers = await env.requireParsers("compact legacy parser attempts");
      const result = await parsers.compactLegacyParserAttempts({
        ...(input.apply ? { apply: true } : {}),
        ...(input.maxAttempts === undefined
          ? {}
          : { maxAttempts: input.maxAttempts }),
        vaultRoot: paths.absoluteVaultRoot,
      });
      return {
        vault: paths.absoluteVaultRoot,
        ...result,
      };
    },
  };
}
