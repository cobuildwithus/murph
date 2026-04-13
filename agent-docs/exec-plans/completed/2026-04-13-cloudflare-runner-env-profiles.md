# Cloudflare Runner Env Profiles

## Goal

Enable the full hosted runner env profile set for deployed Cloudflare hosted execution so post-activation and hosted channel flows receive the integration env they require.

## Scope

- Default deploy automation and GitHub deploy workflow to the full supported hosted runner profile set.
- Update focused docs and tests that describe or assert the deploy behavior.
- Apply the same profile setting to the live `murph-hosted` Worker through the existing Wrangler-backed deploy path.

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not expose raw secret values or environment contents in logs, diffs, or handoff.
- Keep the change limited to deploy/config/docs/test surfaces; do not widen hosted runtime behavior beyond env forwarding.

## Verification

- Run truthful `apps/cloudflare`-scoped verification for touched files.
- Confirm the deployed worker reports the runner profile variable as present without printing its value.

## Notes

- Current production has `LINQ_API_TOKEN` configured on the Worker but omits `HOSTED_EXECUTION_RUNNER_ENV_PROFILES`, so the hosted runner falls back to the minimal `assistant,parsers,web` set and drops Linq env during member activation.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
