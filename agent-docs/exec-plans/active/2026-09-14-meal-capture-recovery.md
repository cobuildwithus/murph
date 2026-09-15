# Recover automatic meal capture and Photos permission status

Status: active
Created: 2026-09-14
Updated: 2026-09-14

## Goal

- Automatic meal capture recovers from interrupted work and shows an actionable
  status when Photos access or delivery needs attention.

## Success criteria

- Meals refresh includes the bounded foreground continuation and its final status.
- Lost Photos permission remains visible above saved photos, even offline.
- Missing delivery routes retain pending photos and explain recovery.
- A changed-image retry can recover an authenticated original capture receipt
  without changing the canonical image or creating another mailbox input.
- OCR execution failures use the existing bounded asset retry policy.
- Focused server and native regressions, typecheck/build, rendered UI proof,
  parent review, and required PR gates pass, or gaps are reported explicitly.

## Scope

- In scope: existing native capture coordinator, processor, state and Meals UI;
  additive server conflict receipts; synthetic regression tests and owner docs.
- Out of scope: classifier threshold changes, historical scanning, retention
  changes, release, deployment, and unrelated native feature branches.

## Constraints

- Keep existing capture identity, strict immutable payload binding, transaction
  authority checks, cancellation fences, future-only cursor, and bounded work.
- Persist no original images, private examples, tokens, or direct identifiers.
- Work in isolated branches in the backend and native repositories. Use paired
  PRs with exact counterpart revisions and independent required review gates.

## Risks and mitigations

1. A receipt could acknowledge another capture or replace original content.
   Mitigation: issue it only for an authenticated member/event/capture match;
   leave the strict conflict and original envelope unchanged.
2. Waiting for follow-up work could break teardown or become unbounded.
   Mitigation: retain tracked cancellation tasks and wait at most two passes.
3. Status reads could cross a session boundary or hide Photos loss offline.
   Mitigation: retain epoch/operation guards and publish local permission state
   independently of remote member proof.

## Tasks

1. Implement additive canonical receipts and server regressions.
2. Fix native continuation, status, upload recovery, and OCR retry behavior.
3. Render and inspect Photos-loss and upload-recovery states with saved tiles.
4. Run focused checks, inspect the diff, update durable docs and changelog.
5. Commit scoped candidates, create paired draft PRs, and complete routed gates.

## Decisions

- Deploy the additive server receipt producer before shipping the native reader.
  Old clients still receive the existing strict 422 conflict; new clients keep
  receipt-less conflicts visible and pending instead of silently dropping them.
- The supplied private photo is not a fixture. Prior diagnostic classification
  passed; physical-device reproduction remains unavailable.

## Verification

- Backend: focused companion capture route and prepared-mailbox Vitest suites;
  Web typecheck and complexity diff.
- Native: XcodeGen, SwiftFormat lint, relevant simulator XCTest suites and app
  build; real simulator screenshots for permission loss with saved photos.
- Journeys: delayed second scan; credential rejected mid-refresh; missing route;
  committed upload with lost response followed by edit; OCR exception; Photos
  loss while offline; restoration of access; sign-out during pending work.

## Candidate evidence

- Backend: 38 focused route/mailbox tests pass; Web typecheck passes. Complexity
  guard passes; the pre-existing workspace-target validator hotspot is unchanged.
- Native: 410 unit tests and two UI tests pass on an isolated iOS 26.5 simulator.
  XcodeGen, app/extension compilation, and full SwiftFormat lint pass.
- Inspected real simulator screenshots for permission loss with saved history,
  missing delivery route, and unconfirmed prior upload. Recovery remains visible
  above tiles; the Photos action opens iPhone Settings. Product walkthrough Ready
  within simulator proof; signed physical-device capture remains unverified.
- Changelog decision: this backend PR adds compatibility metadata for a native
  reader that has not shipped. Published clients keep their current response
  behavior, so the backend change alone has no new member-visible release note.
- Remaining: paired PRs, required independent reviews and exact-head checks; close
  this plan after those completion gates. No release or deployment is included.
