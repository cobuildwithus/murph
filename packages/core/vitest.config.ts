import { execFileSync } from "node:child_process";
import { defineConfig } from "vitest/config";
import { createMurphPackageVitestConfig } from "../../config/vitest-package.js";

const config = createMurphPackageVitestConfig({
  configUrl: import.meta.url,
  name: "core",
});

// Opt-in proof runs compare every successful import with the complete builder.
// Keep the assertion and private-state access entirely out of production builds.
export default defineConfig({
  ...config,
  plugins: [{
    name: "device-identity-equivalence",
    enforce: "pre",
    transform(code: string, id: string) {
      if (!id.endsWith("/core/src/mutations.ts")) return;
      if (process.env.MURPH_IDENTITY_BASELINE) {
        return execFileSync("git", ["show", `${process.env.MURPH_IDENTITY_BASELINE}:packages/core/src/mutations.ts`], { encoding: "utf8" });
      }
      if (process.env.MURPH_IDENTITY_ASSERT !== "1") return;
      const original = "const result = await importDeviceBatchWithExecutionOptions(input, options, timing);";
      if (!code.includes(original)) throw new Error("Identity assertion insertion point changed");
      return code.replace(original, `
        const result = await importDeviceBatchWithExecutionOptions(input, options, timing);
        const cached = deviceEventIdentityCache.get(input.vaultRoot);
        if (cached) {
          const { assertIdentityIndexMatchesLedger } = await import("../test/identity-equivalence.ts");
          await assertIdentityIndexMatchesLedger(cached.index,
            await indexLatestEventsByExternalRef(input.vaultRoot, await listEventLedgerShardPaths(input.vaultRoot)));
        }
      `);
    },
  }],
});
