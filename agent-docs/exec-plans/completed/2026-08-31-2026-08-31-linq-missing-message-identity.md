# Require Linq message identity before acceptance

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Prevent a successful Linq API response for an existing-chat message that
  lacks every provider message identity from being persisted as an accepted
  direct reply or consuming its answered mailbox input. Preserve the existing
  idempotent ambiguous-send recovery path so the same delivery can be safely
  retried.

## Success criteria

- A focused regression fails on the current base by showing that a 2xx Linq
  response without a message identity is returned as accepted.
- The accepted patch requires one provider message identity for ordinary
  existing-chat sends, without changing rich-link partial-delivery ownership or
  adding a second retry owner.
- Focused Linq runtime transport and affected typecheck proof pass.
- The exact pushed head passes repository completion review, required CI, and
  final ReviewGPT review before the ordinary bug-fix PR is handed to a human.

## Product UX

- Effort: `Patch`.
- Outcome: a direct iMessage reply whose provider acknowledgement lacks the
  identity needed for delivery confirmation stays recoverable instead of
  appearing durably complete.
- Reaches: ordinary existing-chat sends in hosted direct conversations and
  route-authorized groups. Identity-bearing replies, rich-link partial delivery,
  receipt ingestion, and the Web onboarding client preserve current behavior.
- Proof: the runtime-level and composed outbox regressions prove one provider
  request per attempt, an identical body and delivery key across safe text
  retry, and terminal ambiguity after one private-media reservation, upload, and
  message attempt.
- Walkthrough: `Ready`. Stable-body replies remain recoverable without an
  untrackable accepted state; private vault-backed media fails closed after
  provider ambiguity instead of risking a duplicate attachment or message.

## Scope

- In scope: hosted-runtime Linq transport acknowledgement validation, focused
  regression tests, required changelog evidence, and PR evidence.
- Out of scope: production data repair, replaying or resending historical
  deliveries, provider configuration, receipt ingestion, group receipt policy,
  telemetry backends, device-sync work, and autonomous merge or deployment.

## Constraints

- Technical constraints: reuse the current idempotency and ambiguous-send
  error contract; do not introduce a queue, state owner, provider retry loop,
  schema, migration, dependency, or production mutation.
- Product/process constraints: ReviewGPT owns production-code implementation;
  production evidence remains aggregate and content-free; ordinary bug-fix PR
  remains ready for human merge.

## Risks and mitigations

1. Risk: Treating an identity-less 2xx as a definitive failure could duplicate
   a provider-accepted message.
   Mitigation: classify the response as ambiguous and preserve the stable
   provider idempotency key and existing replay owner.
2. Risk: Applying the rule at the wrong boundary could break intentional
   identity-less attachment behavior or rich-link partial recovery.
   Mitigation: keep the correction on ordinary text chat creation/send results
   and add direct proof for the unaffected special cases.

## Tasks

1. [x] Record the base failure with a focused hosted-runtime Linq regression.
2. [x] Send ReviewGPT the privacy-safe root-cause and implementation packet.
3. [x] Inspect and apply only scoped, contract-aligned ReviewGPT patches.
4. [x] Run focused proof, affected typechecks, privacy/static checks, and
   completion audits.
5. [x] Commit, push, update the PR, and pass final ReviewGPT review on the exact
   candidate head concurrently with required GitHub checks.

## Decisions

- Selected over current runtime retry noise because it has direct durable
  accepted-work evidence, five affected direct runtime deliveries in seven
  days, a current code path that makes terminal correlation impossible, and no
  exact active owner.
- Local tiny-fix authority is ineligible because the correction changes
  provider acknowledgement and retry semantics; ReviewGPT must implement it.

## Verification

- Commands to run: focused `operator-config` Vitest for the Linq runtime
  transport, affected package typecheck, `git diff --check`, repository
  completion audit commands, required GitHub checks, and final ReviewGPT
  review. The package does not expose an ESLint executable or lint script;
  exact-head CI owns the repository static-analysis lane.
- Expected outcomes: identity-less 2xx results are ambiguous and nonterminal;
  identity-bearing sends retain current accepted behavior; all checks pass.
- Base proof: the focused runtime regression failed with `Missing expected
  rejection` while 73 neighboring tests passed.
- Candidate proof: the same file passed 74/74 tests; the operator-config
  typecheck passed; the composed assistant-runtime regression passed 15/15;
  assistant-runtime typecheck passed; the changelog fragment test passed 7/7;
  the Web typecheck passed; and `git diff --check` passed.
- ReviewGPT implementation: the first adjacent Web-client patch was rejected.
  A corrected artifact from the hosted-runtime owner was hash-verified,
  inspected for provider-call and retry ownership, and applied. One omitted
  pre-existing Web test was restored verbatim as non-production remediation;
  the final base-to-head diff contains no Web production or test behavior
  change outside the authored changelog fragment.
- ReviewGPT remediation: the accepted final-round finding was corrected by
  reusing the existing private-attachment reservation-ambiguity marker before
  generic replay. The hash-verified artifact added composed text and private
  image regressions and narrowed the public changelog claim.
- CI remediation: five CLI test doubles returned an empty response body despite
  a separate `json()` method. Test-only real JSON `Response` fixtures now satisfy
  the production parser contract; the focused CLI channel suite passed 29/29
  and the CLI typecheck passed.
- Final audit: ReviewGPT round 2 returned `ROUND_OUTCOME: PASS` with no
  qualifying findings on the corrected production candidate. The later CLI
  fixture correction is non-production-only and does not alter the reviewed
  mechanism.
Completed: 2026-08-31
