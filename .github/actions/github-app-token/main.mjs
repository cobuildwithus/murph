import { runTokenAction } from "../../../scripts/github-app-token-action.mjs";

runTokenAction().catch(() => {
  console.error("::error::GitHub App token action failed; no credential details were exposed.");
  process.exitCode = 1;
});
