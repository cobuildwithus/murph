# Hosted AI usage reporting secret

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Wire `HOSTED_AI_USAGE_REPORTING_SECRET` into the Cloudflare hosted deploy workflow and create the production GitHub environment secret without exposing the value in repo files, shell env, or logs.

## Success criteria

- `.github/workflows/deploy-cloudflare-hosted.yml` forwards `HOSTED_AI_USAGE_REPORTING_SECRET` into the deploy job.
- The GitHub `production` environment has a `HOSTED_AI_USAGE_REPORTING_SECRET` secret set.
- Verification for the touched workflow surface runs and any unrelated blocker is named precisely.
- A scoped commit contains only this task's repo changes plus plan/ledger closeout.

## Scope

- In scope: the Cloudflare deploy workflow, active plan/ledger bookkeeping, and setting the GitHub environment secret by name only.
- Out of scope: Vercel env changes, hosted-web runtime code changes, secret rotation work, and any broader billing or usage-attribution refactor.

## Constraints

- Do not print or persist the generated secret value.
- Do not place the generated secret in shell environment variables.
- Preserve unrelated dirty-tree edits and active ledger rows.

## Tasks

1. [ ] Register the task in the coordination ledger.
2. [ ] Patch the deploy workflow to pass `HOSTED_AI_USAGE_REPORTING_SECRET`.
3. [ ] Set the GitHub `production` environment secret via direct pipe.
4. [ ] Run verification for the touched workflow surface.
5. [ ] Create a scoped commit.

## Verification

- Pending
Completed: 2026-04-24
