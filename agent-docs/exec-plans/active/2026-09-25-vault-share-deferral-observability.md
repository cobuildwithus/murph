# Attribute vault-share deferrals without changing delivery

Status: active
Created: 2026-09-26

## Outcome and invariant
Distinguish the existing deferred-delivery route branches using one fixed, metadata-only diagnostic. Preserve exact generic HTTP errors, retryability, authority, delivery, reads/writes, timeouts, ordering and public contracts. No raw production evidence belongs in this plan.

## Evidence and ownership
The current route maps four distinct conditions to the same error. Its generic error logging cannot distinguish a continuation generation change, initial stale generation with remaining work, inactive unmaterialized work, or guarded replacement rejection. Existing route fixtures independently exercise these conditions. Database projections cannot reconstruct the historical branch. The Web delivery route owns this decision; Vercel owns its existing logs. Current open PRs and the earlier group-readiness plan do not implement this observation; their actual path scopes were inspected. The primary checkout is foreign and remains untouched.

## Smallest change
ReviewGPT implements a closed four-value reason at existing callsites and one failure-only diagnostic in the existing deferred-error helper. No new state, dependency, framework, endpoint, correlation identifier, health kind, counts, payload, or per-destination logging. Success produces no new record. Logging failure cannot change the deferred response. The observation answers the branch question; deeper replacement reasons remain deliberately uninstrumented until evidence warrants them.

## Verification and release
- Extend current composed route fixtures for all reasons, identical response shape, success silence, private-field exclusion and throwing logger.
- Red-old/green-new proof, focused route/store tests, Web typecheck/lint, logs/privacy/provider guards, documentation drift, diff and complexity review.
- Parent candidate review, scoped commit and draft PR, Ready after focused proof; final ReviewGPT concurrently with exact-head required CI.
- Telemetry-only eligible for ordinary protected merge and canonical Git-managed Web deployment after all gates. No functional fix or production data/config mutation.
- Old/new callers see identical responses. Verify exact serving descendant and natural logs; preserve bounded query if no occurrence.

## Progress
- Current code, owner contracts and synthetic branch fixtures inspected. Implementation requested from ReviewGPT.
- ReviewGPT implemented the two-file telemetry/test patch. Parent added warning-spy cleanup and the Web owner note; production source remains the returned implementation.
- New route tests fail against the original source only at missing diagnostic assertions (10 failures, 29 passes), while exact generic response assertions pass. With telemetry: 72 focused route/store/scope tests pass. Web typecheck, focused lint, logging privacy guard, docs drift and whitespace checks pass.
- Parent privacy/cost review: one closed metadata record per deferral; no dynamic source values, success logs, additional awaited operations, I/O or state. Complexity debt remains 6 and maximum 26; the existing route hotspot retains its authority and pagination branches, with no new control flow in that owner.
- Internal-only observability: no member-visible changelog, UI rendering or provider-input measurement applies. Pending pushed candidate, final review, required CI and authorized telemetry-only release gates.
