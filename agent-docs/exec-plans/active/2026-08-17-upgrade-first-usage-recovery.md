# Upgrade-first usage recovery UX

Status: active
Created: 2026-08-17
Updated: 2026-08-18

## Goal

- Make exhaustion recovery mobile-first and upgrade-first: one first-party handoff
  resolves the signed-in member's plan authority, makes the best recurring plan
  upgrade the dominant action, and keeps one-time usage as a secondary option.

## Success criteria

- Exhaustion notices use one stable Settings recovery link rather than sending a
  member to Home or exposing plan-specific authority in message copy.
- Direct paid members, trial/Starter members, Family owners, sponsored Family
  members, and members with no higher eligible tier all see truthful, distinct
  recovery states.
- Eligible upgrades are the primary action. One-time usage is visually secondary
  and appears only when the server authorizes it.
- A sponsored non-owner sees a focused dialog with a large copy-link action and
  clear wording to send the link to the Family owner. The copied URL is generic,
  contains no member identifier or token, and resolves authority after sign-in.
- The narrow-phone and desktop experiences are keyboard-accessible, readable,
  and covered by focused tests.
- Relevant tests, web typecheck, Product UX walkthrough, changelog, ReviewGPT
  gates, and PR CI are complete.

## Scope

- In scope:
  - Usage-exhaustion message links and copy.
  - Settings recovery routing and the hosted billing/Family UI needed to make
    the next authorized plan step obvious.
  - Direct paid, Starter/trial, Family owner, sponsored Family non-owner, and
    no-higher-tier fallbacks.
  - Focused tests, member-facing changelog, and rendered mobile/desktop proof.
- Out of scope:
  - Changing plan eligibility, prices, payment authority, or database state.
  - Adding a new Family delegation token or embedding a member identity in URLs.
  - Repairing the separate low-usage warning delivery/observability pipeline.
  - Changing the operations usage-reset contract.

## Constraints

- Technical constraints:
  - Reuse the existing Settings, plan-usage, Family, and Checkout contracts.
  - Keep server-returned eligibility and authority canonical; never infer them
    from URL parameters or client copy.
  - Do not add dependencies, durable state, or a new public route unless the
    existing Settings surface cannot express the journey.
- Product/process constraints:
  - This is a Feature-level UX change because it creates a new Family
    member-to-owner recovery journey.
  - The user has approved an upgrade-first hierarchy, one-time usage as a ghost
    action, and a Family non-owner copy-link dialog.
  - Keep production member data and incident identifiers out of the patch,
    plan, ReviewGPT prompt, commits, and PR.

## Risks and mitigations

1. Risk: A generic link sends the Family owner to the wrong surface.
   Mitigation: Use the exact identifier-free
   `/settings?familyRecovery=true#family` handoff, preserve it through sign-in,
   and let Settings resolve the owner/member relationship before rendering
   actions.
2. Risk: The UI offers an unauthorized or nonexistent upgrade.
   Mitigation: Render only server-returned eligible plans and preserve truthful
   add-usage/wait fallbacks when no higher tier exists.
3. Risk: The first-party message and Settings UI drift apart.
   Mitigation: Keep the message link stable and centralize recovery ranking and
   labels in the Settings implementation with focused scenario tests.
4. Risk: The new dialog is awkward or unusable on mobile.
   Mitigation: Verify a narrow-phone viewport, touch target size, focus behavior,
   clipboard success/failure feedback, and desktop layout.

## Tasks

1. [x] Give ReviewGPT a synthetic, privacy-safe implementation brief and request one
   downloadable patch with focused coverage.
2. [x] Inspect the complete artifact, reject unsafe/unrelated paths or identifiers,
   run `git apply --check`, and apply it deliberately.
3. [x] Review and simplify the resulting data flow and authority decisions; correct
   gaps without expanding plan/billing contracts.
4. [x] Add or update focused message, billing Settings, Family dialog, and recovery
   scenario tests plus a member-facing changelog entry.
5. [x] Run focused tests and web typecheck, then render and inspect narrow-phone and
   desktop recovery states.
6. [in progress] Run Product UX, preliminary specialist, and final cross-cutting ReviewGPT
   gates; address actionable findings.
7. [in progress] Commit with the authenticated approved Git identity, push, open a PR, monitor
   CI/review automation, and archive the plan through `scripts/finish-task`.

## Decisions

- Exhaustion recovery has one dominant question: can this signed-in account move
  to a higher recurring plan? If yes, that is primary.
- One-time usage is secondary and visually quiet. It becomes primary only when
  no recurring upgrade is available and it is the best authorized continuation.
- Sponsored Family members do not receive awkward owner instructions in the
  outbound message. The message opens Settings; Settings shows a focused dialog
  with a large `Copy link for your Family owner` action.
- The copied owner URL is the generic Family Settings URL. It carries neither a
  member identifier nor a bearer token. Its exact
  `familyRecovery=true#family` destination survives authentication, and the
  owner chooses the member after sign-in.
- Family owners are taken to their applicable recurring plan upgrade when one is
  eligible, with member-specific one-time usage secondary.
- Direct and trial/Starter members see only current server-returned plan options.
  Max/no-higher-tier states do not invent an upgrade and instead expose an
  authorized add-usage or wait-for-reset fallback.
- Settings derives the next direct recovery tier from the same server-owned plan
  visibility and eligibility facts that render its plan cards. The usage
  projection does not resolve a second subscription quote or recommendation
  pipeline for this UI.
- The recovery query requests presentation but never proves exhaustion. An exact
  active or returned usage purchase opens first; otherwise Family recovery may
  auto-open only while the live usage projection remains exhausted. The Family
  owner banner remains available during ordinary exhausted Settings visits;
  the query controls its initial dialog only. A stale query is inert after
  reset, fulfillment, upgrade, or other recovery.
- Recovery actions use the plain `Add usage` label. Supporting copy explains the
  monthly benefit directly and avoids internal terms such as recurring option,
  secondary option, or authorized option.
- User messages should promise recovery, not a particular price or action; the
  signed-in UI owns the current recommendation.
- Core exhaustion copy keeps the wearable-sync and authorized-group-update
  boundary explicit. Family copy says the exhausted allowance is individual
  and that other members keep separate allowances. Both reuse the shared
  Settings-link template machinery.

## Verification

- Commands to run:
  - Focused Vitest suites selected from the files changed by the patch.
  - `pnpm --dir apps/web typecheck`
  - Repository completion/review commands required by the changed surface.
  - Browser walkthrough at narrow-phone and desktop viewports.
- Expected outcomes:
  - All focused tests and typecheck pass.
  - Every supported authority/eligibility scenario renders one truthful primary
    recovery action and no unauthorized action.
  - The Family non-owner dialog copies only the generic Family Settings URL and
    exposes clear success/failure feedback.
  - Screenshots show a usable mobile hierarchy and an equivalent desktop path.

## Product UX walkthrough

- Direct paid member with an eligible higher tier: the exhausted Pulse state
  renders `Upgrade to Edge` as the dominant action and keeps one-time usage as
  an outline secondary action.
- Direct paid member with no higher tier: the exhausted Max state truthfully
  promotes the authorized one-time usage action without inventing an upgrade.
- Sponsored Family member: the recovery handoff opens a focused dialog with a
  large copy action and only the identifier-free
  `/settings?familyRecovery=true#family` destination.
- Family owner: focused client coverage and rendered phone/desktop proof show
  the recovery banner selects the owner's next eligible recurring tier first,
  automatically opens its confirmation dialog, and retains authorized one-time
  usage as the secondary action.
- Signed-out member: focused auth coverage proves only the exact
  `usageRecovery=true#subscription` and `familyRecovery=true#family` handoffs
  resume after sign-in; repeated or augmented parameters fail closed to the
  normal Home route.
- Member with a frozen purchase: the exact purchase dialog opens before Family
  handoff or another recovery dialog and retains its resume, cancel, retry,
  polling, failure, and completion behavior.
- Member whose usage recovered while the URL stayed open: Settings ignores the
  stale recovery query and shows the ordinary live usage state without opening
  a dialog.
- Presentation proof was inspected at phone and desktop widths from production
  components on the synthetic screenshot surface. Selected redacted evidence:
  `.artifacts/review-gpt/usage-recovery-sponsored-phone.png`,
  `.artifacts/review-gpt/usage-recovery-direct-phone.png`,
  `.artifacts/review-gpt/usage-recovery-max-phone.png`, and
  `.artifacts/review-gpt/usage-recovery-direct-desktop.png`. Corrective evidence
  adds `.artifacts/review-gpt/usage-recovery-family-owner-phone.png`,
  `.artifacts/review-gpt/usage-recovery-family-owner-desktop.png`,
  `.artifacts/review-gpt/usage-recovery-family-owner-banner-phone.png`,
  `.artifacts/review-gpt/usage-recovery-family-owner-banner-desktop.png`, and
  `.artifacts/review-gpt/usage-recovery-family-signed-out-phone.png`.
- Result: `Ready`. The screenshot surface proves presentation; focused route,
  authority, clipboard, and action tests provide the journey proof unavailable
  from synthetic props alone.

## Local proof

- Focused Vitest: all 344 unique tests across 8 files passed. One overloaded
  batch produced a timeout in a billing projection test; that test passed in
  15.64 seconds when isolated, and the full changed Settings page suite passed
  64/64 after the query-shape correction.
- Web typecheck: passed.
- Changed-file ESLint: passed.
- Frontend-evidence checker tests: 6 passed.
- `git diff --check`: passed.
- Privacy scan over changed task content: no configured direct identifier
  appeared.

## Review findings and resolutions

- ReviewGPT final round 1 found that `/settings#family` loses its fragment at
  the server boundary for a signed-out owner. Repaired with the exact
  identifier-free Family recovery query plus fragment and fail-closed query
  tests.
- ReviewGPT final round 1 found a duplicate usage-projection quote and
  eligibility pipeline. Deleted it; Settings now derives the next tier from its
  existing visibility and eligibility facts.
- The preliminary specialist pass was invalid because the evidence set lacked
  phone/desktop Family-owner banner and auto-open-dialog proof plus a signed-out
  render. Those states are now implemented, captured, and inspected for the
  required retry.
- Specialist scope feedback identified lost Core and Family allowance meaning
  in the shared exhaustion copy. Added small shared variants that preserve the
  correct continuity and per-member boundaries without exposing authority,
  identifiers, prices, or plan recommendations.
- ReviewGPT final round 2 found that the presentation query could override live
  usage truth and hide a payer's frozen purchase after Family sponsorship.
  Accepted: the query is now live-exhaustion-gated, and active or returned
  purchases retain first presentation ownership without new state or lifecycle
  machinery.
- The specialist retry found that an exhausted Family owner's ordinary Settings
  link pointed at a query-gated recovery banner. The banner now follows live
  exhausted state, while only the confirmation dialog follows the exact query.
- Direct screenshot feedback found `recurring option` and `secondary option when
  authorized` to be implementation-facing copy. Replaced them with the concrete
  monthly usage benefit and the shorter `Add usage` action.
