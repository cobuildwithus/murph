import { cleanupTokenAction } from "../../../scripts/github-app-token-action.mjs";

cleanupTokenAction().catch(() => {
  console.error("::error::GitHub App token cleanup failed; token will expire at its issued expiry.");
  process.exitCode = 1;
});
