# PR 620 ReviewGPT Round 6

## Goal

Apply the existing failed-provider resume-state decision consistently for
interactive and scheduled notification turns so retained cron occurrences do
not retry a rejected resume or lose a provider-confirmed thread.

## Scope

- Move the existing clear/persist/preserve session mutation into the current
  turn-finalizer owner and delete the local-service-only implementation.
- Apply the same action before a notification `failed_terminal` outcome is
  surfaced.
- Keep isolated maintenance turns on the existing preserve behavior.
- Add focused notification and cron proof for rejected and accepted provider
  thread identities without adding retry state, lifecycle enums, or services.

## Verification

- First capture the notification-path gap with a failing focused regression.
- Run focused assistant-engine tests, the package typecheck and full suite, and
  the affected-owner verification lane.
- Run the required coverage/write and security/privacy completion audits.
- Commit, push, require green CI, and run ReviewGPT on the new exact head.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
