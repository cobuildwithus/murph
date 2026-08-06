# Overlap cold App Server initialization with first-contact bootstrap

Status: completed
Created: 2026-08-05
Updated: 2026-08-06

## Goal

- Reduce fresh-number first-reply latency by starting the resident Codex App
  Server after the first eligible conversation input is durably staged, even
  when that same invocation first had to bootstrap the vault.
- Preserve bootstrap ordering, accepted-input authority, provider-egress
  authority, foreground ownership, checkpoint safety, and ordinary fallback.

## Proven latency and code-path evidence

- The closest fully correlated fresh-number trace spent about 1.9 seconds in
  App Server initialization after conversation staging, inside an approximately
  24.6-second end-to-end reply.
- Current runtime code installs the existing process-preparation callback only
  when vault metadata existed before the invocation. A cold first-contact
  invocation therefore suppresses preparation even after system bootstrap has
  created metadata and the Linq conversation import has staged its assistant
  input.
- The hosted runtime contract already permits process-only initialization after
  restore, final managed Codex config/auth preparation, and staging of the first
  fresh auto-reply-enabled Linq or Telegram candidate. Bootstrap itself remains
  ineligible and must not trigger preparation.

## Success criteria

- A cold first-contact invocation starts process-only initialization only after
  system bootstrap succeeds and the eligible conversation input is staged.
- Bootstrap, system-only work, email, self-authored input, replay, maintenance,
  and active-turn imports remain unable to admit preparation.
- Preparation still starts no thread, turn, provider request, tool assembly, or
  delivery, and any preparation failure falls back to authoritative foreground
  startup without consuming accepted work.
- Snapshot and invocation-release paths continue to join and cancel the exact
  pending preparation handle before crossing the workspace boundary.
- Focused regression tests, assistant-runtime typecheck, exact-head CI,
  preliminary specialist review, and final ReviewGPT pass with no unresolved
  findings.

## Scope

- In scope: the existing hosted-runtime preparation-admission callback and a
  focused cold-bootstrap ordering regression, plus directly matching runtime
  documentation if code inspection proves it stale.
- Out of scope: Web/Temporal direct-wake collapse, container allocation,
  assistant model selection, prompt changes, provider-turn optimization, new
  queues, retries, state owners, dependencies, or user-visible message copy.

## Constraints

- Reuse the existing assistant-engine resident-process owner and exact-process
  cancellation handle; add no second readiness or lifecycle owner.
- Do not move initialization before final managed config/auth preparation or
  before an eligible conversation candidate is staged.
- Treat preparation as a best-effort latency optimization only. Foreground
  admission and delivery remain authoritative and fail safe.
- Keep all production evidence aggregate, bounded, and free of message content,
  member identifiers, phone numbers, provider payloads, or local paths.

## Tasks

1. [x] Trace the current admission path, runtime contract, active-plan overlap,
   and the measured App Server segment.
2. [x] Add a focused cold-bootstrap regression that proves the required event
   ordering and fails on the current implementation.
3. [x] Make the smallest admission change and run scoped tests/typecheck plus
   direct diff and privacy review.
4. [x] Push the exact candidate, open a PR, and run preliminary specialists,
   final ReviewGPT, and exact-head CI concurrently where allowed.
5. [x] Resolve accepted findings and close this plan with
   `scripts/finish-task`; leave the verified PR open, unmerged, and undeployed
   per the user's explicit instruction.
6. [x] Report the evidence-backed projected saving separately from production
   measurement; production measurement remains future work after an authorized
   merge and deployment.

## Verification log

- Before the source change, the focused cold-bootstrap regression failed at the
  staged conversation boundary because `onConversationInputStaged` was `null`.
- After the one-condition admission correction, that focused regression passed
  and proved `bootstrap complete -> conversation durably staged -> App Server
  initialization -> foreground`.
- The complete assistant-runtime Vitest suite passed: 81 files, 2,048 tests
  passed, and 4 tests skipped.
- `pnpm --filter @murphai/assistant-runtime typecheck` passed.
- `pnpm docs:drift` and `git diff --check` passed.
- Static parent and delegated review confirmed production conversation import
  requires bootstrap metadata and durable input staging before the callback;
  existing regressions retain system-only, email-first, active-turn, failure
  fallback, and snapshot-cancellation exclusions.
- The preliminary specialist finding requesting production-faithful process
  ownership coverage was accepted. A hosted-local Linq scenario now queues
  activation without waking, lets the inbound webhook own the only cold
  processing ensure, and checks terminal delivery plus the real App Server
  `preinitialized` timing trace with `node-process-first-use` cold authority.
  The trace and the cold restore plus two-item initial import must share the
  same runtime attempt ID.
- `pnpm --filter @murphai/cloudflare-runner typecheck` passed after the
  hosted-local coverage addition.
- `pnpm hosted-local e2e linq-first-contact` was blocked before scenario start
  by the pre-existing runner entrypoint bundle ratchet: the assembled output
  measured 10,273,354 bytes against the checked-in 10,219,693-byte budget.
  This patch adds only test/test-support code outside the runner bundle, and
  the production source diff deletes three lines, so the coverage scenario
  remains direct proof pending resolution of that unrelated bundle baseline.
- The sanctioned prepared-artifact reuse lane,
  `pnpm hosted-local e2e linq-first-contact --no-bundle`, also stopped before
  scenario start because the local Docker API was unavailable while preparing
  the pinned runner base image. No bundle budget or runtime invariant was
  bypassed.
- Preliminary specialist review's only accepted finding was the hosted-local
  ownership coverage above. Final ReviewGPT passed the immutable candidate with
  no findings; the later change is test/test-support proof only.
- Exact-head GitHub Actions passed the CLI host matrix, release build/typecheck,
  app verification, assistant/CLI/platform package coverage, fixture coverage,
  frontend proof, overflow, and artifact-hygiene checks. The Vercel check passed
  through its configured ignored-build path.
- Parent final review found no unresolved source, ordering, privacy, delivery,
  or documentation issue. The candidate remains open, unmerged, and undeployed.
Completed: 2026-08-06
