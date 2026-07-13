# PR #563 group join confirmation UX correction

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Replace the alarm-like yes/no group-join check-in with a calm private
  confirmation that names the group, explains the sharing editor honestly,
  and reflects whether the member joined on the web or from a group-chat
  reaction.

## Success criteria

- Both supported first-join paths persist their origin with the existing
  confirmation obligation and render a deterministic origin-specific message.
- The server sanitizes the current group display name before placing it in
  exact user-facing text; group content never enters model instructions or a
  model turn.
- The confirmation never asks for yes/no, implies that a reply removes the
  member, or frames the join as a security alarm.
- Existing membership-derived delivery keys, private-route authority,
  deferred materialization, retry behavior, and rollout compatibility remain
  unchanged.
- Focused tests, truthful app verification, required completion audits, final
  exact-head CI, and exactly one fresh final ReviewGPT Pro audit pass.

## Scope

- In scope: the existing hosted group membership confirmation obligation,
  server-rendered copy, additive migration/schema surface, focused tests,
  product contract, PR description, conflict reconciliation, and completion
  gates.
- Out of scope: group leave behavior, a new mailbox kind, a retry queue or
  scheduler, model-generated notification copy, and the unrelated hosted
  runner entry-budget ratchet on `main`.

## Constraints

- Preserve unrelated working-tree and ledger work.
- Keep the origin fact only as long as the existing confirmation obligation
  needs it; do not create a second lifecycle owner.
- Keep the membership-derived mailbox event, dedupe token, and idempotency key
  unchanged.
- Resolve `origin/main` with ordinary Git history operations and retain the
  current migration-test intent from both sides.
- Run one final ReviewGPT round only after the final PR-specific head is
  pushed, in parallel with CI; do not rerun for a base-only update.

## Tasks

1. Reconcile the current `origin/main` conflict without changing the unrelated
   hosted-runner entry budget.
2. Persist the known join origin on the existing pending confirmation row and
   clear it when that obligation reaches a terminal state.
3. Render sanitized-name, origin-specific exact text on the server and update
   focused tests plus the durable product contract.
4. Run required security/privacy and coverage passes, direct scenario proof,
   routed verification, and parent final review; resolve concrete findings.
5. Finish the scoped commit, push the clean head, update the PR intent, start
   exactly one final ReviewGPT Pro audit with a 120-minute timeout alongside
   CI, and continue until merge-ready or concretely blocked.

## Verification

- Focused hosted group confirmation/store/adapter and migration tests.
- `pnpm test:diff` for the touched `apps/web` slice, or the routed hosted-web
  verification fallback if the diff lane is not truthful.
- Direct readback proving web, group-chat reaction, sanitized-name fallback,
  stable membership keys, and exact-text/model-bypass behavior.
- Required local security/privacy and coverage audit passes.
- `git diff --check`, privacy/identifier inspection, clean merge proof, final
  PR CI, and one final ReviewGPT Pro audit on the exact pushed head.
Completed: 2026-07-13
