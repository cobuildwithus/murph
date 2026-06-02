# Hosted Assistant Input Admission

## Goal

Preserve the invariant that foreground user messages staged as Assistant Input remain reply-eligible even when active-turn notification misses or another runtime path is busy.

## Scope

- Reuse the assistant automation scanner as the single durable source of pending reply work.
- Schedule hosted assistant wakes from scanner-visible unhandled Assistant Input, not mailbox import progress alone.
- Keep active-turn notification as a latency optimization only.
- Fix hosted latency traces so provider start can be recorded when a staged input is handled by a later runtime attempt.

## Constraints

- Do not add a new late-input queue, table, or cursor.
- Do not weaken foreground reply priority over device sync or maintenance.
- Preserve terminal-evidence filtering so already handled inputs do not wake-loop.
- Keep logs and diagnostics metadata-only.

## Verification Plan

- Focused assistant-engine pending-input scanner tests.
- Focused assistant-runtime hosted runner or phase regression for foreground import wake scheduling.
- Focused hosted latency store regression for cross-attempt provider start.
- Package/app scoped typecheck for touched owners where feasible.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
