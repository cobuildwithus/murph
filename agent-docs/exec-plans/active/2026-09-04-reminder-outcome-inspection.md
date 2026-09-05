# Reminder execution inspection

Status: active

## Outcome and invariant

Answer what happened to a reminder through its existing read-only inspection tool. Retained attempts and exact outstanding delivery evidence remain authoritative; consumed work does not imply delivery.

## Product UX

- Outcome: Distinguish running, execution retry, pending occurrence, and pending delivery; explain recent delivered, skipped, expired, and failed attempts with a useful next step.
- Reaches: Existing authenticated individual and group automation inspection. No new delivery authority, writes, retry policy, or history storage.
- Proof: Synthetic persisted runtime/journal/outbox fixtures, dynamic-tool serialization, hosted runtime composition, and focused real-assistant interpretation.

## Implementation

Derive a bounded inspection from the existing runtime owner, ten newest retained runs, and at most one exact outbox intent. Exclude prompts, responses, routes and diagnostics. Preserve stored schedules and occurrence timing projection.

## Verification

Pending focused regression, relevant typechecks, complexity guard, candidate review, exact-head CI and final ReviewGPT.
