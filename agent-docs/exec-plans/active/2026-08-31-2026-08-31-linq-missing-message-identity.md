# Require Linq message identity before acceptance

Status: active
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

1. Record the base failure with a focused hosted-runtime Linq regression.
2. Send ReviewGPT the privacy-safe root-cause and implementation packet.
3. Inspect and apply only a scoped, contract-aligned ReviewGPT patch.
4. Run focused proof, affected typechecks, privacy/static checks, and completion
   audits.
5. Commit, push, open the PR, and run final ReviewGPT review concurrently with
   required GitHub checks.

## Decisions

- Selected over current runtime retry noise because it has direct durable
  accepted-work evidence, five affected direct runtime deliveries in seven
  days, a current code path that makes terminal correlation impossible, and no
  exact active owner.
- Local tiny-fix authority is ineligible because the correction changes
  provider acknowledgement and retry semantics; ReviewGPT must implement it.

## Verification

- Commands to run: focused `operator-config` Vitest for the Linq runtime
  transport, affected package typecheck, focused ESLint, `git diff --check`,
  repository completion audit commands, required GitHub checks, and final
  ReviewGPT review.
- Expected outcomes: identity-less 2xx results are ambiguous and nonterminal;
  identity-bearing sends retain current accepted behavior; all checks pass.
