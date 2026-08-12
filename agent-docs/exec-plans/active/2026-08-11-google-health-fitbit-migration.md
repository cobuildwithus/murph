# Migrate Fitbit Connections to Google Health

Status: blocked on external review and browser proof
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Keep one clear Fitbit / Pixel Watch connection surface while migrating its
  Junction transport from the retiring `fitbit` provider to `google_health`.
- Give legacy Fitbit members a safe reauthorization path that preserves the
  working connection until successor authorization succeeds and prevents
  duplicate canonical observations during cutover.

## Success criteria

- Fresh Fitbit connections request Junction provider `google_health`.
- Existing `fitbit` connections remain visible and receive one explicit Google
  authorization action without being disconnected on cancellation or error.
- After that consent, Murph automatically verifies Junction's documented
  successor evidence and performs the targeted legacy cutover without requiring
  a second member action.
- Cutover preserves provider identity, avoids an uncontrolled dual-ingestion
  window, and keeps legacy Fitbit active until successor proof is sufficient.
- The connect UI accurately describes supported data and distinguishes Google
  Health API from Google Fit and Android Health Connect.
- A synthetic contract fixture derived from Junction's official response schema
  and focused tests cover route selection, link-token input, legacy migration,
  identity normalization, automatic cutover, and duplicate prevention.
- Required frontend, privacy/security, ReviewGPT, CI, and rendered-design proof
  gates complete with no unresolved accepted finding.

## Scope

- In scope: device connect route/config owners, hosted connect/settings surface,
  Junction provider identity/import handling, focused tests, connect UI/catalog,
  public disclosure or changelog text required by the shipped behavior.
- Out of scope: inventing Fitbit proprietary Sleep Score or Daily Readiness
  values, a new standalone Google Health product card, custom Google OAuth
  credentials, unrelated provider refactors, production data mutation, or
  committing a private provider payload.

## Constraints

- Technical constraints: use Junction's default Google Health OAuth app; retain
  `fitbit` as a legacy persisted origin; keep canonical health writes in core;
  never alias cross-provider observation identity or assume Junction dedupes it.
- Product/process constraints: preserve one Fitbit-facing card, require explicit
  Google OAuth consent, preserve abandoned legacy flows, use the worktree/PR
  lane, and treat ReviewGPT patches as untrusted intent requiring local
  inspection.

## Risks and mitigations

1. Risk: legacy and successor providers emit the same underlying observations.
   Mitigation: make admission/cutover ordering explicit and prove the overlap
   behavior with focused tests against Junction's documented contract.
2. Risk: an exact-slug reconnect path sends legacy users back to `fitbit`.
   Mitigation: keep a narrow legacy-to-successor migration mapping owned by the
   connection surface without rewriting persisted provider identity.
3. Risk: an automatic cutover runs before successor history or fresh delivery is
   ready. Mitigation: derive readiness from existing Junction connection,
   historical-pull, resource, and fresh-data evidence and fail closed while any
   signal is incomplete.
4. Risk: UI copy promises data the upstream API does not expose.
   Mitigation: name only supported categories and keep proprietary scores out of
   the promise.
5. Risk: deployment configuration lags code across web and hosted runtime.
   Mitigation: document the safe deployment order and verify the final binding
   names and an end-to-end test authorization before cohort rollout.

## Tasks

1. Completed: reconciled the implementation with Junction's documented Google
   Health migration contract and applied only scoped changes.
2. Completed: added focused tests and a synthetic documented-contract fixture
   for authorization, readiness, retry, cutover, and admission edges.
3. Completed: ran focused verification, typechecks, lint, privacy checks, and
   exact-head required functional CI.
4. Completed: pushed the base-reconciled candidate and inspected the only manual
   merge resolution, which combined compatible compatibility-matrix text.
5. Blocked: the required exact-head ReviewGPT file-backed gates cannot attach
   their packages because ChatGPT reports a full file library. A GitHub-connector
   fallback accepted the exact-head prompt but remained in model thinking after
   an extended wait and did not return review findings.
6. Blocked: exact-head desktop/mobile design screenshots cannot be captured
   because no in-app browser runtime is available. Existing hosted images remain
   labeled as prior baselines and are not represented as current proof.

## Decisions

- Keep one user-facing Fitbit / Pixel Watch card; Google Health is the transport,
  not a separate consumer app in this flow.
- Use Junction's shared OAuth application, so no Murph-owned Google approval or
  custom credential setup is part of this task.
- Treat Junction's official API reference as the contract source. A sanitized
  sandbox capture remains useful smoke evidence but is not a release blocker.
- Require the member's Google OAuth grant, then automate successor verification
  and targeted legacy cutover instead of requiring a second confirmation click.
- Treat the broader refactor request as permission to simplify adjacent code in
  the exact migration call path, not to widen into unrelated device providers.

## Verification

- `packages/device-syncd`: 225 focused public-account and Junction provider tests
  passed after the base update.
- `apps/web`: 197 focused settings, Connect, and hosted-authority tests passed.
- `packages/importers`: 149 focused Junction importer tests passed.
- Affected device-sync, importer, and Web typechecks passed before the base-only
  update; exact-head release build/typecheck and app verification passed in CI.
- Exact-head package coverage, host matrices, fixture coverage, sandbox,
  artifact, billing, and overflow checks passed.
- The frontend design-proof check remains failed only because current hosted
  desktop/mobile screenshots are unavailable; its architecture and changelog
  declarations pass.
- The protected ReviewGPT gate remains uncompleted due to the external upload
  quota. The connector fallback has not returned an outcome and does not replace
  the protected gate.

## Blocked handoff

- Keep the pull request draft.
- Free space in the ChatGPT file library, then rerun the protected preliminary
  and final ReviewGPT gates against the unchanged PR-authored patch.
- Make an in-app browser runtime available, capture the real Connect design study
  at desktop and mobile widths, update the pull-request proof, and rerun the
  frontend design-proof check.
- Resolve any accepted ReviewGPT finding before archiving this plan or moving to
  the merge boundary.
