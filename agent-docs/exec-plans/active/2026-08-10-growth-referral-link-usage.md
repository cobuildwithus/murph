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
5. Risk: Recent claim cohorts can look like settled conversion even though they
   have had less time to activate.
   Mitigation: Label the rate and series as observed by capture and explicitly
   identify the cohorts as open.
6. Risk: Rendering an empty 256-pixel chart creates a large information-free
   focus target.
   Mitigation: Keep the summary stats and replace the chart with one compact
   no-claims sentence when the window has zero claims.
7. Risk: A pale claims series can disappear against the card background.
   Mitigation: Use the darker `#8F7551` claims fill, which measures at least
   4.06:1 against the rendered light card surfaces, and cover its computed
   browser fill plus forced-colors semantics.

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
- Activation is an open-cohort snapshot at capture time, not a settled 30-day
  conversion result; newer claims have less time to activate.
- A zero-claim window omits the chart and its focus target while retaining the
  four summary stats and the metric definition.

## Verification

- Focused Growth metrics, component, account-deletion, and referral-migration
  Vitest suites: passed, 151 tests.
- `pnpm --dir apps/web lint`: passed with 37 pre-existing warnings in unrelated
  files and no errors.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm test:frontend-design-proof`: passed, 10 tests.
- ReviewGPT package check: installed CLI `0.5.124` matches the registry's
  `latest` tag (`0.5.124`).
- Focused Growth Playwright plus repository capture: passed at desktop and
  mobile viewports, 6 tests, including populated and zero-claim states,
  keyboard tooltip, focus treatment, computed claims fill, and forced-colors
  semantics.
- Four repository Playwright captures against `/design?tab=sections` were
  visually inspected for hierarchy, legibility, overflow, series
  identification, compact empty-state behavior, and absence of development
  chrome. Capture dimensions are 2172x1264 and 948x2847 for populated desktop
  and mobile, plus 1388x656 and 948x1731 for empty desktop and mobile.
- Claude Code UI double-check: Fable and the required Opus fallback could not
  start because the `claude` executable is unavailable in this environment; no
  second-model UI verdict is claimed.
- Preliminary specialist retry reviewed all four rendered states and returned
  findings. All four were accepted: qualify open cohorts, collapse the empty
  chart, increase claims-series contrast, and assert the production page owns
  the section. The fixes and focused coverage are implemented. Per the
  specialist workflow, that one substantive pass is not rerun after accepted
  remediation.
- Parent corrected-head product-purpose revalidation: `NO FINDINGS`. The
  irreducible purpose remains an immediately legible aggregate view of referral
  claims and downstream activation, and the smallest complete experience is the
  existing Growth page with summary stats, an open-cohort chart when data
  exists, and one compact sentence when it does not. The four refreshed
  rendered states and desktop/mobile interaction proof cover the changed
  journey; no material evidence gap remains for this lens.
- Final ReviewGPT round 1: one accepted finding that deletion can rewrite
  historical cohorts. The retained-record disclosure and focused deletion/FK
  regression coverage are implemented. A substantive recovery review of that
  pushed head remains in progress; the corrected production behavior will
  require the next substantive round on the new head.
