# Hosted foreground mailbox budget removal

## Goal

Remove the foreground-only hosted mailbox import budget that can strand fresh
conversation input inside a long-lived warm runtime invocation.

Success criteria:

- Foreground conversation wakes are not blocked by the per-invocation mailbox
  replay budget.
- Initial and background mailbox replay still keep the existing bounded import
  behavior.
- A focused regression proves more than ten foreground conversation imports in
  one invocation continue to reach the assistant.

## Constraints

- Default to deletion and the smallest runtime primitive that preserves
  foreground user-reply priority.
- Preserve the existing replay/catch-up mailbox budget until there is separate
  evidence it is obsolete.
- Do not touch unrelated active mailbox consume-authority work.
- Do not expose local identifiers, secrets, raw mailbox payloads, or home paths
  in committed artifacts.

## Approach

1. Delete the foreground-specific budget and its separate fetch cap.
2. Keep foreground conversation imports on a direct import path with the normal
   mailbox page limit.
3. Update tests that previously encoded the special foreground budget and add
   the production regression.
4. Run focused assistant-runtime verification plus repo typecheck.

## State

Complete. Foreground conversation imports no longer consume a cumulative
foreground-only mailbox budget; the existing replay/catch-up budget remains on
initial and system imports.

## Notes

- Production evidence on 2026-07-07 showed active-turn conversation imports
  exhausted the foreground budget across a single warm invocation before a fresh
  group-chat message could reach Codex.
- The foreground cap entered with hosted runtime E2E stabilization work, not as
  a documented product, provider, or security invariant.
- Verification passed: assistant-runtime Vitest, scoped `test:diff`, and full
  repo `pnpm typecheck`.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
