# Hosted Web Migration Phase Split

## Goal

Minimize hosted web deploy downtime from schema/app skew by keeping Vercel build-time migrations backward compatible and moving destructive contract migrations to a post-deploy path.

## Constraints

- Preserve the existing automatic Vercel production migration wrapper for additive/expand migrations.
- Do not put destructive migrations in the predeploy Prisma lane after the current production incident baseline.
- Run contract migrations only after the production deployment reports success.
- Keep the implementation small, explicit, and easy to audit.
- Use direct Postgres connections for migration commands; do not print secrets.
- Open a PR, then run the ReviewGPT PR loop to zero accepted findings.

## Plan

1. Add a future-migration guard that blocks destructive Prisma SQL from the Vercel predeploy path.
2. Add a direct-DB post-deploy contract migration runner for sorted SQL files with idempotent metadata.
3. Wire a GitHub deployment-status workflow to run contract migrations after Vercel production success.
4. Update tests and durable deploy docs.
5. Run verification, commit in the isolated worktree, open a draft PR, and complete ReviewGPT.

## Verification

- Focused hosted web migration guard tests.
- Typecheck or scoped verification required by the repo workflow.
- `git diff --check`.
- ReviewGPT PR loop.

## State

Active. Implementation verified locally; ready to commit and open PR.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
