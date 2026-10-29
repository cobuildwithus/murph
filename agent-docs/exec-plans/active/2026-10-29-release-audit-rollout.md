# Release audit rollout and native canary recovery

Status: active
Created: 2026-10-29
Updated: 2026-10-29

## Goal

Ship the reviewed audit fixes to production Web and hosted runtime, verify iOS TestFlight delivery, and recover both protected native canaries.

## Authority and constraints

The user explicitly authorized backend, iOS and TestFlight deployment and native canary fixes. Preserve unrelated checkouts. Production secrets remain in protected workflows. No production identity reset, rollback or App Store review submission is authorized. Completed audit evidence remains immutable.

## Tasks and gates

1. Merge current main into the owned backend fix branch, complete focused proof, publish PR 4397 and run final ReviewGPT concurrently with CI.
2. Rotate native canary pins to reviewed native main revisions with green main CI, using new immutable tags. Run controller contract tests and protected canaries after the policy and deployed Web converge.
3. Merge the backend only with resolved review, exact-head checks and mergeability; verify production Web and dispatch the normal protected gradual Cloudflare rollout with predeploy and live smoke gates enabled.
4. Establish current iOS upload state. The release PR records successful upload of 1.1.24 (57); do not duplicate an already uploaded build. Confirm TestFlight processing and tester availability through supported authenticated access if available.
5. Diagnose remaining native failures using closed stage summaries. Correct proven causes without weakening assertions or exporting private logs.
6. Record actual receipts, external blockers and final rollout status; close this plan only after the task outcome is established.

## Evidence so far

- Backend merged current main cleanly. All 66 focused auth/deletion tests pass, including real PostgreSQL proof across the encrypted session boundary.
- Standalone Web typecheck exposed missing DOM async-iteration declarations for the existing bounded asset-import stream. Add the standard library declaration without changing runtime code.
- iOS main 49c2994b9cf709a281bd93995fb0679430fe9fe5: CI 40580321375 passed. Includes protected inbox probing and closed login diagnostics absent from the old controller pin.
- Android main 916813760e1585ec84dc7ac1f1dcf75f874eae48: CI 40412071292 and instrumentation 40412071279 passed. Includes first-party auth and removal of the old Privy dependency.
- New native tags point directly to these reviewed commits. Advancing source does not itself prove recovery; the real protected journeys must pass.
- iOS release PR 284 records build 57 upload success and Apple processing acceptance; TestFlight availability was not verified there.
