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
- Preparation repairs provider-to-Murph projection drift before another
  provider mutation can open.
- Normal link or update success synchronizes only the exact returned phone.
- Transfer exit synchronizes only a proven change from its authoritative
  preparation baseline; an unchanged baseline cancels quietly.
- Retry after provider completion repeats the same server expectation and never
  launches a second link or update flow.
- Focused tests, hosted-web lint and typecheck, review gates, and exact-head CI
  pass.

## Scope

- In scope: Settings phone preparation, link/update completion, transfer
  completion and cancellation, sync-route authority, retry behavior, focused
  regressions, security documentation, and design-catalog behavior notes.
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
   against the preflight baseline.
2. Risk: provider propagation briefly exposes an old or absent phone.
   Mitigation: use bounded retries with the identical expectation and never
   persist an absent intermediate replacement.
3. Risk: retrying a failed Murph save mutates Privy twice.
   Mitigation: retain the completed sync expectation until it succeeds or an
   unchanged transfer is confirmed.
4. Risk: a stale Murph projection forces another provider flow after reload.
   Mitigation: compare provider and Murph state during preparation and repair
   drift before choosing link versus update.

## Tasks

1. [x] Record the repeated-finding retrospective and reproduce the callback bug.
2. [x] Replace client refresh inference with management-read server expectations.
3. [x] Add transfer, decline, propagation, retry, reload-repair, and deduplication
   regressions.
4. [ ] Complete scoped verification, parent review, commit, push, and PR evidence.
5. [ ] Run final ReviewGPT correction round with exact-head CI and resolve every
   accepted finding.

## Decisions

- The existing phone-sync endpoint remains the sole provider-to-Murph
  reconciliation boundary.
- A preparation request returns the exact provider baseline or repairs drift.
- Normal callbacks use an exact-phone expectation; transfer exits use a
  changed-from expectation.
- Client-supplied phone expectations may select an outcome but cannot select a
  member or bypass the fresh same-member gate.
- General account merging remains a separate product decision.

## Verification

- Focused Settings phone, phone-sync route, phone-support, and identity-dialog
  suites pass with 44 tests.
- Hosted-web typecheck and scoped lint pass.
- Documentation and final exact-head review evidence remain pending.
