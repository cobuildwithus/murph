# Biomarker result loading and quiet refresh

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Make the biomarker-result loading state preserve the real page hierarchy and
  remove the visible stale-refresh notice while the existing background refresh
  owner continues to converge saved data.
- Separate the user-facing UI repair from the diagnosed production latency
  incident so no speculative data-path abstraction is added to this patch.

## Success criteria

- The detail route shows no stale or refreshing banner when saved results remain
  usable.
- The loading skeleton mirrors the latest-reading/chart shell and year-grouped
  result ledger at desktop and mobile widths.
- Focused component coverage proves quiet stale and refresh-pending states,
  private error handling, and the revised skeleton structure.
- The real production skeleton appears in the sections design catalog with
  redacted desktop and mobile rendered proof.
- Hosted Web typechecking, linting, focused tests, diff checks, required review,
  and exact-head CI complete before handoff.

## Scope

- In scope:
  - Biomarker result-detail loading and stale presentation.
  - Existing component tests and Browser Vault loading-transition design study.
  - A narrow member-facing changelog item for the improved loading experience.
  - Privacy-safe diagnosis of the affected production replica and deployment
    history.
- Out of scope:
  - Browser Vault persistence, encryption, freshness, or refresh ownership.
  - Cloudflare deployment or production workflow dispatch.
  - Compatibility machinery for indefinitely serving an old replica producer.

## Constraints

- Technical constraints:
  - Browser Vault refresh remains automatic and owned by the shared provider.
  - Loading markup must be seek-free, reduced-motion safe, and responsive.
  - No private production row or direct member identifier may enter durable
    artifacts.
- Product/process constraints:
  - Reuse the production component in `/design?tab=sections`.
  - Keep the solution proportional and delete the obsolete notice rather than
    replacing it with different refresh copy.
  - Production deployment is protected external state and is diagnosis-only in
    this task without separate authorization.

## Risks and mitigations

1. Risk: Removing the banner also removes its manual refresh action.
   Mitigation: Preserve the shared provider's existing automatic stale refresh
   and retain the explicit retry action for actual load errors.
2. Risk: A polished skeleton could drift from the loaded layout.
   Mitigation: Use the same container, grid, breakpoint, spacing, and ledger
   hierarchy as the production result content, then render it in the catalog.
3. Risk: The slow page could be misattributed to biomarker row volume.
   Mitigation: Keep only privacy-safe metadata evidence: the affected workspace
   had a recently produced generation-8 monolith with no shard references while
   current Web requests generation-10 `core` and `labs` shards. The last
   generation-10 deployment candidate did not reach production.

## Tasks

1. Remove the detail stale-refresh notice and unused manual-refresh plumbing.
2. Rebuild the skeleton around the latest-reading/chart and results-ledger
   structure.
3. Add the production skeleton to the Browser Vault transitions study and
   update focused tests.
4. Add the scoped changelog item once the PR number is available.
5. Run local verification, rendered proof, specialist/second-model review,
   exact-head CI, and parent final review.
6. Close this plan through the scoped task-finishing workflow.

## Decisions

- Treat the production slowness as deploy skew, not a new query or projection
  design problem: Web can request shards, but the active producer still emits
  the legacy monolith because the first generation-10 deployment candidate was
  blocked before Worker deploy and later candidates also failed protected
  gates.
- Do not alter refresh state semantics. Stale saved data stays visible while the
  provider refreshes quietly; true transport errors keep the existing retry.
- Use an abstract chart trace in the skeleton so it communicates final layout
  without pretending to contain real health data.

## Verification

- Completed local proof:
  - Focused Vitest passed all 34 biomarker-history UI tests.
  - Changelog generation and 53 focused fragment, archive, and page tests
    passed.
  - Hosted Web typecheck passed.
  - Hosted Web lint passed with no errors; its 43 warnings pre-existed this
    change and none came from the touched files.
  - Focused ESLint and `git diff --check` passed.
  - The production skeleton rendered in the sections catalog at desktop and
    mobile breakpoints. The inspected crops are private-data-free and meet the
    repository's 2x-or-higher, 700-pixel-minimum, 2400-pixel-maximum rules.
- Remaining completion proof:
  - Exact-head PR CI plus the routed completion-specialists and Claude UI
    reviews.
