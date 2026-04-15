import { verifyScenarioIntegrity } from "./verify-scenario-integrity.js";

// Historical compatibility entrypoint for the root `pnpm test:smoke` alias.
verifyScenarioIntegrity({ coverageMode: process.argv.includes("--coverage") }).catch(
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  },
);
