# PR 620 ReviewGPT Round 3

## Goal

Prevent fresh-thread fallback from replaying any provider action whose result may be ambiguous.

## Scope

- Register dynamic-tool server requests in the existing provider-action set before execution.
- Reuse the existing failure mapper whenever an accepted no-reply or provider action fences fallback.
- Update focused app-server and provider fallback coverage; add no state, queue, or per-tool retry machinery.

## Verification

- Run focused assistant-engine tests and typecheck.
- Complete coverage-write and security/privacy follow-up.
- Push, run ReviewGPT on the new exact head, and require green CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
