# Repair phone-transfer reconciliation

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make Settings reconcile an approved Privy phone transfer onto the existing
  Murph member without treating a declined transfer as success or reopening
  Privy after a Murph-side save failure.

## Success criteria

- Web management-reads the exact app-session Privy user after the fresh
  same-member gate.
- The Settings action opens Privy's phone flow directly from the single
  page-level provider, without a Murph preflight handoff.
- Normal link or update success synchronizes only the exact returned phone.
- Transfer exit synchronizes only a proven change from its authoritative
  pre-flow baseline; an unchanged baseline cancels quietly.
- A provider-confirmed transfer can retire only a source member proven to be an
  unused onboarding scaffold after Privy deleted its source principal.
- Source deletion, release of its stale phone projection, target reconciliation,
  and target channel enqueue commit atomically after a fresh target-Privy read
  and final safety recheck.
- Retry after provider completion repeats the same server expectation and never
  launches a second link or update flow.
- Focused tests, hosted-web lint and typecheck, review gates, and exact-head CI
  pass.

## Scope

- In scope: Settings phone link/update completion, transfer
  completion and cancellation, provider-confirmed retirement of an exact unused
  source scaffold through the existing account-deletion owner, sync-route
  authority, retry behavior, focused regressions, security documentation, and
  design-catalog behavior notes.
- Out of scope: general Murph account merging, provider dashboard policy,
  production data mutation, and unrelated authentication flows.

## Constraints

- Technical constraints: preserve the existing app-session and member ownership
  gate; provider state selects the phone outcome but never authorizes a member;
  phone persistence stays transactional and fail-closed on identity conflict.
- Product/process constraints: keep one visible provider dialog, preserve
  customer evidence as confidential, and ship through the existing PR.

## Risks and mitigations

1. Risk: a provider exit is interpreted as proof that a transfer completed.
   Mitigation: treat exit only as a wake-up and compare the management-read phone
   against the phone observed immediately before opening Privy.
2. Risk: provider propagation briefly exposes an old or absent phone.
   Mitigation: use bounded retries with the identical expectation and never
   persist an absent intermediate replacement.
3. Risk: retrying a failed Murph save mutates Privy twice.
   Mitigation: retain the completed sync expectation until it succeeds or an
   unchanged transfer is confirmed.
4. Risk: a stale Murph projection forces another provider flow after reload.
   Mitigation: compare the page-level Privy phone against the initial Murph
   projection and retry that exact repair expectation without reopening Privy.
5. Risk: a phone transfer is mistaken for authority to merge or erase product
   data from a real former member.
   Mitigation: require target-Privy ownership, typed source-Privy deletion, and
   an exhaustive exact classifier for only the unused onboarding scaffolds the
   product creates; any other relationship or activity fails closed to support.
6. Risk: source deletion commits while the target phone projection is absent.
   Mitigation: fresh-read target Privy immediately before a phone-locked,
   sorted-member-locked transaction that rechecks the source classifier and
   commits cleanup ownership, source deletion, target reconciliation, and
   target channel enqueue together.

## Tasks

1. [x] Record the repeated-finding retrospective and reproduce the callback bug.
2. [x] Replace client refresh inference with management-read server expectations.
3. [x] Add transfer, decline, propagation, retry, reload-repair, and deduplication
   regressions.
4. [x] Reconcile a provider-confirmed transfer by retiring only a proven unused
   source scaffold through the canonical account-deletion owner.
5. [ ] Complete scoped verification, parent review, commit, push, and PR evidence.
6. [ ] Run final ReviewGPT correction round with exact-head CI and resolve every
   accepted finding.

## Decisions

- The existing phone-sync endpoint remains the sole provider-to-Murph
  reconciliation boundary.
- Settings mounts one Privy provider, opens its phone flow directly, and keeps
  the provider phone observed before launch as the transfer baseline.
- Normal callbacks use an exact-phone expectation; transfer exits use a
  changed-from expectation.
- Client-supplied phone expectations may select an outcome but cannot select a
  member or bypass the fresh same-member gate.
- Provider-confirmed transfer never merges accounts. It may delete only an
  exhaustively classified unused onboarding scaffold; any general product data
  or other activity requires support.
- General account merging remains a separate product decision.

## Verification

- Thirteen focused Settings phone, identity, account-deletion, Privy,
  orchestration, device-sync, and ops suites pass with 356 tests.
- A direct local database probe proves every current browser-vault refresh
  event matches its canonical owner, time bucket, workspace version, and
  deterministic event id.
- Hosted-web typecheck, scoped lint, and `git diff --check` pass.
- Focused review found and resolved null-to-null transfer cancellation: a
  declined new-phone transfer now closes quietly while a transient null during
  an existing-phone transfer remains retryable.
- Browser proof of the final already-transferred phone reconciliation remains
  pending.
- Final parent review, exact-head review, and CI evidence remain pending.
