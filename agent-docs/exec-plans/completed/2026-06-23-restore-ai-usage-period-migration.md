# Restore AI Usage Period Migration

## Goal

Restore the missing hosted-web Prisma migration file so clean GitHub Actions checkouts include `2026062100_hosted_ai_usage_period_counter_backfill` and the `Murph Host Support` app verification shard can pass.

## Constraints

- Keep the fix scoped to the missing migration artifact and its existing invariant test surface.
- Preserve unrelated dirty assistant prompt/test edits in the current checkout.
- Do not expose secrets, local paths, or personal identifiers in code, docs, logs, or commits.

## Current Evidence

- GitHub Actions run `28060285176` failed in `Release app verification (ubuntu)`.
- Failing test: `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`.
- Clean CI checkout did not contain migration entry `2026062100_hosted_ai_usage_period_counter_backfill`.
- Local checkout had only an empty untracked directory for that migration; Git cannot commit empty directories.
- Earlier commit `da43bed5e` contains the intended `migration.sql` content.

## Plan

1. Restore `apps/web/prisma/migrations/2026062100_hosted_ai_usage_period_counter_backfill/migration.sql`.
2. Run the focused migration invariant test.
3. Run scoped app verification required for hosted-web migration work, or report any unrelated blocker.
4. Close the plan with a scoped commit that excludes unrelated dirty files.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
