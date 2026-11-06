# Preserve channel welcome delivery identity across acceptance

Status: completed
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
- Web typecheck, documentation drift/gardening, exact-base/head documentation proof, and all five rendered PR evidence validators passed.
- Final ReviewGPT round 1 on `5d3c944bfaa32369960b2b48e3920d35d19902dc`: PASS, zero qualifying or accepted findings. Accepted-turn identity and exact response hash verified; managed requested-model capture exceeded its minimum response time.
- Required CLI platform and hosted Stripe boundary checks passed on the reviewed head. Release aggregation was still running at plan closeout; final-head required CI remains a PR handoff gate.

## Completion and handoff

PR #4015 contains the implementation and release-note provenance. Parent final review confirms that only the shared-validator substitution and duplicate-parser deletion change production behavior; the receipt transaction, route ownership, and followup sequence are unchanged. No unresolved review findings remain.

This plan-closeout commit changes explanatory documentation only, so the resolved substantive review remains valid under the review-loop exemption. Required checks must pass on the final pushed head before merge readiness is reported. Keep the functional change for human merge, then use read-only deployed-revision and exact receipt/home-route evidence to verify production recovery. No production write or recovery occurred during this task.
Completed: 2026-10-05
