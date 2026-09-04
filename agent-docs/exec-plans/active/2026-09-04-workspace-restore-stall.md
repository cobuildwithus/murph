# Bound stalled workspace snapshot downloads

Status: active
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
- Cloudflare typecheck, complexity guard, and added-content privacy review passed.
- Diff-aware coverage and changelog validation are running.
- Changelog copy is written; scoped PR and required final review remain pending.

## Deployment

One Cloudflare runner release; no ordered Web or Temporal contract migration.
Old containers retain previous behavior until replaced. Use the existing deploy
process; local proof does not establish production recovery.
