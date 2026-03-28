# Cloudflare Hosted Email Bridge

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

Integrate the supplied hosted-only Cloudflare email bridge patch on top of the current dirty branch without discarding newer hosted-execution, assistant-runtime, inboxd, or CLI work already in flight.

## Scope

- Add the Worker-side hosted email ingress/send bridge and encrypted raw-email storage.
- Add the hosted runtime email event path and provider-neutral parsed-email normalization changes needed by the patch.
- Extend runtime-state and hosted-execution contracts for hosted email routing, canonical thread targets, and the new hosted event payload.
- Update the local assistant channel adapter and targeted tests so hosted email no longer depends on AgentMail inbox semantics.

## Constraints

- Preserve unrelated dirty edits already present in the overlapping hosted-execution, Cloudflare, CLI, and inboxd files.
- Treat the supplied patch as a behavioral reference rather than a file-for-file overwrite.
- Keep hosted email scoped to the Cloudflare-hosted lane; do not widen into unrelated onboarding or web UI changes.

## Risks

1. The patch was generated against a newer snapshot than the current shared tree.
   Mitigation: compare a clean patch-applied reference against the live worktree and manually port only the missing behavior.
2. Hosted email touches active lanes in `apps/cloudflare`, `packages/assistant-runtime`, and `packages/cli`.
   Mitigation: read live file state first, preserve adjacent edits, and avoid reverting structural changes already present in those files.
3. Repo-wide verification may still be blocked by unrelated in-flight failures.
   Mitigation: run focused checks while iterating, then run the required repo commands and separate unrelated failures explicitly if they remain.

## Verification Plan

- Focused tests for hosted email Worker ingress/send, hosted runtime ingestion, parsed-email normalization, and channel persistence while iterating.
- Required repo commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Working Notes

- The overlapping architecture-refactor lane already changed several hosted-execution imports and worker control paths; keep those newer shapes when they already satisfy the hosted-email behavior.
- The uploaded patch also updates `packages/runtime-state`; port those helpers carefully because the live branch already diverged in that package.
- Focused verification landed green for `packages/inboxd` typecheck/tests, `packages/assistant-runtime` typecheck, focused Cloudflare node tests, focused Cloudflare Workers-runtime tests, and focused CLI assistant-channel/cron tests.
- Required repo commands still stop in unrelated pre-existing dirty-tree failures: `pnpm typecheck` in `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`, `pnpm test` in `apps/web/src/lib/hosted-onboarding/webhook-service.ts`, and `pnpm test:coverage` in `apps/web/test/hosted-share-service.test.ts`.
- The repo-mandated spawned audit passes were attempted but blocked by the environment's subagent usage limit before any audit agent could return findings.
Completed: 2026-03-28
