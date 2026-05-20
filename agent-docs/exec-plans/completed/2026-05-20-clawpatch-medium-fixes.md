# Clawpatch Medium Fixes

## Goal

Fix the remaining medium-severity Clawpatch findings across package build, package-contract, and coverage surfaces.

## Scope

- `packages/assistant-cli`
- `packages/cli`
- `packages/gateway-core`
- `packages/importers`
- `packages/inboxd`
- `packages/messaging-ingress`
- `packages/setup-cli`
- `packages/vault-usecases`

## Constraints

- Preserve unrelated dirty work in the checkout.
- Keep fixes simple and package-local where possible.
- Do not add broad compatibility shims or weaken package boundaries.
- Avoid exposing local paths, personal identifiers, secrets, or raw authorization headers in code, tests, docs, or logs.

## Verification Plan

- Run package-local typecheck/test/coverage commands for touched packages where available.
- Run `pnpm typecheck` or scoped `test:diff` if the dirty worktree makes a full diff lane too broad.
- Revalidate the fixed Clawpatch finding ids.
- Run required completion audits before handoff.

## Progress

- Worker fixes integrated across package scripts, package boundary tests, importers build safety, and coverage config.
- All 11 medium Clawpatch findings revalidated as fixed.
- Simplify and security audit findings on the importers safe-build writer were addressed by staging importers TypeScript output under `.dist-next`, refreshing published `dist` only through the package safe build, and hardening safe-build sync against symlink traversal.
- Coverage audit added safe-build symlink regression proof.
- Final completion audit found and rechecked a safe-build temp-symlink issue; the copy path now uses a fresh `.dist-publish-*` directory outside `dist`, with regression coverage.
- Required verification passed except `pnpm deps:audit`, which remains blocked by unrelated pre-existing transitive advisories in `apps/web` dependencies. A final broad `pnpm test:diff` rerun was also blocked by unrelated dirty Cloudflare test work after the focused safe-build fix.
- Final completion audit passed with no remaining blocking findings.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
