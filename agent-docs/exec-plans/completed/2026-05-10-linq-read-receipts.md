# Linq Read Receipts

## Goal

Restore hosted Linq/iMessage read receipts for accepted inbound conversation messages
without reintroducing provider payload decryption or provider identifiers into durable
workflow inputs.

Success means active-member Linq webhook handling marks the provider chat as read only
after the mailbox item is durably appended and the runner handoff path has been started
or directly accepted.

## Constraints

- Keep workflow inputs pointer-only: mailbox item id plus source label.
- Do not store chat ids, phone numbers, message bodies, webhook payloads, or provider
  response payloads in workflow state.
- Keep read receipts best-effort, bounded by a short timeout, and non-blocking for
  webhook acknowledgement beyond metadata-only timing.
- Do not weaken mailbox checkpoint supervision or make read receipts the evidence that
  assistant handling completed.
- Log only sanitized metadata such as status, booleans, timing labels, and suffixes.

## Implementation Plan

1. Inspect current Linq planner output, webhook handoff result, and focused tests.
2. Restore a bounded route-side read receipt after mailbox append plus successful
   workflow start or direct nudge acceptance.
3. Add/update tests proving read receipts send for accepted active-member messages and
   do not send before mailbox persistence or handoff.
4. Run focused hosted web verification plus required audits.

## Verification Plan

- Focused hosted onboarding Linq dispatch tests.
- Focused hosted onboarding Linq HTTP tests if helper behavior changes.
- `pnpm test:diff` for touched files or the narrowest truthful `apps/web` checks.
- Required security/privacy, coverage, and final review audits per repo workflow.

## Progress

- Plan opened.
- Restored route-side best-effort Linq read receipts after active-member mailbox
  append and successful workflow/direct-nudge handoff.
- Updated focused Linq dispatch tests to assert read receipts send for active-member
  accepted messages and remain non-blocking on provider failure.
- Focused Linq dispatch Vitest file passed.
- Apps/web typecheck passed.
- Apps/web lint passed with pre-existing warnings in device-sync agent-session code.
- Focused Linq HTTP and webhook workflow Vitest files passed.
- Coverage worker added direct-nudge-after-workflow-start-failure read-receipt proof;
  focused Linq dispatch now passes with 42 tests.
- Scoped `test:diff` reached full `apps/web verify`; lint/build completed but app
  Vitest failed on stale direct-nudge expectations outside this change.
- Security/privacy review reported no concrete findings.
- Final completion review reported no concrete findings.

Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
Completed: 2026-05-10
