# Linq Webhook Follow-up Hardening

## Goal

Close the remaining Linq webhook trust-boundary gaps by enforcing signed timestamp freshness, giving all accepted `/api/linq/webhook` events a durable receipt barrier, separating onboarding-intent gating from active-member routing, and adding regression proof for sparse Linq webhook hydration.

## Why

- Signed Linq webhooks currently validate HMACs without checking timestamp freshness, which leaves a replay window open until event-level dedupe happens.
- `/api/linq/webhook` only persists routed bound `message.received` events today, so ignored or unpaired but signature-valid webhooks can replay indefinitely.
- The hosted onboarding Linq path still treats any non-active inbound text as onboarding input, even though active-member dispatch and “should this text start onboarding?” are separate decisions.
- Sparse receipt hydration still depends on the stored Linq snapshot retaining enough shape for both dispatch rebuild and downstream runtime ingestion; the current proof is too implicit.

## Scope

- hosted Linq environment and verification helpers
- `/api/linq/webhook` receipt persistence and duplicate behavior
- hosted onboarding Linq planning/gating logic
- sparse Linq receipt hydration regression coverage
- focused Linq tests in `apps/web` plus the primary inboxd verification unit

## Constraints

- Preserve existing routed-event queue behavior for paired active-member Linq control-plane events.
- Reuse the existing hosted webhook receipt infrastructure if it is sufficient; avoid widening into new schema unless necessary.
- Keep signed timestamp enforcement explicit and testable at both hosted entry points.
- Preserve unrelated dirty worktree edits and keep the change scoped to Linq webhook handling plus direct proof.

## Verification

- Focused Linq/hosted-web Vitest coverage for control-plane, onboarding auth/dispatch/route, sparse hydration, and inboxd webhook verification
- `pnpm --dir apps/web lint`
- `pnpm typecheck`
- note unrelated failures explicitly if repo-wide lanes remain red

## Commit Plan

- Use `scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
