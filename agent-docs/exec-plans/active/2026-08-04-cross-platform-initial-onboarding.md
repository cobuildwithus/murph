# Cross-platform initial onboarding

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Make the hosted onboarding flow available natively in the companion app
  while ensuring a member completes or skips it only once across web and
  mobile.

## Success criteria

- Web/Postgres owns one canonical onboarding-completion fact.
- Existing members are not unexpectedly enrolled during rollout.
- Every authenticated Home load renders canonically pending onboarding and
  suppresses it after canonical completion, independent of query or session
  history. Persona save or explicit persona skip/dismiss records completion.
- User-initiated device and connected-app completion results finish before
  pending onboarding becomes the foreground Home dialog.
- Authenticated companion routes expose pending/completed state and perform
  idempotent completion without accepting a caller-selected member.
- iOS can render the same contact, persona, voice/tone, and welcome sequence
  and never persists a second completion owner.
- Focused service, route, web, and iOS tests cover cross-surface deduplication,
  retries, and failure behavior.

## Scope

- In scope: canonical schema/service state, browser gating, companion API
  contract, native SwiftUI onboarding, migration/backfill, tests, docs, and
  exact-head review/evidence.
- Out of scope: a webview-based mobile client, historical onboarding recovery,
  simultaneous-device exclusivity leases, analytics, and changes to companion
  Health/Contacts/meal setup ownership.

## Constraints

- Technical constraints: Postgres is the only durable owner; companion auth is
  Privy bearer-only; completion writes are idempotent and member-bound; no new
  app dependency or local database; deploy web/backend before the iOS client.
- Product/process constraints: preserve the existing hosted flow and copy,
  treat persona save or persona skip/dismiss as completion, keep contact-card
  skip as an advance rather than completion, and follow exact-head visual and
  ReviewGPT gates in both repositories.

## Risks and mitigations

1. Risk: existing members with no new field appear newly pending.
   Mitigation: backfill all pre-migration members as completed, use a temporary
   database default for legacy writers still serving during the rolling
   deploy, and make the current member creator write null explicitly.
2. Risk: app and web race after both have already displayed onboarding.
   Mitigation: make completion atomic/idempotent and re-read on foreground;
   explicitly avoid a lease/state machine for the narrow simultaneous-open
   edge case.
3. Risk: assistant-style save succeeds while completion fails.
   Mitigation: reuse the canonical preference owner and record completion only
   after preference persistence; retries remain safe and cannot erase choices.
4. Risk: mobile and web option contracts drift.
   Mitigation: project the closed canonical option catalog from the web-owned
   companion route and validate submitted identifiers server-side.

## Tasks

1. Capture the exact hosted flow, preference owner, companion auth boundary,
   and rollout constraints.
2. Ask ReviewGPT to review the proposed ownership, API, and migration design.
3. Add canonical completion persistence, migration/backfill, shared service,
   companion routes, and focused backend tests.
4. Gate and complete the hosted Home flow through canonical state alone.
5. Implement the native flow against the companion protocol with no local
   completion persistence.
6. Update architecture/product/security/reliability documentation and visual
   evidence catalogs required by each repository.
7. Run focused and required verification, capture exact-head screenshots,
   publish scoped PRs, and run the exact-head ReviewGPT gates.

## Decisions

- Canonical ownership is a nullable completion timestamp on the hosted member,
  backfilled for all members that predate the migration.
- The initial migration keeps a compatibility default so a legacy writer that
  omits the column during deployment cannot re-enroll its member. The current
  creator explicitly writes null. A later deployment removes the default only
  after legacy writers have drained.
- A member has completed onboarding after saving persona preferences or
  explicitly skipping/dismissing the persona picker. The contact-card step
  alone does not complete onboarding.
- Simultaneous already-open surfaces may both remain visible until one
  foregrounds/reloads; no claim lease is added for this narrow race.
- The companion route returns the current canonical choices so iOS does not
  become a second option-catalog owner.
- Optional contact projection may omit only the contact-card step. It cannot
  block the canonical pending/completed state, public catalog, or Health
  continuation.
- One-shot connection result dialogs take foreground priority over pending
  onboarding and refresh plain Home on close; no general modal coordinator or
  second onboarding owner is introduced.

## Verification

- Completed: focused web Vitest suites, Prisma client generation and schema
  validation, web typecheck and ESLint, the full affected web verification
  lane (644 files and 8,621 tests passed), focused iOS API/session/UI tests,
  the full iOS simulator suite, XcodeGen, SwiftFormat lint, visual-proof
  verifier tests, and simulator inspection of all six native states.
- Completed: the preliminary specialist found three material gaps. The
  rolling-deploy writer gap, truthful skip progress/retry, and real
  first-writer-wins proof were accepted and corrected. The new opt-in local
  PostgreSQL suite applies the exact migration SQL and proves both controlled
  Web-save/iOS-skip winner orderings with independent Prisma clients.
- Completed: final ReviewGPT round one found that Web session/query history
  still acted as a second eligibility owner and that optional contact
  decryption could block native onboarding. Both were accepted and corrected:
  plain Home now reads only the canonical row, all eligibility marker/session
  branches were deleted, and contact projection fails soft to a catalog-only
  pending response.
- Completed: Web ReviewGPT round two found that one-shot device or connected-app
  completion results could mount alongside and be obscured by pending
  onboarding. The result dialog now takes foreground priority and refreshes
  plain Home on close. The same correction makes optional Web contact
  resolution fail soft, matching the native contract.
- Completed: production `/design?tab=sections` onboarding renders at desktop
  and mobile sizes. The required Claude Code UI double-check was attempted and
  stopped at explicit Fable credit exhaustion as the completion workflow
  directs.
- Completed: refreshed exact-head visual evidence for the truthful skip-saving
  and retry states at desktop and mobile sizes.
- Remaining: publish the correction commits, finish green PR workflows and the
  separate final ReviewGPT gate in both repositories, then close this plan.
- Expected outcomes: every check is clean; screenshots represent each
  materially changed native state; ReviewGPT reports zero blocking findings on
  each exact pushed PR head.
