# Cloudflare Deploy Validator Hotfix

## Goal

Fix the Cloudflare hosted deploy artifact validator so `pnpm cf:deploy` accepts the production pnpm install layout and still rejects truly missing runner dependencies.

## Scope

- `apps/cloudflare/scripts/deploy-artifacts.ts`
- `apps/cloudflare/test/deploy-artifacts.test.ts`
- This execution plan and its coordination-ledger row

## Constraints

- Preserve unrelated dirty work.
- Do not weaken deploy-time validation for missing runner workspace dependencies.
- Keep the change narrow enough to rerun the deploy promptly.

## Verification

- Focused deploy artifact validation test
- `apps/cloudflare` typecheck
- `git diff --check`
- Rerun `pnpm cf:deploy` and watch the GitHub Actions workflow to completion

## State

- `pnpm cf:deploy` failed before Cloudflare deployment during deploy artifact validation.
- The failure was caused by valid pnpm virtual-store installs not always exposing every transitive workspace package as a top-level `node_modules` entry.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
