# pr1002-reviewgpt-correction-4

Status: completed
Created: 2026-07-26
Updated: 2026-07-27

## Goal

- Close PR 1002's remaining exact-head ReviewGPT findings by extending the
  existing direct-OAuth lifecycle marker through callback token exchange and
  durable connection commitment, without adding lifecycle state.

## Success criteria

- A live start is rejected before any expired-marker provider cleanup begins.
- The member suspension commits before destructive expired-marker cleanup.
- URL-only OAuth expiry is classified without current provider credentials.
- Unknown and owner-creating providers without cleanup support remain
  fail-closed.
- Direct-OAuth callbacks cannot exchange provider tokens or commit a connection
  after account deletion wins the hosted-member fence.
- Account deletion cannot suspend a member while a consumed direct-OAuth
  callback still owns its pending marker.
- Callback success is returned only after the durable connection is committed
  under the active-member fence and the exact marker is completed.
- Provider denial and missing-code callbacks complete their marker before any
  provider exchange, while a seedless failure after exchange may have begun
  retains its consumed marker without positive cleanup proof.
- Focused unit and real-PostgreSQL ordering tests pass.
- The draft PR is reconciled with current `main`, CI passes, and the exact
  PR-specific patch receives a passing ReviewGPT correction.

## Scope

- In scope: hosted account-deletion ordering, configuration-independent provider
  classification, direct-OAuth callback fencing, focused lifecycle tests,
  design-evidence packaging, and PR evidence.
- Out of scope: new persistence, background cleanup, provider onboarding
  redesign, merging the draft PR, or unrelated device-sync changes.

## Constraints

- Reuse the existing pending marker, its existing consumed timestamp, deletion
  cutoff, hosted-member lock, provider manifest, and provider cleanup interface.
- Keep provider I/O outside database transactions.
- Preserve truthful pre-start Cancel behavior and the ambiguous/reload recovery
  path after suspension commits.

## Risks and mitigations

1. Risk: an expired marker is cleaned before a live sibling rejects deletion.
   Mitigation: read-only preflight before provider I/O and a cutoff-consistent
   recheck under the member locks.
2. Risk: a provider disabled after an OAuth start blocks deletion forever.
   Mitigation: classify known URL-only OAuth providers from the canonical
   configuration-independent manifest.
3. Risk: a new live marker stages between preflight and suspension.
   Mitigation: recheck the same live-at-cutoff predicate inside the suspension
   transaction before writing `suspendedAt`.
4. Risk: deletion suspends after callback state consumption but before provider
   token exchange or durable connection commitment.
   Mitigation: consume the pending callback state and commit its connection only
   under the active hosted-member lock; retain a consumed pending marker as live
   until callback completion.
5. Risk: an interrupted callback leaves an upstream grant without a durable
   cleanup owner.
   Mitigation: consumed pending markers remain fail-closed even after their
   authorization expiry; only the exact successful callback completion clears
   the pending flag.
6. Risk: provider exchange accepts a one-time code but fails before returning a
   connection that Murph can persist or revoke.
   Mitigation: classify denial and missing code before provider exchange; once
   provider completion is attempted, retain a seedless consumed marker unless
   cleanup is positively confirmed.

## Tasks

1. Split pending-start handling into read-only live preflight, locked suspension,
   and post-suspension expired cleanup.
2. Resolve URL-only OAuth classification from the canonical provider manifest
   before constructing a configured provider registry.
3. Add mixed expired/live, staging-barrier, cleanup-order, missing-config, and
   fail-closed tests.
4. Package the rendered retry-state evidence claimed by the PR body.
5. Preserve the pending marker when finalizing a direct-OAuth authorization URL,
   consume callback state under the active-member fence, atomically commit the
   callback connection under that fence, and complete only the exact consumed
   marker after established hooks finish.
6. Add both callback/deletion race barriers: deletion winning before token
   exchange, and callback commitment holding deletion after token exchange.
7. Run scoped and canonical verification, update the draft PR, and complete the
   exact-head review/CI gate.
8. Resolve ReviewGPT round 5's ambiguous seedless exchange finding with focused
   ingress and real-PostgreSQL fail-closed proof; do not start a sixth
   substantive ReviewGPT round after the repository hard cap.

## Decisions

- Suspension is the deletion authority boundary. Live markers may reject only
  before that boundary; destructive provider cleanup happens only after it.
- The existing deletion cutoff determines which markers are live for both the
  initial preflight and locked recheck.
- Provider capability configuration and provider lifecycle classification are
  separate concerns; URL-only OAuth classification must not require credentials.
- For direct OAuth, authorization-URL return is not terminal. The lifecycle
  remains pending through callback state consumption, provider token exchange,
  connection persistence, and established-hook completion.
- `device_oauth_session.consumed_at` identifies a callback that owns provider
  side effects. A consumed pending marker remains live past its authorization
  expiry so account deletion fails closed instead of deleting the only cleanup
  owner.
- OAuth provider denial and missing code are ingress-owned pre-exchange
  outcomes. Any seedless exception after provider completion is invoked remains
  ambiguous unless a connection is returned or provider cleanup succeeds.

## Verification

- Focused hosted unit/UI suites: 105 tests passed; 17 opt-in tests skipped in
  the ordinary lane.
- Real PostgreSQL device-start/account-deletion suites: 92 tests passed,
  including expired-plus-live sibling rejection, staging between preflight and
  the locked recheck, suspension before blocked owner cleanup, and URL-only
  OAuth expiry without current provider credentials.
- Hosted-web typecheck and affected ESLint passed after regenerating the local
  Prisma client for `main`'s newly merged cleanup-receipt model.
- The ordinary merge of current `main` preserved its durable external-cleanup
  receipt and terminal cleanup-status UI while retaining the retryable
  wearable-start confirmation state.
- Crabbox `pnpm test:diff`: passed in Testbox
  `tbx_01kygvvykasey43kpqapr64639`
  ([Actions run](https://github.com/cobuildwithus/murph/actions/runs/30236069810));
  539 files and 6,881 tests passed with 14 files and 205 tests skipped.
- Crabbox `pnpm verify:acceptance`: passed in Testbox
  `tbx_01kygvw3sj8baxj8b8npny0z1b`
  ([Actions run](https://github.com/cobuildwithus/murph/actions/runs/30236073583)).
- Exact-head ReviewGPT correction round 4 found the direct-OAuth callback gap
  after confirming the earlier deletion-order and provider-classification
  corrections.
- Direct-OAuth callback remediation focused tests: 70 package tests passed;
  125 hosted-web tests passed with 18 opt-in cases skipped in the ordinary
  lane. Device-sync and hosted-web typechecks plus affected hosted-web ESLint
  passed.
- Fresh migrated worktree PostgreSQL proof: 94 tests passed, including
  deletion attempts after callback state consumption before token exchange and
  after token exchange before durable connection commitment.
- After merging current `main`, the focused device-sync ingress suite passed
  all 70 tests, the hosted focused lane passed 91 tests with 18 opt-in cases
  skipped, both affected typechecks passed, agent-doc drift and diff checks
  passed, and the fresh PostgreSQL ordering lane again passed all 94 tests.
- The merged-head local `pnpm test:diff` exposed a stale worktree install:
  source and lockfile required `@cobuild/review-gpt` 0.5.117 while the shared
  install still contained 0.5.114. A frozen-lockfile install corrected it and
  the previously failing CLI audit assertion then passed.
- The corrected local `pnpm test:diff` passed the directly changed
  device-sync package and the preceding reverse-dependent suites, then stopped
  only in the unchanged hosted-local harness because its documented
  `@murphai/assistant-runtime/dist` prerequisite was absent. The prerequisite
  package build waited ten minutes behind an independently owned active
  acceptance run; the idle task-owned waiter was stopped without signaling the
  active run. Neither the harness nor assistant-runtime differs from
  `origin/main`.
- Crabbox `pnpm verify:acceptance`: passed in Testbox
  `tbx_01kyh1eb3ngg14qv7dde0vhds0`
  ([Actions run](https://github.com/cobuildwithus/murph/actions/runs/30240432723)).
- Crabbox `pnpm test:diff`: the generated Health Commons artifact was supplied
  after the first fresh-box artifact miss, after which two identical
  Testboxes reached only an unrelated `packages/hosted-local-harness` Linux
  Docker-host resolution failure (65 tests fail before their assertions because
  no container-reachable worker host can be resolved). The complete final
  reproduction used Testbox `tbx_01kyh0vv4pd6a3q9bzg4vstxnw`
  ([Actions run](https://github.com/cobuildwithus/murph/actions/runs/30239956291)).
- Post-fix PR CI passed on exact pushed head
  `326cb43a2ee3973dfbc3f6bdab7f29df46cbdccd`: all 27 reported checks
  passed or were intentionally skipped. The sole first-attempt failure was an
  unrelated hosted-local Linq shard whose web server and Temporal metrics
  process were assigned the same ephemeral localhost port; rerunning only the
  failed jobs passed.
- Exact-head ReviewGPT correction round 5 returned one accepted high-severity
  finding: an ambiguous seedless provider exchange failure cleared its marker
  without cleanup proof. The focused regressions failed on the reviewed head
  for that exact reason, then passed after ingress moved denial/missing-code
  validation before provider invocation and retained every attempted seedless
  failure without positive cleanup proof.
- Post-fix focused verification: all 72 public-ingress tests passed; both
  affected typechecks and affected hosted lint passed; the hosted focused lane
  passed 91 tests with 19 opt-in cases skipped; and the fresh PostgreSQL
  lifecycle lane passed all 95 tests, including forced expiry after an
  ambiguous provider exchange with the member still unsuspended.
- ReviewGPT reached the repository's five-round hard cap. No sixth substantive
  round will run; final confidence comes from the preliminary specialist pass,
  parent review, focused and PostgreSQL proof, PR CI, and the existing
  acceptance evidence.
Completed: 2026-07-27
