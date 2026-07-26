# Fix durable account deletion and group identity authorization

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Land the smallest current-main-compatible fixes for three reviewed hosted
  seams: durable post-account-deletion cleanup, authenticated Telegram group
  speaker attribution, and bounded Linq participant-derived entitlement.
- Preserve existing owner boundaries and reject stale patch hunks whose
  invariant is already implemented on current `main`.

## Success criteria

- Canonical account deletion cannot remove the only retry owner for pending
  Cloudflare, Stripe-customer, or Privy erasure, and the UI never reports full
  completion while those targets remain pending.
- Authenticated Telegram group messages retain stable blinded actor identity and
  bounded display attribution without using display data as authority; legacy
  envelopes and direct threads remain compatible.
- Linq participant-derived access, AI usage, and newsletter eligibility expire
  after one shared bounded lease unless a provider-authoritative observation
  safely renews an existing participant.
- Focused regression coverage, canonical diff verification, acceptance, required
  product/specialist review, final ReviewGPT, and PR CI pass on the final head.

## Scope

- In scope: account-deletion persistence/retry/UI truthfulness; Telegram
  producer-contract-parser-import-prompt attribution; Linq participant
  entitlement readers and safe lease renewal; focused tests, migration, and
  current durable docs.
- Out of scope: new schedulers, roster pagination redesign, provider membership
  APIs, unrelated migration-test cleanup, and unrelated hosted ingress changes.

## Constraints

- Technical constraints: reuse existing retention ownership; keep sensitive
  cleanup identifiers encrypted; use one canonical participant lease predicate;
  never create participant authority from an inbound identity alone; preserve
  additive wire compatibility and deploy-skew safety.
- Product/process constraints: isolated worktree/PR lane, preserve overlapping
  active work, keep the correction simple and composable, use canonical
  verification, and complete the required preliminary/final review gates.

## Risks and mitigations

1. Risk: the supplied patch was authored against an older ZIP and can overwrite
   newer current-main safety work.
   Mitigation: treat it as behavioral intent, inspect every hunk against current
   owners, and apply only current-compatible changes.
2. Risk: a cleanup receipt becomes a second account record or leaks vendor
   identity.
   Mitigation: make it foreign-key-free, encrypt the minimal payload with
   receipt-bound AAD, track only retry progress, and delete it on convergence.
3. Risk: Linq renewal lets arbitrary or delayed inbound regain access.
   Mitigation: renew only an existing non-removed row for the currently resolved
   member, clamp provider time, and use monotonic conditional writes.
4. Risk: cross-package Telegram rollout breaks legacy envelopes or direct chat.
   Mitigation: keep sender evidence optional and group-only, reuse the existing
   blinded actor path, and retain legacy parser coverage.

## Tasks

1. Compare the supplied patch with current `main` and map each invariant to its
   canonical owner and all authorization/retry readers.
2. Reconcile and implement only missing behavior, then inspect the complete diff
   for simplicity, privacy, and overlap.
3. Run focused tests, canonical `test:diff`, acceptance, typecheck, and required
   direct operational or UI proof.
4. Run the product-experience and preliminary specialist reviews, resolve
   accepted findings, close the plan, and push the final scoped commit.
5. Run final ReviewGPT concurrently with PR CI, resolve any accepted findings,
   and hand off the draft PR only after exact-head gates pass.

## Decisions

- Use a full plan because the supplied patch is cross-cutting, schema-bearing,
  privacy-sensitive, and operationally significant.
- The uploaded diff is evidence and implementation intent, not authority to
  regress current code or carry unrelated conflict-marker cleanup.
- Current `main` already carries the complete additive Telegram group-speaker
  attribution path, so this branch does not duplicate or replace it.
- Keep quiet Linq groups available without restoring stale unlimited authority:
  only an otherwise-denied inbound gets one 1.5-second authoritative roster
  read, and only an existing participant whose contact still resolves to the
  same active member may renew the shared lease.

## Verification

- Completed before preliminary review: 290 focused Web regressions, 11 focused
  Cloudflare regressions, Web and Cloudflare typechecks, Web lint, frontend
  design-proof tests, full migration deployment against disposable PostgreSQL,
  canonical `pnpm test:diff apps/web apps/cloudflare`, and
  `pnpm verify:acceptance`.
- Still required: exact-head preliminary specialists, parent final review,
  final canonical verification after remediation, final ReviewGPT, and GitHub
  CI.
- Expected outcomes: every selected check passes or has a credibly unrelated
  pre-existing failure documented with next-best proof; no privacy-sensitive
  identifier or local path appears in committed or published artifacts.
