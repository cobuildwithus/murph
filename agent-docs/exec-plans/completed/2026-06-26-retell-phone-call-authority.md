# Retell Phone Call Authority Fix

## Goal

Fix the post-merge Retell phone-call authority issues from PR 295:

- Create Retell calls with Murph metadata and dynamic variables in the provider-supported request fields.
- Prevent `call_analyzed` webhooks from finalizing rows that web already failed as unstarted/stale.

## Constraints

- Keep the fix inside the existing web-owned Retell phone-call boundary.
- Preserve recovery for real calls where Retell started but the local provider-id update was lost.
- Do not persist raw Retell transcripts, raw request bodies, provider secrets, or call audio.
- Add focused regressions for request shape and stale webhook replay.

## State

Ready to close.

## Done

- Confirmed current `main` still nests metadata and dynamic variables under `agent_override`.
- Confirmed Retell SDK create-call params expose `metadata` and `retell_llm_dynamic_variables` as top-level fields.
- Confirmed `call_analyzed` lacks the status/ended authority guard present in `call_ended`.
- Typed the Retell create-call request with `retell-sdk` and moved Murph metadata/dynamic variables to top-level fields.
- Added the `call_analyzed` authority guard and regressions for stale failed rows and ended failed rows.
- Verified with focused Retell tests, web typecheck, root typecheck, dependency guard, ignored-build review, and `pnpm test:diff`.

## Now

- Run commit/plan closure.

## Next

- Hand off the committed branch and verification notes.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
