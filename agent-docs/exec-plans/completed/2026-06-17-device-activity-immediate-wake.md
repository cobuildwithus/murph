# Device Activity Immediate Wake

## Goal

Fix hosted system-mailbox processing so an immediate assistant follow-up wake reliably remains armed after the mailbox item is recorded.

## Evidence

- Hosted device-sync mailbox wake for the affected member was imported and processed.
- Pre-record system mailbox log had a next wake present, but the post-record log did not.
- Later assistant scans only saw the daily automation, so the device-activity follow-up was not armed for delivery.

## Plan

1. Add a regression for a system-mailbox metrics result that returns an immediate assistant wake.
2. Preserve immediate assistant wakes across the system-mailbox post-checkpoint path.
3. Run the focused hosted runtime test and required typecheck/test verification.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
