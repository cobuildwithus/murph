# Migrate Fitbit Connections to Google Health

Status: in progress; final ReviewGPT and current-base gates remain
Created: 2026-08-11
Updated: 2026-08-12

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
6. Risk: the browser closes before successor verification finishes, leaving the
   member indefinitely on the legacy source.
   Mitigation: make the hosted runtime the bounded retry owner, have Web recheck
   durable readiness under the existing connection lock, and keep the browser
   limited to presentation and an explicit manual retry.

## Tasks

1. Completed: reconciled the implementation with Junction's documented Google
   Health migration contract and applied only scoped changes.
2. Completed: added focused tests and a synthetic documented-contract fixture
   for authorization, readiness, retry, cutover, and admission edges.
3. Completed: ran focused verification, typechecks, lint, privacy checks, and
   exact-head required functional CI.
4. Completed: pushed the base-reconciled candidate and inspected the only manual
   merge resolution, which combined compatible compatibility-matrix text.
5. Completed: captured and published desktop/mobile design proof for the real
   Connect study through the repository's Playwright fallback when the in-app
   browser runtime was unavailable.
6. Completed: obtained the preliminary ReviewGPT specialist outcome, accepted
   its browser-lifecycle finding, and moved automatic verified cutover into the
   hosted runtime and signed Web control plane with bounded retries.
7. Completed: triaged final ReviewGPT round 1 and remediated its accepted
   runtime-port, source-epoch, per-resource coverage, polling, disclosure, and
   legal-version findings with focused regression proof.
8. In progress: push the round-one remediation head, run final ReviewGPT round
   2 concurrently with required CI, and inspect current-base mergeability
   without spending a second base-update attempt.

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
- Corrected lifecycle remediation: 102 device-sync contract tests, 246 Web
  connect/control-plane tests, 82 hosted-runtime maintenance tests, 362
  Cloudflare transport/policy tests, and all affected package typechecks pass.
- Final round-one remediation: all 979 device-sync tests, 2,193 assistant-runtime
  tests (with four skips), and 296 affected Web tests pass. The final
  temporal-resource edge correction passes 229 device-sync, 366 runtime, and
  159 Web consumer tests plus the device-sync typecheck.
- Affected device-sync, importer, and Web typechecks passed before the base-only
  update; exact-head release build/typecheck and app verification passed in CI.
- Exact-head package coverage, host matrices, fixture coverage, sandbox,
  artifact, billing, and overflow checks passed.
- The frontend design-proof test passes, and the pull request includes rendered
  desktop/mobile proof for authorization, verification, cutover, retry, and the
  provider disclosure.
- Preliminary ReviewGPT returned one accepted finding and final ReviewGPT round
  1 returned six accepted findings. All are remediated locally; the corrected
  exact head must still complete final ReviewGPT round 2.

## Remaining handoff

- Keep the pull request draft.
- Run final ReviewGPT round 2 against the corrected exact head while required CI
  executes; resolve every accepted finding before archiving this plan.
- Recheck the current base with `git merge-tree`. The one permitted base update
  is already consumed, so retain the draft PR and report a moving-base conflict
  if the reviewed patch no longer merges cleanly.
