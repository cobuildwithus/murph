# PR 1726 projection integration

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Integrate the reviewed group-share readiness contract from PR 1688 with PR
  1726's reviewed post-import projection convergence contract.
- Preserve both sets of privacy, durability, bounded-work, source-version, and
  foreground-preemption guarantees while resolving the shared projection wire
  and runtime owners once.

## Success criteria

- First-materialization work keeps its generation proof, null-only bounded
  paging, opaque deferral, durable mailbox retry, and truthful pending state.
- Post-import refresh keeps immutable checkpoint capture, one owned delivery,
  exact effect deadlines, source-workspace fencing, and dirty acknowledgement
  only after a complete projection opportunity.
- The combined transport carries every proof required by both contracts and
  retains fail-stop behavior for ambiguous or shared-infrastructure failures.
- Focused integration tests, affected typechecks, production runner assembly,
  ReviewGPT when required, exact-head CI, and parent review pass before merge.

## Scope

- The existing hosted vault-share wire, Cloudflare transport, Web delivery and
  projection-store seams, assistant-runtime projection/mailbox owners, their
  focused tests, and matching durable documentation.
- Derived runner-bundle budget ratchets only when exact assembly proves the
  combined reviewed graph requires them.

## Constraints

- Add no queue, scheduler, cursor table, status column, manager, or second retry
  lifecycle.
- Keep Web authoritative for grants and replacements and the personal runtime
  authoritative for private vault reads.
- Keep transactions short and database-only; no provider or network work may
  enter a transaction.
- Preserve unrelated changes already present in both branches.

## Tasks

1. [x] Inspect both exact reviewed heads, their conflict set, prior findings,
   deployment contracts, and focused proof.
2. [ ] Merge the landed PR 1688 head, resolve every overlap by preserving both
   reviewed mechanisms, and add only missing integration coverage.
3. [ ] Run focused tests, affected typechecks, docs guards, production runner
   assembly, diff/privacy checks, and parent review.
4. [ ] Push the exact candidate, run the applicable ReviewGPT continuation and
   exact-head CI, resolve accepted findings, and prove current-base mergeability.
5. [ ] Merge PR 1726 and retire its clean inactive worktree.

## Decisions

- Extend PR 1726's existing immutable capture and single-delivery owner with PR
  1688's projection mode, generation token, and opaque deferred-work metadata.
  Do not restore direct mutable-vault delivery or detach publication.
- Keep ordinary post-import refresh and durable first materialization as two
  modes of the same projection owner. The mode changes Web selection and retry
  classification, not ownership or persisted state.
- Treat the cross-PR source conflicts as behavior-significant until focused
  combined-path proof and review show otherwise.

## Verification

- Pending.
