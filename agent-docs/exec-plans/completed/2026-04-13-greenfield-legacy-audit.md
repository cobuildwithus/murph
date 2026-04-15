# Greenfield Legacy Audit And Prisma Bootstrap

## Goal

Audit the repository for removable pre-launch legacy, compatibility, and versioned cutover logic before first deployment, and collapse the hosted Prisma migration history to one bootstrap SQL file that matches the current schema.

## Why

- The repo is still greenfield on the hosted deployment path, so pre-launch compatibility layers can often be hard-cut instead of preserved indefinitely.
- The first hosted Postgres deployment should start from one truthful Prisma bootstrap migration instead of carrying legacy cleanup history.

## Scope

- Review-only exploration across `apps/**`, `packages/**`, `config/**`, `scripts/**`, and durable docs relevant to legacy or compatibility logic.
- Prisma bootstrap work under `apps/web/prisma/**` and any directly required hosted-web verification/tests.
- Durable doc updates only if the migration bootstrap policy or another durable rule needs correction.

## Constraints

- Preserve unrelated dirty `apps/web` hosted onboarding/auth route and test edits already in progress.
- Keep this turn focused on identifying pre-launch cleanup targets plus the Prisma bootstrap collapse; do not silently broaden into unrelated runtime rewrites.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.

## Verification

- Use the required high-risk repo-change lane truthfully for any landed Prisma edit.
- Prefer focused Prisma/schema validation and diff checks during iteration, then run the required repo verification commands before handoff.
- Record direct evidence for whether the bootstrap migration matches the current Prisma schema.

## Result

Status: completed
Updated: 2026-04-13
Completed: 2026-04-13

## Notes

- Refreshed `apps/web/prisma/migrations/2026040600_init/migration.sql` so the single bootstrap SQL file matches Prisma 7's current generated output from `apps/web/prisma/schema.prisma`.
- Direct proof passed via `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` diffed against the checked-in migration file.
- Focused migration proof also passed via `pnpm exec vitest run --config vitest.workspace.ts test/hosted-onboarding-privacy-foundation-migration.test.ts` and `pnpm exec prisma validate --config prisma.config.ts`.
- Repo-wide `pnpm verify:acceptance` remains red for apparently unrelated pre-existing failures in assistant-runtime coverage thresholds, CLI release-script coverage expectations, and at least one additional background package-coverage lane.
- Parallel repo review found likely greenfield cleanup targets to discuss next: dormant RevNet schema/runtime paths, direct-vs-gradual Cloudflare deploy branching, hosted assistant-delivery old-shape aliases, inboxd raw-capture rescue paths, device-sync legacy internal response backfill, and stale current-doc wording around device-sync hosted rollout.
Completed: 2026-04-13
