# Managed Auth Handoff Diagnostics

## Goal

Make Managed Auth startup failures recover into the existing member-bound Live
View handoff without an endless waiting state, while preserving one-browser
writer ownership and producing privacy-safe retry diagnostics when the fallback
cannot be published.

## Root Cause

- Production rejected a valid Kernel Live View URL under the hosted-computer
  origin policy.
- The fallback resume boundary used transaction timestamps even though mailbox
  `laneSeq` is the causal total order.
- A mutable-timestamp heuristic could misclassify ordinary direct-login rows as
  legacy Managed Auth fallbacks.
- A pre-write mailbox-boundary storage failure was collapsed into the same
  checkpointing result as an ambiguous terminal commit, hiding the failure from
  the managed-login runtime log and retry page.

## Constraints

- Do not expose handoff tokens, browser capabilities, provider payloads,
  domains, connection ids, credentials, or direct identifiers in diagnostics.
- Keep ambiguous terminal-write outcomes checkpointing until durable state is
  reread; do not risk a second profile-writing browser.
- Preserve direct-login and pre-migration reply behavior for unmarked rows.
- Keep the schema change additive and nullable.

## Plan

1. Persist the serialized conversation mailbox lane sequence on the run during
   Managed Auth fallback conversion.
2. Use that sequence for reply proof, exact-CAS it during resume, and clear it
   on replacement, resume, and terminal transitions.
3. Delete the legacy mutable-timestamp inference and cover direct/unmarked rows.
4. Normalize pre-write boundary storage failures into a fixed retryable code;
   surface it only when both terminal attempts prove they failed before writes.
5. Run focused tests, migration guards, full web verification, required local
   audits, CI, and ReviewGPT on the exact pushed PR head.

## Verification

- Focused computer-use, managed-auth, handoff route, runtime-log, migration, and
  production-migration-guard tests.
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir apps/web verify`
- `pnpm docs:drift`
- Security/privacy, frontend, and coverage-write completion audits.
- ReviewGPT and GitHub checks on the pushed PR head.

## Deployment

Apply the additive database migration before deploying the new `apps/web`
bundle. The prior app ignores the nullable column, but after the new app creates
sequence-marked active runs, treat the new bundle as a temporary rollback floor
until the bounded active-run TTL drains.

## State

Implementation and local verification are complete. The final web verification
passed with 4,549 tests, 135 skips, zero lint errors, a successful development
smoke, typecheck, and 185-page production build. Security/privacy, frontend,
and coverage-write audits report zero remaining findings. Commit, push, CI, and
ReviewGPT remain.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
