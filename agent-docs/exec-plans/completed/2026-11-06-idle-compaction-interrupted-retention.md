# Preserve retention deadlines after empty wake interruption

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Accepted finding and correction

ReviewGPT round 1 for PR #4721 found that the admission snapshot can be false before a later empty wake interrupts maintenance. The interruption owner returns `pending_work` with no replacement deadline; the selector must retain that outcome check in addition to the new admission check. Otherwise checkpoint publication clears an unfulfilled retention deadline.

Restore the existing interruption predicate at the same selector. Keep the new admission predicate for compacted, failed, and no-warm-process outcomes. No state, timeout, authority path, or schema changes are needed. The prior completed implementation record is immutable and is superseded only for this correction.

Outcome: preserve scheduled content cleanup after an empty runtime notification.
Reaches: idle maintenance and its model-free retention successor; foreground preemption remains unchanged.
Proof: reproduce the lost deadline through the real maintenance and entrypoint, then assert checkpoint publication, invocation return, and restored successor execution.

## Verification and completion

The composed empty-wake regression failed before the correction with a null persisted retention deadline (exit 1), then passed with the restored predicate. All 97 affected tests across four runtime boundary suites passed, including restored model-free successor execution; runtime typecheck and complexity passed (exit 0). Parent final review accepted the minimal correction and found no unresolved accepted issue.

Round 1 reviewed code candidate `d30762a27ad466a2fc9760c27d61a544b9d659b5` with GPT-6 Pro and returned one finding. The reviewed candidate also completed CI with 37 successful checks and 3 scoped skips. The correction still requires final exact-head CI after push. One review round suffices under the completion policy because this corrects the reviewed predicate without new state, design, authority, or risky surface. This record closes local remediation and does not claim deployment or production verification.
Completed: 2026-11-06
