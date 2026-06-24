# PR 240 independent retention wake

## Goal

Fix ReviewGPT round-13 for PR #240: inbox media retention must keep an
independent durable wake from assistant/model work, and AI-denied assistant
work must not suppress or bypass media deletion.

Success criteria:

- Assistant wake timestamp/reason stay intact and usage-gated.
- Inbox media retention wake is persisted separately and can schedule runtime
  work even when assistant work is blocked.
- Retention-only processing cannot enter assistant/model automation.
- No new scheduler/service; keep the existing hosted runtime processing loop.
- Focused tests, typecheck, and CI pass before handoff.

## Constraints

- No local subagent review passes for this follow-up.
- Prefer one explicit nullable retention wake field over hidden redacted-status
  state or mixed wake reasons.
- Keep the runtime retention-only path bounded to existing retention/checkpoint
  primitives.

## Plan

1. Add the independent retention wake field through workspace persistence and
   hosted control contracts.
2. Have reconciliation expose/schedule the earliest wake while AI-gating only
   model-capable assistant wakes.
3. Thread a retention-only processing mode through Temporal and Cloudflare to
   the runtime invocation request.
4. Make runtime retention-only mode run inbox media maintenance and checkpoint
   without entering assistant automation.
5. Replace the mixed-reason regression with denied-usage and retention-only
   coverage, then verify and rerun ReviewGPT.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
