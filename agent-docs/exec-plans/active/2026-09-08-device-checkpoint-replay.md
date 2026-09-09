# Preserve device continuation progress through hosted checkpoints

Status: active
Created: 2026-09-08
Updated: 2026-09-08

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

1. Locate the handoff that loses continuation progress.
2. Reproduce it through existing production owners; add missing bounded error evidence if required.
3. Apply the smallest proven correction and run focused tests and typecheck.
4. Complete review and CI, deploy, and verify recovery.

## Decisions

- Provider work executes, so investigation starts at continuation publication and recording rather than ingress or admission limits.
- Production logs are private operational evidence and are not copied into this plan.
- The first candidate closes a proven diagnostic gap: rejected continuation persistence returns a retry with the old wake but the dedicated system lane emits no failure event. The existing pass-finished event precedes that write.
- Synthetic proof confirms a valid 127-job continuation survives mailbox recording; an invalid continuation preserves the original wake and now reports the schema rejection without payload values. This does not establish the live exception or complete the recovery task.

## Verification

- Focused system-mailbox and workspace entrypoint tests, relevant runtime typecheck, and complexity guard.
- A reconstructed pass receives the preceding accepted continuation; failures preserve ownership and emit useful diagnostics.
- Diagnostic candidate: focused system-mailbox suite passes 106 tests; assistant-runtime typecheck and complexity guard pass.
