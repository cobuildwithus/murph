# Preserve channel welcome delivery identity across acceptance

Status: implementation verified; completion gates pending
Created: 2026-10-04
Updated: 2026-10-05

## Goal

Accepted phone welcomes must reach the delivery ledger and home-route materialization under the same member-bound identity contract that admitted their send.

## Scope and authority

Reuse the shared welcome identity validator in the Web delivery callback. Preserve authenticated-member binding, route evidence, receipt locking, transaction ordering, and legacy malformed-thread handling. No production data repair, replay, provider send, merge, or deployment. Other contact-card, activation, and typing work is independent and remains untouched.

## Product UX

- Effort: Patch. Result: Ready for the tested local journeys; production outcome awaits an authorized deployment and read-only verification.
- Accepted participant welcomes in original, legacy phone, and destination-specific forms complete the existing atomic handoff. The shared owner also recognizes destination-specific email identities; the existing materializer still requires the matching participant dispatch record and current verified phone/assigned line.
- Existing-thread welcomes record without rematerializing. Recognized foreign-member identities fail before writes on both paths. Malformed participant keys and missing provider/participant evidence still fail closed. Legacy malformed-thread recording is unchanged.
- No additional provider dispatch, product state, fallback, or recovery machinery.

## Implementation and review decisions

The stale local parser recognized only original signup keys. Claude Opus authored the correction under the user's explicit 2026-10-05 implementation instruction, replacing the initially unavailable ReviewGPT authoring lane. Parent review rejected an unnecessary expansion of malformed-thread rejection; Opus revised its patch to preserve that behavior. The final production change uses the existing shared predicate and removes the duplicate parser.

The callback continues to lock receipts, materialize the home route, and record acceptance in that order inside the same transaction. Member/route ownership remains with the existing materializer and store. No contract/schema/producer change is needed. No model instructions, tool choices, or reply composition change; live model verification is not applicable.

## Verification

- Expanded synthetic actual-route baseline: 6 failed, 51 passed. Three valid participant formats were rejected; three recognized foreign-member thread formats were incorrectly admitted by the route guard.
- Corrected callback, admission, home-routing, and changelog suites: 220 passed, including all 57 callback cases.
- Focused ESLint and whitespace checks passed.
- Complexity guard passed: callback 31 to 30; total changed-file complexity 108 to 102. The remaining callback hotspot expresses its existing validation/transaction sequence; extracting wrappers would obscure the ordering without reducing policy.
- Web typecheck, documentation drift, and documentation gardening passed. Exact-head CI and final review remain pending.

## Completion

1. Complete local checks and parent candidate review.
2. Candidate committed and pushed; draft PR #4015 owns the correction and changelog provenance.
3. Mark the stable candidate Ready and start final ReviewGPT concurrently with required CI.
4. Keep this functional PR for human merge. Close the plan only after the completion gates resolve, or retain the specific blocker.

No production change or recovery is claimed by the local regression result.
