# PR 1004 ReviewGPT round-one remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-26

## Goal

- Resolve the three accepted exact-head ReviewGPT findings without adding a new
  scheduler, queue, participant store, or retry state machine.
- Preserve immediate truthful account-deletion acknowledgement, prevent a live
  Stripe Checkout from outliving canonical ownership, and let authoritative
  Linq roster recovery restore one verified participant outside the capped
  assistant-facing projection.

## Success criteria

- Account deletion expires every known nonterminal direct and Family Checkout
  before canonical rows are removed, and Checkout creation cannot return or bind
  a session after deletion wins the member fence.
- The post-commit route returns pending cleanup without awaiting external
  providers; the existing retention owner uses bounded per-target attempts and
  continues after one target stalls.
- A full authoritative Linq roster may create or reinstate exactly one
  contact- and identity-verified participant relationship, while inbound-only
  evidence remains update-only and provider failure or reassignment fails closed.
- Focused production-path regressions, canonical verification, acceptance,
  exact-head CI, and ReviewGPT correction round pass.

## Scope

- Direct and Family subscription Checkout session ownership and deletion fence.
- Existing encrypted account-deletion receipt and retention retry path.
- Existing Linq participant table and authoritative roster-recovery path.
- Focused tests, current billing/privacy/reliability docs, and PR intent/evidence.

## Constraints

- Reuse the deletion receipt, hourly retention sweep, Family billing-attempt
  owner, and participant table. Model direct Checkout attempts as a narrow
  member-owned collection because the API permits more than one live attempt.
- Do not weaken account-deletion billing fences or let an ordinary inbound mint
  participant authority.
- Keep provider waits bounded and keep account deletion truthful after its
  canonical transaction commits.
- Preserve unrelated working-tree and PR work.

## Risks and mitigations

1. Checkout completion can race expiry, and a member can hold more than one
   direct Checkout URL.
   Mitigation: persist every direct session in a narrow encrypted member-owned
   collection, fence creation and deletion with the existing member lock,
   retrieve the post-expiry Stripe state, and fail closed on ambiguity.
2. Removing foreground cleanup can delay convergence.
   Mitigation: the transaction already persists the encrypted retry owner;
   return pending immediately and let the existing hourly sweep converge.
3. Roster upsert can mint authority from a reassigned contact.
   Mitigation: require an authoritative current handle and re-resolve it to the
   same active hosted member before one canonical upsert or reinstatement.

## Tasks

1. Reproduce and trace each accepted finding through its production owner.
2. Implement the smallest owner-boundary corrections and direct regressions.
3. Run focused billing, privacy, retention, Linq, migration, typecheck, and
   canonical verification.
4. Update the PR current-head/disposition contract, close this plan, push, and
   run ReviewGPT correction round concurrently with CI.

## Decisions

- Accept all three substantive round-one findings.
- Treat the rendered-evidence note as a packaging gap, not a product-code
  finding; include the existing desktop/mobile renders in the correction review
  evidence without committing binary artifacts.
- The architecture pressure check keeps all retry and authorization behavior in
  existing owners.
- Final owner review rejected a single latest-session field: Pulse and Edge
  attempts can coexist, so last-write-wins would leave an older billable URL
  outside deletion. The accepted exception is one FK-owned encrypted collection
  with no scheduler or lifecycle state; it is deleted with the member after all
  rows have been made terminal.

## Review anomaly retrospective

- Original requirement: account deletion must remove canonical ownership only
  after billing is terminal or durably owned, acknowledge that canonical delete
  immediately, and bound Linq participant authority without stranding a current
  provider-verified member.
- First-reviewed shape: source `+1,024/-218`; it added the encrypted external
  cleanup receipt and participant lease, but still waited on providers after
  commit, omitted live subscription Checkout attempts, and required an existing
  capped participant projection row for recovery.
- Current shape before correction round: source `+1,544/-259`. Review
  remediation itself is `+556/-77` source, so it exceeds both the 500-line and
  25-percent source-addition triggers. The growth is attributable to direct and
  Family billing fences plus their shared Stripe terminalization helper,
  deadline-bounded use of the existing retention owner, and the one-sender
  authoritative Linq recovery proof. No repeated scheduler, queue, lease,
  participant store, or cleanup state machine was added.
- Architecture pressure result: a single latest-session field was insufficient
  because two direct plan attempts can coexist. Deletion, reordering, and the
  existing scalar billing ref cannot represent that demonstrated cardinality.
  The correction therefore uses one FK-owned encrypted collection with no
  lifecycle enum or worker; the existing member lock owns creation and account
  deletion owns terminalization and removal.
- Decision: justified continuation in this PR. Splitting billing would separate
  the deletion invariant from the exact external effect that can violate it;
  reverting or shrinking would knowingly preserve the charge-after-deletion
  path. The remediation removes the foreground provider owner and otherwise
  tightens existing boundaries, so a new PR or broader redesign would increase
  coordination without reducing concepts.

## Verification

- Focused remediation suites: 283 billing, Family, account-deletion, retention,
  Linq, and migration tests passed; targeted reruns passed 211 billing/privacy
  tests, 61 Linq tests, and 5 schema-contract tests.
- Web Prisma generation, schema validation, and TypeScript typecheck passed.
- Web lint passed with zero errors and 15 unrelated existing warnings.
- A fresh disposable PostgreSQL database applied all 128 migrations and was
  then removed.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff apps/web
  apps/cloudflare` passed in Testbox `tbx_01kygpx2hpxvnfx97warnz29y2`.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed in
  Testbox `tbx_01kygq2xyw4zj9cq7dcvch7a1x`.
- Required after push: PR CI and ReviewGPT correction round with the immutable
  first-reviewed head and round-one head as the previous-reviewed head.
Completed: 2026-07-26
