# Cloudflare Hosted Runner Follow-Up Patch

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

Apply the provided deploy-focused follow-up patch for `apps/cloudflare`, keeping the existing Worker plus separate runner-container shape while closing the remaining deployment-blocking runtime, scaffold, and test gaps.

## Scope

- Add the missing runner deployment scaffold files and local example env files.
- Harden the worker and runner runtime behavior around health checks, manual runs, runner timeouts, bundle write dedupe, and alarm clearing.
- Add focused tests for the new hosted-runner behaviors.
- Update repo and app docs so the current Cloudflare/manual deploy path stays truthful.

## Constraints

- Keep the existing Worker plus separate Node runner design; do not rewrite this lane to Cloudflare Containers.
- Preserve the local-first core runtime seams and current hosted trust-boundary posture.
- Do not broaden into `apps/web` or unrelated package work unless a narrow integration fix is required for this patch to remain truthful.
- Preserve adjacent dirty edits already in the tree.

## Verification Plan

- Focused `apps/cloudflare` tests after integration.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion-workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`.

## Notes

- Source of truth for the requested behavior is the user-supplied patch at `<REDACTED_PATH>/cloudflare-hosted-runner-fixes-full-relative.patch`.
- If required repo checks stay red for pre-existing reasons, record the failing targets and keep the handoff scoped to this hosted-runner lane.
Completed: 2026-03-26
