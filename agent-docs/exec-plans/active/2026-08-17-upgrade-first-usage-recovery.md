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
   Mitigation: Use a stable Family anchor and let the signed-in Settings read
   resolve the owner/member relationship before rendering actions.
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
7. [pending] Commit with the authenticated approved Git identity, push, open a PR, monitor
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
  member identifier nor a bearer token; the owner chooses the member after
  authentication.
- Family owners are taken to their applicable recurring plan upgrade when one is
  eligible, with member-specific one-time usage secondary.
- Direct and trial/Starter members see only current server-returned plan options.
  Max/no-higher-tier states do not invent an upgrade and instead expose an
  authorized add-usage or wait-for-reset fallback.
- User messages should promise recovery, not a particular price or action; the
  signed-in UI owns the current recommendation.

## Verification

- Commands to run:
  - Focused Vitest suites selected from the files changed by the patch.
  - `pnpm --filter web typecheck`
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
  large copy action and only the generic `/settings#family` destination.
- Family owner: focused client coverage proves the recovery route selects the
  owner's next eligible recurring tier first and retains authorized one-time
  usage as the secondary action.
- Signed-out member: focused auth coverage proves only the exact
  `usageRecovery=true#subscription` handoff resumes after sign-in; repeated or
  augmented parameters fail closed to the normal Home route.
- Presentation proof was inspected at phone and desktop widths from production
  components on the synthetic screenshot surface. Selected redacted evidence:
  `.artifacts/review-gpt/usage-recovery-sponsored-phone.png`,
  `.artifacts/review-gpt/usage-recovery-direct-phone.png`,
  `.artifacts/review-gpt/usage-recovery-max-phone.png`, and
  `.artifacts/review-gpt/usage-recovery-direct-desktop.png`.
- Result: `Ready`. The screenshot surface proves presentation; focused route,
  authority, clipboard, and action tests provide the journey proof unavailable
  from synthetic props alone.

## Local proof

- Focused Vitest: 6 files and 210 tests passed.
- Web typecheck: passed.
- Changed-file ESLint: passed.
- Frontend-evidence checker tests: 6 passed.
- `git diff --check`: passed.
- Privacy scan over tracked and untracked task content: no configured direct
  identifier appeared.
