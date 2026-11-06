# Retain bounded Garmin canary progress outside job logs

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Expose the last validated wearable browser stage and numeric host resources even when the private runner does not publish a final job log archive. Actual Garmin connect, canonical-data, and cleanup acceptance remains pending live proof.

## Scope and constraints

Reuse the existing harness progress reporter and closed browser stage vocabulary. Emit no more than ten GitHub notice annotations per scenario, initially and every four minutes or sooner after available memory halves. Keep ordinary stdout progress and all provider/data/cleanup assertions. No provider secrets, raw output, URLs, accounts, new infrastructure, or production mutations.

## Tasks and decisions

1. Return the validated stage from the existing exact-message forwarder and retain it in the scenario owner.
2. Add capped timeline notices to the existing periodic resource reporter; stop through the existing cleanup lifecycle.
3. Prove privacy, timing, memory-pressure sampling, cap, and timer cleanup; verify the composed configuration boundary and affected typechecks.
4. Complete parent review, scoped commit, required final review and exact-head CI; run the protected Garmin follow-up after merge.

## Verification

- Harness wearable progress and canary workflow tests: 10 passed.
- Cloudflare live wearable configuration boundary: 7 passed, 7 live cases intentionally skipped locally.
- Harness and Cloudflare typechecks: passed.
- Complexity, logging privacy, documentation gardening/drift, and whitespace guards: passed. No source hotspot exceeds 20; reporter complexity is 6.
- Parent candidate review: ready; exact stage allowlist, bounded numeric-only annotation payload, ten-notice cap, existing cleanup ownership, unchanged canonical-data/control markers.
- Delivery gates remain pending: final review, exact-head CI, merge, and protected live follow-up. This plan closes the diagnostic implementation, not actual Garmin acceptance.

## Product and completion boundaries

Internal proof infrastructure only; no member-facing UX or changelog change. Existing browser producers still emit the same plain stage protocol, so the new return value and parent notices do not require deployment sequencing. A successful local diagnostic test does not establish actual Garmin recovery.
Completed: 2026-09-12
