# Reuse scheduled automation turn preparation

Status: completed
Created: 2026-07-20
Updated: 2026-07-21

## Goal

- Make delayed scheduled-automation continuations reuse the canonical scheduled
  turn preparation path without conflating their mailbox lifecycle with the
  original cron occurrence lifecycle.

## Success criteria

- Delayed continuation uses the same automation turn-envelope primitive as
  ordinary scheduled execution and retains the existing shared route,
  capability-scoping, notification, and outbox primitives.
- Continuations preserve the configured assistant target and are classified as
  scheduled automation rather than inbound auto-replies.
- Mailbox claim/retry/expiry/fallback behavior remains separately owned and no
  new queue, state machine, compatibility layer, or persisted state is added.
- Focused tests prove the shared preparation contract and the intentionally
  distinct service-tier/lifecycle inputs.
- Scoped verification, coverage review, green PR CI, and ReviewGPT complete
  with no unresolved accepted findings.

## Scope

- In scope: scheduled automation turn preparation in assistant-engine and its
  focused runtime tests.
- Out of scope: changing Assistant Ask product semantics, cron or mailbox state
  ownership, completion expiry, retry policy, and the larger disclosure feature
  architecture in the stacked base PR.

## Constraints

- Stack from the exact reviewed head of the disclosure feature branch so this
  PR exposes only the focused cleanup.
- Prefer deletion and one existing source of truth over mode flags or a broad
  abstraction.
- Preserve unrelated active ledger work, especially broad assistant-engine
  review lanes.

## Tasks

1. Trace ordinary cron and delayed-continuation preparation through delivery,
   outbox provenance, usage attribution, and target selection.
2. Reuse the existing shared turn-envelope primitive instead of introducing a
   second preparation abstraction or hand-copying its fields.
3. Add focused regression proof for target override, scheduled trigger, and
   intentionally separate lifecycle/service-tier behavior.
4. Run scoped verification, coverage review, and parent final review.
5. Close the plan with a scoped commit, push, open the stacked draft PR, then
   run CI and ReviewGPT concurrently to completion.

## Decisions

- Reuse turn preparation, not the cron claim/finalize lifecycle: the completion
  mailbox already owns replay, expiry, and fallback after the originating
  occurrence is consumed.
- Keep continuation service tier explicit and non-Flex because mailbox retry
  attempts do not share the cron failure counter that bounds Flex first
  attempts.
- Do not extract a broader mode-driven notification builder. Route liveness,
  reviewed-completion expiry/fallback, and cron claim/finalize hooks have
  different owners; the current shared route, group-tool, envelope,
  notification, and outbox primitives already cover the composable seams.

## Audit outcomes

- The required coverage-write pass added only focused proof that occurrence
  time, abort signal, and turn environment survive the shared envelope. It
  found no remaining actionable coverage gap.
- Parent final review confirmed scheduled isolation is still derived from the
  reviewed completion plus invocation authority, scheduled turn behavior is
  still derived from the occurrence timestamp, and only the intended
  target/trigger preparation changed.
- No new state owner, queue, retry policy, compatibility path, dependency, or
  cross-package API was introduced.

## Verification

- Focused assistant cron runtime test: 140/140 passed.
- Diff-aware verification passed dependency, boundary, guard, and all affected
  typechecks, then the assistant-engine no-coverage suite exhausted the local
  default 4 GiB Node heap. The package fallback below is the final owner proof.
- `NODE_OPTIONS=--max-old-space-size=8192 MURPH_VITEST_MAX_WORKERS=4 pnpm --dir packages/assistant-engine test:coverage`:
  170 files passed, 1 skipped; 2,550 tests passed, 5 skipped; 89.61% statements,
  82.06% branches, 94.18% functions, and 89.64% lines.
- `pnpm typecheck`: passed across the full workspace.
- `git diff --check`: passed.
- Required coverage-write audit and parent final review: passed with no
  unresolved actionable findings.
- PR CI, exact-head ReviewGPT loop, and mergeability proof remain as the final
  external gates.
Completed: 2026-07-21
