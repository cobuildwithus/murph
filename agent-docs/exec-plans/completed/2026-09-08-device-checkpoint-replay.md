# Preserve device continuation progress through hosted checkpoints

Status: completed
Created: 2026-09-08
Updated: 2026-09-09

## Goal

- Make retained device work advance across hosted checkpoints and cold restores.

## Success criteria

- Reproduce the failing handoff with synthetic input before changing behavior.
- Preserve exact dirty acknowledgements, accepted child jobs, retries, and foreground priority.
- Verify the deployed runner retains progress and drains accepted dirty work.

## Scope

- In scope: device pass recovery, system-mailbox persistence, and metadata-only failure diagnostics.
- Out of scope: provider policy changes, queue capacity changes, and unrelated Cloudflare deployment work.

## Constraints

- Technical constraints: keep the existing mailbox and checkpoint owners; do not introduce another queue or snapshot machine-local SQLite.
- Product/process constraints: no private production evidence in artifacts; use synthetic tests and required PR verification.

## Risks and mitigations

1. Mistaking activity or checkpoint success for job progress.
   Mitigation: compare continuation metadata across passes and exercise reconstruction from the accepted snapshot.

## Tasks

1. Completed: locate the handoff that loses continuation progress.
2. Completed: reproduce it through existing production owners and add bounded error evidence.
3. Completed: apply the smallest proven correction and run focused tests and typecheck.
4. Completed: review, merge, deploy, and verify recovery through persisted progress and dirty-payload removal.

## Decisions

- Provider work executes, so investigation starts at continuation publication and recording rather than ingress or admission limits.
- Production logs are private operational evidence and are not copied into this plan.
- The first candidate closes a proven diagnostic gap: rejected continuation persistence returns a retry with the old wake but the dedicated system lane emits no failure event. The existing pass-finished event precedes that write.
- Synthetic proof confirms a valid 127-job continuation survives mailbox recording; an invalid continuation preserves the original wake and reports the schema rejection without payload values. Deployed diagnostics subsequently confirmed rejection of a manifest-generated calendar refresh field.
- Diagnostic PR #3080 and reader correction PR #3084 are merged and deployed through the protected release path. The Web reader was verified live before the corrected runner rollout completed.
- A producer-to-reader regression independently reproduces six manifest-valid Junction fields rejected by the generic wake reader: calendar refresh, companion admission and observation, source instance and type, and silent-source timestamp. The smallest correction extends the existing typed allowlist; no new parser or state owner is required.

## Product UX

- Outcome: preserve accepted sync work when a pass yields and resumes.
- Reaches: calendar refresh jobs, companion observations, source-specific jobs, and silent-source recovery; normal jobs and rejection of undeclared fields keep their existing boundaries.
- Proof: manifest-normalized jobs survive the production hint producer and wake reader. Live readback confirms the next pass receives the preceding saved continuation, pending jobs decrease, and the primary database removes processed dirty payloads. Result: Ready; remaining accepted work continues through the existing queue owner.

## Verification

- Focused system-mailbox and workspace entrypoint tests, relevant runtime typecheck, and complexity guard.
- A reconstructed pass receives the preceding accepted continuation; failures preserve ownership and emit useful diagnostics.
- Diagnostic candidate: focused system-mailbox suite passes 106 tests; assistant-runtime typecheck and complexity guard pass.
- Reader correction: all six producer-to-reader cases fail before the correction and pass afterward; the two device-sync suites pass 140 tests. Device-sync typecheck and complexity guard pass (debt and hotspot maximum unchanged).
- The mailbox lifecycle suite passes 106 tests, including recording and reloading a 127-job continuation containing a calendar refresh. Assistant-runtime typecheck and 10 changelog rendering tests pass.
- Web typecheck, required exact-head CI, and final ReviewGPT pass. The independent review reproduced the six rejected fields and checked malformed inputs and directional reader compatibility.
- Protected Cloudflare smoke and release convergence pass. The affected runtime reports the corrected source, the former schema rejection stops, continuation recording succeeds, and the next pass loads the preceding progress fingerprint. Durable dirty-payload removal verifies recovery beyond import or checkpoint activity alone.
Completed: 2026-09-09
