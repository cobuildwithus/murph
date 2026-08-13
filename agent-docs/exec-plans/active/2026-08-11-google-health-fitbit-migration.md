# Migrate Fitbit Connections to Google Health

Status: in progress; final ReviewGPT and current-base gates remain
Created: 2026-08-11
Updated: 2026-08-13

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
8. Completed: pushed the round-one remediation head and ran final ReviewGPT
   round 2 as a fresh full-snapshot audit with exact rendered evidence.
9. Completed: final ReviewGPT round 2 required a repeated-mechanism
   retrospective because reverting only the consent registry preserved old
   grants but made new July 23 acceptance events point at August 11 documents.
   The recorded shrink decision restores Terms and Privacy content, versions,
   and immutable PDFs to July 23, retains exact disclosure on the connect card
   and independently versioned subprocessor register, and adds no compatibility
   owner or grant migration.
10. Completed: pushed the retrospective correction and ran final ReviewGPT
    round 3 as a fresh full-snapshot audit. It found canonical coverage was
    advancing from raw retention rather than exact canonical receipt identity,
    the browser retry passed a projected connection ID into a raw-ID owner, and
    completed cutover left a migration-owned notice mounted.
11. Completed: pushed the round-three remediation and ran final ReviewGPT round
    4. It accepted four findings: importer-owned canonical local-day coverage,
    strict availability semantics with sparse-resource obligations, recovery of
    the post-revoke/pre-finalize crash window, and stale retry UI state.
12. Completed: pushed the round-four remediation and ran final ReviewGPT round
    5 with all eight rendered captures. It required a second retrospective:
    successor admission still compared raw UTC-shaped records after legacy
    coverage moved to canonical local-day boundaries, while crash recovery
    could leave an active-provider pre-revoke claim pending forever.
13. Completed: pushed the requirement-level round-five remediation, reran final
    ReviewGPT against the exact head with all rendered evidence attached, and
    inspect current-base mergeability without spending a second base update.
14. Completed: final ReviewGPT round 6 accepted one review-induced receipt
    gap: the importer resolved the vault timezone for normalization but did not
    pass it into committed daily-coverage derivation. Apply the existing
    resolved timezone at that owner boundary, remove the test helper's invented
    UTC fallback, prove floating date-only event identity plus monotonic durable
    coverage and mixed daily/interval obligations, then run round 7 at the
    ReviewGPT hard cap.
15. Completed: final ReviewGPT round 7 required the hard-cap retrospective.
    Replace timezone-derived daily timestamps with stable canonical day keys,
    converge provider-confirmed Fitbit disconnection through the existing Web
    cutover owner, and obtain the user's explicit decision before any round 8.
16. Completed: the user authorized continued review beyond the hard cap. Final
    rounds 8 and 9 found incomplete legacy-provider status aggregation and
    stale successor/provider authority checks; both were remediated with
    complete-set status semantics and live provider-list revalidation.
17. Completed: final round 10 found two review-induced edges. Daily facts must
    not advance cutover coverage while their provider-local day is still open,
    and browser polling must span automatic `cutover_ready` processing without
    continuing after completion or a retry-required failure. Both were
    remediated and the exact head was sent through a full-snapshot round 11.
18. Completed: final round 11 found the closed-boundary suppression still left
    the preceding day as the fence, so an active cutover could admit the current
    Google Health day after Fitbit had already written it. Pair every accepted
    daily boundary with its exact provider-local next-midnight readiness instant,
    require that instant to elapse for active-provider cutover, and attempt the
    cutover before the hosted scheduler can import the next legacy day. That
    correction was pushed and the explicitly authorized final-gate loop continued.
19. In progress: final round 12 found that the readiness instant was stripped at
    both the real device-sync receipt bridge and Web source-summary sanitizer.
    More importantly, elapsed midnight did not prove the accepted current-day
    Fitbit aggregate was final because pre-scheduler cutover prevented a fresh
    post-close provider pull. Replace time-only readiness with end-to-end durable
    proof that a fresh Junction pull performed after the provider-local day
    closed canonically accepted the day, run active cutover only after scheduled
    work is drained and published, then push and continue to a valid pass.

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
- Carry one durable per-resource Fitbit boundary into the Junction importer and
  apply it only after canonical normalization, before the writer. Daily facts
  use their canonical provider day key; interval facts use the canonical
  accepted interval end. The receipt, source summary, and fence share that
  representation, with no timezone-derived daily timestamp or second store.
- Treat explicit upstream Fitbit `disconnected` as provider-confirmed terminal
  evidence. Runtime candidacy, readiness, importer admission, fencing, and UI
  use the shared terminal predicate; the existing Web cutover owner converges
  it to the completed local marker after successor verification without a
  redundant revoke. Legacy disconnected rows with no error code are the same
  terminal provider fact; a missing coverage marker is waived only when their
  availability summary proves they produced no resource obligation. Ambiguous
  or unavailable states remain fail-closed.
- Treat `SOURCE_DISCONNECT_IN_PROGRESS` plus the source row's `lastSeenAt` as a
  bounded 60-second cutover claim. A fresh active-provider claim remains with
  its owner; a stale claim is renewed under the exact source epoch before the
  existing list-before-revoke operation resumes. Provider absence finalizes the
  fence, active failure restores the existing retry marker, and an unprobeable
  outcome retains the renewed bounded claim. Do not add a lease table or worker.
- Publish every durably accepted daily fact as its canonical day boundary so the
  overlap fence advances immediately. Mark that boundary cutover-final only when
  a fresh Junction provider pull made after the provider-local day closed
  canonically accepts the day again; inline webhook payloads and replays cannot
  finalize it. An active legacy source cannot cut over until every produced
  daily resource has this finalization proof. Explicit terminal provider state
  waives only proof that can no longer be obtained, not the durable boundary.
  The hosted pass schedules and drains provider work, publishes source authority,
  and then attempts cutover. Interval resources keep their accepted instant
  boundary and need no daily finalization marker.

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
- Final ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED` for the repeated
  legal-version mechanism. The PR comment records the first-head/current-shape
  comparison and selects scope deletion: no Terms/Privacy change belongs in
  this migration, while the card and subprocessor register retain the required
  provider disclosure. Round 3 must verify the resulting exact head.
- Retrospective correction proof: all 34 focused consent-route, registry,
  manifest, and legal-copy tests pass; the Web typecheck passes; generated
  current Terms and Privacy PDFs are byte-identical to their immutable July 23
  artifacts and match the manifest hashes.
- Final round-three remediation proof: all 224 Junction provider tests and all
  251 affected Connect, browser-ingress, signed-runtime, and cutover route tests
  pass. Device Sync and Web typechecks pass. Coverage now advances only for raw
  records represented by an exact canonical receipt identity; projected browser
  IDs resolve through the existing ownership boundary; completed cutover clears
  only migration-owned notices before and after polling backoff.
- Final round-four remediation proof: all 390 importer tests, all 981 device-sync
  tests, and 250 affected Web tests pass. Importer, device-sync, and Web
  typechecks pass. Canonical coverage now comes from committed vault records and
  uses the vault-resolved local-day boundary; availability accepts only explicit
  supported values; an absent Fitbit registration recovers the exact fenced
  cutover without a second revoke; and successful retry removes its stale error.
- Final round-five retrospective proof: 154 focused importer tests, 224 focused
  Junction provider tests, and 136 hosted Web cutover tests pass. The importer,
  device-sync, and Web typechecks plus focused Web lint pass. Coverage includes
  positive-offset and DST local-day boundaries, interval-ended sleep, the real
  vault-writer boundary, stale pre-revoke recovery, concurrent retries with one
  provider mutation, and both absent and still-active ambiguous revoke results.
- Final round-six remediation proof: the production-shaped real-importer test
  first failed with an empty receipt for a committed date-only Fitbit activity
  event in a non-UTC vault, then passed after forwarding the importer's existing
  resolved vault timezone into receipt derivation. All 156 focused Junction
  importer tests and 231 focused Junction provider/public-account tests pass,
  with importer and device-sync typechecks. The committed floating event stays
  timezone-free and replay-stable; durable coverage remains monotonic across a
  vault-timezone update; mixed activity/sleep obligations and successor fencing
  are covered together.
- Final round-seven retrospective proof: 156 focused importer tests, 233 focused
  device-sync tests, 82 hosted-runtime maintenance tests, and 256 affected Web
  tests pass. Importer, device-sync, runtime, and Web typechecks pass. Daily
  coverage is now stable across vault-timezone changes, interval coverage stays
  instant-based, provider-confirmed Fitbit absence admits only post-boundary
  Google Health facts, and Web converges that state without another revoke.
- Final round-ten remediation proof: all 160 focused Junction importer tests,
  all 235 Junction device-sync tests, and all 121 Connect-page tests pass.
  Importer, device-sync, and Web typechecks pass, and importer/device-sync builds
  pass. Daily closure is covered west and east of UTC plus a DST boundary;
  accepted sleep intervals remain instant-based; Connect polling spans
  verification and automatic cutover, then stops on success or retry-required
  failure.
- Final round-eleven finding was reproduced as a boundary-authority gap: hiding
  an accepted open-day fact retained the prior day's fence, which allowed a
  post-cutover Google Health fact for the already-written day. The correction
  now persists the accepted day plus a timezone/DST-exact readiness instant,
  fails closed if that instant is unavailable, and cuts over before another
  eligible legacy scheduler pass. Focused importer, device-sync, and hosted
  runtime proofs covered daily readiness, terminal waiver, and pre-scheduler
  ordering before round twelve replaced that incomplete authority. All 160
  importer, 243 device-sync, 84 hosted-runtime maintenance,
  and 367 affected Web tests pass; all four affected typechecks and the three
  affected package builds pass.
- Final round-twelve finding was reproduced at both lossy authority boundaries
  and in hosted ordering. The correction carries canonical post-close
  provider-pull finalization through importer receipt, local source summary, and
  Web persistence; inline payloads and replays remain provisional, and active
  cutover runs only after scheduler, drain, reconcile, and durable publication.
  Initial focused proof passes all 161 importer tests, 348 device-sync tests, 84
  hosted-runtime maintenance tests, and 9 Web source-store tests.

## Remaining handoff

- Keep the pull request draft.
- Commit and push the round-twelve remediation, then continue the user-authorized
  ReviewGPT loop against that exact head until it reaches a valid pass.
- Recheck the current base with `git merge-tree`. The one permitted base update
  is already consumed, so retain the draft PR and report a moving-base conflict
  if the reviewed patch no longer merges cleanly.
