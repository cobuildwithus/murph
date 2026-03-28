# Cloudflare Hosted Runner Phase 2

Status: completed
Created: 2026-03-26
Updated: 2026-03-28

## Goal

Close the main gaps between the current hosted Cloudflare runner implementation and the recovered handoff: broaden hosted bundle persistence, complete the one-shot runner loop, add better per-user coordination hardening, wire best-effort hosted device-sync wake dispatches, and add the missing Cloudflare/container deployment scaffold.

## Scope

- Broaden hosted bundle snapshot/restore so `agent-state` can carry sibling `assistant-state`, hosted `.runtime` state, and the minimal operator-home/config files required for hosted bootstrap.
- Add runtime-state tests for hosted bundle snapshot/restore behavior.
- Expand the hosted runner loop to include parser drain plus one-shot device-sync scheduler/worker passes using existing package seams.
- Harden the Durable Object state model for dedupe/retry/poison handling without inventing a second canonical persistence model.
- Add device-sync wake dispatch helpers in `apps/web` for hosted connection/webhook/disconnect flows.
- Add missing deployment/runtime scaffold such as `wrangler.jsonc`, `Dockerfile.cloudflare-hosted-runner`, and any truthful docs/env updates.

## Constraints

- Keep canonical health/inbox writes inside existing `core`/`inboxd`/`device-syncd`/assistant package APIs.
- Preserve the current local-first vault model; hosted state is orchestration and encrypted bundle persistence, not a second source of truth.
- Keep `apps/web` changes best-effort and narrow; wake dispatch failures must not break hosted device-sync or onboarding flows.
- Avoid broad CLI or repo-verification cleanup outside the minimum needed for this hosted lane.

## Risks

1. Broadening `agent-state` could accidentally sweep in sensitive or noisy local residue.
   Mitigation: snapshot explicit roots only, keep an allowlist mindset, and add focused tests for included/excluded paths.
2. Reusing device-syncd in a one-shot hosted runner may require more runtime assumptions than the current local daemon shape.
   Mitigation: reuse direct service/store seams only for single scheduler/worker passes and keep the adapter isolated.
3. DO retry/poison logic can sprawl quickly.
   Mitigation: keep the metadata model small and event-oriented, with bounded retries and explicit last-error/poison markers.
4. Container/deploy files can drift from actual runtime code.
   Mitigation: keep the scaffold minimal and document what is still placeholder versus actually wired.

## Verification Plan

- Focused runtime-state tests/typecheck for hosted bundle helpers.
- Focused `apps/cloudflare` tests/typecheck.
- Focused `apps/web` typecheck and targeted tests for new device-sync wake dispatch hooks.
- Required repo commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.

## Outcome

- Implemented broader hosted bundle persistence for sibling `assistant-state`, vault `.runtime`, and minimal operator-home config with dedicated runtime-state coverage.
- Expanded the one-shot hosted runner loop to drain parser jobs, run assistant automation once, and run a one-shot device-sync scheduler/worker pass.
- Hardened the Durable Object runner with queued dispatches, dedupe, retry scheduling, poison tracking, richer status, and internal route aliases (`/health`, `/internal/events`).
- Added best-effort hosted device-sync wake dispatches in `apps/web`.
- Added manual deployment scaffold and truthful runtime docs for the worker plus separate runner container.
- Verification passed for focused hosted-runner slices plus repo `pnpm typecheck`.
- Repo-wide `pnpm test` and `pnpm test:coverage` remain blocked by unrelated `packages/contracts` and `packages/cli` lanes already red outside this hosted-execution scope.
Completed: 2026-03-28
