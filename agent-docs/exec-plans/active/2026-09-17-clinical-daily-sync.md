# Daily clinical record sync and provider privacy controls

Status: active
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Support daily authorized medical-record updates with bounded provider work and clear controls for stopping retrieval and deleting imported data. Align in-app privacy explanations and Epic registration guidance with actual behavior.

## Success criteria

- Persistent authorization is optional and server-owned; existing one-time connections remain usable.
- Daily work is durable, idempotent, consent-bound, and bounded. No unchanged document is repeatedly sent for model extraction. Unsupported incremental APIs do not silently claim complete coverage.
- Revocation, disconnect, deletion, and expired authorization stop future collection and stale writers.
- Privacy controls distinguish disconnecting from existing full-account deletion; hospital-specific erasure is excluded.
- Focused tests, typechecks, rendered proof, final-head CI, and requested ReviewGPT resolve before PR completion.

## Architecture and evidence

Web owns SMART credentials, connection generations, retrieval plans, request accounting, and status. Runtime imports through the existing system mailbox and vault-usecases; core owns canonical writes. Current SMART flow has no refresh-token field and clears credentials after finalization. Current Records disconnect retains imported evidence; account deletion has a separate durable cleanup workflow. Default Epic acquisition on current main already restricts automatic-distribution APIs, with broader APIs explicitly configured per organization.

Do not create another scheduler or canonical data store. Reuse existing scheduled recovery admission and mailbox delivery. Keep credentials in Web encryption, clinical contents in the vault, and only operational state in Postgres. Source deletion requires inspection of canonical historical evidence and snapshot ownership before choosing a safe implementation.

## Product UX

- Entry and promise: authorize a source, see whether daily updates are supported, inspect last/next check, stop updates, and reach the existing account-deletion controls.
- Journeys: new persistent grant; legacy one-time grant; refresh denied/expired; unchanged daily check; new/corrected records; partial results; disconnect/deletion racing active work; phone and desktop privacy controls.
- Proof: provider-shaped authorization and refresh tests, actual scheduled admission through terminal outcome, canonical readback for deletion, and real component rendering.
- Done when: supported journeys report truthful final outcomes; operational Epic provisioning dependencies are documented separately from code readiness.

## Tasks

1. Verify current provider capability, registration, source deletion, scheduler and retention boundaries; choose the smallest implementation.
2. Add encrypted persistent authorization and daily admission with bounded refresh concurrency and revocation fences.
3. Add economical recurring retrieval and unchanged-document handling without weakening correction coverage.
4. Link existing account deletion and consent controls; distinguish disconnect from erasure.
5. Update owner docs, registration/privacy questionnaire guidance, and member changelog.
6. Run focused tests/typechecks and rendered proof; parent review; scoped commits and PR; run ReviewGPT concurrently with CI.

## Decisions

- Daily cadence is the requested target; incremental support must be proven per API rather than assumed from generic FHIR support.
- Epic registration changes and new patient authorization may be required; never claim that code alone enables persistent provider access.
- No production data deletion or account mutation is part of verification; use synthetic evidence.
- Use existing account deletion for this release. Address MyChart warnings through truthful Epic questionnaire guidance. Both automatic hospital distribution and avoiding per-check patient consent are requirements.

## Verification

Select focused clinical SMART, connection, retrieval, runtime, canonical deletion, consent-withdrawal, and UI suites after implementation boundaries are established. Include overlap/concurrency, expired credentials, partial search, unchanged data, and stale work after deletion. Run relevant package typechecks and complexity guard. Final ReviewGPT and CI apply to the exact pushed head.

## Candidate evidence

Implemented optional persistent SMART credentials, lease-protected rotation,
bounded daily admission through the existing recovery sweep, overlapping native
query windows, periodic lifetime checks, and private extraction reuse. Simplified
record outcomes and linked the existing account deletion controls. Corrected the
required longitudinal care-plan category while retaining frozen request identity.

Focused Web suites cover explicit opt-in, callback binding, rotation and failure,
admission replay, disconnect fencing, credential retention and route authorization.
Real PostgreSQL deletion/withdrawal concurrency: 10 passed. Enrichment/readback:
40 passed. Web and vault-usecases typechecks passed. Complexity guard passed with
no added debt; existing retrieval orchestration hotspots remain unchanged. The
real component study fits 1440, 390 and 320 pixel viewports without overflow.

Epic questionnaire editing, per-organization credential provisioning and a live
persistent grant remain operator rollout steps, not proven by local tests. Keep
persistent credentials disabled until the documented hosted rollout is verified.
PR, final external review and exact-head CI are pending at this candidate.
