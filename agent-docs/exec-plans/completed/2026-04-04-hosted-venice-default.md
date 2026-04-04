# Hosted Venice Default Provider

## Goal

Make the Cloudflare-hosted assistant path support Venice as the platform default provider, including deploy-time wiring for `VENICE_API_KEY` and hosted seed vars, while preserving the requested GPT-5.4 medium-reasoning configuration where the runtime truly supports it.

## Why This Needs A Plan

- The task touches hosted assistant bootstrap, external model-provider behavior, and deployment secrets/vars.
- The current runtime and deploy workflow already partially support Venice, so the safe change is to verify the existing path and patch the remaining gaps without broad refactors.
- Repo policy treats secrets, hosted runtime surfaces, and deploy configuration as high-risk.

## Guardrails

- Never print or persist secret values from local `.env` files or remote environments.
- Preserve unrelated worktree edits and keep the diff limited to hosted assistant/deploy wiring.
- Use the smallest change that makes the requested Venice default path valid and testable.

## Expected Evidence

- Repo proof showing Venice is already an allowed hosted secret/env key.
- Focused tests for hosted assistant bootstrap and Cloudflare deploy/runtime env wiring.
- Verification that the GitHub deploy workflow forwards the new Venice secret and hosted assistant seed vars.
- CLI proof for whichever remote environment manager is actually linked and appropriate for Cloudflare-hosted deploys.

## Exit Criteria

- Hosted assistant env seeding accepts the intended Venice configuration or documents the exact remaining provider limitation.
- Cloudflare deploy docs and workflow expose the required `HOSTED_ASSISTANT_*` vars and `VENICE_API_KEY`.
- Required verification passes, audit review completes, and the task ends with a scoped commit and cleaned-up ledger state.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
