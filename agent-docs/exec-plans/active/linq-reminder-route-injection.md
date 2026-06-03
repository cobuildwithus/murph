# Linq Reminder Route Injection

## Goal

Fix the hosted/local iMessage reminder creation path so `vault-cli automation save`
receives the current Linq delivery target automatically during foreground
assistant turns.

## Constraints

- Keep the fix simple and owner-local; do not add scheduler or delivery
  fallbacks.
- Preserve fail-closed behavior for Linq reminders without a deliverable target.
- Do not expose direct provider identifiers, secrets, raw payloads, or local
  personal identifiers in code, tests, logs, docs, or handoff.

## Current Evidence

- Scheduler and delivery work after a manually recovered delivery target.
- A new foreground reminder save first failed because `--delivery-target` was
  absent, which means the intended injected current route did not reach the
  spawned CLI process.

## Plan

1. Trace current Linq route facts from mailbox input to assistant turn planning
   and CLI process env.
2. Patch the smallest missing propagation boundary.
3. Add focused regression coverage for automatic target injection.
4. Run targeted tests, typecheck, and direct hosted-local reminder proof.
