# Biomarker result loading and quiet refresh

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Make the biomarker-result loading state preserve the real page hierarchy and
  remove the visible refreshing notice while an active background refresh owner
  continues to converge saved data. Preserve explicit recovery when no refresh
  is in flight.
- Separate the user-facing UI repair from the diagnosed production latency
  incident so no speculative data-path abstraction is added to this patch.

## Success criteria

- The detail route stays quiet while a provider refresh is active, while stale
  populated and empty states with no active refresh expose a working action.
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
  - Keep the solution proportional: delete obsolete in-progress copy, but do
    not conceal recovery when the provider has no active refresh owner.
  - Production deployment is protected external state and is diagnosis-only in
    this task without separate authorization.

## Risks and mitigations

1. Risk: Removing the banner also removes its manual refresh action.
   Mitigation: Keep active refreshes quiet, restore the stale/no-pending action
   for populated and empty states, and retain the explicit retry action for
   actual load errors.
2. Risk: A polished skeleton could drift from the loaded layout.
   Mitigation: Use the same container, grid, breakpoint, spacing, and ledger
   hierarchy as the production result content, then render it in the catalog.
3. Risk: The slow page could be misattributed to biomarker row volume.
   Mitigation: Keep only privacy-safe metadata evidence: the affected workspace
   had a recently produced generation-8 monolith with no shard references while
   current Web requests generation-10 `core` and `labs` shards. The last
   generation-10 deployment candidate did not reach production.

## Tasks

1. Remove the in-progress refresh notice while preserving stale/no-pending
   recovery.
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
  provider refreshes quietly; a stale/no-pending state keeps a manual action,
  and true transport errors keep the existing retry.
- Use an abstract chart trace in the skeleton so it communicates final layout
  without pretending to contain real health data.

## Verification

- Completed local proof:
  - The corrected focused Vitest run passed all 110 biomarker-history,
    Browser Vault provider, loading-transition catalog, and design-catalog
    tests.
  - Changelog generation and 53 focused fragment, archive, and page tests
    passed.
  - Hosted Web typecheck passed.
  - Hosted Web lint passed with no errors; its 43 warnings pre-existed this
    change and none came from the touched files.
  - Focused ESLint and `git diff --check` passed.
  - The production skeleton rendered in the sections catalog at desktop and
    mobile breakpoints. The inspected crops are private-data-free and meet the
    repository's 2x-or-higher, 700-pixel-minimum, 2400-pixel-maximum rules.
  - The first specialist pass was correctly marked invalid because its two
    loading screenshots did not cover the changed stale populated,
    refresh-pending populated, and stale empty states. The catalog now renders
    the real shared production presentation for all three states, and the
    inspected corrected desktop/mobile evidence covers each state.
  - The corrected specialist pass found that stale/no-pending sessions are a
    supported non-polling provider state. The finding was accepted: those
    populated and empty states now retain a working Refresh action, while the
    refresh-pending populated state remains quiet. A real provider-boundary test
    proves the stale empty action starts a provider load after the non-polling
    interval.
  - Hosted Web typecheck, focused ESLint, and full lint passed after the
    correction; full lint retained the same 43 pre-existing warnings and no
    touched-file diagnostics.
  - Updated synthetic desktop/mobile renders confirm the recovery alert is
    responsive, the refresh-pending state remains unchanged, and the real chart
    and result ledger render without overflow.
  - The final catalog cold compile completed in 15.9 minutes after shorter
    bounded attempts expired; the task Frog entry records this proof-loop
    friction.
- Remaining completion proof:
  - Push the corrected exact head and complete PR CI. The hosted design-proof
    gate still requires hosted desktop/mobile image URLs; local redacted images
    are ready, but this environment has neither an uploader credential nor a
    GitHub attachment API.
  - The Claude UI check could not start because Claude Code is not installed in
    this environment; repository guidance requires recording that exact gap
    without a substitute local reviewer.
