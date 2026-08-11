# PR 1481 Pre-Checkpoint Private Completion

Status: completed
Created: 2026-08-10
Updated: 2026-08-10
Completed: 2026-08-10

## Goal

Resolve the final ReviewGPT finding that an exact private Assistant Ask
completion may wait behind the personal runtime's production idle-checkpoint
floor, while preserving the existing durable provider boundary and narrow
notification admission rules.

## Success criteria

- Static and executable proof either rejects the finding or demonstrates the
  production dirty-runtime delay before any correction.
- Only the deterministic private-completion notification family can join the
  existing pre-checkpoint external-completion path; ordinary notifications
  remain checkpoint-gated.
- The private completion is staged without advancing the production idle
  timer, but non-idempotent provider work still waits for durable checkpoint
  publication and repeats the existing Web authority assertion.
- Malformed input and replay remain fail closed and idempotent.
- Focused tests, package typechecks, lint where applicable, runtime assembly
  proof, exact-head CI, and final ReviewGPT pass.
- PR #1481 remains open and unmerged with a clean path to its configured base.

## Constraints

- Reuse the existing pre-checkpoint external-completion owner and causal
  outbox path; add no queue, state owner, service, or completion lifecycle.
- Keep generic notifications behind the idle-checkpoint floor.
- Preserve the exact-text, member, route, expiry, and provider-entry authority
  checks already landed for private completion.
- Update durable invariant/reliability text only if the proven correction
  changes the enumerated pre-checkpoint completion families.
- Do not rerun the preliminary specialist pass after remediation; rerun the
  final ReviewGPT gate and exact-head CI as required.

## Plan

1. Trace the real `aask_done_` identity from Web append through runtime mailbox
   prefetch, dirty-state scheduling, causal staging, checkpoint publication,
   and provider entry.
2. Add a failing production-faithful regression that demonstrates the current
   idle-floor behavior and preserves provider/checkpoint authority.
3. If proven, add the private-completion identity to the two existing
   kind-scoped pre-checkpoint allowlists and update the owning invariant text.
4. Run focused Runtime/Web/Cloudflare tests, affected typechecks, scoped lint,
   runner assembly/boot proof, and diff/privacy checks.
5. Perform the parent diff review, close this plan through `scripts/finish-task`,
   push the exact head, update the PR contract, and rerun final ReviewGPT plus
   GitHub Actions until no accepted finding remains.

## Findings and decisions

- Final ReviewGPT round 4 reported one original integration gap: the private
  completion uses deterministic `aask_done_` mailbox identity, while both
  pre-checkpoint external-completion filters currently enumerate only phone
  result and usage-referral notification families.
- Accepted. A failing entrypoint regression proved that `aask_done_*` imported
  only after the idle snapshot while the two existing exact families imported
  before it.
- The production-faithful detached-ask regression exposed one connected race
  beyond the review's proposed prefix edit: Web can signal the completion while
  the detached request is still being removed, and the coalesced wake can import
  the notification after the inspected prefix without immediately running the
  local causal phase.
- The correction keeps one owner. Both existing allowlists admit `aask_done_*`;
  exact imports set one invocation-local scheduling hint; and the existing dirty
  loop checks only the already-allowlisted local completion before sleeping.
  The local system mailbox and outbox remain the durable owners, and ordinary
  notifications remain checkpoint-gated.

## Verification

- Failing proof before correction: the private prefix imported after the idle
  snapshot, and the causal selector omitted it from its allowed prefix list.
- Assistant Runtime typecheck passed.
- Full workspace entrypoint and assistant-phase files passed 551/551 tests.
- Current-sender execution, private-completion integration, system-mailbox
  notification, and provider callback files passed 279/279 tests.
- The full Assistant Runtime suite passed: 84 files, 2,120 tests passed, and 4
  tests intentionally skipped.
- The Cloudflare runner production bundle assembled and passed its parity
  probes at 1,675,016 bytes entrypoint, 8,025,436 bytes static boot closure,
  and 10,002,927 bytes total, within the existing 1,689,254, 8,119,354, and
  10,033,613 byte limits.
- Assistant Runtime typecheck, `pnpm no-js`, `pnpm docs:drift`,
  `git diff --check`, and the added-line identifier-path scan passed. The
  package exposes no lint script, and the attempted root ESLint command was
  unavailable, so no lint result is claimed.
- Parent diff review found no new durable state, queue, service, lifecycle,
  provider-authority bypass, generic-notification admission, or user-visible
  copy change. The exact-head GitHub Actions and final ReviewGPT gate run after
  the scoped candidate commit and remain PR completion gates rather than local
  implementation work.
Completed: 2026-08-10
