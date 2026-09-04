# Recover fresh device data behind a retained retry

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Let a fresh same-connection device webhook admit one bounded device-sync pass
  even when an older exact continuation is waiting on its own local retry time.
  Preserve the older job's provider backoff and exact mailbox ownership while
  allowing newly arrived dirty data to be collected without waiting behind it.

## Success criteria

- A focused regression reproduces an older future retained device item followed
  by a due webhook item for the same connection.
- The older exact item owns the admitted pass; the later item is not executed
  out of order, and the retained job's own availability remains unchanged.
- A later scheduled-reconcile duplicate does not bypass provider backoff.
- Different-connection concurrency and ordinary same-connection ordering stay
  covered by the existing suite.
- The fix is merged, the hosted runner is deployed, and the affected member
  shows a new device pass plus forward sync progress.

## Scope

- In scope: assistant-runtime system-mailbox selection and wake projection,
  focused synthetic coverage, durable retry documentation, and member-facing
  recovery copy.
- Out of scope: provider retry-delay policy, mailbox or workspace schemas,
  Temporal wire changes, manual production database mutation, and new queues or
  persisted owners.

## Constraints

- Technical constraints: preserve per-connection serialization and the local
  device job store as the only retry-time owner; a newer webhook is admission
  authority for a pass, not authority to make an older provider job due.
- Product/process constraints: keep production evidence private, use only
  synthetic fixtures in the repository, recheck public and private PR overlap
  before push and merge, and follow the high-risk runtime PR/deploy gates.

## Risks and mitigations

1. Risk: a repeated scheduled reconciliation could accidentally hammer a
   provider before its retained retry time.
   Mitigation: allow only a due same-connection `webhook_hint` successor to
   admit the older frontier, and prove scheduled duplicates remain blocked.
2. Risk: executing the later webhook row directly could split local continuation
   ownership across two mailbox items.
   Mitigation: select the older exact frontier for the pass; leave the later row
   durable and ordered behind it.
3. Risk: wake projection and execution selection diverge again.
   Mitigation: derive both from one helper and cover both the candidate resolver
   and the end-to-end system-mailbox entrypoint.

## Tasks

1. Completed: added the failing same-connection retained-retry/webhook regression.
2. Completed: implemented the smallest shared admission projection and updated the durable
   reliability contract.
3. Completed: ran focused tests, package typecheck, complexity, diff/privacy
   checks, and the Product UX walkthrough; committed and opened draft PR #2723.
4. Complete exact-head CI and ReviewGPT, merge, deploy the Cloudflare runner,
   and verify live member recovery.

## Decisions

- Treat the previously merged mailbox-owner fix as necessary but insufficient:
  it enabled the affected frontier to run and exposed a separate starvation
  case caused by a legitimate 24-hour historical retry ahead of fresh dirty
  webhook work.
- Keep Temporal unchanged. Its repeated no-progress probes are downstream of
  the hidden local retry, while the user-visible delay is owned by runtime
  same-connection admission.
- A due webhook admits the older exact retained item only when one of its
  retained job hints owns the same future retry timestamp. This excludes outer
  transient failures and scheduled-reconcile duplicates from early admission.

## Verification

- Commands to run: focused mailbox-state and system-mailbox entrypoint Vitest
  suites; assistant-runtime typecheck; `pnpm complexity:diff`; changelog checks;
  `git diff --check`; identifier scan; exact-head GitHub checks and final
  ReviewGPT.
- Expected outcomes: the regression fails on the old selector, passes with the
  shared admission rule, all neighboring ordering/backoff cases stay green, and
  production records a new device pass followed by updated sync completion or
  an explicit provider-level terminal diagnosis.
- Local results: the focused regression failed with no selected item before the
  change. After the change, 20 mailbox-state tests, 62 system-mailbox execution
  tests, 53 entrypoint tests, and 46 changelog tests pass; assistant-runtime
  typecheck, complexity, diff, and private-identifier checks pass.
Completed: 2026-09-02
