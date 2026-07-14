# PR 620 CI Clock Assertion

## Goal

Keep the hosted retry E2E focused on observable delivery ordering instead of runner wall-clock speed.

## Scope

- Delete the redundant deadline assertion after foreground delivery.
- Preserve the existing accepted-send ordering and exactly-once assertions.
- Run the focused test validation available locally and require the hosted CI lane to pass.

## Verification

- Run the focused static/test checks available without starting a hosted-local stack.
- Push, rerun ReviewGPT for the changed head, and require green CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
