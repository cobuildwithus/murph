# PR 240 ReviewGPT round 18 fixes

## Goal

Resolve accepted ReviewGPT round-18 findings for PR 240 with the smallest
changes that preserve the 14-day inbox media retention invariant, hosted
foreground priority, and existing runner/checkpoint ownership.

## Constraints

- No new scheduler, queue, database, service, or retention owner.
- Keep retention automatic and checkpoint-owned.
- Active pending assistant input media remains protected until terminal evidence.
- Replaced workspace snapshots must have one durable cleanup outcome before the
  complete route reports success: direct deletion or an orphan cleanup record.
- Web cron must signal due retention work without rewriting the authoritative
  retention deadline.
- The current task explicitly opts out of more local audit subagents; use parent
  review plus ReviewGPT only.

## Plan

1. Route stale retention/default mode mismatches through existing runtime fence
   recovery and replacement.
2. Restore pending-input media protections in retention-only checkpoint mode and
   update the regression expectation.
3. Make successful snapshot replacement fail closed when both orphan recording
   and direct cleanup fail.
4. Collapse hosted retention cron claiming into a bounded due-row selection.
5. Run focused tests, typecheck, commit, push, and continue ReviewGPT/CI.

## Verification

- Focused Cloudflare runner/snapshot tests.
- Focused assistant-runtime retention entrypoint tests.
- Focused hosted web retention cleanup tests.
- `pnpm typecheck`.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
