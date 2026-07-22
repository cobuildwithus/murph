# Hosted ask continuation round-three remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Resolve PR #840 ReviewGPT round-two findings by collapsing the Ask ordering
barrier onto the existing mailbox and outbox owners, without changing the idle
workspace snapshot schedule.

## Success criteria

- Every automatically actionable Ask completion older than the oldest pending
  personal input is discharged before that personal input is answered, even
  when an earlier completion creates no intent or already reached terminality.
- The outbox remains the sole owner of exact delivery wake and ambiguous-send
  semantics. Non-idempotent confirmation-pending work is not resent and cannot
  indefinitely block later accepted input.
- A real non-idempotent sending intent with no `nextAttemptAt` keeps the
  existing confirmation-grace and stale-reconciliation timing.
- The outbox-only compatibility scan and private Ask wake calculation are
  deleted; no new queue, scheduler, state machine, durable owner, or snapshot
  trigger is added.
- Focused tests, owner verification, exact-head CI, and ReviewGPT pass on the
  final PR head.

## Constraints

- Keep the mailbox row as the occurrence and ordering anchor and the outbox as
  delivery-state owner.
- Preserve the deterministic completion delivery key across replay.
- Keep the expensive idle workspace snapshot on its existing idle or shutdown
  schedule. Required pre-delivery phase commits do not move that timer.
- Preserve unrelated active work and keep private conversation, health, member,
  and local-machine identifiers out of durable artifacts.

## Approach

1. Export the existing exact-intent outbox wake fact and remove feature-private
   wake and terminality derivation.
2. Turn the pre-input Ask barrier into a discharge loop over retained mailbox
   rows, continuing past invalid, terminal, or safely parked older work before
   admitting personal input.
3. Remove the outbox-only fallback scan so the mailbox and outbox have one clear
   ownership boundary.
4. Add focused multi-completion, restart, confirmation-pending, and real
   sending-without-next-attempt regression proof.
5. Run required verification and coverage audit, commit and push the correction,
   then run ReviewGPT round three concurrently with exact-head CI.

## Review findings being remediated

- Review-induced: discharging one older completion could release a later
  personal reply without checking the remaining older completion set.
- Review-induced: the private Ask wake calculation could strand accepted input
  behind a deliberately parked non-idempotent confirmation-pending intent and
  could ignore owner-managed sending grace.

## Verification

- Focused runtime regressions: 470 tests passed across the Ask ordering,
  outbox-owner, completion-event, and pending-input-index suites.
- Idle-snapshot regression: 1 focused entrypoint test passed and proves the
  dirty-group fast path requests no early workspace snapshot; the sole snapshot
  remains `idle_shutdown`.
- `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- Coverage-write audit: clean; 460 targeted tests passed and every round-two
  ordering and ambiguous-send scenario has direct regression coverage.
- `pnpm test:diff packages/assistant-runtime`: passed, including 1,802 Assistant
  Runtime tests (2 skipped), 1,851 Cloudflare Node tests, the Cloudflare Workers
  lane, package boundaries, guards, and typechecks.
- `pnpm verify:acceptance`: passed, including all workspace coverage lanes,
  6,125 web tests (150 skipped), the production web build, and Cloudflare app
  verification.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- Privacy scan: passed; no member, conversation, health, email, or local-machine
  identifiers appear in the patch.
Completed: 2026-07-22
