# Add referral-link usage stats to Growth

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Give operators a truthful 30-day view of stable signup-referral link usage on
  the existing Growth page, including claim volume, activation outcomes, and
  the number of referrers whose links were claimed.

## Success criteria

- The Growth read derives referral-link claims from attributed `HostedInvite`
  rows and activation outcomes from canonical `member.activated` mailbox facts.
- Daily cohorts cover the same 30 UTC days as the surrounding Growth charts,
  fill empty days, and never expose member or referrer identifiers to the UI.
- The Growth page renders compact summary statistics and an accessible,
  responsive chart that makes clear a use means a `Join Murph` claim rather
  than a landing-page view.
- The production section is represented on the `/design` sections catalog and
  has focused data and UI tests.
- Focused hosted-web tests, lint, typecheck, design-proof checks, rendered
  desktop/mobile proof, and the routed completion reviews pass.

## Scope

- In scope:
  - Read-only aggregation over the existing signup-referral attribution and
    activation owners.
  - A 30-day claim cohort series with activated-claim counts.
  - Summary counts for claims, activated claims, activation rate, and active
    referrers.
  - The Growth page section, design-catalog study, focused tests, and review
    evidence.
- Out of scope:
  - Landing-page impressions, link issuance, clipboard events, or shares,
    because the product does not persist those events.
  - New schema, telemetry, attribution, reward settlement, or referral-policy
    changes.

## Constraints

- Technical constraints:
  - `HostedInvite.referrerMemberId` is the durable attribution owner;
    `HostedInvite.channel` and expiry are not referral authority.
  - Activation must come from canonical `member.activated` mailbox evidence and
    must occur at or after the attributed claim.
  - Collection reads remain bounded to the dashboard's 30-day window and are
    aggregated before returning to the client.
- Product/process constraints:
  - Match the existing Growth scorecard and Interstellar Lab Notebook design
    language without adding a generic card grid or decorative imagery.
  - Render the real production section in the design catalog and collect
    desktop/mobile proof.
  - Follow the PR-lane completion workflow and keep private identifiers out of
    durable artifacts.

## Risks and mitigations

1. Risk: Counting invite channel values would miss referral claims relabeled by
   ordinary onboarding resume.
   Mitigation: Select attributed invites by non-null `referrerMemberId` only.
2. Risk: Dividing independently windowed activation and claim totals would
   create a misleading conversion rate.
   Mitigation: Cohort activations against claims created inside the 30-day
   window and group both series by claim day.
3. Risk: The dashboard could expose member-level evidence.
   Mitigation: Return only aggregate counts and date buckets from the server
   read model.
4. Risk: Account deletion can make a historical claim disappear or clear its
   referral attribution, so the window is not an immutable event ledger.
   Mitigation: Define the display as retained-record metrics, disclose the
   deletion behavior in the UI, and cover both deletion owners plus the
   aggregation boundary.

## Tasks

1. Add the bounded referral claim/activation cohort read and focused unit proof.
2. Build the Growth referral-link usage section and wire it to production data.
3. Add the real section to the design catalog with deterministic synthetic data.
4. Run focused verification and rendered desktop/mobile checks.
5. Complete the required specialist, UI, CI, parent-review, and PR workflow.

## Decisions

- A referral-link "use" means the explicit public claim action that creates an
  attributed invite, not a page view.
- The 30-day chart is cohort-based: an activated claim is plotted on the day the
  attributed invite was created. This keeps the activation rate mathematically
  coherent.
- No persistence is added because the existing referral and activation owners
  already contain the required facts.
- The counts describe retained records: introduced-member deletion removes the
  invite row and referrer deletion clears `referrerMemberId`, so either action
  can reduce historical totals.

## Verification

- Focused Growth metrics, component, account-deletion, and referral-migration
  Vitest suites: passed, 151 tests.
- `pnpm --dir apps/web lint`: passed with 37 pre-existing warnings in unrelated
  files and no errors.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm test:frontend-design-proof`: passed, 10 tests.
- Focused Growth Playwright plus repository capture: passed at desktop and
  mobile viewports, 6 tests, including populated and zero-claim states,
  keyboard tooltip, and focus treatment.
- Four repository Playwright captures against `/design?tab=sections` were
  visually inspected for hierarchy, legibility, overflow, series
  identification, and absence of development chrome.
- Claude Code UI double-check: Fable and the required Opus fallback could not
  start because the `claude` executable is unavailable in this environment; no
  second-model UI verdict is claimed.
- Preliminary specialist review: invalid because the first evidence package
  omitted the zero-claim rendered state; the missing desktop/mobile evidence is
  now captured and the same pass must be retried.
- Final ReviewGPT round 1: one accepted finding that deletion can rewrite
  historical cohorts. The retained-record disclosure and focused deletion/FK
  regression coverage are implemented; substantive round 2 remains pending.
