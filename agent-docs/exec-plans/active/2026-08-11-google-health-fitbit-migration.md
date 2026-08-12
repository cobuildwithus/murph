# Migrate Fitbit Connections to Google Health

Status: active
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

1. Send the corrected official-contract and automatic-cutover packet to
   ReviewGPT and retrieve its scoped patch.
2. Inspect the patch, reconcile it with current Junction/Google documentation,
   and apply only scoped, maintainable changes.
3. Add or refine focused tests and synthetic documented-contract fixtures for
   every migration edge.
4. Run local focused verification plus rendered desktop/mobile catalog proof.
5. Commit and push an exact candidate head, update the PR, and run preliminary
   and final ReviewGPT gates concurrently with required CI.
6. Resolve accepted findings, run parent final review, archive this plan, and
   leave the PR/worktree ready for the authorized merge boundary.

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

- Commands to run: focused device-sync config/provider tests, hosted connect and
  connect-page tests, importer/query fixture tests, affected typechecks,
  `git diff --check`, design-catalog proof, exact-head required CI, preliminary
  completion-specialists ReviewGPT, and the final sensitive ReviewGPT loop.
- Expected outcomes: all focused and required checks pass; one Fitbit card starts
  `google_health`; legacy identity remains truthful; cancellation preserves the
  old connection; verified successor readiness automatically cuts over without a
  second member action; duplicate legacy/successor observations are not admitted;
  and no unsupported readiness or sleep-score promise remains.
