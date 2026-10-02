# Clarify unrecognized Verify failure diagnostics

## Outcome

Distinguish an allowlisted Twilio parameter label in an alternate message format from an unknown label, within the existing bounded private error cause. Keep public responses, authentication decisions, requests, and retries identical.

## Proof and owners

ReviewGPT authors a minimal diagnostic-only patch in the current bounded Verify failure reader. Parent verifies synthetic suffix privacy, unchanged decision semantics, finite cardinality, tests, typecheck, and final exact-head ReviewGPT with required CI. No private production message enters fixtures or review context. Existing auth retirement PR does not modify the Verify owner.

## Deployment

No schema, provider contract, or policy changes. Telemetry-only deployment remains eligible only after all canonical compatibility and CI gates. Verify the promoted SHA and natural diagnostic emission read-only; preserve the query if traffic has not exercised it. No sign-in or provider messages are sent by this task.

## Status

ReviewGPT authored the bounded observation-only change. Parent review confirms a closed five-label vocabulary and unchanged exact classifier, public errors, request count, timeout, retry and authentication behavior. Synthetic base proof: 11 failed / 46 passed; patched proof: all 57 passed. Web typecheck, targeted ESLint, diff whitespace and complexity passed (debt 0 to 0; maximum complexity 20). Final pushed-candidate review and required CI remain pending. The production rejection cause remains unresolved until natural traffic exercises the diagnostic.
