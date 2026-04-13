# Greenfield Cleanup Non Revnet

## Goal

Land the non-RevNet greenfield cleanup before first deployment by removing remaining compatibility and cutover logic that the current hosted launch does not need.

## Why

- The repo is still pre-launch for hosted deployment, so internal compatibility aliases and rollout branches can often be hard-cut instead of preserved.
- The prior repo-wide audit identified concrete non-RevNet cleanup targets that reduce deploy, runtime, and persistence complexity without changing the intended first-launch feature set.

## Scope

- Cloudflare deploy/config/docs cleanup around direct deploy, stale rollout guidance, and the hosted device-sync env contract.
- Hosted assistant-delivery canonicalization cleanup across `packages/assistant-runtime`, `packages/hosted-execution`, and Cloudflare adapters/tests.
- Inboxd cleanup for raw-capture rescue and dead raw-only persistence helpers.
- Device-sync runtime apply-response cleanup requiring explicit `writeUpdate`.

## Constraints

- Do not remove or change RevNet code in this task.
- Preserve unrelated dirty `apps/web` hosted onboarding/auth route and test edits already in progress.
- Keep worker ownership disjoint and avoid reverting overlapping concurrent edits.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.

## Verification

- Run the truthful owner/package verification for each changed seam during iteration where practical.
- Run the required high-risk completion verification before handoff and record any unrelated pre-existing failures separately.
- Capture direct proof for the deploy/docs/env contract changes and the assistant-delivery/device-sync canonical-shape changes.

## Result

Status: completed
Updated: 2026-04-13

## Outcome

- Removed hosted assistant-delivery compatibility aliases and legacy hosted `intentId` tolerance, keeping `assistantDeliveryEffects` as the canonical hosted shape.
- Simplified hosted deploy/docs flow around direct deploy and clarified the hosted device-sync secret contract without removing the local control token.
- Hard-cut the hosted device-sync apply-response backfill so `writeUpdate` is now required explicitly.
- Removed the old inboxd raw-capture rescue lane while preserving only the narrow current-format crash-recovery path gated by unresolved `inbox_capture_persist` metadata.

## Verification Summary

- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir apps/cloudflare test:node`
- `pnpm --dir apps/cloudflare test:workers`
- `pnpm --dir packages/device-syncd test:coverage`
- `pnpm --dir packages/inboxd test:coverage`
- `pnpm typecheck`
- `pnpm verify:acceptance` still reproduces the unrelated pre-existing coverage blocker in `packages/assistant-runtime/src/hosted-runtime/platform.ts`
Completed: 2026-04-13
