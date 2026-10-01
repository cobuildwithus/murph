# Bound stalled workspace snapshot downloads

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Recover promptly from inactive snapshot response bodies while preserving
authenticated restore and downloads that continue making progress.

## Product UX

- Outcome: returning conversations can recover from a stalled context download.
- Reaches: cold hosted workspace restores; warm conversations are unaffected.
- Proof: synthetic encrypted restore retries once after inactivity, preserves the
  prior workspace on exhaustion/cancellation, and accepts a progressing stream.

## Scope and decisions

- Add an optional per-read idle budget to the existing body reader, enabled only
  for snapshot downloads at 15 seconds. URL expiry remains the total deadline.
- Keep inactivity distinct from ordinary non-retryable control deadlines; the
  existing restore loop owns the same maximum of two attempts.
- Preserve checksum/authentication, byte limits, cancellation, temporary cleanup,
  and durable-root replacement ordering.
- Emit bounded attempt timings through existing Cloudflare structured logs only;
  no database, persisted wire field, provider input, or scheduler changes.
- Read-wait includes event-loop scheduling; neither metric alone proves a network
  root cause. Private production evidence stays out of repository artifacts.

## Risks and proof

- Progressing downloads must outlive the idle interval: test repeated progress
  and slower consumer processing with a synthetic clock.
- Do not broaden retry authority: prove caller abort, total timeout, scoped idle
  classification, encrypted restore retry, and attempt exhaustion.
- Preserve prior durable files when attempts fail; only authenticated extraction
  may replace them.

## Verification

- Full response-reader and runner-platform suites: 211 tests passed.
- Diff-aware verification selected the Cloudflare owner: all guards passed,
  with 2,927 tests passed and 2 existing skips across Node, container-helper,
  and Worker suites.
- Cloudflare typecheck and complexity guard passed. The existing upload hotspot
  remains unchanged at 28; the response reader is 19 with no complexity debt.
- Changelog archive: 9 tests passed. Web typecheck passed after building the
  missing local device-syncd artifact; no unrelated source correction was needed.
- Parent diff, added-content privacy, and merge-tree checks passed.
- PR #2842, ReviewGPT round 1: PASS, zero findings, on
  `9ae5239f1c6996ffc09ebf611f061ebf088d309e` using the Hercules lane and
  verified `gpt-6-pro`. Response hash and committed-turn identity match.
- Review took about 7 minutes 16 seconds from send to capture. Accepted under
  the documented near-threshold rule: exact model, full snapshot, head and
  eight-file patch identity, completion marker, source-level reasoning and
  fourteen isolated checks provide substantive scope-appropriate evidence.
  External checks are supplemental; the local suites ran the actual packages.
- Changelog uses the documented content-only presentation exception; no renderer
  changes require new screenshots.
- Implementation and parent review are complete. This plan-only closing change
  preserves the reviewed implementation. Required final-head CI remains the PR
  merge gate; production rollout and recovery verification are separate.

## Deployment

One Cloudflare runner release; no ordered Web or Temporal contract migration.
Old containers retain previous behavior until replaced. Use the existing deploy
process; local proof does not establish production recovery.
Completed: 2026-09-04

## Final CI follow-up

The final-head assistant-engine coverage job exposed an unrelated existing test
expectation in the onboarding predecessor cases. A generated schedule at the
legacy occurrence time preserves the pending retry, but the test expected the
next daily occurrence. Reuse its existing `transfersLegacyPendingOccurrence`
condition for that expectation. This correction changes only test evidence;
no scheduler or reviewed restore implementation changes. All three focused
predecessor cases and assistant-engine typecheck passed after the correction.
The required release-gate rerun remains necessary before merge.
