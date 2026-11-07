# Preserve ordinary cron failure attribution

Status: completed
Created: 2026-10-22
Updated: 2026-10-22

## Goal and evidence

Ordinary cron failures retain the broad error code but drop the original
finite Codex classification and HTTP status. The existing detailed context is
assigned only in the non-replayable maintenance branch. A synthetic failure
carrying an existing typed context must retain that context in the existing
cron completion observation, while preserving the run outcome and retry.

## Scope and ownership

- Reuse the cron execution owner, shared safe failure projection, existing
  completion event and hosted runtime-log pipeline. No new event or state owner.
- Preserve maintenance replay attribution and every execution, admission,
  persistence, delivery, cancellation, retry and timing decision.
- Keep fields finite and bounded. No messages, stack traces, tool inputs,
  provider bodies, member identifiers, raw context or new correlation values.
- Existing PR 2629 changes delivery-reconciliation tests only. Its actual diff
  has no overlap with ordinary failure attribution; dirty worktree checks found
  no collision. Other owners remain untouched.

## Verification and completion

1. ReviewGPT authors the smallest correction and composed regression proof.
2. Apply tests first and prove missing original fields against unchanged source.
3. Apply the correction; verify ordinary failure classifications, absent/invalid
   context, success and maintenance barriers through existing composed tests and
   strict runtime-log parsing. No real provider calls or production mutations.
4. Run focused engine/runtime tests, relevant typechecks, complexity, docs and
   privacy checks. Telemetry only: prompts, tool choices, replies and UX do not
   change; no real-Codex journey or member-facing changelog is required.
5. Close the plan, scoped commit, draft PR, Ready pushed candidate, final
   ReviewGPT concurrent with required exact-head CI, then merge and canonical
   runtime deployment under the sweep authorization.
6. Verify serving revision and natural observations. Request the native
   heartbeat when available; preserve the concrete observation blocker if the
   required tool remains unavailable. Never invent a scheduler or claim quiet
   traffic exercises the failure path.

## Status

ReviewGPT authored the existing-helper extension and composed proof. Four
ordinary telemetry cases failed against unchanged source; two controls passed.
After correction, 286 cron execution tests, 156 hosted maintenance tests and
four runtime-log tests passed. Engine and runtime typechecks passed. The parent
kept the existing provider-admitted boolean argument and moved optional barrier
selection into the diagnostic helper, avoiding one added branch in the large
execution owner. Engine proof/typecheck was rerun and passed; complexity debt
and maximum remain unchanged (105 and 106). Docs and whitespace guards passed.

Parent review confirms bounded finite fields, unchanged scalar readers, no
persisted-state or retry changes, no added logs or external calls, and no
production/private evidence in the patch. Existing old-reader parser accepts
the new optional fields; old writers continue to omit them. Runtime deployment
and natural-failure observation remain necessary after final review and CI.
Completed: 2026-10-22
