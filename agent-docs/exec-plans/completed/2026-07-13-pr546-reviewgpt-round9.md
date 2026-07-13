# PR 546 ReviewGPT round 9 remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Close both exact-head ReviewGPT round 9 High findings by using one exact
  Pulse provider-shape owner at every extension boundary and re-reading current
  Stripe authority inside the existing member mutation lock before activation.

## Success criteria

- Preview, Apply, update-result validation, and provider recovery reject
  incomplete item pagination and member/policy/item drift through the shared
  exact Pulse predicate.
- Preview proof changes when any exact provider decision fact changes.
- Checkout webhook, billing-success, and auto-enrollment activation cannot
  commit from a provider snapshot captured before the member lock wait.
- Contention tests prove canceled, paused, expired, or drifted provider state
  cannot create billing activation, mailbox, wake, or welcome effects.
- Required audits, reconciled-head verification, ReviewGPT round 10, CI, and
  merge pass.

## Constraints

- Reuse the existing exact Pulse predicate, member Stripe mutation lock,
  receipt owner, and billing writers.
- Resolve identifiers outside the lock only when needed; resolve mutable
  provider authority inside the lock immediately before durable writes.
- Do not add persisted state, a provider snapshot table, another receipt
  owner, queue, or billing writer.

## Tasks

1. Replace extension/recovery duplicate provider-shape predicates with the
   shared exact known-policy predicate and bind its decision fields into proof.
2. Add incomplete-page, Preview-to-Apply drift, update-result, and unchanged
   positive regressions.
3. Move authoritative Checkout/success/auto-enrollment subscription rereads
   under the existing member mutation lock.
4. Add lock-contention regressions proving stale trial snapshots cannot
   activate or emit post-commit effects.
5. Run required audits and full verification, commit/push, run exact-head
   ReviewGPT round 10, wait for final CI, and merge.

## Decisions

- Accept both Round 9 findings. The extension path duplicated the exact-shape
  decision with weaker fields, and all three activation entry points can carry
  mutable provider state across a member-lock wait.
- Reject the suggested new normalized snapshot abstraction. Directly reusing
  the exact predicate and binding its decision facts into the existing proof
  keeps one provider-shape owner without another representation.
- Accept the completion-audit finding that event time and pre-lock ownership
  are also stale authorities after lock contention. Capture decision time only
  after the in-lock provider read, and require direct/discovered billing owners
  to resolve to the same member again under the selected lock.
- Keep unresolved ordinary billing events out of their handlers: Checkout
  completes as a no-op when no authoritative owner exists, while subscription
  and invoice receipts remain retryable. Preserve the existing family-event
  path explicitly.
- Accept the final coverage findings as tests only. Add direct proof for
  standard Checkout owner drift and no-owner family Checkout, subscription,
  and invoice routing without changing production structure.
- No persisted state, queue, receipt owner, billing writer, or provider
  snapshot abstraction was added.

## Verification

- `pnpm --filter @murphai/hosted-web typecheck` — passed.
- Reconciliation regression suite — 45/45 tests passed.
- `pnpm test:diff apps/web` — passed: dependency/boundary/runtime guards,
  dev smoke, production build/typecheck, lint with 0 errors and 11 unrelated
  warnings, 381 test files passed and 1 skipped, 4,461 tests passed and 135
  skipped.
- Required final coverage, security/privacy, and completion re-audits — clean.
- `git diff --check` and sensitive-identifier scan — clean.
- Exact pushed-head ReviewGPT round 10, GitHub CI, and merge — pending.
Completed: 2026-07-13
