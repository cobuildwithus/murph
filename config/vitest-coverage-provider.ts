import path from "node:path";
import { tmpdir } from "node:os";

import baseCoverageModule from "@vitest/coverage-v8";
import type { CoverageProvider, CoverageProviderModule } from "vitest/node";

type CoverageProviderWithFilesDirectory = CoverageProvider & {
  coverageFilesDirectory: string;
};

const mod: CoverageProviderModule = {
  ...baseCoverageModule,
  async getProvider() {
    const provider =
      await baseCoverageModule.getProvider() as CoverageProviderWithFilesDirectory;
    const originalInitialize = provider.initialize.bind(provider);

    provider.initialize = (ctx: Parameters<typeof originalInitialize>[0]) => {
      originalInitialize(ctx);
      provider.coverageFilesDirectory = path.join(
        tmpdir(),
        "murph-vitest-coverage",
        `${process.pid}`,
      );
    };

    return provider;
  },
};

export default mod;
