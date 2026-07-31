# Restore Family usage top-ups and reset the usage meter

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Restore the Family owner's authorized Add usage entry point for their own
  active seat, keep the chooser dollar-first, and make the Settings usage meter
  begin at 0% used whenever a new purchase grant or monthly allowance
  replenishment creates a fresh capacity epoch.

## Success criteria

- An active Family owner sees Add usage for every currently eligible active
  Family member, including the owner's own seat, without exposing that action
  to sponsored non-owners.
- The shared personal and Family chooser presents only the fixed `$5`, `$10`,
  and `$25` credit amounts, with no approximate message-count labels.
- A fulfilled purchase makes a previously exhausted member's Settings meter read
  `0% used`; later counted usage advances the percentage from that grant.
- A monthly allowance reset also starts a fresh `0% used` epoch while unused
  carryover credit remains available.
- Settings, Home, assistant reads, admission, and settlement continue to consume
  the existing Web-owned allowance and credit owners; no balance, wallet, new
  ledger, or mutable display-only reset state is introduced.
- Focused billing/projection/component tests, typecheck/lint, design-catalog
  desktop/mobile proof, exact-head CI, preliminary specialist review, final
  ReviewGPT, and parent final review complete.
- Design-proof screenshots are lossless, captured at 2x device scale or higher,
  cropped to the changed surface, legible at native resolution, and delivered
  without an additional resolution reduction.

## Scope

- In scope:
  - Family Settings eligibility and rendering for owner-funded member credit.
  - Shared usage-credit dialog copy and choice presentation.
  - Overall usage-percentage derivation from the latest canonical capacity
    epoch and its transport/UI coverage.
  - Existing `/design` catalog study and durable billing/product docs.
  - Durable design-proof capture/upload guidance and its local uploader quality
    gates.
- Out of scope:
  - New offers, message-count entitlements, shared Family balances, transfers,
    recurring auto-refill, or direct purchase authority for sponsored members.
  - Changes to Stripe payment, webhook fulfillment, credit settlement,
    admission, or runtime-wake ownership.

## Constraints

- Technical constraints:
  - Derive the display epoch from existing immutable allowance/credit facts.
    Do not add persisted UI reset state or change immutable usage history.
  - Preserve beneficiary/payer separation and current Family authorization.
  - Keep the percentage bounded and make used plus remaining equal 100.
- Product/process constraints:
  - Reuse the existing PlanUsageBand, usage-credit dialog, Family member rows,
    and server-projected offers.
  - Keep private production evidence out of repository artifacts.
  - Follow the worktree/PR, design-proof, verification, and ReviewGPT gates.

## Risks and mitigations

1. Risk: A display-only reset could drift from real capacity or make exhausted
   credit look available.
   Mitigation: Keep remaining capacity and admission unchanged, derive only the
   used numerator and anchor it to canonical period/grant facts, and cover grant,
   reset, partial-use, exhaustion, and carryover cases.
2. Risk: Broadening the Family CTA could let a non-owner or stale member start
   a payment.
   Mitigation: Reuse the server-owned Family target projection and existing
   same-origin route authorization; change presentation only after proving the
   projection already carries the authorized owner target.
3. Risk: Replacing message estimates could accidentally change group funding
   copy, whose offers intentionally use estimates.
   Mitigation: Scope dollar-only choices to the personal/Family dialog and keep
   the separate group sponsorship catalog unchanged.
4. Risk: A payer who starts a personal purchase and then activates Family could
   lose the frozen purchase's exact recovery controls if Settings follows only
   the current billing mode.
   Mitigation: Let an active personal target or personal return own the billing
   row before current Family availability, and keep the frozen target encoded
   in the persisted provider return URL.
5. Risk: A delayed exact return could inherit conflict or recovery fields from
   the payer's newer active purchase.
   Mitigation: Treat the returned purchase ID as the exclusive dialog state
   source and keep a simultaneous active purchase on its own target surface.

## Tasks

1. Trace and reproduce the Family owner CTA, dialog display, and percentage
   projection against code, focused tests, and a privacy-minimized production
   state check.
2. Add focused failing tests for the proven regressions and new capacity-epoch
   rule.
3. Implement the smallest fixes at the existing projection/component owners and
   update the real design-catalog study.
4. Update the current billing/product owner docs where the percentage contract
   changes.
5. Run focused proof, browser evidence, required reviews, exact-head CI, parent
   final review, plan closure, and PR completion.
6. Replace low-resolution PR evidence with focused high-resolution captures and
   prevent future proof uploads from silently accepting blurry inputs or a
   downscaling delivery variant.

## Decisions

- The meter is a view over an immutable capacity epoch, not a resettable
  counter. Its anchor is the later of the current allowance-period start and
  the latest fulfilled purchase grant. Referral credit does not reset the
  display window.
- Group sponsorship remains message-estimate-based and is not changed.
- Design proof uses lossless PNGs, a minimum 700-pixel capture width, and the
  dedicated public `designproof` Cloudflare Images variant. That variant uses
  `scale-down` with a 2400-by-2400 ceiling, so compliant captures retain their
  pixel dimensions.
- Frozen purchase and return targets win over current billing mode. New
  owner-seat Family returns land at `#subscription`; another member's returns
  remain at `#family`, and the target reader accepts legacy owner-seat
  `#family` URLs.
- An exact return ID exclusively owns its dialog status, conflict, capabilities,
  copy, and completion. A payer-wide latest-active record is ignored by that
  dialog and remains available only through its own frozen-target surface.

## Verification

- Commands to run:
  - Focused Vitest files for plan usage, credit projection, Family Settings, and
    the shared usage-credit dialog.
  - `pnpm test:frontend-design-proof`
  - The narrowest truthful hosted-web typecheck/lint or diff-aware lane selected
    after the touched files are known.
  - Desktop and mobile `/design?tab=sections` browser proof.
  - Exact-head GitHub Actions, preliminary `completion-specialists`, final
    ReviewGPT, and Claude Code UI double-check.
- Expected outcomes:
  - All focused and required checks pass; rendered proof shows the Family owner
    CTA, dollar-only chooser, and reset meter states without private data.
  - Focused product result: 255 tests passed across eight relevant Web files,
    plus 12 related Web status/notice tests, 7 assistant-consumer tests, and 2
    Cloudflare plan-usage port tests.
  - Repository-tool tests passed (460 tests), the frontend design-proof guard
    passed (10 tests), full workspace typecheck passed, and touched-file ESLint
    passed.
  - Local `/design` proof passed at desktop and mobile viewports: the owner CTA
    and fresh 0%-used state were visible, and the Family picker showed only
    dollar amounts plus the short `usage` label.
  - Five replacement PNGs were visually inspected locally and after Cloudflare
    Images delivery. Each delivered file retained its source pixel dimensions.
  - ReviewGPT round 1 found one exact-target recovery issue. Focused regression
    coverage first reproduced both affected mechanisms, then 389 tests across
    seven directly affected Web files, Web typecheck, and touched-file ESLint
    passed after the correction.
  - ReviewGPT round 2 found that a delayed exact return could still inherit
    another purchase's conflict fields. The required anomaly retrospective
    selected a first-principles identity rule instead of another routing patch:
    an exact return is the dialog's sole state source. Two distinct-ID
    regressions reproduced the mixed state before the correction; 391 tests
    across seven affected Web files, Web typecheck, and touched-file ESLint
    passed afterward.
